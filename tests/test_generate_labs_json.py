"""Tests for the multi-cloud handling in scripts/generate-labs-json.py.

Run with: python -m unittest discover tests
"""

import unittest
from pathlib import Path

from tests.script_loader import REPO_ROOT, load_script

generate_labs_json = load_script("generate-labs-json.py", "generate_labs_json")

# A sibling pathfinding-labs clone, when present, lets us check real GCP READMEs.
PATHFINDING_LABS_DIR = REPO_ROOT.parent / "pathfinding-labs"
GCP_SCENARIOS_DIR = (
    PATHFINDING_LABS_DIR / "modules" / "scenarios" / "gcp" / "single-account"
    / "privesc-one-hop" / "to-admin"
)

MINIMAL_GCP_DEFEND_README = """# Example

## Defend

### Detecting Abuse (CloudSIEM)

#### Cloud Audit Log Events to Monitor

- `iam.googleapis.com/GenerateAccessToken`

#### Detonation logs

Coming soon.
"""


class ServicePrefixTests(unittest.TestCase):
    def test_aws_permission(self):
        self.assertEqual(generate_labs_json.service_prefix_of("lambda:CreateFunction"), "lambda")

    def test_gcp_permission(self):
        self.assertEqual(generate_labs_json.service_prefix_of("iam.serviceAccounts.actAs"), "iam")
        self.assertEqual(generate_labs_json.service_prefix_of("run.routes.invoke"), "run")

    def test_azure_permission(self):
        self.assertEqual(
            generate_labs_json.service_prefix_of("Microsoft.Compute/virtualMachines/write"),
            "microsoft.compute",
        )

    def test_unparseable_permission(self):
        self.assertIsNone(generate_labs_json.service_prefix_of("*"))


class CloudFromModulePathTests(unittest.TestCase):
    def test_gcp_module_path(self):
        self.assertEqual(
            generate_labs_json.cloud_from_module_path(
                "modules/scenarios/gcp/single-account/privesc-one-hop/to-admin/gcp-iam-001-x"
            ),
            "gcp",
        )

    def test_aws_module_path_has_no_cloud_segment(self):
        self.assertEqual(
            generate_labs_json.cloud_from_module_path(
                "modules/scenarios/single-account/privesc-one-hop/to-admin/iam-002-x"
            ),
            "aws",
        )


class AuditLogHeadingTests(unittest.TestCase):
    def test_cloud_audit_log_heading_is_captured(self):
        parsed_sections = generate_labs_json.parse_readme_sections_v3(MINIMAL_GCP_DEFEND_README)
        cloud_siem = parsed_sections["defend"]["cloudSiem"]
        self.assertIn("GenerateAccessToken", cloud_siem["auditLogEvents"])
        self.assertIn("Coming soon", cloud_siem["detonationLogs"])


@unittest.skipUnless(GCP_SCENARIOS_DIR.is_dir(), "sibling pathfinding-labs clone not found")
class RealGcpLabTests(unittest.TestCase):
    def transform(self, scenario_dir: Path) -> dict:
        readme_path = scenario_dir / "README.md"
        readme_text, module_path = generate_labs_json.load_local_readme(
            readme_path, str(PATHFINDING_LABS_DIR)
        )
        lab_entry, is_valid = generate_labs_json.transform_readme(
            readme_text, module_path, readme_dir=str(scenario_dir)
        )
        self.assertTrue(is_valid, scenario_dir.name)
        return lab_entry

    def test_every_gcp_lab_has_cloud_services_and_audit_events(self):
        for scenario_dir in sorted(GCP_SCENARIOS_DIR.iterdir()):
            if not (scenario_dir / "README.md").exists():
                continue
            with self.subTest(scenario=scenario_dir.name):
                lab_entry = self.transform(scenario_dir)
                self.assertEqual(lab_entry["cloud"], "gcp")
                self.assertIn("iam", lab_entry["services"])
                self.assertIn("auditLogEvents", lab_entry["readme"]["defend"]["cloudSiem"])


if __name__ == "__main__":
    unittest.main()
