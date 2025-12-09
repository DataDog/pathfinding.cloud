# Contributing to pathfinding.cloud

Thank you for your interest in contributing to pathfinding.cloud! This project aims to be a comprehensive source of AWS IAM privilege escalation paths.

## How to Contribute

### Types of Contributions

We welcome the following types of contributions:

1. **New privilege escalation paths** - Document previously undiscovered or undocumented paths
2. **Path variations** - Document nuances and variations of existing paths (e.g., different unique permissions combinations)
3. **Corrections** - Fix errors in existing documentation
4. **Enhancements** - Add detection rules, tool support, or additional references
5. **Website improvements** - Enhance the user interface or functionality

## Adding a New Privilege Escalation Path

### Step 1: Choose an ID

- Use the format `{service}-{number}` where number is 3 digits
- For PassRole combinations, use the service of the resource being created/manipulated
  - Example: `iam:PassRole + ec2:RunInstances` → `ec2-001` (note: spaces around +)
- Check existing files to find the next available number for your service
- Create the file in `data/paths/{service}/{id}.yaml`

### Step 2: Create the YAML File

Use the template at [example-001.yaml](data/example-001.yaml)  which includes all required and optional fields with detailed comments and formatting examples.

### Step 3: Validate Your File

Before submitting, validate your YAML file:

```bash
# Install dependencies (first time only)
pip install -r requirements.txt

# Validate your file
python scripts/validate-schema.py data/paths/{service}/{id}.yaml

# Or validate all files
python scripts/validate-schema.py data/paths/
```

The validation script checks:
- Required fields are present
- Field types are correct
- ID format is valid
- Category values are allowed
- Exploitation steps are numbered sequentially
- And more...

### Step 4: Submit a Pull Request

1. Fork the repository
2. Create a new branch: `git checkout -b add-{service}-{number}`
3. Add your YAML file
4. Commit your changes: `git commit -m "Add {service}-{number}: {name}"`
5. Push to your fork: `git push origin add-{service}-{number}`
6. Open a Pull Request

## Schema Reference

See [SCHEMA.md](SCHEMA.md) for complete documentation of all fields.

### Field Guidelines

#### `id`
- Format: `{service}-{number}` (e.g., `iam-001`, `lambda-001`)
- Must be unique across all paths
- Number must be exactly 3 digits

#### `name`
- Use AWS IAM permission syntax
- Single permission: `iam:CreatePolicyVersion`
- Multiple permissions: `iam:PassRole + ec2:RunInstances` (note: **spaces around +**)
- Separate with ` + ` (space-plus-space)

#### `category`
Must be one of:
- `self-escalation` - Modify own permissions directly
- `lateral-movement` - Gain access to other principals
- `service-passrole` - Escalate via service + PassRole combination
- `credential-access` - Create or steal credentials
- `access-resource` - Modify resources to gain elevated access

#### `services`
- List all AWS services involved
- Use lowercase service names (e.g., `iam`, `ec2`, `lambda`)

#### `permissions`
- **required**: List minimum permissions needed by the exploiting principal
- **additional**: List helpful get/list permissions that aid exploitation
- Include `resourceConstraints` to describe requirements for each permission
- Be specific about what resources must be accessible

#### `description`
- Explain how the escalation works
- Describe what the attacker gains
- Keep it clear and concise but complete

#### `prerequisites`
- Document all conditions that must be met
- **New format (recommended)**: Use tabs (`admin` and `lateral`) for different scenarios
- **Legacy format**: Simple list of conditions (still supported)
- Be specific about environment requirements

#### `exploitationSteps`
- Organized by tool (awscli, pacu, pmapper, stratus, leonidas, nebula, pathfinder)
- Number steps sequentially starting from 1 for each tool
- Include actual commands with multi-line syntax using `|`
- Use placeholders like `<value>` for variables
- Explain what each step accomplishes

#### `recommendation`
- Explain how to prevent the escalation
- Include monitoring and detection strategies
- Reference the principle of least privilege

#### `discoveryAttribution` (required)
- Credit the original researcher or source
- Use `author` for individual researchers (e.g., "Spencer Gietzen")
- Use `source` for organizations/websites (e.g., "HackTricks", "pathfinding.cloud")
- **Do not use both** `author` and `source` - choose one
- Include organization if using `author`
- Add year of discovery and link to source
- For derivatives, include `derivativeOf` and optionally `ultimateOrigin` for multi-level chains

#### `references` (encouraged)
- Link to blog posts, papers, or documentation
- Must include both `title` and `url`

#### `relatedPaths` (optional)
- Link to similar or related escalation paths
- Use the path IDs (e.g., `iam-001`)

#### `detectionRules` (optional)
- Link to detection rules in security platforms
- Include platform name and URL

#### `detectionTools` (optional)
- Documents which open source security tools detect this path
- Link directly to the source code where detection logic is implemented
- Supported tools: `pmapper`, `cloudsplaining`, `pacu`, `prowler`, `scoutsuite`
- Example: `pmapper: https://github.com/nccgroup/PMapper/blob/master/principalmapper/graphing/iam_edges.py#L123`

#### `learningEnvironments` (optional)
- Documents learning labs and CTF environments where this path can be practiced
- **Open-source environments**: Include `type: open-source`, `githubLink`, `description`, optional `scenario`
- **Closed-source environments**: Include `type: closed-source`, `description`, `scenario`, and `scenarioPricingModel` (paid/free)
- Replaces the deprecated `toolSupport` field

#### `attackVisualization` (optional but recommended)
- Creates an interactive diagram showing the attack flow
- Uses structured format with `nodes` and `edges` arrays
- Node types: `principal` (users/roles), `resource` (AWS resources), `payload` (attacker actions), `outcome` (results)
- Supports conditional branching for different outcomes
- See [example-001.yaml](data/example-001.yaml) for a complete example

## Examples

Use the template at [example-001.yaml](data/example-001.yaml)  or any of the existing paths to get started. 

## Pull Request Guidelines

### PR Title Format

Use one of these formats:
- `Add {service}-{number}: {name}` - For new paths
- `Update {service}-{number}: {description}` - For updates
- `Fix {service}-{number}: {description}` - For corrections

### PR Description

Include:
- Brief description of the path or changes
- Why this path is important
- Any testing performed
- Links to relevant research or documentation

### Review Process

1. Automated validation runs on all PRs
2. Maintainers review for accuracy and completeness
3. At least one maintainer approval required
4. Once merged, the website is automatically rebuilt

## Questions?

- Open an issue for questions about contributing
- Check [SCHEMA.md](SCHEMA.md) for detailed field documentation
- Review existing YAML files in `data/paths/` for examples

## Code of Conduct

- Be respectful and professional
- Focus on improving AWS security knowledge
- Credit original researchers appropriately
- Do not submit malicious content

Thank you for contributing to pathfinding.cloud!
