# Detection Tools Reference: AWS

Open source security tools to check for AWS IAM privilege escalation detection coverage, in priority order (most comprehensive detection engines first).

## 1. PMapper (Principal Mapper)
- **Repository**: https://github.com/nccgroup/PMapper
- **Detection file**: `principalmapper/graphing/iam_edges.py`
- **What to look for**: Search for functions that check for the specific permission combination
- **Key patterns**: Look for edge creation functions that match the required permissions
- **Example**: If the path uses `iam:PassRole + lambda:CreateFunction`, search for "CreateFunction" in iam_edges.py

## 2. Cloudsplaining
- **Repository**: https://github.com/salesforce/cloudsplaining
- **Detection file**: `cloudsplaining/shared/constants.py`
- **What to look for**: Check the `PRIVILEGE_ESCALATION_METHODS` constant for the required permissions
- **Key patterns**: Look for permission names in the privilege escalation list
- **Example**: If the path uses `iam:CreateAccessKey`, check if it's in PRIVESC_ACTIONS

## 3. Pacu
- **Repository**: https://github.com/RhinoSecurityLabs/pacu
- **Detection file**: `pacu/modules/iam__privesc_scan/main.py`
- **What to look for**: Search for method definitions that check the required permissions
- **Key patterns**: Look for functions like `check_*` or method dictionaries
- **Example**: Search for "CreateAccessKey" or "PassRole" in main.py

## 4. Prowler
- **Repository**: https://github.com/prowler-cloud/prowler
- **Detection file**: `prowler/providers/aws/services/iam/lib/privilege_escalation.py`
- **What to look for**: Determine if any combo in `privilege_escalation_policies_combination` matches this attack path
- **Search approach**: Use GitHub search within the repo for the permission names

## Output key names

Use these lowercase keys in `detectionTools`: `pmapper`, `cloudsplaining`, `pacu`, `prowler`.

## Example

```yaml
detectionTools:
  pmapper: https://github.com/nccgroup/PMapper/blob/master/principalmapper/graphing/iam_edges.py#L456
  cloudsplaining: https://github.com/salesforce/cloudsplaining/blob/master/cloudsplaining/shared/constants.py#L23
  pacu: https://github.com/RhinoSecurityLabs/pacu/blob/master/pacu/modules/iam__privesc_scan/main.py#L89
```
