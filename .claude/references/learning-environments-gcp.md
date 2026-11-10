# Learning Environments Reference: GCP

Learning platforms to check for GCP IAM privilege escalation practice labs, in priority order.

## 1. pathfinding Labs (Open Source)
- **Type**: open-source
- **Repository**: https://github.com/DataDog/pathfinding-labs (public). A local clone is usually at `~/Documents/projects/pathfinding/pathfinding-labs`; GCP scenarios live under `modules/scenarios/gcp/single-account/`. Find the matching scenario first by grepping `scenario.yaml` files for `pathfinding-cloud-id: "<this path's id>"`, then fall back to matching required permissions.)
- **What to look for**: Check `modules/scenarios/gcp/` for matching GCP attack paths. Use the full module path (from `modules/`) as `scenario`, as in `data/paths/gcp/iam/gcp-iam-001.yaml`
- **Field requirements**:
  ```yaml
  pathfinding-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinding-labs
    scenario: modules/scenarios/gcp/single-account/privesc-one-hop/to-admin/gcp-iam-001-iam-serviceaccountsgetaccesstoken
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
