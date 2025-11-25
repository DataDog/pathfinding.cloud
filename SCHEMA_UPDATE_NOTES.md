# Schema Update: Limitations and Next Steps

## Overview

Added two new optional fields to better document the nuances of privilege escalation paths, particularly for PassRole-based attacks.

## New Fields

### `limitations` (optional, string)

**Purpose**: Explains when a path provides direct admin access vs. limited escalation.

**Key Points**:
- Describes what determines the level of access gained
- Clarifies conditions for admin vs. partial privilege escalation
- Especially important for PassRole + service combinations

**Example Use Case**:
For `iam:PassRole+ec2:RunInstances`, you can only get admin if:
1. A role exists that trusts ec2.amazonaws.com
2. That role has admin permissions

If only a read-only role exists, you only get read-only access.

### `nextSteps` (optional, string)

**Purpose**: Provides guidance for multi-hop attack paths when direct admin access isn't achieved.

**Key Points**:
- Commands to enumerate gained permissions
- Common multi-hop scenarios
- What to look for in assumed role permissions
- How to chain privileges for complete escalation

**Example Scenario**:
If EC2 role has `sts:AssumeRole` permission and there's an admin role that allows assumption, you can chain:
1. PassRole + EC2 → Get limited role
2. Enumerate permissions → Find sts:AssumeRole
3. AssumeRole → Get admin role

## Why These Fields Matter

### Real-World Accuracy
- Most PassRole paths don't give admin directly
- Attackers need to understand what they actually gain
- Multi-hop attacks are common in practice

### Defender Perspective
- Shows full attack chains, not just single steps
- Helps understand risk even with "limited" roles
- Guides detection of multi-step attacks

### Pentester Guidance
- What to do after initial exploitation
- How to enumerate for additional paths
- Practical next commands to run

## Updated Files

1. **SCHEMA.md** - Added field definitions with examples
2. **scripts/validate-schema.py** - Added to OPTIONAL_FIELDS
3. **website/js/app.js** - Display in modal with icons (⚠️ and 🔗)
4. **data/paths/ec2/ec2-001.yaml** - Example implementation
5. **CLAUDE.md** - Updated field order convention

## Example: ec2-001

```yaml
limitations: |
  This path only provides direct administrative access if a role exists that:
  1. Trusts ec2.amazonaws.com in its trust policy
  2. Has administrative permissions (e.g., AdministratorAccess policy attached)

  If no such role exists, you are limited to the permissions of whatever roles are
  available and trust ec2.amazonaws.com. For example, if only a read-only role trusts
  EC2, you can only gain read-only access through this path.

  However, even limited access may enable multi-hop attacks (see Next Steps).

nextSteps: |
  After gaining access to the EC2 instance role, enumerate its permissions:

  1. Connect to the instance and retrieve role credentials:
     curl http://169.254.169.254/latest/meta-data/iam/security-credentials/ROLE_NAME

  2. Use the credentials to list the role's policies:
     aws iam list-attached-role-policies --role-name ROLE_NAME
     aws iam list-role-policies --role-name ROLE_NAME

  3. Look for additional privilege escalation opportunities:
     - sts:AssumeRole permissions → Can assume other more privileged roles
     - iam:PassRole + other service permissions → Chain to another PassRole attack
     - ssm:SendCommand or ssm:StartSession → Access other EC2 instances
     - lambda:UpdateFunctionCode + lambda:InvokeFunction → Modify existing Lambda functions
     - iam:CreatePolicyVersion, iam:PutRolePolicy, etc. → Direct self-escalation

  Common multi-hop scenario:
  If the EC2 role has sts:AssumeRole with Resource: "*" or a specific admin role ARN,
  and there exists an admin role with a trust policy allowing your role to assume it,
  you can complete the privilege escalation chain:

  aws sts assume-role --role-arn arn:aws:iam::ACCOUNT_ID:role/AdminRole --role-session-name escalation
```

## Paths That Should Have These Fields

### High Priority (PassRole combinations):
- ✅ ec2-001: iam:PassRole+ec2:RunInstances
- ⬜ lambda-001: iam:PassRole+lambda:CreateFunction+lambda:InvokeFunction
- ⬜ cloudformation-001: iam:PassRole+cloudformation:CreateStack

### Medium Priority (Access Resource):
- ⬜ ssm-001: ssm:StartSession
- ⬜ ssm-002: ssm:SendCommand
- ⬜ ec2-002: ec2:ModifyInstanceAttribute+ec2:StopInstances+ec2:StartInstances

### Lower Priority (Direct escalation):
Most IAM self-escalation paths (iam-001 through iam-012) give direct escalation, so limitations/nextSteps are less critical but could still mention what to do after gaining admin.


## Future Enhancements

Potential additions:
- `commonScenarios` - Real-world attack scenarios
- `chainsWith` - Explicit links to paths that chain well
- `detectionDifficulty` - How hard to detect (easy/medium/hard)
- `exploitComplexity` - How hard to exploit (low/medium/high)
