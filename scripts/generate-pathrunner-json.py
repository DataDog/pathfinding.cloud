#!/usr/bin/env python3
"""
Pulls the pathrunner reference artifact (pathrunner-reference.json) from the
DataDog/pathrunner repo and converts it into the data files the pathfinding.cloud
website consumes.

pathrunner is the source of truth: its `cmd/gendocs` binary generates
docs/reference/pathrunner-reference.json and commits it. This script PULLS that
artifact (one-directional, read-only), mirroring scripts/generate-labs-json.py.

Produces:
  docs/pathrunner.json                     -- Lightweight index (counts + summaries
                                              for landing page, sidebar, and search)
  docs/pathrunner/data/commands/{name}.json -- Full per-command detail (lazy-loaded)
  docs/pathrunner/data/modules/{id}.json    -- Full per-module detail (lazy-loaded)
  docs/pathrunner/data/payloads/{slug}.json -- Full per-payload detail (lazy-loaded)
  docs/pathrunner/gifs/{name}.{gif,webm}    -- Demo media (command GIFs + per-module
                                              WebM videos), when present (optional)

Usage:
    # Fetch from GitHub (default - for CI/CD)
    python generate-pathrunner-json.py

    # Read from local clone (for development)
    python generate-pathrunner-json.py --source-dir ../pathrunner
"""

import argparse
import base64
import json
import os
import re
import shutil
import sys
from pathlib import Path

import requests


GITHUB_OWNER = "DataDog"
GITHUB_REPO = "pathrunner"

# Location of the generated artifact and media inside the pathrunner repo.
REFERENCE_PATH = "docs/reference/pathrunner-reference.json"
GIFS_DIR = "docs/reference/gifs"

# The schemaVersion major we understand. A different major means the artifact
# shape changed incompatibly and this script must be updated before it is trusted.
SUPPORTED_SCHEMA_MAJOR = 1

# Output locations (relative to repo root; main() chdirs there).
INDEX_OUTPUT = "docs/pathrunner.json"
DATA_ROOT = Path("docs/pathrunner/data")
GIFS_OUTPUT = Path("docs/pathrunner/gifs")

# Cross-reference source: the labs index, built by generate-labs-json.py. Must run
# AFTER that script so module pages can deep-link to a matching lab.
LABS_INDEX = "docs/labs.json"


# --------------------------------------------------------------------------- #
# Fetching the artifact (GitHub API or local clone)
# --------------------------------------------------------------------------- #

def build_github_headers(github_token=None):
    """Build the GitHub API request headers, adding auth when a token is set."""
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"
    return headers


def fetch_github_raw_file(file_path, headers):
    """Fetch a raw text file from the pathrunner repo via the Contents API."""
    url = (
        f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}"
        f"/contents/{file_path}"
    )
    response = requests.get(url, headers=headers, timeout=30)
    if response.status_code != 200:
        return None

    content_data = response.json()
    content_bytes = base64.b64decode(content_data["content"])
    return content_bytes.decode("utf-8")


def fetch_github_dir_listing(dir_path, headers):
    """List the files in a directory of the pathrunner repo via the Contents API.

    Returns a list of (name, download_url) tuples, or an empty list if the
    directory does not exist (the GIFs dir is optional and may be absent).
    """
    url = (
        f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}"
        f"/contents/{dir_path}"
    )
    response = requests.get(url, headers=headers, timeout=30)
    if response.status_code != 200:
        return []

    listing = response.json()
    if not isinstance(listing, list):
        return []

    return [
        (item["name"], item["download_url"])
        for item in listing
        if item.get("type") == "file"
        and (item["name"].endswith(".gif") or item["name"].endswith(".webm"))
    ]


def load_reference(source_dir, headers):
    """Load the pathrunner reference artifact from a local clone or GitHub."""
    if source_dir:
        reference_file = Path(source_dir) / REFERENCE_PATH
        if not reference_file.exists():
            print(f"Error: reference artifact not found at {reference_file}")
            sys.exit(1)
        print(f"Reading reference artifact from {reference_file}")
        return json.loads(reference_file.read_text(encoding="utf-8"))

    print(
        f"Fetching reference artifact from GitHub: "
        f"{GITHUB_OWNER}/{GITHUB_REPO}/{REFERENCE_PATH}"
    )
    raw = fetch_github_raw_file(REFERENCE_PATH, headers)
    if raw is None:
        print(
            f"Error: could not fetch {REFERENCE_PATH} from "
            f"{GITHUB_OWNER}/{GITHUB_REPO} (repo private, missing, or rate-limited)"
        )
        sys.exit(1)
    return json.loads(raw)


def make_gif_play_once(gif_path):
    """Strip the NETSCAPE2.0 looping extension so the GIF plays once, not forever.

    VHS/ffmpeg GIFs embed a NETSCAPE2.0 application-extension block that sets an
    infinite loop count. Removing that block (pure stdlib byte surgery, no
    re-encode) makes the animation play a single time. Safe and idempotent: if the
    signature is absent (already stripped, or an unusual encoder) the file is left
    untouched.
    """
    try:
        data = gif_path.read_bytes()
        signature = b"\x21\xFF\x0BNETSCAPE2.0"
        start = data.find(signature)
        if start == -1:
            return  # No loop extension -> already plays once.
        # Walk the data sub-blocks after the 14-byte header to the 0x00 terminator.
        cursor = start + len(signature)
        while cursor < len(data) and data[cursor] != 0x00:
            cursor += 1 + data[cursor]
        if cursor >= len(data):
            return  # Malformed; leave the file as-is rather than corrupt it.
        block_end = cursor + 1  # include the terminating 0x00
        gif_path.write_bytes(data[:start] + data[block_end:])
    except OSError:
        return


def copy_gifs(source_dir, headers):
    """Copy command and per-module demo media into the web root, tolerating missing dirs.

    Command demos live in docs/reference/gifs/ as GIFs (e.g. search.gif,
    modules-list.gif); per-module demos live in docs/reference/gifs/modules/ and
    are now WebM videos (<id>.webm) so the site can offer scrub/pause/seek
    controls. Both are flattened into docs/pathrunner/gifs/ -- module ids
    (lambda-001) never collide with command names.

    The output directory is wiped first so media deleted upstream (e.g. the old
    per-module GIFs, now replaced by WebM) does not linger as orphans. Returns a
    {stem: extension} map (e.g. {"ec2-001": "webm", "search": "gif"}) so detail
    rendering knows both which entries have a demo and how to embed it.
    """
    # Wipe and recreate so stale media (old .gif modules, renamed commands) is
    # not left behind -- the media set is regenerated in full on every run.
    if GIFS_OUTPUT.exists():
        shutil.rmtree(GIFS_OUTPUT)
    GIFS_OUTPUT.mkdir(parents=True, exist_ok=True)
    published = {}  # stem -> extension (without the dot)

    # Top-level command media, then the per-module media subdirectory.
    media_dirs = [GIFS_DIR, f"{GIFS_DIR}/modules"]
    media_globs = ("*.gif", "*.webm")

    if source_dir:
        for rel in media_dirs:
            local_dir = Path(source_dir) / rel
            if not local_dir.exists():
                continue
            for pattern in media_globs:
                for media in sorted(local_dir.glob(pattern)):
                    dest = GIFS_OUTPUT / media.name
                    shutil.copy2(media, dest)
                    if dest.suffix == ".gif":
                        make_gif_play_once(dest)
                    published[media.stem] = media.suffix.lstrip(".")
    else:
        for rel in media_dirs:
            for name, download_url in fetch_github_dir_listing(rel, headers):
                response = requests.get(download_url, timeout=30)
                if response.status_code == 200:
                    dest = GIFS_OUTPUT / name
                    dest.write_bytes(response.content)
                    if dest.suffix == ".gif":
                        make_gif_play_once(dest)
                    published[Path(name).stem] = Path(name).suffix.lstrip(".")

    if published:
        print(f"Published {len(published)} demo media file(s)")
    else:
        print("No demo media found (skipping)")
    return published


# --------------------------------------------------------------------------- #
# Validation and transforms
# --------------------------------------------------------------------------- #

def check_schema_version(reference):
    """Fail loudly if the artifact's schema major version is unsupported."""
    generator = reference.get("generator", {})
    schema_version = generator.get("schemaVersion", "")
    if not schema_version:
        print("Error: reference artifact is missing generator.schemaVersion")
        sys.exit(1)

    major = schema_version.split(".")[0]
    if major != str(SUPPORTED_SCHEMA_MAJOR):
        print(
            f"Error: unsupported schemaVersion {schema_version!r} "
            f"(this script supports major version {SUPPORTED_SCHEMA_MAJOR}.x). "
            f"Update generate-pathrunner-json.py before trusting this artifact."
        )
        sys.exit(1)

    print(f"Reference schemaVersion {schema_version} (supported)")


def slugify(value):
    """Slugify a payload name/qualifiedName for safe filenames and URL routes.

    Payload names contain '/' (e.g. 'exfil/response') and qualifiedNames contain
    ':' (e.g. 'lambda:exfil/response'), so raw values cannot be used as path
    segments. Collapse any run of non-alphanumeric characters to a single '-'.
    """
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug


def build_lab_lookup():
    """Map a pathfinding.cloud path id -> lab slug, from the labs index.

    Matches on both the lab slug (e.g. 'lambda-001') and its pathfindingCloudId
    (frequently null for CTF/other labs), so a module can deep-link to a lab when
    one exists. Missing labs index is tolerated (returns empty).
    """
    labs_file = Path(LABS_INDEX)
    if not labs_file.exists():
        print(
            f"Warning: {LABS_INDEX} not found; module pages will have no lab "
            f"links. Run generate-labs-json.py first."
        )
        return {}

    labs = json.loads(labs_file.read_text(encoding="utf-8"))
    lookup = {}
    for lab in labs:
        slug = lab.get("slug")
        if not slug:
            continue
        cloud_id = lab.get("pathfindingCloudId")
        if cloud_id:
            lookup.setdefault(cloud_id, slug)
        # A lab slug that is itself a path id (e.g. 'lambda-001') also joins.
        lookup.setdefault(slug, slug)
    return lookup


def iter_commands(commands, parent_path=""):
    """Yield top-level commands (subcommands are kept nested in the detail)."""
    for command in commands:
        yield command


# --------------------------------------------------------------------------- #
# Output writing
# --------------------------------------------------------------------------- #

def resolve_module_payloads(module_payloads, services, primary_service, payloads_by_name):
    """Enrich a module's compatible payloads with the concrete payload they map to.

    A module lists payloads by unqualified name (e.g. "backdoor/attach-policy").
    The same name exists for many services; the one this module actually uses is
    the variant whose service the module runs on. Prefer the primary service, then
    any of the module's services. When a variant is found, carry its slug (for
    linking), qualifiedName, service, and tags; otherwise leave slug null so the
    frontend shows a non-linked chip.
    """
    service_set = set(services)
    enriched = []
    for payload in module_payloads:
        name = payload.get("name", "")
        resolved = {"name": name, "description": payload.get("description", "")}
        candidates = payloads_by_name.get(name, [])
        match = (
            next((c for c in candidates if c["service"] == primary_service), None)
            or next((c for c in candidates if c["service"] in service_set), None)
        )
        if match:
            resolved["slug"] = match["slug"]
            resolved["qualifiedName"] = match["qualifiedName"]
            resolved["service"] = match["service"]
            resolved["tags"] = match["tags"]
        else:
            resolved["slug"] = None
        enriched.append(resolved)
    return enriched


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def reconcile_orphans(subdir, valid_ids):
    """Delete stale per-entry detail files no longer present in the artifact."""
    detail_dir = DATA_ROOT / subdir
    if not detail_dir.exists():
        return
    valid_files = {f"{entry_id}.json" for entry_id in valid_ids}
    for existing in detail_dir.glob("*.json"):
        if existing.name not in valid_files:
            existing.unlink()
            print(f"Removed stale {subdir} detail: {existing.name}")


def generate_pathrunner_json(source_dir, output_file):
    github_token = os.environ.get("GITHUB_TOKEN")
    if not source_dir:
        if github_token:
            print("Using GitHub token for API access")
        else:
            print("No GITHUB_TOKEN found, using unauthenticated access (rate limited)")
    headers = build_github_headers(github_token)

    reference = load_reference(source_dir, headers)
    check_schema_version(reference)

    generator = reference.get("generator", {})
    counts = reference.get("counts", {})
    commands = reference.get("commands", []) or []
    modules = reference.get("modules", []) or []
    payloads = reference.get("payloads", []) or []

    media_by_stem = copy_gifs(source_dir, headers)
    lab_lookup = build_lab_lookup()

    # ---- Commands ---------------------------------------------------------- #
    command_index = []
    command_ids = []
    for command in iter_commands(commands):
        name = command.get("name", "")
        if not name:
            continue
        command_ids.append(name)
        command_index.append(
            {
                "name": name,
                "group": command.get("group", ""),
                "short": command.get("short", ""),
            }
        )
        detail = dict(command)
        # Command demos are GIFs keyed by full invocation (e.g. "modules-list",
        # "attacker-identity-show"); attach any whose name matches this command
        # or one of its subcommands so they render on the top-level command page.
        # Commands stay bare stems (the frontend re-derives subcommand stems and
        # tests set membership); command media is always GIF.
        detail["gifs"] = sorted(
            s for s in media_by_stem if s == name or s.startswith(f"{name}-")
        )
        write_json(DATA_ROOT / "commands" / f"{name}.json", detail)

    # ---- Payloads ---------------------------------------------------------- #
    # Processed before modules so each module can resolve its (unqualified)
    # compatible payload names to concrete, linkable payload entries.
    payload_index = []
    payload_slugs = []
    payloads_by_name = {}  # name -> [index entry, ...] across services
    seen_slugs = {}
    for payload in payloads:
        name = payload.get("name", "")
        if not name:
            continue
        qualified = payload.get("qualifiedName") or name
        slug = slugify(qualified)
        # Guard against slug collisions (distinct qualifiedNames that slugify the
        # same) by suffixing a counter -- keeps per-entry files 1:1 with payloads.
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            slug = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 0
        payload_slugs.append(slug)
        service = payload.get("service") or "other"
        entry = {
            "slug": slug,
            "name": name,
            "qualifiedName": qualified,
            "service": service,
            "tags": payload.get("tags", []) or [],
        }
        payload_index.append(entry)
        payloads_by_name.setdefault(name, []).append(entry)
        detail = dict(payload)
        detail["slug"] = slug
        detail["service"] = service
        write_json(DATA_ROOT / "payloads" / f"{slug}.json", detail)

    # ---- Modules ----------------------------------------------------------- #
    module_index = []
    module_ids = []
    for module in modules:
        module_id = module.get("id", "")
        if not module_id:
            continue
        module_ids.append(module_id)
        services = module.get("services", []) or []
        primary_service = module.get("primaryService") or (
            services[0] if services else "other"
        )
        module_index.append(
            {
                "id": module_id,
                "name": module.get("name", ""),
                "category": module.get("category", ""),
                "primaryService": primary_service,
                "services": services,
            }
        )
        detail = dict(module)
        detail["primaryService"] = primary_service
        # Resolve the matching lab slug (if any) for the module page's lab link.
        detail["labSlug"] = lab_lookup.get(module_id)
        # Per-module demo media (keyed by module id). Carry the file extension so
        # the frontend can embed WebM as a <video> (with scrub/pause controls) and
        # fall back to an <img> for any module still shipping a GIF.
        detail["gifs"] = [
            {"name": stem, "ext": media_by_stem[stem]}
            for stem in sorted(media_by_stem)
            if stem == module_id
        ]
        # Resolve each compatible payload (unqualified name, e.g.
        # "backdoor/attach-policy") to a concrete payload entry. The right one is
        # the variant whose service the module actually runs on -- preferring the
        # primary service, else any of the module's services. This makes the
        # module page's payload chips link to the real payload pages.
        detail["payloads"] = resolve_module_payloads(
            module.get("payloads", []) or [], services, primary_service, payloads_by_name
        )
        write_json(DATA_ROOT / "modules" / f"{module_id}.json", detail)

    # ---- Lightweight index ------------------------------------------------- #
    index = {
        "generator": {
            "schemaVersion": generator.get("schemaVersion", ""),
            "pathrunnerVersion": generator.get("pathrunnerVersion", ""),
            "gitCommit": generator.get("gitCommit", ""),
        },
        "counts": counts,
        "commands": command_index,
        "modules": module_index,
        "payloads": payload_index,
    }
    write_json(Path(output_file), index)

    # ---- Reconcile orphaned detail files ----------------------------------- #
    reconcile_orphans("commands", command_ids)
    reconcile_orphans("modules", module_ids)
    reconcile_orphans("payloads", payload_slugs)

    print(
        f"Wrote {output_file}: "
        f"{len(command_index)} commands, "
        f"{len(module_index)} modules, "
        f"{len(payload_index)} payloads"
    )
    modules_with_labs = sum(1 for m in modules if lab_lookup.get(m.get("id")))
    print(f"Resolved lab links for {modules_with_labs} module(s)")


def main():
    parser = argparse.ArgumentParser(
        description="Generate pathrunner.json from the pathrunner reference artifact"
    )
    parser.add_argument(
        "--source-dir",
        help="Path to a local pathrunner clone (default: fetch from GitHub)",
    )
    parser.add_argument(
        "--output",
        default=INDEX_OUTPUT,
        help=f"Output index JSON file path (default: {INDEX_OUTPUT})",
    )
    args = parser.parse_args()

    # Change to project root so all docs/... paths resolve from the repo root.
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    os.chdir(project_root)

    generate_pathrunner_json(source_dir=args.source_dir, output_file=args.output)


if __name__ == "__main__":
    main()
