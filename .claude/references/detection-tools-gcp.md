# Detection Tools Reference: GCP

Open source security tools to check for GCP IAM privilege escalation detection coverage, in priority order.

**Note:** GCP's privesc-detection tool ecosystem is smaller than AWS's and moves fast. Verify each repo/path below still exists before citing it — if a tool has been renamed, archived, or never actually implemented detection for this specific permission combination, skip it per the "only add verified tools" rule.

## 1. Prowler (GCP provider)
- **Repository**: https://github.com/prowler-cloud/prowler
- **Detection area**: `prowler/providers/gcp/services/iam/`
- **What to look for**: GCP IAM checks for risky role bindings and privilege escalation combinations (e.g. `iam.serviceAccounts.actAs`, `iam.roles.update`, `deploymentmanager.deployments.create`)
- **Search approach**: GitHub search within the repo for the specific permission name(s)

## 2. ScoutSuite (GCP module)
- **Repository**: https://github.com/nccgroup/ScoutSuite
- **Detection area**: `ScoutSuite/providers/gcp/` rulesets (IAM findings)
- **What to look for**: Ruleset definitions flagging overly permissive IAM bindings that match this path's required permissions

## 3. gcp_scanner
- **Repository**: https://github.com/google/gcp_scanner
- **What to look for**: This is a recon/scanning tool (built by Google) rather than a pure detector — check if it specifically enumerates or flags the permission combination used by this path (e.g. service account impersonation chains via `iam.serviceAccounts.getAccessToken`/`actAs`)

## Output key names

Use lowercase keys in `detectionTools`: `prowler`, `scoutsuite`, `gcp-scanner`. Only add a key you've confirmed with a specific file/line link.

## Example

```yaml
detectionTools:
  prowler: https://github.com/prowler-cloud/prowler/blob/master/prowler/providers/gcp/services/iam/iam_service.py#L120
```
