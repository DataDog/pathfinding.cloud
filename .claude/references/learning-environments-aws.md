# Learning Environments Reference: AWS

Learning platforms to check for AWS IAM privilege escalation practice labs, in priority order.

## 1. pathfinding Labs (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/DataDog/pathfinding-labs (IMPORTANT: this repo is still private for now, so you can't WebSearch it. Instead read `~/Documents/projects/pathfinding-labs/modules/scenarios/single-account` locally and find the scenario there, then create a link that will work once the project goes live.)
- **What to look for**: Check `modules/scenarios/` for matching attack paths
- **Key patterns**: Look for `scenario.yaml` files that match the required permissions
- **Field requirements**:
  ```yaml
  pathfinding-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinding-labs
    scenario: "privesc-one-hop/to-admin/iam-passrole+lambda-createfunction"
    description: "Deploy Terraform into your own AWS account to practice this attack path"
  ```

## 2. IAM Vulnerable (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/BishopFox/iam-vulnerable
- **What to look for**: Check the README or Terraform modules for matching scenarios
- **Key patterns**: Look for scenario names like "IAM-CreateAccessKey", "IAM-PassRole-EC2"
- **Field requirements**:
  ```yaml
  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: "IAM-CreatePolicyVersion"
    description: "Deploy Terraform into your own AWS account and practice individual exploitation paths"
  ```

## 3. CloudGoat (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/RhinoSecurityLabs/cloudgoat
- **What to look for**: Check scenarios in the repository for matching attack paths
- **Field requirements**:
  ```yaml
  cloudgoat:
    type: open-source
    githubLink: https://github.com/RhinoSecurityLabs/cloudgoat
    scenario: "iam_privesc_by_rollback"
    description: "Deploy vulnerable infrastructure using CloudGoat to practice AWS attacks"
  ```

## 4. CloudFoxable (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/BishopFox/cloudfoxable
- **What to look for**: Check scenarios for matching attack paths, especially IAM misconfigurations
- **Field requirements**:
  ```yaml
  cloudfoxable:
    type: open-source
    githubLink: https://github.com/BishopFox/cloudfoxable
    scenario: "scenario-name-here"
    description: "Deploy vulnerable AWS environment using CloudFoxable"
  ```

## 5. CYBR.com (Closed Source / Hosted)
- **Type**: closed-source
- **Website**: https://cybr.com
- **What to look for**: Search their hands-on labs catalog for IAM privilege escalation labs
- **Field requirements**:
  ```yaml
  cybr:
    type: closed-source
    description: "Hosted learning environment with interactive AWS security labs"
    scenario: https://cybr.com/hands-on-labs/lab/iam-privilege-escalation/
    scenarioPricingModel: paid  # or "free" if applicable
  ```

## 6. PwnedLabs (Closed Source / Hosted)
- **Type**: closed-source
- **Website**: https://pwnedlabs.io
- **What to look for**: Search their lab catalog for AWS IAM labs
- **Field requirements**:
  ```yaml
  pwnedlabs:
    type: closed-source
    description: "Hosted cloud security labs with AWS privilege escalation scenarios"
    scenario: https://pwnedlabs.io/labs/lab-name-here
    scenarioPricingModel: paid  # or "free" if applicable
  ```

## 7. HackSmarter (Closed Source / Hosted)
- **Type**: closed-source
- **Website**: https://www.hacksmarter.org/catalog
- **What to look for**: Search their catalog for AWS security courses/labs
- **Field requirements**:
  ```yaml
  hacksmarter:
    type: closed-source
    description: "Cloud security training platform with AWS labs"
    scenario: https://www.hacksmarter.org/catalog/course-or-lab-name
    scenarioPricingModel: paid  # or "free" if applicable
  ```
