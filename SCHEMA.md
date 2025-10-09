# AWS IAM Privilege Escalation Path Schema

This document defines the YAML schema used for documenting AWS IAM privilege escalation paths in this repository.

## Schema Version

Current version: `1.0.0`

## File Naming Convention

Files should be named using the format: `{service}-{number}.yaml`

Examples:
- `iam-001.yaml`
- `ec2-001.yaml`
- `lambda-001.yaml`

## ID Numbering Convention

- **IAM-focused paths**: Use `iam-###` (e.g., `iam-001`, `iam-002`)
- **PassRole combinations**: Use the service of the resource being created/manipulated
  - `iam:PassRole+ec2:RunInstances` → `ec2-001`
  - `iam:PassRole+lambda:CreateFunction` → `lambda-001`
  - `iam:PassRole+cloudformation:CreateStack` → `cloudformation-001`
- **Other service paths**: Use the primary service (e.g., `ssm-001`, `ec2-002`)
- **Sequential numbering**: IDs are assigned sequentially as paths are added

## Field Definitions

### Required Fields

#### `id` (string)
Unique identifier for the privilege escalation path.
- Format: `{service}-{number}` (e.g., `iam-001`)
- Must be unique across all paths

#### `name` (string)
Human-readable name using AWS IAM permission syntax.
- Single permission: `iam:CreatePolicyVersion`
- Multiple permissions: `iam:PassRole+ec2:RunInstances`
- Use `+` to separate multiple permissions
- Use exact AWS permission syntax (service:Action)

#### `category` (enum)
The type of privilege escalation.

Allowed values:
- `self-escalation` - Modify own permissions directly
- `lateral-movement` - Gain access to other principals
- `service-passrole` - Escalate via service + PassRole combination
- `credential-access` - Create or steal credentials for other principals
- `access-resource` - Modify resources to gain elevated access

#### `services` (array of strings)
List of all AWS services involved in the escalation path.

Example:
```yaml
services:
  - iam
  - ec2
```

#### `permissions` (object)
IAM permissions for the escalation path, organized into required and additional helpful permissions.

The permissions object contains two arrays:
- `required` (array of objects, required): Minimum permissions needed by the principal exploiting this path
- `additional` (array of objects, optional): Helpful get/list permissions that aid in exploitation but could come from a separate read-only principal

Each permission object contains:
- `permission` (string, required): The IAM permission (e.g., `iam:CreatePolicyVersion`)
- `resourceConstraints` (string, optional): Any resource-level constraints or requirements

Example:
```yaml
permissions:
  required:
    - permission: "iam:PassRole"
      resourceConstraints: "Must have access to a privileged role ARN"
    - permission: "ec2:RunInstances"
      resourceConstraints: "Must be able to launch EC2 instances"
  additional:
    - permission: "iam:ListRoles"
      resourceConstraints: "Helpful for discovering available roles to pass"
    - permission: "iam:GetRole"
      resourceConstraints: "Useful for viewing role trust policies and permissions"
```

#### `description` (string)
Clear, concise explanation of how the privilege escalation works.

Should include:
- What the attack accomplishes
- How the permissions are abused
- The end result for the attacker

#### `exploitationSteps` (object)
Step-by-step instructions for exploiting the path using different tools. This is an object where each key is a tool name and the value is an array of step objects.

Supported tools:
- `awscli` - AWS Command Line Interface
- `pacu` - Pacu (AWS exploitation framework)
- `pmapper` - Principal Mapper
- `stratus` - Stratus Red Team
- `leonidas` - Leonidas (AWS attack simulation)
- `nebula` - Nebula
- `pathfinder` - Pathfinder

Each step object contains:
- `step` (integer, required): Step number (1, 2, 3, etc.)
- `command` (string, required): The command to execute for the tool
- `description` (string, required): Explanation of what this step does

Example:
```yaml
exploitationSteps:
  awscli:
    - step: 1
      command: "aws iam create-policy-version --policy-arn arn:aws:iam::123456789012:policy/MyPolicy --policy-document file://admin_policy.json --set-as-default"
      description: "Create a new policy version with administrative permissions and set it as default"
    - step: 2
      command: "aws sts get-caller-identity"
      description: "Verify that the new permissions are active"
  pacu:
    - step: 1
      command: "run iam__create_policy_version --policy-arn arn:aws:iam::123456789012:policy/MyPolicy --policy-file admin_policy.json"
      description: "Use Pacu to create a new policy version with admin permissions"
```

#### `limitations` (string, optional)
Explains the limitations of this privilege escalation path and under what conditions it provides administrative access versus limited access.

This field is particularly important for PassRole-based paths, where access level depends on the permissions of available roles in the environment.

Example:
```yaml
limitations: |
  This path provides administrative access only if the passed role has administrative
  permissions (e.g., AdministratorAccess policy). If only limited roles are available,
  you gain access limited to those permissions. However, even limited access may enable
  multi-hop attacks.
```

#### `recommendation` (string)
Security recommendations for preventing and detecting this escalation path.

Should include:
- How to restrict the permissions using least privilege
- Monitoring and detection strategies
- IAM policy conditions and constraints
- Best practices

Example:
```yaml
recommendation: |
  Restrict iam:PassRole using the principle of least privilege. Use IAM policy
  conditions to limit which roles can be passed and to which services:

  {
    "Effect": "Allow",
    "Action": "iam:PassRole",
    "Resource": "arn:aws:iam::ACCOUNT:role/SpecificRole",
    "Condition": {
      "StringEquals": {
        "iam:PassedToService": "ec2.amazonaws.com"
      }
    }
  }

  Monitor for unusual PassRole + RunInstances activity in CloudTrail.
```

#### `discoveredBy` (object)
Information about who discovered this escalation path. **This field is required.**

Fields:
- `name` (string, required): Researcher's name (use "Unknown" if not known)
- `organization` (string, optional): Organization or company (use "Unknown" if not known)
- `date` (string, optional): Year discovered (YYYY format)

Example:
```yaml
discoveredBy:
  name: "Spencer Gietzen"
  organization: "Rhino Security Labs"
  date: "2019"
```

If attribution is unknown:
```yaml
discoveredBy:
  name: "Unknown"
  organization: "Unknown"
```

### Optional Fields

#### `prerequisites` (object or array)
Conditions that must be met for the escalation to work.

**New format (recommended):** Object with tab names as keys (e.g., `admin`, `lateral`), each containing an array of prerequisite strings. This is especially useful for PassRole paths where admin vs. lateral movement have different requirements.

**Legacy format:** Simple array of prerequisite strings (still supported for paths with uniform prerequisites).

Supported tab names:
- `admin` - Prerequisites for administrative privilege escalation
- `lateral` - Prerequisites for lateral movement (non-admin access)

Example (new format):
```yaml
prerequisites:
  admin:
    - "A role must exist that trusts ec2.amazonaws.com to assume it"
    - "The role must have administrative permissions (e.g., AdministratorAccess)"
    - "The role must have an instance profile associated with it"
  lateral:
    - "A role must exist that trusts ec2.amazonaws.com to assume it"
    - "The role must have an instance profile associated with it"
```

Example (legacy format):
```yaml
prerequisites:
  - "User must have fewer than 2 access keys"
  - "Target policy must be attached to the user's role or group"
```

#### `references` (array of objects)
Links to external resources, blog posts, and documentation.

Each reference object contains:
- `title` (string, required): Title of the resource
- `url` (string, required): Full URL

Example:
```yaml
references:
  - title: "AWS Privilege Escalation Methods"
    url: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"
  - title: "IAM Vulnerable Repository"
    url: "https://github.com/BishopFox/iam-vulnerable"
```

#### `relatedPaths` (array of strings)
List of related privilege escalation path IDs.

Example:
```yaml
relatedPaths:
  - "iam-002"
  - "iam-007"
```

#### `detectionRules` (array of objects)
Links to detection rules in various security platforms.

Each detection rule object contains:
- `platform` (string, required): Security platform name (e.g., "CloudSIEM", "AWS Config", "Splunk")
- `ruleId` (string, optional): Rule identifier
- `url` (string, optional): Link to the rule documentation

Example:
```yaml
detectionRules:
  - platform: "CloudSIEM"
    ruleId: "7b6-2a8-df9"
    url: "https://docs.datadoghq.com/security/default_rules/7b6-2a8-df9/"
```

#### `toolSupport` (object)
Indicates which security tools support detecting/testing this path.

Boolean fields:
- `pmapper` (boolean): PMapper support
- `iamVulnerable` (boolean): IAM Vulnerable support
- `pacu` (boolean): Pacu support
- `prowler` (boolean): Prowler support

Example:
```yaml
toolSupport:
  pmapper: true
  iamVulnerable: true
  pacu: false
  prowler: true
```

## Complete Example

```yaml
id: "iam-001"
name: "iam:CreatePolicyVersion"
category: "self-escalation"
services:
  - iam

permissions:
  required:
    - permission: "iam:CreatePolicyVersion"
      resourceConstraints: "Policy ARN must be in the Resource section and policy must be attached to the actor"

description: |
  Anyone with access to iam:CreatePolicyVersion can create a new version of an IAM policy.
  If a user can create a new version of a policy that is already attached to them, they can
  grant themselves administrative privileges by creating a new policy version with elevated
  permissions and setting it as the default version.

prerequisites:
  - condition: "Policy must already be attached to the actor's user, role, or group"
    type: "resource-state"

exploitationSteps:
  - step: 1
    command: "aws iam create-policy-version --policy-arn arn:aws:iam::123456789012:policy/MyPolicy --policy-document file://admin_policy.json --set-as-default"
    description: "Create a new policy version with administrative permissions and set it as default"
  - step: 2
    command: "aws sts get-caller-identity"
    description: "Verify that the new permissions are now active"

recommendation: |
  Restrict access to iam:CreatePolicyVersion using the principle of least privilege.
  Very few principals need this permission, so it should be restricted to only the
  few principals that need it. Monitor use of this sensitive permission using
  CloudSIEM detections, and look for usage anomalies.

discoveredBy:
  name: "Spencer Gietzen"
  organization: "Rhino Security Labs"
  date: "2019"

references:
  - title: "AWS Privilege Escalation Methods and Mitigation"
    url: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"

relatedPaths:
  - "iam-002"
  - "iam-007"
  - "iam-008"

detectionRules:
  - platform: "CloudSIEM"
    ruleId: "7b6-2a8-df9"
    url: "https://docs.datadoghq.com/security/default_rules/7b6-2a8-df9/"

toolSupport:
  pmapper: true
  iamVulnerable: true
  pacu: true
  prowler: true
```

## Validation

All YAML files must validate against this schema. A validation script is provided in `scripts/validate-schema.py` to check new contributions.

To validate a file:
```bash
python scripts/validate-schema.py data/paths/iam/iam-001.yaml
```

To validate all files:
```bash
python scripts/validate-schema.py data/paths/
```
