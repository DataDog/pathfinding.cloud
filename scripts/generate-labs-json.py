#!/usr/bin/env python3
"""
Converts README.md files from pathfinding-labs to JSON files for the website.

README.md is the single source of truth for all display/content fields.
scenario.yaml is NOT read by this script.

Produces:
  docs/labs.json              -- Lightweight index for the list page
  docs/labs/data/{slug}.json  -- Full scenario data including README content

Usage:
    # Fetch from GitHub (default - for CI/CD)
    python generate-labs-json.py

    # Read from local clone (for development)
    python generate-labs-json.py --source-dir /path/to/pathfinding-labs
"""

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import requests


GITHUB_OWNER = "DataDog"
GITHUB_REPO = "pathfinding-labs"
SCENARIOS_ROOT = "modules/scenarios"

# Required metadata fields in every README
REQUIRED_README_METADATA = [
    "Category",
    "Path Type",
    "Target",
    "Environments",
    "Technique",
    "Cost Estimate",
    "Terraform Variable",
]

# Fields included in the lightweight index (labs.json)
INDEX_FIELDS = [
    "slug",
    "displayName",
    "name",
    "description",
    "category",
    "subCategory",
    "pathType",
    "target",
    "costEstimate",
    "interactiveDemo",
    "pathfindingCloudId",
    "environments",
    "githubUrl",
]


# ---------------------------------------------------------------------------
# README metadata parser
# ---------------------------------------------------------------------------

def parse_readme_metadata(readme_text):
    """Extract structured metadata from the README bullet-point block.

    Parses lines like:
      * **Category:** Privilege Escalation
      * **Pathfinding.cloud ID:** iam-002
      * **Terraform Variable:** `enable_single_account_...`
    """
    metadata = {}
    for line in readme_text.split("\n"):
        match = re.match(r"^\*?\s*\*\*(.+?):\*\*\s*(.+)$", line)
        if match:
            key = match.group(1).strip()
            value = match.group(2).strip()
            metadata[key] = value
    return metadata


def extract_h1_title(readme_text):
    """Extract the H1 title from README."""
    match = re.search(r"^# (.+)$", readme_text, re.MULTILINE)
    return match.group(1).strip() if match else None


def validate_readme_metadata(metadata, readme_path):
    """Validate that required metadata fields are present. Returns True if valid."""
    missing = [f for f in REQUIRED_README_METADATA if f not in metadata]
    if missing:
        print(f"  ERROR: {readme_path} missing required metadata: {', '.join(missing)}")
        return False
    return True


# ---------------------------------------------------------------------------
# Structured metadata parsers
# ---------------------------------------------------------------------------

def parse_principals(raw):
    """Parse Attack Principals metadata into a list of ARN strings.

    Input:  `arn:aws:iam::123:user/foo`; `arn:aws:iam::123:role/bar`
    Output: ["arn:aws:iam::123:user/foo", "arn:aws:iam::123:role/bar"]
    """
    if not raw:
        return []
    # Split on semicolons, strip backticks and whitespace
    return [p.strip().strip("`") for p in raw.split(";") if p.strip()]


def parse_required_permissions(raw):
    """Parse Required Permissions metadata into structured objects.

    Input:  `iam:CreateAccessKey` on `arn:aws:iam::*:user/target`; `sts:AssumeRole` on `arn:...`
    Output: [{"permission": "iam:CreateAccessKey", "resource": "arn:..."}, ...]
    """
    if not raw:
        return []
    result = []
    for entry in raw.split(";"):
        entry = entry.strip()
        if not entry:
            continue
        # Match: `permission` on `resource`  OR  just `permission`
        match = re.match(r"`([^`]+)`(?:\s+on\s+`([^`]+)`)?", entry)
        if match:
            item = {"permission": match.group(1)}
            if match.group(2):
                item["resource"] = match.group(2)
            result.append(item)
    return result


def parse_helpful_permissions(raw):
    """Parse Helpful Permissions metadata into structured objects.

    Input:  `iam:ListUsers` (Discover privileged users); `iam:GetUser` (View details)
    Output: [{"permission": "iam:ListUsers", "purpose": "Discover privileged users"}, ...]
    """
    if not raw:
        return []
    result = []
    for entry in raw.split(";"):
        entry = entry.strip()
        if not entry:
            continue
        # Match: `permission` (purpose)  OR  just `permission`
        match = re.match(r"`([^`]+)`(?:\s*\(([^)]+)\))?", entry)
        if match:
            item = {"permission": match.group(1)}
            if match.group(2):
                item["purpose"] = match.group(2)
            result.append(item)
    return result


def parse_comma_list(raw):
    """Parse a comma-separated metadata value into a list of strings."""
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def parse_semicolon_list(raw):
    """Parse a semicolon-separated metadata value into a list of strings."""
    if not raw:
        return []
    return [item.strip() for item in raw.split(";") if item.strip()]


def parse_cspm_expected_finding(raw):
    """Parse CSPM Expected Finding metadata into a structured object.

    Input:  resource_type=aws_ec2_instance; resource_id=pl-cspm-ec2-001; finding=Instance has role...
    Output: {"resource_type": "aws_ec2_instance", "resource_id": "...", "finding": "..."}
    """
    if not raw:
        return None
    result = {}
    for entry in raw.split(";"):
        entry = entry.strip()
        if "=" in entry:
            key, value = entry.split("=", 1)
            result[key.strip()] = value.strip()
    return result if result else None


# ---------------------------------------------------------------------------
# README section parser (v1 schema: H2/H3/H4 hierarchy)
# ---------------------------------------------------------------------------

def split_by_heading_level(text, level):
    """Split text by headings of a given level. Returns {heading: content} dict.

    Prose before first heading stored under '' key.
    """
    prefix = "#" * level + " "
    sections = {}
    current_key = ""
    current_lines = []
    for line in text.split("\n"):
        if line.startswith(prefix) and not line.startswith(prefix + "#"):
            sections[current_key] = "\n".join(current_lines).strip()
            current_key = line[len(prefix):].strip()
            current_lines = []
        else:
            current_lines.append(line)
    sections[current_key] = "\n".join(current_lines).strip()
    return sections


def parse_readme_sections(readme_text):
    """Parse a README.md using the v1 schema H2/H3/H4 heading hierarchy.

    Returns a dict with structured content fields. Returns None if no recognized
    sections are found.
    """
    if not readme_text:
        return None

    # Split by H2 headings
    h2_sections = split_by_heading_level(readme_text, 2)
    if not h2_sections:
        return None

    result = {}

    # --- ## Attack Overview ---
    attack_overview_text = next(
        (h2_sections[k] for k in h2_sections if "Attack Overview" in k), None
    )
    if attack_overview_text:
        h3 = split_by_heading_level(attack_overview_text, 3)

        # Prose before first H3 → overview
        if h3.get(""):
            result["overview"] = h3[""]

        for key, content in h3.items():
            low = key.lower()
            if "mitre" in low:
                result["mitreAttack"] = content
            elif "attack path diagram" in low:
                mermaid_match = re.search(r"```mermaid\n(.*?)```", content, re.DOTALL)
                if mermaid_match:
                    result["attackDiagram"] = mermaid_match.group(1).strip()
            elif "attack steps" in low:
                result["attackSteps"] = content
            elif "resources created" in low or "scenario specific" in low:
                result["resourcesCreated"] = content

    # --- ## Attack Lab ---
    attack_lab_text = next(
        (h2_sections[k] for k in h2_sections if k.strip() == "Attack Lab"), None
    )
    if attack_lab_text:
        h3 = split_by_heading_level(attack_lab_text, 3)
        attack_lab = {}

        for key, content in h3.items():
            low = key.lower()

            if "prerequisites" in low:
                attack_lab["prerequisites"] = content

            elif "deploy" in low and "non-interactive" in low:
                attack_lab["deployNonInteractive"] = content

            elif "deploy" in low and "tui" in low:
                attack_lab["deployTui"] = content

            elif "automated demo" in low or "demo_attack" in low or "demo" in low and "script" in low:
                h4 = split_by_heading_level(content, 4)
                demo = {}
                for h4_key, h4_content in h4.items():
                    h4_low = h4_key.lower()
                    if "resources created" in h4_low:
                        demo["resourcesCreated"] = h4_content
                    elif "non-interactive" in h4_low:
                        demo["nonInteractive"] = h4_content
                    elif "tui" in h4_low:
                        demo["tui"] = h4_content
                    elif h4_key == "" and h4_content:
                        demo["intro"] = h4_content
                if demo:
                    attack_lab["demoAttack"] = demo

            elif "cleanup" in low:
                h4 = split_by_heading_level(content, 4)
                cleanup = {}
                for h4_key, h4_content in h4.items():
                    h4_low = h4_key.lower()
                    if "non-interactive" in h4_low:
                        cleanup["nonInteractive"] = h4_content
                    elif "tui" in h4_low:
                        cleanup["tui"] = h4_content
                if cleanup:
                    attack_lab["cleanup"] = cleanup

            elif "teardown" in low and "non-interactive" in low:
                attack_lab["teardownNonInteractive"] = content

            elif "teardown" in low and "tui" in low:
                attack_lab["teardownTui"] = content

            elif "manual attack" in low:
                attack_lab["manualAttack"] = content

        if attack_lab:
            result["attackLab"] = attack_lab

    # --- ## Detecting Misconfiguration (CSPM) ---
    cspm_text = next(
        (h2_sections[k] for k in h2_sections if "CSPM" in k or "Detecting Misconfiguration" in k),
        None,
    )
    if cspm_text:
        h3 = split_by_heading_level(cspm_text, 3)
        cspm = {}
        for key, content in h3.items():
            low = key.lower()
            if "what cspm" in low or "should detect" in low:
                cspm["whatToDetect"] = content
            elif "prevention" in low:
                cspm["prevention"] = content
        if cspm:
            result["cspm"] = cspm

    # --- ## Detection Abuse (CloudSIEM) ---
    siem_text = next(
        (h2_sections[k] for k in h2_sections if "CloudSIEM" in k or "Detection Abuse" in k or "Cloud SIEM" in k),
        None,
    )
    if siem_text:
        h3 = split_by_heading_level(siem_text, 3)
        cloud_siem = {}
        for key, content in h3.items():
            low = key.lower()
            if "cloudtrail" in low or "cloud trail" in low:
                cloud_siem["cloudTrailEvents"] = content
            elif "detonation" in low:
                cloud_siem["detonationLogs"] = content
        if cloud_siem:
            result["cloudSiem"] = cloud_siem

    # --- ## References ---
    references_text = next(
        (h2_sections[k] for k in h2_sections if "reference" in k.lower()), None
    )
    if references_text:
        result["references"] = references_text

    # Remove empty string values
    result = {k: v for k, v in result.items() if v}

    return result if result else None


# ---------------------------------------------------------------------------
# Scenario discovery -- local filesystem
# ---------------------------------------------------------------------------

def find_local_readmes(source_dir):
    """Find all README.md files under modules/scenarios/ in a local clone."""
    scenarios_path = Path(source_dir) / SCENARIOS_ROOT
    if not scenarios_path.exists():
        print(f"Error: Scenarios directory not found at {scenarios_path}")
        sys.exit(1)

    readme_files = sorted(scenarios_path.rglob("README.md"))
    print(f"Found {len(readme_files)} README files in {scenarios_path}")
    return readme_files


def load_local_readme(readme_path, source_dir):
    """Load a README and compute its relative module path."""
    readme_text = readme_path.read_text(encoding="utf-8")
    module_path = str(readme_path.parent.relative_to(Path(source_dir)))
    return readme_text, module_path


# ---------------------------------------------------------------------------
# Scenario discovery -- GitHub API
# ---------------------------------------------------------------------------

def fetch_github_tree(github_token=None):
    """Fetch the full file tree from the GitHub repo using the Git Trees API."""
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/git/trees/main?recursive=1"
    print(f"Fetching file tree from GitHub: {GITHUB_OWNER}/{GITHUB_REPO}")

    response = requests.get(url, headers=headers, timeout=30)
    if response.status_code != 200:
        print(f"Error: GitHub API returned status {response.status_code}")
        if response.status_code == 404:
            print("Repository may be private or not exist yet")
        sys.exit(1)

    tree_data = response.json()

    # Find README.md files under modules/scenarios/
    readme_paths = []
    for item in tree_data.get("tree", []):
        if (
            item["path"].startswith(SCENARIOS_ROOT)
            and item["type"] == "blob"
            and item["path"].endswith("/README.md")
        ):
            readme_paths.append(item["path"])

    print(f"Found {len(readme_paths)} README files on GitHub")
    return sorted(readme_paths), headers


def fetch_github_raw_file(file_path, headers):
    """Fetch a raw text file from GitHub."""
    url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/contents/{file_path}"
    response = requests.get(url, headers=headers, timeout=15)

    if response.status_code != 200:
        return None

    content_data = response.json()
    content_bytes = base64.b64decode(content_data["content"])
    return content_bytes.decode("utf-8")


# ---------------------------------------------------------------------------
# Slug generation
# ---------------------------------------------------------------------------

def generate_slug(metadata, module_path):
    """Generate a URL slug for a scenario.

    Rules:
    1. If pathfinding-cloud-id exists and target is to-admin -> use the id (e.g., "iam-002")
    2. If pathfinding-cloud-id exists and target is to-bucket -> append "-to-bucket"
    3. If no pathfinding-cloud-id -> use the directory name
    """
    cloud_id = metadata.get("Pathfinding.cloud ID")
    target = metadata.get("Target", "")

    if cloud_id:
        if target == "to-bucket":
            return f"{cloud_id}-to-bucket"
        return cloud_id
    else:
        # Use directory name as slug
        return Path(module_path).name


def disambiguate_slugs(labs):
    """Detect slug collisions and disambiguate by incorporating module path context."""
    slug_groups = {}
    for lab in labs:
        slug_groups.setdefault(lab["slug"], []).append(lab)

    for slug, group in slug_groups.items():
        if len(group) <= 1:
            continue

        # Find the distinguishing path segment between the colliding scenarios
        module_paths = [lab["terraform"]["modulePath"] for lab in group]
        split_paths = [p.split("/") for p in module_paths]
        min_len = min(len(s) for s in split_paths)

        for i in range(min_len):
            segments_at_i = [s[i] for s in split_paths]
            if len(set(segments_at_i)) == len(segments_at_i):
                for lab, seg in zip(group, segments_at_i):
                    lab["slug"] = f"{slug}-{seg}"
                break
        else:
            for idx, lab in enumerate(group):
                lab["slug"] = f"{slug}-{idx}"


# ---------------------------------------------------------------------------
# Transform README data into output JSON
# ---------------------------------------------------------------------------

def transform_readme(readme_text, module_path):
    """Transform a README.md into the output JSON format.

    All display/content fields are sourced from README.md.
    Returns (lab_dict, is_valid) tuple.
    """
    metadata = parse_readme_metadata(readme_text)
    display_name = extract_h1_title(readme_text)

    if not validate_readme_metadata(metadata, module_path):
        return None, False

    # Extract terraform variable, stripping backticks
    terraform_var = metadata.get("Terraform Variable", "")
    terraform_var = terraform_var.strip("`")

    # Parse environments as a list
    environments_raw = metadata.get("Environments", "")
    environments = [e.strip() for e in environments_raw.split(",") if e.strip()]

    # Determine interactive demo status
    interactive_raw = metadata.get("Interactive Demo", "").lower()
    interactive_demo = interactive_raw in ("yes", "true")

    # Directory name as scenario name/id
    name = Path(module_path).name

    result = {
        "displayName": display_name,
        "name": name,
        "description": metadata.get("Technique", ""),
        "costEstimate": metadata.get("Cost Estimate", "$0/mo"),
        "pathfindingCloudId": metadata.get("Pathfinding.cloud ID") or None,
        "interactiveDemo": interactive_demo,
        "category": metadata.get("Category", ""),
        "subCategory": metadata.get("Sub-Category", ""),
        "pathType": metadata.get("Path Type", ""),
        "target": metadata.get("Target", ""),
        "environments": environments,
        "attackPath": {
            "principals": parse_principals(metadata.get("Attack Principals", "")),
            "summary": metadata.get("Attack Path", ""),
        },
        "permissions": {
            "required": parse_required_permissions(metadata.get("Required Permissions", "")),
            "helpful": parse_helpful_permissions(metadata.get("Helpful Permissions", "")),
        },
        "mitreAttack": {
            "tactics": parse_comma_list(metadata.get("MITRE Tactics", "")),
            "techniques": parse_comma_list(metadata.get("MITRE Techniques", "")),
        },
        "terraform": {
            "variableName": terraform_var,
            "modulePath": module_path,
        },
        "githubUrl": f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/tree/main/{module_path}",
    }

    # CSPM-specific fields (only present in CSPM scenarios)
    cspm_rule_id = metadata.get("CSPM Rule ID")
    if cspm_rule_id:
        result["cspmDetection"] = {
            "rule_id": cspm_rule_id,
            "severity": metadata.get("CSPM Severity", ""),
            "expected_finding": parse_cspm_expected_finding(
                metadata.get("CSPM Expected Finding", "")
            ),
        }

    risk_summary = metadata.get("Risk Summary")
    if risk_summary:
        result["risk"] = {
            "summary": risk_summary,
            "impact": parse_semicolon_list(metadata.get("Risk Impact", "")),
        }

    remediation_raw = metadata.get("Remediation")
    if remediation_raw:
        result["remediation"] = {
            "recommendations": parse_semicolon_list(remediation_raw),
        }

    # Parse README sections for prose content
    readme_sections = parse_readme_sections(readme_text)
    if readme_sections:
        result["readme"] = readme_sections

    return result, True


# ---------------------------------------------------------------------------
# Index generation
# ---------------------------------------------------------------------------

def make_index_entry(lab):
    """Extract lightweight index fields from a full lab entry."""
    entry = {}
    for field in INDEX_FIELDS:
        if field in lab:
            entry[field] = lab[field]

    # Include terraform.variableName for deploy info on cards
    if "terraform" in lab:
        entry["terraform"] = {"variableName": lab["terraform"].get("variableName", "")}

    # Include minimal permissions for search
    if "permissions" in lab:
        entry["permissions"] = {
            "required": [
                {"permission": p.get("permission", "")}
                for p in lab.get("permissions", {}).get("required", [])
            ],
            "helpful": [
                {"permission": p.get("permission", "")}
                for p in lab.get("permissions", {}).get("helpful", [])
            ],
        }

    return entry


def validate_slug_uniqueness(labs):
    """Validate that all slugs are unique, error if collision."""
    seen_slugs = {}
    for lab in labs:
        slug = lab["slug"]
        if slug in seen_slugs:
            print(f"Error: Slug collision! '{slug}' used by both:")
            print(f"  - {seen_slugs[slug]}")
            print(f"  - {lab['name']}")
            sys.exit(1)
        seen_slugs[slug] = lab["name"]


# ---------------------------------------------------------------------------
# Main generation pipeline
# ---------------------------------------------------------------------------

def generate_labs_json(source_dir=None, output_file="docs/labs.json"):
    """Main function to generate labs.json and per-scenario JSON files."""
    print("Generating labs JSON (README-only mode)...")

    labs = []
    validation_errors = 0

    if source_dir:
        # Local mode: read from filesystem
        print(f"Reading from local directory: {source_dir}")
        readme_files = find_local_readmes(source_dir)

        for readme_path in readme_files:
            try:
                readme_text, module_path = load_local_readme(readme_path, source_dir)
                lab, is_valid = transform_readme(readme_text, module_path)
                if lab and is_valid:
                    lab["slug"] = generate_slug(
                        parse_readme_metadata(readme_text), module_path
                    )
                    labs.append(lab)
                    print(f"  Loaded: {lab['name']}")
                elif not is_valid:
                    validation_errors += 1
            except Exception as e:
                print(f"  Warning: Error loading {readme_path}: {e}")
    else:
        # GitHub mode: fetch from API
        github_token = os.environ.get("GITHUB_TOKEN")
        if github_token:
            print("Using GitHub token for API access")
        else:
            print("No GITHUB_TOKEN found, using unauthenticated access (rate limited)")

        readme_paths, headers = fetch_github_tree(github_token)

        for file_path in readme_paths:
            try:
                readme_text = fetch_github_raw_file(file_path, headers)
                if readme_text:
                    module_path = str(Path(file_path).parent)
                    lab, is_valid = transform_readme(readme_text, module_path)
                    if lab and is_valid:
                        lab["slug"] = generate_slug(
                            parse_readme_metadata(readme_text), module_path
                        )
                        labs.append(lab)
                        print(f"  Loaded: {lab['name']}")
                    elif not is_valid:
                        validation_errors += 1
            except Exception as e:
                print(f"  Warning: Error fetching {file_path}: {e}")

    if not labs:
        print("No scenarios found!")
        sys.exit(1)

    if validation_errors:
        print(f"\nWARNING: {validation_errors} README(s) failed validation")

    # Disambiguate any slug collisions
    disambiguate_slugs(labs)

    # Validate slug uniqueness
    validate_slug_uniqueness(labs)

    # Sort by slug for consistent ordering
    labs.sort(key=lambda x: x["slug"])

    # Write per-scenario detail files to docs/labs/data/{slug}.json
    detail_dir = Path("docs/labs/data")
    detail_dir.mkdir(parents=True, exist_ok=True)

    readme_count = 0
    for lab in labs:
        detail_path = detail_dir / f"{lab['slug']}.json"
        with open(detail_path, "w") as f:
            json.dump(lab, f, indent=2)
        if "readme" in lab:
            readme_count += 1

    print(f"\nWrote {len(labs)} per-scenario detail files to {detail_dir}/")
    print(f"  With README prose content: {readme_count}")

    # Write lightweight index to labs.json
    index = [make_index_entry(lab) for lab in labs]

    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w") as f:
        json.dump(index, f, indent=2)

    # Calculate size comparison
    index_size = output_path.stat().st_size
    total_detail_size = sum(f.stat().st_size for f in detail_dir.glob("*.json"))

    print(f"\nSuccessfully generated {len(labs)} lab entries")
    print(f"  Index: {output_file} ({index_size / 1024:.1f} KB)")
    print(f"  Detail files: {total_detail_size / 1024:.1f} KB total")

    # Print summary stats
    categories = {}
    for lab in labs:
        cat = lab["category"]
        categories[cat] = categories.get(cat, 0) + 1

    print(f"\nStatistics:")
    print(f"  Total labs: {len(labs)}")
    for cat, count in sorted(categories.items()):
        print(f"  {cat}: {count}")

    linked_count = sum(1 for lab in labs if lab["pathfindingCloudId"])
    print(f"  Linked to pathfinding.cloud: {linked_count}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate labs.json from pathfinding-labs README files"
    )
    parser.add_argument(
        "--source-dir",
        help="Path to local pathfinding-labs clone (default: fetch from GitHub)",
    )
    parser.add_argument(
        "--output",
        default="docs/labs.json",
        help="Output JSON file path (default: docs/labs.json)",
    )

    args = parser.parse_args()

    # Change to project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    os.chdir(project_root)

    generate_labs_json(source_dir=args.source_dir, output_file=args.output)


if __name__ == "__main__":
    main()
