# AWS IAM Privilege Escalation Path Schema

This document defines the YAML schema used for documenting AWS IAM privilege escalation paths in this repository.

## Schema Version

Current version: `1.4.0`

### Version History

#### Version 1.4.0 (2025-01-11)
- Added `detectionTools` optional field for documenting open source detection tool coverage
- Tool metadata (names, descriptions, GitHub links) stored in `metadata.json`
- YAML files only need to specify the detection source code URL for each tool
- Frontend always displays "Detection Coverage" section with placeholder message if no tools listed

#### Version 1.3.0 (2025-11-10)
- **Breaking change**: `toolSupport` field is deprecated and replaced with `learningEnvironments`
- Added `learningEnvironments` optional field for documenting available learning labs and CTF environments
- Supports both open-source (self-hosted) and closed-source (hosted service) environments

#### Version 1.2.0 (2025-01-30)
- **Breaking change**: `attackVisualization` changed from string (Mermaid) to structured object
- Added support for interactive visualizations with nodes and edges
- Added support for conditional branching paths (multiple outcomes)
- Added support for click-to-view descriptions on nodes and edges
- Added node types: `principal`, `resource`, `action`, `outcome`
- Added optional branch identifiers and conditions for edges

#### Version 1.1.0 (2025-01-30)
- Added `attackVisualization` optional field for Mermaid diagrams of attack paths
- Provides visual representation of privilege escalation flows
- Supports simple and complex diagrams with optional styling

#### Version 1.0.0 (2024-10-07)
- Initial schema release
- Core required and optional fields
- Support for both new and legacy formats (permissions, prerequisites, exploitationSteps)

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
- `credential-access` - Access to hardcoded credentials, not through IAM
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

**Format requirement:** All recommendations MUST use multi-line YAML format with the `|` pipe operator (never use quoted strings with `\n`).

Should include:
- How to restrict the permissions using least privilege
- Monitoring and detection strategies
- IAM policy conditions and constraints
- Best practices

**For iam:PassRole privilege escalation paths**, use this standardized template adapted for the specific service:

```yaml
recommendation: |
  High powered service roles + overly permissive `iam:PassRole` is what makes this privilege escalation path exploitable and impactful.

  - **Avoid administrative service roles** - Very rarely does a [SERVICE_RESOURCE] need administrative access. Use the principle of least privilege.
  - **Avoid granting `iam:PassRole` on all resources** - Whenever possible, restrict `iam:PassRole` to specific roles or specific services.
  Use IAM policy conditions to restrict which roles can be passed and to which services:

  ```json
  {
    "Effect": "Allow",
    "Action": "iam:PassRole",
    "Resource": "arn:aws:iam::ACCOUNT_ID:role/Specific[ServiceRole]",
    "Condition": {
      "StringEquals": {
        "iam:PassedToService": "[service].amazonaws.com"
      }
    }
  }
  ```


  - Monitor CloudTrail for unusual [SERVICE_RESOURCE] creation followed by immediate [execution/invocation]
  - Monitor CloudTrail for [SERVICE_RESOURCE] creation by principals who do not usually create [resources]
  - Monitor CloudTrail for roles being passed to [SERVICE] that haven't been used before
  - Monitor and alert on [SERVICE_RESOURCE] creation with privileged roles
  - Regularly audit [SERVICE_RESOURCES] for excessive IAM permissions
  - Regularly audit all IAM roles that trust the [SERVICE] service and down-scope any roles with administrative access
```

**Template placeholders to adapt:**
- `[SERVICE_RESOURCE]` - The AWS resource type (e.g., "Lambda function", "EC2 instance", "SageMaker notebook")
- `[ServiceRole]` - The role name pattern (e.g., "LambdaRole", "EC2Role", "SageMakerRole")
- `[service]` - The service name (e.g., "lambda", "ec2", "sagemaker")
- `[SERVICE]` - The capitalized service name (e.g., "Lambda", "EC2", "SageMaker")
- `[execution/invocation]` - Service-specific action (e.g., "invocation", "execution", "startup")
- `[resources]` - Plural resource name (e.g., "functions", "instances", "notebooks")
- `[SERVICE_RESOURCES]` - Plural capitalized (e.g., "Lambda functions", "EC2 instances")

**Examples of adapted recommendations:**
- **Lambda**: "Lambda function", "lambda.amazonaws.com", "invocation", "functions"
- **EC2**: "EC2 instance", "ec2.amazonaws.com", "execution", "instances"
- **SageMaker**: "SageMaker notebook", "sagemaker.amazonaws.com", "startup", "notebooks"
- **CloudFormation**: "CloudFormation stack", "cloudformation.amazonaws.com", "resource creation", "stacks"

**For non-PassRole paths**, use multi-line format with service-specific prevention and monitoring guidance.

Example (non-PassRole):
```yaml
recommendation: |
  Restrict access to `iam:CreatePolicyVersion` using the principle of least privilege.
  Very few principals need this permission, so it should be restricted to only the
  few principals that need it.

  Monitor use of this sensitive permission using CloudSIEM detections, and look for usage anomalies.
```

#### `discoveryAttribution` (object)
Rich attribution information supporting primary discovery, derivative relationships, and original source tracking. This field allows documenting complex attribution scenarios including derivative work and multi-level attribution chains.

**This is the preferred attribution format.** All new paths should use `discoveryAttribution`.

The `discoveryAttribution` object contains up to three sub-objects:

##### `firstDocumented` (object, required if discoveryAttribution present)
Information about who first documented this specific attack path variation.

Fields:
- `author` (string, optional): Researcher's name (use for individual contributors)
- `source` (string, optional): Source name (use for organizations/websites like "HackTricks" or "pathfinding.cloud")
- `organization` (string, optional): Organization name (if author is specified)
- `date` (string, optional): Year or date documented (YYYY format)
- `link` (string, optional): URL to the source documentation

**Note:** Use either `author` OR `source`, not both. Use `author` for individual researchers and `source` for organizations/websites.

##### `derivativeOf` (object, optional)
Information about what this path is derived from. Only include if this path is a variation of another existing path.

Fields:
- `pathId` (string, required): The path ID this is derived from (e.g., `ecs-004`)
- `modification` (string, required): Description of what was modified or added compared to the original path

##### `ultimateOrigin` (object, optional)
Information about the ultimate origin if there's a multi-level derivative chain. Only include if this path is a derivative of a derivative and you want to trace back to the original discovery.

**Note:** Skip `ultimateOrigin` if it would be the same as `derivativeOf.pathId` - only use it for multi-level chains.

Fields:
- `pathId` (string, required): The original path ID (e.g., `ecs-004`)
- `author` (string, required): Original discoverer's name
- `organization` (string, optional): Organization name
- `date` (string, optional): Year discovered (YYYY format)
- `link` (string, required): URL to original research/documentation

---

**Example 1 (Original discovery by researcher):**
```yaml
discoveryAttribution:
  firstDocumented:
    author: Spencer Gietzen
    organization: Rhino Security Labs
    date: 2018
    link: https://rhinosecuritylabs.com/aws/weaponizing-ecs-task-definitions-steal-credentials-running-containers/
```

**Example 2 (Derivative documented by another source):**
```yaml
discoveryAttribution:
  firstDocumented:
    source: HackTricks
    link: https://cloud.hacktricks.wiki/en/pentesting-cloud/aws-security/aws-privilege-escalation/aws-ecs-privesc/

  derivativeOf:
    pathId: ecs-004
    modification: "Uses ecs:CreateService instead of ecs:RunTask to execute the malicious task definition"

  ultimateOrigin:
    pathId: ecs-004
    author: Spencer Gietzen
    organization: Rhino Security Labs
    date: 2018
    link: https://rhinosecuritylabs.com/aws/weaponizing-ecs-task-definitions-steal-credentials-running-containers/
```

**Example 3 (New path created on pathfinding.cloud):**
```yaml
discoveryAttribution:
  firstDocumented:
    author: Seth Art
    organization: Datadog
    date: 2025

  derivativeOf:
    pathId: ecs-003
    modification: "Adds ecs:CreateCluster permission for scenarios where no ECS cluster exists"

  ultimateOrigin:
    pathId: ecs-004
    author: Spencer Gietzen
    organization: Rhino Security Labs
    date: 2018
    link: https://rhinosecuritylabs.com/aws/weaponizing-ecs-task-definitions-steal-credentials-running-containers/
```

**Example 4 (Direct derivative, no multi-level chain):**
```yaml
discoveryAttribution:
  firstDocumented:
    author: Seth Art
    organization: Datadog
    date: 2025

  derivativeOf:
    pathId: ecs-004
    modification: "Adds ecs:CreateCluster permission for scenarios where no ECS cluster exists"

  # Note: ultimateOrigin omitted because it would be the same as derivativeOf.pathId
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

#### `learningEnvironments` (object)
Documents available learning labs, CTF environments, and cloud security training platforms where this privilege escalation path can be practiced safely.

This field is an object where each key is the environment name (e.g., `iam-vulnerable`, `pathfinder-labs`, `cloudfoxable`, `cybr`, `pwndlabs`) and the value is an object with details about that environment.

**Common fields for all environments:**
- `type` (string, required): Environment type - either `open-source` or `closed-source`
- `description` (string, required): Brief explanation of what the learning environment provides
- `scenario` (string, optional): The specific scenario/lab name or URL within the environment

**Additional fields for open-source environments:**
- `githubLink` (string, required for open-source): URL to the GitHub repository

**Additional fields for closed-source environments:**
- `scenarioPricingModel` (string, required for closed-source): Either `paid` or `free`

Example (open-source):
```yaml
learningEnvironments:
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: IAM-UpdateLoginProfile
    description: "Deploy Terraform into your own AWS account and practice individual exploitation paths"
  pathfinder-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinder-labs
    scenario: iam-updateloginprofile
    description: "Deploy Terraform scenarios individually or in groups, each with attack and cleanup scripts"
```

Example (closed-source):
```yaml
learningEnvironments:
  cybr:
    type: closed-source
    description: "A hosted learning environment with free and paid labs accessible by subscription"
    scenario: https://cybr.com/hands-on-labs/lab/iam-updateloginprofile-privilege-escalation/
    scenarioPricingModel: paid
  pwndlabs:
    type: closed-source
    description: "A cloud security training platform with hands-on AWS labs"
    scenario: https://pwnedlabs.io/labs/iam-privilege-escalation
    scenarioPricingModel: free
```

#### `toolSupport` (object) **[DEPRECATED]**
**Note: This field is deprecated as of schema version 1.3.0 and replaced by `learningEnvironments`. It will be removed in a future version.**

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

#### `detectionTools` (object)
Documents which open source security assessment tools can detect this privilege escalation path and links to their detection source code.

This field is an object where each key is the tool name (e.g., `pmapper`, `cloudsplaining`, `pacu`, `prowler`, `scoutsuite`) and the value is a URL string pointing to the specific source code file or line where this path's detection logic is implemented.

**Supported tool names:**
- `pmapper`: Principal Mapper by NCC Group
- `cloudsplaining`: Cloudsplaining by Salesforce
- `pacu`: Pacu AWS exploitation framework by Rhino Security Labs
- `prowler`: Prowler multi-cloud security tool
- `scoutsuite`: ScoutSuite by NCC Group

**Note:** The frontend loads tool metadata (display names, GitHub repository links, descriptions) from `metadata.json`. Only the `detectionSource` URL needs to be specified in each path's YAML file.

Example:
```yaml
detectionTools:
  pmapper: https://github.com/nccgroup/PMapper/blob/master/principalmapper/graphing/iam_edges.py#L123
  cloudsplaining: https://github.com/salesforce/cloudsplaining/blob/master/cloudsplaining/shared/constants.py#L45
  pacu: https://github.com/RhinoSecurityLabs/pacu/blob/master/pacu/modules/iam__privesc_scan/main.py#L234
```

**Frontend Behavior:**
- If this field is present with tool entries, the "Detection Coverage" section displays tabs for each tool with:
  - Tool name (from metadata)
  - Link to GitHub repository (from metadata)
  - Link to detection source code (from YAML)
  - Tool description with pros/cons (from metadata)
- If this field is absent or empty, the section displays: "This path is not currently supported by any open source detection tools."
- The section is **always visible** on the frontend regardless of whether tools are listed

#### `attackVisualization` (object)
A structured representation of the attack path that creates an interactive visualization showing the flow from starting principal to target outcomes, including conditional branches.

**Structure:**
- `nodes` (array, required): List of nodes in the attack graph
- `edges` (array, required): List of edges connecting nodes

**Node Fields:**
- `id` (string, required): Unique identifier for the node
- `label` (string, required): Display text for the node
- `type` (string, required): Node type - one of:
  - `principal`: IAM users, roles, or starting principal (any entity with IAM identity)
  - `resource`: AWS resources involved in attack (EC2, Lambda, S3, etc.) - **NOT IAM users/roles**
  - `payload`: Attacker exploitation choice, malicious code/commands being executed
  - `action`: (Deprecated - use `payload` instead) Action or intermediate step
  - `outcome`: Final outcome/result
- `color` (string, optional): Hex color code (e.g., `#ff9999`). Defaults based on type if not specified
- `description` (string, optional): Markdown description shown when node is clicked

**Important Type Distinctions:**
- **`principal` vs `resource`**: ALL IAM users and roles must be typed as `principal`, never as `resource`. This includes starting principals, target users/roles, assumed roles, execution roles, etc.
- **`payload` vs edges**: IAM actions (like `iam:CreateAccessKey`) should be represented as edge labels, NOT as payload nodes. Payload nodes represent what the attacker DOES with acquired permissions (e.g., "Execute malicious script", "Exfiltrate credentials")
- **When to use `payload`**: Use for attacker exploitation choices like: User Data scripts, Lambda function code, buildspec commands, reverse shells, credential exfiltration methods

**Description Formatting Guidelines:**

All description fields (for both nodes and edges) should follow these formatting rules to ensure consistent display in the frontend:

1. **Single-line paragraphs**: Text should flow as single-line paragraphs without artificial line breaks at ~80 characters
   - ✅ GOOD: `The principal with iam:PassRole and ec2:RunInstances permissions. Can be an IAM user or role.`
   - ❌ BAD: `The principal with iam:PassRole and ec2:RunInstances permissions.\nCan be an IAM user or role.` (artificial break)

2. **Multi-line structure**: Use line breaks only for intentional separation:
   - Separate paragraphs (different thoughts or topics)
   - Code blocks with bash/python commands
   - Bulleted or numbered lists
   - Example commands followed by explanations

3. **Code blocks**: Always preserve multi-line structure for commands
   ```yaml
   description: |
     Execute the command to create a Lambda function.

     Command:
     ```bash
     aws lambda create-function \
       --function-name privesc-function \
       --runtime python3.9 \
       --role "arn:aws:iam::ACCOUNT_ID:role/PRIVILEGED_ROLE"
     ```

     This creates the function with the privileged role attached.
   ```

4. **Lists**: Keep list items on separate lines
   ```yaml
   description: |
     The script could perform several actions:
     - Attach AdministratorAccess policy to starting principal
     - Create new admin access keys for starting principal
     - Add starting principal to admin group
   ```

**Edge Fields:**
- `from` (string, required): Source node id
- `to` (string, required): Target node id
- `label` (string, required): Edge label describing the action/transition
- `branch` (string, optional): Branch identifier (e.g., `A`, `B`, `C`, `A1`, `B1`) for conditional paths
- `condition` (string, optional): Condition type (e.g., `admin`, `no_permissions`, `some_permissions`, `iam_write_permissions`)
- `description` (string, optional): Markdown description shown when edge is clicked

**Critical Edge Labeling Rules:**
- **Edge labels should ONLY include permissions from `permissions.required`**
- Reconnaissance permissions (describe/list/get) from `permissions.additional` should NOT be edge labels
- Optional reconnaissance permissions can be mentioned in node descriptions instead
- Edges represent the required attack path flow, not helpful optional reconnaissance steps
- Example: ❌ WRONG - Edge labeled "ec2:DescribeLaunchTemplates" when this is in additional permissions
- Example: ✅ CORRECT - Edge labeled "ec2:CreateLaunchTemplateVersion + ec2:ModifyLaunchTemplate" (only required permissions)

**Important Edge Rendering Rules:**
- **Conditional edges** (those with `branch` or `condition` fields) are rendered as **dashed lines with NO visible label** on the graph
- **Transitive edges** (those without `branch` or `condition`) are rendered as **solid lines WITH visible labels** on the graph
- All edges (both conditional and transitive) show their label in the tooltip when clicked
- Edge labels should describe the action or condition clearly, as they will be shown in tooltips

**Node Label Conventions:**
- Use `starting-principal` when the attack works from either a user or role
- Use `starting-user` or `starting-role` only when the attack is specific to one type
- Use descriptive, specific labels for resources (e.g., `target-role`, `EC2 Instance`)
- Use clear outcome labels (e.g., `Effective Administrator`, `No Additional Access`)

**Color Conventions (defaults):**
- `principal` (users/roles): `#ff9999` (red)
- `resource` (AWS resources): `#ffcc99` (orange)
- `payload` (attacker actions): `#99ccff` (blue)
- `action` (deprecated): `#99ccff` (blue) - use `payload` instead
- `outcome` (success): `#99ff99` (green)
- `outcome` (partial): `#ffeb99` (yellow)
- `outcome` (dead end): `#cccccc` (gray)

**When to Use Conditional Branching:**

Use conditional branching when the outcome of an attack path depends on environmental factors that vary:

1. **Permission-dependent outcomes**: The privileges gained depend on the permissions of a resource (e.g., assumed role, passed role)
   - Example: sts:AssumeRole gains admin only if the target role has admin permissions

2. **Multiple attack approaches**: Different techniques to exploit the same vulnerability
   - Example: EC2 PassRole can use User Data script OR reverse shell

3. **Resource-dependent outcomes**: Success depends on what resources exist in the environment
   - Example: AttachUserPolicy gains admin only if an admin policy exists to attach

**Branch Naming Convention:**
- Use single letters (`A`, `B`, `C`) for major branches (different attack approaches)
- Use numbered variants (`A1`, `A2`, `A3`) for conditional outcomes within a branch
- Example: Branch `A` = User Data approach, `A1` = admin outcome, `A2` = partial outcome, `A3` = minimal outcome

**Common Conditional Patterns:**

For PassRole-based attacks, use this three-outcome pattern:
- **admin outcome** (green): Target resource has administrative permissions
- **some_permissions outcome** (yellow): Target resource has elevated but non-admin permissions
- **no_permissions outcome** (gray): Target resource has minimal permissions

Example (simple with branching):
```yaml
attackVisualization:
  nodes:
    - id: start
      label: Starting Principal
      type: principal
      description: |
        The principal initiating the attack. Can be an IAM user or role
        with sts:AssumeRole permission on the target role.

    - id: target_role
      label: Target Role
      type: resource
      description: |
        The privileged role being assumed. Must have a trust policy that
        allows the starting principal to assume it.

    - id: admin
      label: Effective Administrator
      type: outcome
      description: Full administrative access to the AWS account.

    - id: no_access
      label: No Additional Access
      type: outcome
      color: '#cccccc'
      description: |
        The assumed role has no interesting permissions beyond what
        the starting principal already had.

    - id: some_perms
      label: Check for Additional Access
      type: outcome
      color: '#ffeb99'
      description: |
        The assumed role has some permissions. Check for data access
        or additional privilege escalation paths.

  edges:
    - from: start
      to: target_role
      label: sts:AssumeRole
      description: |
        Use sts:AssumeRole to assume the target role. Requires both
        the permission and a matching trust policy.

    - from: target_role
      to: admin
      label: If role has admin permissions
      branch: A
      condition: admin
      description: |
        If the target role has AdministratorAccess or equivalent,
        attacker gains full administrative access.

    - from: target_role
      to: no_access
      label: If role has no interesting permissions
      branch: B
      condition: no_permissions
      description: |
        If the role only has minimal permissions, there may be
        no additional access gained.

    - from: target_role
      to: some_perms
      label: If role has some permissions
      branch: C
      condition: some_permissions
      description: |
        If the role has permissions to access data or other escalation
        paths, further exploration is needed.
```

Example (complex multi-step attack):
```yaml
attackVisualization:
  nodes:
    - id: start
      label: Starting Principal
      type: principal

    - id: ec2_instance
      label: EC2 Instance
      type: resource
      description: New EC2 instance created with privileged instance profile

    - id: priv_role
      label: privileged-role
      type: resource
      description: IAM role assumed by the EC2 instance

    - id: exfil
      label: Exfiltrate credentials
      type: action
      color: '#99ccff'
      description: Access instance via User Data or SSM to steal credentials

    - id: admin
      label: Effective Administrator
      type: outcome

  edges:
    - from: start
      to: ec2_instance
      label: iam:PassRole + ec2:RunInstances
      description: Launch EC2 instance and pass privileged role to it

    - from: ec2_instance
      to: priv_role
      label: Instance assumes role
      description: EC2 instance automatically assumes the passed role

    - from: priv_role
      to: exfil
      label: User Data / SSM access
      description: Access the instance to retrieve temporary credentials

    - from: exfil
      to: admin
      label: Use stolen credentials
      description: Use the exfiltrated credentials to gain admin access
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

discoveryAttribution:
  firstDocumented:
    author: "Spencer Gietzen"
    organization: "Rhino Security Labs"
    date: "2019"
    link: "https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/"

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

detectionTools:
  pmapper: https://github.com/nccgroup/PMapper/blob/master/principalmapper/graphing/iam_edges.py#L123
  cloudsplaining: https://github.com/salesforce/cloudsplaining/blob/master/cloudsplaining/shared/constants.py#L45

learningEnvironments:
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: IAM-CreatePolicyVersion
    description: "Deploy Terraform into your own AWS account and practice individual exploitation paths"

attackVisualization: |
  graph LR
      A[user-with-policy] -->|iam:CreatePolicyVersion| B[Modify attached policy]
      B -->|Set as default| C[Policy with admin permissions]
      C -->|Automatic effect| D[Effective Administrator]

      style A fill:#ff9999,stroke:#333,stroke-width:2px
      style B fill:#ffcc99,stroke:#333,stroke-width:2px
      style C fill:#ffcc99,stroke:#333,stroke-width:2px
      style D fill:#99ff99,stroke:#333,stroke-width:2px
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
