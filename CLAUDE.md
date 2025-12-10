# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## When to Use Each File

- **CLAUDE.md** (this file): Workflow guidance, commands, development tasks, and quick references
- **SCHEMA.md**: Authoritative field definitions, validation rules, and format specifications
- **.claude/CLAUDE.md**: Anti-patterns, style guide, and contribution-specific guidance

**Rule of thumb**: Check SCHEMA.md for "what does field X mean?", check this file for "how do I do task Y?"

## Project Overview

**pathfinding.cloud** is a comprehensive, community-maintained library documenting AWS IAM privilege escalation paths. The project consists of:

1. **Data Layer**: Structured YAML files documenting each privilege escalation path
2. **Validation Layer**: Python scripts to validate YAML against schema
3. **Website Layer**: Static HTML/CSS/JS site for browsing paths
4. **CI/CD Layer**: GitHub Actions for validation and deployment

## Quick Start Commands

### Essential Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Validate a single file
python scripts/validate-schema.py data/paths/{service}/{service}-###.yaml

# Validate all files
python scripts/validate-schema.py data/paths/

# Generate JSON for website
python scripts/generate-json.py

# Test website locally (with SPA routing support)
cd docs && python3 dev-server.py
# Then visit http://localhost:8888
```

### GitHub Token for Better Contributor Info

```bash
# Set GitHub token (optional but recommended)
export GITHUB_TOKEN=your_github_pat_here
python scripts/generate-json.py

# Token scopes:
# - Private repos: 'repo' scope
# - Public repos: 'public_repo' scope
# Create at: https://github.com/settings/tokens/new
```

## Architecture

### Data Structure

All privilege escalation paths are stored as individual YAML files in `data/paths/{service}/`:
- Files follow naming convention: `{service}-{number}.yaml` (e.g., `iam-001.yaml`)
- Each file adheres to the schema defined in [SCHEMA.md](SCHEMA.md)
- Files are organized by primary service (iam, ec2, lambda, ssm, cloudformation, etc.)

### ID Numbering Convention

- **IAM-focused paths**: `iam-001`, `iam-002`, etc.
- **PassRole combinations**: Use the service of the resource being created/manipulated
  - `iam:PassRole+ec2:RunInstances` → `ec2-001` (not iam-###)
  - `iam:PassRole+lambda:CreateFunction` → `lambda-001`
- **Other services**: `ssm-001`, `ec2-002`, etc.
- **Sequential numbering**: IDs are assigned sequentially within each service

### Website Architecture (SPA with Client-Side Routing)

The website is a Single Page Application (SPA) with client-side routing:
- **List view**: `/` - Shows all paths with search/filter functionality
- **Detail view**: `/paths/{id}` - Shows individual path details (e.g., `/paths/iam-001`)
- **Routing**: Uses History API (`pushState`/`popState`) for proper URLs
- **No page reloads**: Navigation is instant, only content changes
- **SEO ready**: Dynamic meta tags per page, Open Graph support
- **Analytics ready**: Real pageviews on route changes
- **Backward compatible**: Old hash URLs (`#iam-001`) redirect to new format

**Directory Structure:**
- All website files are in the `docs/` directory (GitHub Pages compatible)
- Source data (YAML files) remain at `data/paths/` in repository root
- Generated files (`paths.json`, `metadata.json`) are created in `docs/`

**Development:**
- Use `docs/dev-server.py` for local testing (handles SPA routing)
- Run from project root: `cd docs && python3 dev-server.py`
- Direct file opening won't support routing features

**Production (GitHub Pages):**
- GitHub Pages deploys only the `docs/` directory
- `404.html` implements the SPA routing pattern for GitHub Pages
- When users access direct URLs (e.g., `/paths/iam-001`), GitHub Pages serves `404.html`
- The 404 page captures the requested path in sessionStorage and redirects to `index.html`
- The client-side router in `docs/js/app.js` reads sessionStorage and restores the original URL
- This allows direct linking and page refreshes to work correctly on GitHub Pages
- All URLs work when shared, bookmarked, or accessed directly

## Contribution Workflow

### Adding a New Path

1. **Determine the next ID:**
   ```bash
   ls data/paths/{service}/ | sort | tail -n 1
   ```

2. **Create YAML file:** `data/paths/{service}/{service}-{number}.yaml`

3. **Follow the schema:** See [SCHEMA.md](SCHEMA.md) for complete field definitions

4. **Validate:**
   ```bash
   python scripts/validate-schema.py data/paths/{service}/{service}-{number}.yaml
   ```

5. **Enhance with specialized agents** (optional but recommended):
   - Use `detection-tools` agent to add detection tool coverage
   - Use `learning-environments` agent to add practice labs
   - Use `add-vis` agent to add attack visualization
   - Use `attribution` agent to find discoverer information

6. **Generate JSON and test:**
   ```bash
   python scripts/generate-json.py
   cd docs && python3 dev-server.py
   ```

7. **Submit PR** (validation runs automatically)

### Updating Existing Paths

- Always validate after editing
- Check `relatedPaths` field to ensure consistency with related paths
- Update the website by regenerating JSON: `python scripts/generate-json.py`

### Adding a New Service

1. Create directory: `mkdir data/paths/{service}`
2. Add first path: `data/paths/{service}/{service}-001.yaml`
3. The service will automatically appear in website filters once deployed

## Field Quick Reference

For complete field specifications, see [SCHEMA.md](SCHEMA.md).

### Required Fields

| Field | Type | Quick Description | Details |
|-------|------|-------------------|---------|
| `id` | string | Unique identifier (e.g., `iam-001`) | [SCHEMA.md](SCHEMA.md#id-string) |
| `name` | string | IAM permission syntax (e.g., `iam:PassRole + ec2:RunInstances`) | [SCHEMA.md](SCHEMA.md#name-string) |
| `category` | enum | Type of escalation (`self-escalation`, `principal-access`, `new-passrole`, `credential-access`, `existing-passrole`) | [SCHEMA.md](SCHEMA.md#category-enum) |
| `services` | array | AWS services involved (e.g., `[iam, ec2]`) | [SCHEMA.md](SCHEMA.md#services-array-of-strings) |
| `permissions` | object | Required and additional permissions | [SCHEMA.md](SCHEMA.md#permissions-object) |
| `description` | string | How the privilege escalation works | [SCHEMA.md](SCHEMA.md#description-string) |
| `exploitationSteps` | object | Step-by-step commands for different tools | [SCHEMA.md](SCHEMA.md#exploitationsteps-object) |
| `recommendation` | string | Prevention and detection strategies | [SCHEMA.md](SCHEMA.md#recommendation-string) |
| `discoveryAttribution` | object | Rich attribution info (author, source, derivatives) | [SCHEMA.md](SCHEMA.md#discoveryattribution-object) |

### Optional Fields (Commonly Used)

| Field | Type | Quick Description | Details |
|-------|------|-------------------|---------|
| `prerequisites` | object/array | Conditions required for escalation | [SCHEMA.md](SCHEMA.md#prerequisites-object-or-array) |
| `limitations` | string | When admin vs limited access is achieved | [SCHEMA.md](SCHEMA.md#limitations-string-optional) |
| `references` | array | External links and documentation | [SCHEMA.md](SCHEMA.md#references-array-of-objects) |
| `relatedPaths` | array | Related path IDs | [SCHEMA.md](SCHEMA.md#relatedpaths-array-of-strings) |
| `detectionTools` | object | Open source tools that detect this path | [SCHEMA.md](SCHEMA.md#detectiontools-object) |
| `learningEnvironments` | object | Practice labs and CTF environments | [SCHEMA.md](SCHEMA.md#learningenvironments-object) |
| `attackVisualization` | object | Interactive attack flow diagram | [SCHEMA.md](SCHEMA.md#attackvisualization-object) |

### YAML Field Order (Convention)

While not enforced by validation, this order improves readability:

1. `id`, `name`, `category`, `services`
2. `permissions`
3. `description`
4. `prerequisites` (if applicable)
5. `exploitationSteps`
6. `recommendation`
7. `limitations` (if applicable - especially for PassRole paths)
8. `nextSteps` (if applicable - guidance for multi-hop attacks)
9. `discoveryAttribution` (required - rich attribution with author/source/derivatives)
10. `references` (if available)
11. `relatedPaths` (if applicable)
12. `detectionTools` (if available - added by detection-tools agent)
13. `learningEnvironments` (if available - added by learning-environments agent)
14. `attackVisualization` (if available - added by add-vis agent)

## Common Development Tasks

### Fixing Validation Errors

Common issues:
- **ID format**: Must be `service-###` with exactly 3 digits
- **Category**: Must be one of: `self-escalation`, `principal-access`, `new-passrole`, `credential-access`, `existing-passrole`
- **Step numbering**: Must start at 1 and be sequential
- **Required fields**: All fields in `REQUIRED_FIELDS` dict must be present

### Testing Website Changes

1. Generate JSON: `python scripts/generate-json.py`
2. Start dev server: `cd docs && python3 dev-server.py`
3. Visit `http://localhost:8888` in browser
4. Test search, filters, path detail pages, and navigation
5. Test direct URLs like `http://localhost:8888/paths/iam-001`
6. Test browser back/forward buttons
7. Check browser console for JavaScript errors

**Note:** The website uses client-side routing (SPA). Direct file opening won't support routing features (refresh, direct URLs). Always use the dev server for local testing.

### Using Specialized Agents

Claude Code has specialized agents for enhancing attack paths:

- **detection-tools**: Research and add detection tool coverage
- **learning-environments**: Research and add practice labs
- **add-vis**: Create interactive attack visualizations
- **attribution**: Find discoverer and reference information

Run multiple agents concurrently for efficiency:
```
Can you task the detection-tools, learning-environments, add-vis, and attribution agents concurrently?
```

## Validation Script

`scripts/validate-schema.py` checks:
- All required fields are present
- Field types match expectations
- ID format is correct (`service-###`)
- Category values are allowed
- Prerequisites have valid types
- Exploitation steps are numbered sequentially from 1
- No unexpected fields

## Website Generation

The website loads data from `docs/paths.json`, which is generated from YAML files:
1. GitHub Actions runs `scripts/generate-json.py` on every push to main
2. This converts all YAML files to a single JSON file
3. The website JavaScript loads and displays the JSON data
4. Changes to YAML files automatically update the website

## Key Files

- **[SCHEMA.md](SCHEMA.md)**: Complete field documentation and examples (authoritative reference)
- **[.claude/CLAUDE.md](.claude/CLAUDE.md)**: Anti-patterns, style guide, and contribution-specific guidance
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: Contribution guidelines with examples
- **[README.md](README.md)**: Project overview and setup instructions
- **scripts/validate-schema.py**: Validation logic (comprehensive checks)
- **scripts/generate-json.py**: YAML to JSON converter
- **.github/workflows/validate.yml**: PR validation workflow
- **.github/workflows/deploy.yml**: GitHub Pages deployment workflow

## Research Sources

When adding new paths, cite these primary sources where applicable:
- **Rhino Security Labs**: Original 21 methods by Spencer Gietzen
- **Bishop Fox**: IAM Vulnerable project, additional 10 paths
- **nccgroup**: PMapper implementation details
- **AWS Documentation**: Official IAM permission docs

## GitHub Actions Workflows

### Validate Workflow (`.github/workflows/validate.yml`)
- Triggers on: PRs and pushes to main affecting YAML files
- Runs: `python scripts/validate-schema.py data/paths/`
- Comments on PR: Success/failure status

### Deploy Workflow (`.github/workflows/deploy.yml`)
- Triggers on: Pushes to main branch
- Steps:
  1. Validate all YAML files
  2. Generate JSON from YAML
  3. Update website JavaScript to use JSON
  4. Deploy to GitHub Pages
- Permissions: Requires `pages: write` and `id-token: write`

## Code Style

### Python Scripts
- Use Python 3.11+ features
- Follow PEP 8
- Include docstrings for functions
- Use type hints where helpful
- Provide clear error messages

### YAML Files
- Use 2-space indentation
- Multi-line strings use `|` for description and recommendation
- List items use `-` prefix
- Strings with special characters should be quoted

### Website Code
- Vanilla JavaScript (no frameworks)
- Responsive CSS (mobile-first)
- Accessible HTML (semantic tags, ARIA labels)
- Progressive enhancement
