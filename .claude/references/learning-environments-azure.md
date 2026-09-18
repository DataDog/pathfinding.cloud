# Learning Environments Reference: Azure

Learning platforms to check for Azure / Entra ID privilege escalation practice labs, in priority order.

## 1. pathfinding Labs (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/DataDog/pathfinding-labs (IMPORTANT: this repo is still private for now, so you can't WebSearch it. Instead read `~/Documents/projects/pathfinding-labs/modules/scenarios/single-account` locally and find the scenario there, then create a link that will work once the project goes live.)
- **What to look for**: Check `modules/scenarios/` for matching Azure attack paths
- **Field requirements**:
  ```yaml
  pathfinding-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinding-labs
    scenario: "privesc-one-hop/to-admin/azure-managed-identity-actas"
    description: "Deploy Terraform into your own Azure subscription to practice this attack path"
  ```

## 2. AzureGoat (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/ine-labs/AzureGoat
- **What to look for**: Check the README/Terraform modules for matching RBAC/Entra ID privilege escalation scenarios (this is the Azure counterpart to CloudGoat)
- **Field requirements**:
  ```yaml
  azuregoat:
    type: open-source
    githubLink: https://github.com/ine-labs/AzureGoat
    scenario: "scenario-name-here"
    description: "Deploy vulnerable infrastructure using AzureGoat to practice Azure attacks"
  ```

## 3. CYBR.com / PwnedLabs / HackSmarter (Closed Source / Hosted)
- **Type**: closed-source
- **What to look for**: These platforms are AWS-heavy but periodically add Azure content — search each catalog (https://cybr.com/hands-on-labs/, https://pwnedlabs.io, https://www.hacksmarter.org/catalog) for Azure privilege escalation labs before assuming none exists
- **Field requirements**: same shape as the AWS reference (`type`, `description`, `scenario`, `scenarioPricingModel`)

## Notes

- Do not assume the AWS-only tools (IAM Vulnerable, CloudFoxable) have an Azure equivalent — they don't. Only cite AzureGoat or pathfinding-labs unless you find and verify an Azure-specific lab elsewhere.
