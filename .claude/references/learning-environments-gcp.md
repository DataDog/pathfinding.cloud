# Learning Environments Reference: GCP

Learning platforms to check for GCP IAM privilege escalation practice labs, in priority order.

## 1. pathfinding Labs (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/DataDog/pathfinding-labs (IMPORTANT: this repo is still private for now, so you can't WebSearch it. Instead read `~/Documents/projects/pathfinding-labs/modules/scenarios/single-account` locally and find the scenario there, then create a link that will work once the project goes live.)
- **What to look for**: Check `modules/scenarios/` for matching GCP attack paths
- **Field requirements**:
  ```yaml
  pathfinding-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinding-labs
    scenario: "privesc-one-hop/to-admin/gcp-iam-serviceaccounts-actas"
    description: "Deploy Terraform into your own GCP project to practice this attack path"
  ```

## 2. GCPGoat (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/ine-labs/GCPGoat
- **What to look for**: Check the README/Terraform modules for matching IAM privilege escalation scenarios (this is the GCP counterpart to CloudGoat)
- **Field requirements**:
  ```yaml
  gcpgoat:
    type: open-source
    githubLink: https://github.com/ine-labs/GCPGoat
    scenario: "scenario-name-here"
    description: "Deploy vulnerable infrastructure using GCPGoat to practice GCP attacks"
  ```

## 3. CYBR.com / PwnedLabs / HackSmarter (Closed Source / Hosted)
- **Type**: closed-source
- **What to look for**: These platforms are AWS-heavy but periodically add GCP content — search each catalog (https://cybr.com/hands-on-labs/, https://pwnedlabs.io, https://www.hacksmarter.org/catalog) for GCP IAM privilege escalation labs before assuming none exists
- **Field requirements**: same shape as the AWS reference (`type`, `description`, `scenario`, `scenarioPricingModel`)

## Notes

- Do not assume the AWS-only tools (IAM Vulnerable, CloudFoxable) have a GCP equivalent — they don't. Only cite GCPGoat or pathfinding-labs unless you find and verify a GCP-specific lab elsewhere.
