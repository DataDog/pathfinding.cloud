# Contributing to pathfinding.cloud

Thank you for your interest in contributing to pathfinding.cloud! This project aims to be the definitive source of truth for AWS IAM privilege escalation paths.

## How to Contribute

### Types of Contributions

We welcome the following types of contributions:

1. **New privilege escalation paths** - Document previously undiscovered or undocumented paths
2. **Path variations** - Document nuances and variations of existing paths (e.g., different prerequisites)
3. **Corrections** - Fix errors in existing documentation
4. **Enhancements** - Add detection rules, tool support, or additional references
5. **Website improvements** - Enhance the user interface or functionality

## Adding a New Privilege Escalation Path

### Step 1: Choose an ID

- Use the format `{service}-{number}` where number is 3 digits
- For PassRole combinations, use the service of the resource being created/manipulated
  - Example: `iam:PassRole+ec2:RunInstances` → `ec2-001`
- Check existing files to find the next available number for your service
- Create the file in `data/paths/{service}/{id}.yaml`

### Step 2: Create the YAML File

Use the template below as a starting point:

```yaml
id: "service-001"
name: "iam:Permission" # or "iam:Permission1 + service:Permission2" (note spaces around +)
category: "self-escalation" # or lateral-movement, service-passrole, credential-access, access-resource
services:
  - iam
  - service

permissions:
  required:
    - permission: "iam:Permission"
      resourceConstraints: "Description of resource requirements"
  additional:
    - permission: "iam:ListPermissions"
      resourceConstraints: "Helpful for discovering resources"

description: Clear explanation of how this privilege escalation works, what it accomplishes, and the end result for the attacker.

prerequisites:
  admin:
    - "Description of condition needed for administrative access"
  lateral:
    - "Description of condition needed for lateral movement"

exploitationSteps:
  awscli:
    - step: 1
      command: |
        aws service action --parameters
      description: "What this step does"
    - step: 2
      command: |
        aws service action --parameters
      description: "What this step does"

recommendation: |
  Security recommendations for preventing and detecting this escalation path.
  Include monitoring strategies and best practices.

discoveredBy:
  name: "Your Name"
  organization: "Your Organization (optional)"
  date: "2024"

references:
  - title: "Blog Post Title"
    url: "https://example.com/blog-post"

relatedPaths:
  - "related-001"
  - "related-002"

detectionRules:
  - platform: "CloudSIEM"
    url: "https://docs.example.com/rules/rule-id"

learningEnvironments:
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: IAM-SomeScenario
    description: "Deploy Terraform into your own AWS account and practice exploitation"
```

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
- Multiple permissions: `iam:PassRole+ec2:RunInstances`
- Separate with `+` symbol

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

#### `discoveredBy` (optional but encouraged)
- Credit the original researcher
- Include organization if applicable
- Add year of discovery

#### `references` (encouraged)
- Link to blog posts, papers, or documentation
- Must include both `title` and `url`

#### `relatedPaths` (optional)
- Link to similar or related escalation paths
- Use the path IDs (e.g., `iam-001`)

#### `detectionRules` (optional)
- Link to detection rules in security platforms
- Include platform name and URL

#### `learningEnvironments` (optional)
- Documents learning labs and CTF environments where this path can be practiced
- **Open-source environments**: Include `type: open-source`, `githubLink`, `description`, optional `scenario`
- **Closed-source environments**: Include `type: closed-source`, `description`, `scenario`, and `scenarioPricingModel` (paid/free)
- Replaces the deprecated `toolSupport` field

## Examples

### Example 1: Simple Self-Escalation

```yaml
id: "iam-001"
name: "iam:CreatePolicyVersion"
category: "self-escalation"
services:
  - iam

permissions:
  required:
    - permission: "iam:CreatePolicyVersion"
      resourceConstraints: "Policy must be attached to the actor"
  additional:
    - permission: "iam:ListPolicies"
      resourceConstraints: "Helpful for discovering attached policies"

description: A principal with `iam:CreatePolicyVersion` can create a new version of an IAM policy that is already attached to them, granting themselves administrative privileges by setting the new version as default.

prerequisites:
  - "Policy must already be attached to the actor's user, role, or group"

exploitationSteps:
  awscli:
    - step: 1
      command: |
        aws iam create-policy-version --policy-arn <policy-arn> --policy-document file://admin.json --set-as-default
      description: "Create new policy version with admin permissions and set as default"

recommendation: |
  Restrict iam:CreatePolicyVersion to only necessary principals.
  Monitor usage with CloudTrail and CloudSIEM detections.

discoveredBy:
  name: "Spencer Gietzen"
  organization: "Rhino Security Labs"
  date: "2019"

learningEnvironments:
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: IAM-CreatePolicyVersion
    description: "Deploy Terraform into your own AWS account and practice exploitation"
```

### Example 2: Multi-Permission Path with PassRole

```yaml
id: "lambda-001"
name: "iam:PassRole + lambda:CreateFunction + lambda:InvokeFunction"
category: "service-passrole"
services:
  - iam
  - lambda

permissions:
  required:
    - permission: "iam:PassRole"
      resourceConstraints: "Must be able to pass a privileged role to Lambda service"
    - permission: "lambda:CreateFunction"
      resourceConstraints: "Must be able to create Lambda functions"
    - permission: "lambda:InvokeFunction"
      resourceConstraints: "Must be able to invoke the created function"
  additional:
    - permission: "iam:ListRoles"
      resourceConstraints: "Helpful for discovering available privileged roles"
    - permission: "iam:GetRole"
      resourceConstraints: "Useful for viewing role permissions and trust policies"

description: A principal with `iam:PassRole`, `lambda:CreateFunction`, and `lambda:InvokeFunction` can create a Lambda function with a privileged role and invoke it to execute code with elevated permissions.

prerequisites:
  admin:
    - "A role must exist that trusts lambda.amazonaws.com to assume it"
    - "The role must have administrative permissions (e.g., AdministratorAccess or an equivalent custom policy)"
  lateral:
    - "A role must exist that trusts lambda.amazonaws.com to assume it"
    - "The role can have any level of permissions for lateral movement"

exploitationSteps:
  awscli:
    - step: 1
      command: |
        aws lambda create-function \
          --function-name exploit \
          --runtime python3.9 \
          --role arn:aws:iam::123456789012:role/PrivRole \
          --handler index.handler \
          --zip-file fileb://code.zip
      description: "Create Lambda function with privileged role"
    - step: 2
      command: |
        aws lambda invoke --function-name exploit output.txt
      description: "Invoke function to execute with elevated permissions"

recommendation: |
  Restrict iam:PassRole with condition keys to limit which roles can be passed
  to Lambda. Monitor Lambda function creation and invocation in CloudTrail.

discoveredBy:
  name: "Spencer Gietzen"
  organization: "Rhino Security Labs"
  date: "2019"

references:
  - title: "AWS Privilege Escalation Methods"
    url: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"

relatedPaths:
  - "ec2-001"
  - "cloudformation-001"

learningEnvironments:
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: IAM-PassRole-Lambda-CreateFunction
    description: "Deploy Terraform into your own AWS account and practice exploitation"
  pathfinder-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinder-labs
    scenario: lambda-createfunction
    description: "Deploy scenarios with attack and cleanup scripts"
```

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
