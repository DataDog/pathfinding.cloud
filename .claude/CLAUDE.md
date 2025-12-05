# Claude Code Guidelines for pathfinding.cloud

This document contains project-specific anti-patterns and style guidelines for working on pathfinding.cloud.

**For field definitions and validation rules**, see [SCHEMA.md](../SCHEMA.md).
**For workflow and commands**, see [CLAUDE.md](../CLAUDE.md).

## Anti-Patterns to Avoid

### 1. Path Name Formatting

**WRONG:** `iam:PassRole+sagemaker:CreateTrainingJob`

**CORRECT:** `iam:PassRole + sagemaker:CreateTrainingJob`

Always include spaces before and after the `+` sign when combining multiple permissions in the `name` field.

### 2. PowerUserAccess is NOT Administrative Access

**WRONG:** `The role must have administrative permissions (e.g., AdministratorAccess or PowerUserAccess)`

**CORRECT:** `The role must have administrative permissions (e.g., AdministratorAccess or an equivalent custom policy)`

PowerUserAccess does NOT provide administrative permissions (it specifically excludes IAM actions). When describing administrative access requirements in prerequisites, use "AdministratorAccess or an equivalent custom policy" instead.

### 3. Description Field Line Breaks

**WRONG:**
```yaml
description: A principal with `iam:PassRole` and `ec2:RunInstances` can create
  an EC2 instance with a privileged IAM role attached.
```

**CORRECT:**
```yaml
description: A principal with `iam:PassRole` and `ec2:RunInstances` can create an EC2 instance with a privileged IAM role attached. The instance automatically assumes the passed role, and the attacker can access the instance to retrieve temporary credentials.
```

Descriptions should be single-line in YAML (no artificial line breaks at ~80 characters). They will flow naturally in the UI based on container width.

### 4. Missing Backticks for IAM Permissions

**WRONG:** `A principal with iam:PassRole and ec2:RunInstances...`

**CORRECT:** ``A principal with `iam:PassRole` and `ec2:RunInstances`...``

All IAM permissions in descriptions, recommendations, and text should be formatted with backticks for code styling. This applies everywhere EXCEPT in the `name` field (which should be plain text).

### 5. Using Legacy Permission Format

**WRONG (deprecated format):**
```yaml
requiredPermissions:
  - permission: iam:PassRole
```

**CORRECT (current format):**
```yaml
permissions:
  required:
    - permission: iam:PassRole
      resourceConstraints: Target role ARN must be in the Resource section
  additional:
    - permission: iam:ListRoles
      resourceConstraints: Helpful for discovering available roles to pass
```

The `permissions` field separates required permissions (minimum needed) from additional helpful permissions (get/list type permissions).

## YAML Formatting Standards

### Description Fields

- **Single-line**: Descriptions should be single-line in YAML (no artificial line breaks)
- **Natural flow**: Text will wrap naturally in the UI based on container width
- **Backticks**: Use backticks for inline code formatting (e.g., `` `iam:PassRole` ``)

### Multi-line Fields

Use the `|` pipe syntax for multi-line fields:
- `recommendation`
- `command` (in exploitation steps)
- `limitations`
- Long prerequisite descriptions

Example:
```yaml
recommendation: |
  Restrict the `iam:PassRole` permission using the principle of least privilege.

  Use IAM policy conditions to restrict which roles can be passed:

  ```json
  {
    "Effect": "Allow",
    "Action": "iam:PassRole",
    "Resource": "arn:aws:iam::ACCOUNT:role/SpecificRole"
  }
  ```
```

### YAML Indentation

- Use **2-space indentation** (not tabs)
- List items use `-` prefix
- Strings with special characters should be quoted

### Complete Example

```yaml
id: example-001
name: iam:PassRole + ec2:RunInstances  # Note: spaces around +
category: service-passrole
services:
  - iam
  - ec2
description: A principal with `iam:PassRole` and `ec2:RunInstances` can create an EC2 instance with a privileged IAM role attached. The instance automatically assumes the passed role, and the attacker can access the instance to retrieve temporary credentials.
prerequisites:
  admin:
    - A role must exist that trusts ec2.amazonaws.com to assume it
    - The role must have administrative permissions (e.g., AdministratorAccess or an equivalent custom policy)  # Note: NOT PowerUserAccess
  lateral:
    - A role must exist that trusts ec2.amazonaws.com to assume it
permissions:
  required:
    - permission: iam:PassRole
      resourceConstraints: Target role ARN must be in the Resource section
    - permission: ec2:RunInstances
      resourceConstraints: Must have permission to create EC2 instances
  additional:
    - permission: iam:ListRoles
      resourceConstraints: Helpful for discovering available roles to pass
    - permission: iam:GetRole
      resourceConstraints: Useful for viewing role trust policies and attached permissions
exploitationSteps:
  awscli:
    - step: 1
      command: |
        aws ec2 run-instances \
          --image-id ami-12345678 \
          --instance-type t2.micro \
          --iam-instance-profile Name=privileged-profile \
          --user-data file://exploit.sh
      description: Launch EC2 instance with privileged instance profile
recommendation: |
  Restrict the `iam:PassRole` permission using the principle of least privilege.
discoveredBy:
  name: Spencer Gietzen
  organization: Rhino Security Labs
  date: '2019'
```

## Field-Specific Guidelines

### Permissions Field

See [SCHEMA.md#permissions-object](../SCHEMA.md#permissions-object) for complete specification.

**Structure:**
- `required`: Minimum permissions needed by the exploiting principal
- `additional`: Helpful get/list permissions that aid exploitation

Each permission object has:
- `permission`: The IAM permission
- `resourceConstraints`: Resource-level requirements or constraints

### Prerequisites Field

See [SCHEMA.md#prerequisites-object-or-array](../SCHEMA.md#prerequisites-object-or-array) for complete specification.

**Use object format for PassRole paths** (different requirements for admin vs lateral):
```yaml
prerequisites:
  admin:
    - A role must exist with administrative permissions
  lateral:
    - A role must exist with some elevated permissions
```

**Use array format for simple paths** (uniform requirements):
```yaml
prerequisites:
  - User must have fewer than 2 access keys
  - Target policy must be attached to the user's role or group
```

### Detection Tools Field

See [SCHEMA.md#detectiontools-object](../SCHEMA.md#detectiontools-object) for complete specification.

**Quick reference:**
```yaml
detectionTools:
  pmapper: https://github.com/nccgroup/PMapper/blob/master/principalmapper/graphing/iam_edges.py#L123
  cloudsplaining: https://github.com/salesforce/cloudsplaining/blob/master/cloudsplaining/shared/constants.py#L45
```

**Key points:**
- Only include if at least one tool detects this path
- Link to specific line numbers in source code where detection logic is implemented
- Tool metadata (names, descriptions) stored in `metadata.json`

### Learning Environments Field

See [SCHEMA.md#learningenvironments-object](../SCHEMA.md#learningenvironments-object) for complete specification.

**Quick reference for open-source:**
```yaml
learningEnvironments:
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: IAM-CreatePolicyVersion
    description: "Deploy Terraform into your own AWS account and practice individual exploitation paths"
```

**Quick reference for closed-source:**
```yaml
learningEnvironments:
  cybr:
    type: closed-source
    description: "A hosted learning environment with free and paid labs"
    scenario: https://cybr.com/hands-on-labs/lab/iam-privilege-escalation/
    scenarioPricingModel: paid
```

### Discovery Attribution Field

See [SCHEMA.md#discoveryattribution-array-of-objects-optional](../SCHEMA.md#discoveryattribution-array-of-objects-optional) for complete specification.

**When to use discoveryAttribution:**
- When an attack path has multiple sources of attribution
- When an attack path is a derivative of another path
- When you need to provide links to original sources
- When an attack path was first documented on pathfinding.cloud

**Note:** Both `discoveredBy` (required) and `discoveryAttribution` (optional) are supported. When `discoveryAttribution` is present, the website displays it instead of `discoveredBy`.

**Quick reference for single attribution:**
```yaml
discoveryAttribution:
  - item: "This attack path was first published by Spencer Gietzen (Rhino Security Labs) in 2019"
    link: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"
```

**Quick reference for derivative with multiple attributions:**
```yaml
discoveryAttribution:
  - item: "This attack path is a derivative of IAM-001, which was first published by Spencer Gietzen (Rhino Security Labs) in 2019"
    link: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"
  - item: "This unique variation was first documented by John Doe (Security Corp) in 2024"
    link: "https://securitycorp.example.com/blog/iam-variation"
```

**Quick reference for paths originated on pathfinding.cloud:**
```yaml
discoveryAttribution:
  - item: "This attack path is a derivative of IAM-004, which was first published by Spencer Gietzen (Rhino Security Labs) in 2019"
    link: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"
  - item: "This unique attack path was first documented here on pathfinding.cloud in 2025"
```

### Attack Visualization Field

See [SCHEMA.md#attackvisualization-object](../SCHEMA.md#attackvisualization-object) for complete specification.

**Description formatting guidelines:**
- Use single-line paragraphs (no artificial line breaks at ~80 chars)
- Use line breaks only for intentional separation (paragraphs, code blocks, lists)
- Preserve multi-line structure for bash commands
- Keep list items on separate lines

**Common Anti-Patterns to Avoid:**

1. **Using reconnaissance permissions as edge labels**
   - ❌ WRONG: Edge labeled `ec2:DescribeLaunchTemplates` when this is in `permissions.additional`
   - ✅ CORRECT: Only use permissions from `permissions.required` in edge labels
   - **Why**: Edges represent the required attack flow, not optional reconnaissance
   - **Example**: EC2-004 previously had this issue

2. **Typing IAM roles/users as `resource` instead of `principal`**
   - ❌ WRONG: `type: resource` for nodes like `target_role`, `target_user`, `execution_role`
   - ✅ CORRECT: ALL IAM users and roles must be `type: principal`
   - **Why**: Roles and users are principals (identities), not resources

3. **Using `type: action` instead of `type: payload`**
   - ❌ DEPRECATED: `type: action` for attacker exploitation nodes
   - ✅ CORRECT: `type: payload` for attacker exploitation choices
   - **Why**: Clarifies these represent attacker payloads, not IAM actions

4. **Creating payload nodes for simple IAM API calls**
   - ❌ WRONG: Creating a node for `iam:CreateAccessKey` action
   - ✅ CORRECT: IAM actions should be edge labels, not nodes
   - **Why**: Payload nodes are for attacker exploitation methods, not AWS API calls

5. **Missing explicit role nodes in access-resource paths**
   - ❌ WRONG: `start` → `codebuild_project` → `execute_buildspec` → `outcomes` (missing service_role node)
   - ✅ CORRECT: `start` → `codebuild_project` → `service_role` → `execute_buildspec` → `outcomes`
   - **Why**: The role is a distinct principal that must be explicitly shown in the attack flow
   - **Examples**: CODEBUILD-002, CODEBUILD-003, BEDROCK-002, LAMBDA-003 were fixed to add explicit role nodes

## Specialized Agents

When creating or enhancing attack paths, use these specialized agents:

- **detection-tools**: Research and add detection tool coverage
- **learning-environments**: Research and add practice labs
- **add-vis**: Create interactive attack visualizations
- **attribution**: Find discoverer and reference information

**Run concurrently for efficiency:**
```
Can you task the detection-tools, learning-environments, add-vis, and attribution agents concurrently?
```

## Code Style

### Python Scripts
- Use Python 3.11+ features
- Follow PEP 8
- Include docstrings for functions
- Use type hints where helpful
- Provide clear error messages

### Website Code
- Vanilla JavaScript (no frameworks)
- Responsive CSS (mobile-first)
- Accessible HTML (semantic tags, ARIA labels)
- Progressive enhancement
