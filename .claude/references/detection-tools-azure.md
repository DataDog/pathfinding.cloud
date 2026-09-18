# Detection Tools Reference: Azure

Open source security tools to check for Azure / Entra ID privilege escalation detection coverage, in priority order.

**Note:** Some Azure AD attack-graph tools (Stormspotter) are lightly maintained or archived. Verify each repo/path below still exists and still implements this specific check before citing it — if you can't verify, skip it per the "only add verified tools" rule.

## 1. AzureHound / BloodHound
- **Repository**: https://github.com/SpecterOps/AzureHound (collector) + https://github.com/SpecterOps/BloodHound (attack-graph edges)
- **What to look for**: BloodHound's Azure edge definitions for privilege-escalation edges (e.g. `AZOwns`, `AZContributor`, `AZRunsAs`, role-assignment edges that model passing/assuming a higher-privileged identity) — this is the closest Azure analog to PMapper's edge model
- **Search approach**: Search BloodHound's edge/analysis code for the specific Azure RBAC role or Entra ID permission this path uses

## 2. Prowler (Azure provider)
- **Repository**: https://github.com/prowler-cloud/prowler
- **Detection area**: `prowler/providers/azure/services/`
- **What to look for**: Checks for risky role assignments or Entra ID permissions matching this path

## 3. ScoutSuite (Azure module)
- **Repository**: https://github.com/nccgroup/ScoutSuite
- **Detection area**: `ScoutSuite/providers/azure/` rulesets
- **What to look for**: Ruleset definitions flagging the specific role/permission combination

## 4. Stormspotter
- **Repository**: https://github.com/Azure/Stormspotter (check if archived/maintained before citing)
- **What to look for**: Attack-graph relationships modeling the specific privilege escalation

## Output key names

Use lowercase keys in `detectionTools`: `bloodhound`, `prowler`, `scoutsuite`, `stormspotter`. Only add a key you've confirmed with a specific file/line link.

## Example

```yaml
detectionTools:
  bloodhound: https://github.com/SpecterOps/BloodHound/blob/main/packages/go/analysis/azure/post.go#L88
  prowler: https://github.com/prowler-cloud/prowler/blob/master/prowler/providers/azure/services/entra/entra_service.py#L45
```
