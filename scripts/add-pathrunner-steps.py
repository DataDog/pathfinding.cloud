#!/usr/bin/env python3
"""Add a pathrunner CLI exploitation-steps tab to every pathfinding.cloud path
YAML that has a matching pathrunner module.

Append-only and idempotent: it inserts a `pathrunner:` entry into the existing
`exploitationSteps` block and never rewrites existing content, so diffs stay
minimal and hand-authored YAML (comments, `|` blocks, field order) is preserved.
Pathrunner CLI steps are read from the generated module JSON that
pathfinding.cloud already ships at docs/pathrunner/data/modules/{id}.json.

The link to the module's full reference page and the getting-started guide is
rendered in the website layer (docs/js/app.js, renderExploitationSteps) as a
note at the top of the Pathrunner tab, not stored per-path in YAML.
"""
import json
import glob
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULES_DIR = os.path.join(REPO, "docs", "pathrunner", "data", "modules")

DRY_RUN = "--apply" not in sys.argv
ONLY = None
for a in sys.argv[1:]:
    if a.startswith("--only="):
        ONLY = a.split("=", 1)[1]


def step_description(cmd: str, path_id: str) -> str:
    """Human-readable description for a single pathrunner CLI command."""
    toks = cmd.split()
    # toks[0] == "pathrunner"
    verb = toks[1] if len(toks) > 1 else ""
    if verb == "use":
        return f"Load the {path_id} exploit module in Pathrunner."
    if verb == "show" and len(toks) > 2 and toks[2] == "payloads":
        return "List the payloads compatible with this module."
    if verb == "set" and len(toks) > 2 and toks[2] == "PAYLOAD":
        payload = toks[3] if len(toks) > 3 else ""
        return f"Select the {payload} payload."
    if verb == "set" and len(toks) > 2:
        key = toks[2]
        return (
            f"Set the {key} option (replace the placeholder with your target's "
            f"real value)."
        )
    if verb == "exploit":
        return "Execute the privilege escalation."
    return "Run the Pathrunner command."


def yaml_scalar(value: str) -> str:
    """Render a scalar safely. Plain unless it would be ambiguous YAML."""
    if re.search(r":\s", value) or value.lstrip()[:1] in "#&*!|>%@`\"'[]{}," or "#" in value:
        return "'" + value.replace("'", "''") + "'"
    return value


def build_pathrunner_block(cli_steps, path_id: str, tool_indent: int, dash_indent: int):
    """Lines for the `pathrunner:` tool entry under exploitationSteps.

    tool_indent/dash_indent are detected from the file so the inserted block
    matches that file's existing sequence style (the repo mixes indentless and
    indented sequences).
    """
    tool = " " * tool_indent
    dash = " " * dash_indent
    content = " " * (dash_indent + 2)
    lines = [f"{tool}pathrunner:"]
    for i, cmd in enumerate(cli_steps, start=1):
        desc = step_description(cmd, path_id)
        lines.append(f"{dash}- step: {i}")
        lines.append(f"{content}command: {yaml_scalar(cmd)}")
        lines.append(f"{content}description: {yaml_scalar(desc)}")
    return lines


def is_top_level_key(line: str) -> bool:
    """A non-indented, non-blank, non-comment line starting a new top-level key."""
    return bool(line) and not line[0].isspace() and not line.lstrip().startswith("#")


def leading_spaces(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def find_block_bounds(lines, header_regex):
    """Return info about a top-level block, or None if its header is absent.

    Returns a dict with:
      start:         index of the header line
      insert_after:  index of the last non-blank line in the block
      child_indent:  indent of the first child mapping key (or None)
      dash_indent:   indent of the first sequence item '- ' in the block (or None)
    child_indent/dash_indent let callers match the file's own style.
    """
    start = None
    for i, line in enumerate(lines):
        if re.match(header_regex, line):
            start = i
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if is_top_level_key(lines[j]):
            end = j
            break
    insert_after = start
    child_indent = None
    dash_indent = None
    for j in range(start + 1, end):
        stripped = lines[j].strip()
        if stripped != "":
            insert_after = j
        if dash_indent is None and re.match(r"^\s*- ", lines[j]):
            dash_indent = leading_spaces(lines[j])
        if child_indent is None and re.match(r"^\s+[\w.-]+:", lines[j]):
            child_indent = leading_spaces(lines[j])
    return {
        "start": start,
        "insert_after": insert_after,
        "child_indent": child_indent,
        "dash_indent": dash_indent,
    }


def process_file(yaml_path: str, cli_steps, path_id: str) -> str:
    with open(yaml_path, "r") as f:
        text = f.read()
    # Idempotency: skip if already wired up.
    if re.search(r"^\s{2}pathrunner:\s*$", text, re.MULTILINE):
        return "skipped (already present)"

    lines = text.split("\n")

    exploit = find_block_bounds(lines, r"^exploitationSteps:\s*$")
    if exploit is None:
        return "skipped (no exploitationSteps block)"

    # Match the file's own style. tool keys sit at the block's child indent
    # (2 everywhere); sequence dashes use the detected dash indent.
    tool_indent = exploit["child_indent"] if exploit["child_indent"] is not None else 2
    ex_dash = exploit["dash_indent"] if exploit["dash_indent"] is not None else tool_indent

    new_lines = build_pathrunner_block(cli_steps, path_id, tool_indent, ex_dash)
    insert_after = exploit["insert_after"]
    lines[insert_after + 1:insert_after + 1] = new_lines

    new_text = "\n".join(lines)
    if not DRY_RUN:
        with open(yaml_path, "w") as f:
            f.write(new_text)
    return "updated"


def main():
    yaml_files = {}
    for f in glob.glob(os.path.join(REPO, "data", "paths", "**", "*.yaml"), recursive=True):
        yaml_files[os.path.splitext(os.path.basename(f))[0]] = f

    results = {}
    for mf in sorted(glob.glob(os.path.join(MODULES_DIR, "*.json"))):
        path_id = os.path.splitext(os.path.basename(mf))[0]
        if ONLY and path_id != ONLY:
            continue
        if path_id not in yaml_files:
            results.setdefault("no matching path", []).append(path_id)
            continue
        mod = json.load(open(mf))
        cli_steps = mod.get("cliSteps") or []
        if not cli_steps:
            results.setdefault("no cliSteps", []).append(path_id)
            continue
        status = process_file(yaml_files[path_id], cli_steps, path_id)
        results.setdefault(status, []).append(path_id)

    print(("DRY RUN" if DRY_RUN else "APPLIED") + " summary:")
    for status, ids in sorted(results.items()):
        print(f"  {status}: {len(ids)}")
        if status != "updated" or len(ids) <= 10:
            print("    " + ", ".join(ids))


if __name__ == "__main__":
    main()
