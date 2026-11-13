"""Tests for the multi-cloud checks in scripts/validate-schema.py.

Run with: python -m unittest discover tests
"""

import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from tests.script_loader import REPO_ROOT, load_script

validate_schema = load_script("validate-schema.py", "validate_schema")

GCP_IAM_001_PATH = REPO_ROOT / "data" / "paths" / "gcp" / "iam" / "gcp-iam-001.yaml"


def single_step(command_text: str) -> list:
    """Build a one-step exploitation step list."""
    return [{"step": 1, "command": command_text, "description": "Do the thing"}]


class CloudFromIdTests(unittest.TestCase):
    def test_bare_ids_are_aws(self):
        self.assertEqual(validate_schema.cloud_from_id("iam-001"), "aws")
        self.assertEqual(validate_schema.cloud_from_id("lambda-004"), "aws")

    def test_prefixed_ids_name_their_cloud(self):
        self.assertEqual(validate_schema.cloud_from_id("gcp-iam-001"), "gcp")
        self.assertEqual(validate_schema.cloud_from_id("gcp-cloudrun-001"), "gcp")
        self.assertEqual(validate_schema.cloud_from_id("azure-iam-001"), "azure")


class CloudFromFilePathTests(unittest.TestCase):
    def test_reads_cloud_directory_under_data_paths(self):
        self.assertEqual(
            validate_schema.cloud_from_file_path("data/paths/gcp/iam/gcp-iam-001.yaml"), "gcp"
        )
        self.assertEqual(
            validate_schema.cloud_from_file_path("/abs/repo/data/paths/aws/ec2/ec2-001.yaml"), "aws"
        )

    def test_returns_none_outside_data_paths(self):
        self.assertIsNone(validate_schema.cloud_from_file_path("/tmp/scratch/iam-001.yaml"))


class ExploitationToolCloudTests(unittest.TestCase):
    def test_curl_is_allowed_on_every_cloud(self):
        for cloud_name in ("aws", "gcp", "azure"):
            validate_schema.validate_exploitation_steps(
                {"curl": single_step("curl -s https://example.com")}, cloud=cloud_name
            )

    def test_aws_tool_rejected_on_gcp_path(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "awscli.*gcp"):
            validate_schema.validate_exploitation_steps(
                {"awscli": single_step("aws sts get-caller-identity")}, cloud="gcp"
            )

    def test_gcp_tool_rejected_on_aws_path(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "gcloud.*aws"):
            validate_schema.validate_exploitation_steps(
                {"gcloud": single_step("gcloud auth list")}, cloud="aws"
            )

    def test_cloud_tools_allowed_on_their_cloud(self):
        validate_schema.validate_exploitation_steps(
            {"gcloud": single_step("gcloud auth list"), "gcpwn": single_step("modules run enum_gcp")},
            cloud="gcp",
        )

    def test_unknown_tool_still_rejected(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "not valid"):
            validate_schema.validate_exploitation_steps({"terraform": single_step("terraform apply")})


class ValidateFileCloudConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.temporary_repo_dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temporary_repo_dir)

    def write_path_file(self, cloud_dir: str, path_data: dict) -> Path:
        """Write path_data under <tmp>/data/paths/<cloud_dir>/iam/<id>.yaml."""
        target_dir = self.temporary_repo_dir / "data" / "paths" / cloud_dir / "iam"
        target_dir.mkdir(parents=True)
        target_file = target_dir / f"{path_data['id']}.yaml"
        target_file.write_text(yaml.safe_dump(path_data, sort_keys=False))
        return target_file

    def test_existing_gcp_path_passes(self):
        is_valid, validation_errors = validate_schema.validate_file(str(GCP_IAM_001_PATH))
        self.assertTrue(is_valid, validation_errors)

    def test_gcp_id_in_aws_directory_fails(self):
        path_data = yaml.safe_load(GCP_IAM_001_PATH.read_text())
        misplaced_file = self.write_path_file("aws", path_data)
        is_valid, validation_errors = validate_schema.validate_file(str(misplaced_file))
        self.assertFalse(is_valid)
        self.assertTrue(
            any("directory" in error_text for error_text in validation_errors), validation_errors
        )

    def test_aws_tool_tab_on_gcp_path_fails(self):
        path_data = yaml.safe_load(GCP_IAM_001_PATH.read_text())
        path_data["exploitationSteps"]["awscli"] = single_step("aws sts get-caller-identity")
        gcp_file = self.write_path_file("gcp", path_data)
        is_valid, validation_errors = validate_schema.validate_file(str(gcp_file))
        self.assertFalse(is_valid)
        self.assertTrue(
            any("awscli" in error_text for error_text in validation_errors), validation_errors
        )


def retired_entry(**overrides) -> dict:
    """Build a valid retired-paths registry entry, with optional field overrides."""
    entry = {
        "id": "ec2-099",
        "cloud": "aws",
        "retiredOn": "2026-11-13",
        "reason": "Duplicate",
        "replacedBy": "ec2-001",
    }
    entry.update(overrides)
    return {field: value for field, value in entry.items() if value is not None}


class LoadRetiredPathsTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp_dir)

    def load(self, entries: list, valid_ids: set = frozenset({"ec2-001"})) -> dict:
        registry_file = self.temp_dir / "retired-paths.yaml"
        registry_file.write_text(yaml.safe_dump({"retiredPaths": entries}))
        return validate_schema.load_retired_paths(set(valid_ids), registry_file)

    def test_repo_registry_is_valid(self):
        # The committed registry must load against the committed corpus.
        corpus_ids = {
            yaml.safe_load(path_file.read_text())["id"]
            for path_file in (REPO_ROOT / "data" / "paths").rglob("*.yaml")
        }
        retired_paths_by_id = validate_schema.load_retired_paths(corpus_ids)
        self.assertIn("ec2-004", retired_paths_by_id)
        self.assertNotIn("ec2-004", corpus_ids)

    def test_missing_registry_file_means_nothing_retired(self):
        self.assertEqual(
            validate_schema.load_retired_paths(set(), self.temp_dir / "does-not-exist.yaml"), {}
        )

    def test_valid_entry_is_keyed_by_id(self):
        self.assertEqual(list(self.load([retired_entry()]).keys()), ["ec2-099"])

    def test_replacement_is_optional(self):
        self.assertIn("ec2-099", self.load([retired_entry(replacedBy=None)]))

    def test_missing_required_field_fails(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "missing reason"):
            self.load([retired_entry(reason=None)])

    def test_unexpected_field_fails(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "unexpected fields"):
            self.load([retired_entry(note="hi")])

    def test_cloud_must_match_id(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "belongs to 'aws'"):
            self.load([retired_entry(cloud="gcp")])

    def test_duplicate_entry_fails(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "more than once"):
            self.load([retired_entry(), retired_entry()])

    def test_replacement_must_exist(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "does not exist"):
            self.load([retired_entry(replacedBy="ec2-123")])

    def test_replacement_must_not_be_retired(self):
        with self.assertRaisesRegex(validate_schema.ValidationError, "itself retired"):
            self.load(
                [retired_entry(), retired_entry(id="ec2-098", replacedBy="ec2-099")],
                valid_ids={"ec2-001", "ec2-099"},
            )


class FindRetiredIdUsagesTests(unittest.TestCase):
    retired_paths_by_id = {"ec2-099": retired_entry()}

    def usages(self, path_data: dict) -> list:
        return validate_schema.find_retired_id_usages(path_data, self.retired_paths_by_id)

    def test_clean_path_has_no_usages(self):
        self.assertEqual(self.usages({"id": "ec2-001", "relatedPaths": ["ec2-002"]}), [])

    def test_reusing_retired_id_fails(self):
        (error_text,) = self.usages({"id": "ec2-099"})
        self.assertIn("must not be reused", error_text)

    def test_related_path_reference_names_replacement(self):
        (error_text,) = self.usages({"id": "ec2-001", "relatedPaths": ["ec2-099"]})
        self.assertIn("relatedPaths", error_text)
        self.assertIn("use 'ec2-001'", error_text)

    def test_parent_reference_fails_in_both_formats(self):
        self.assertEqual(len(self.usages({"id": "ec2-002", "parent": "ec2-099"})), 1)
        self.assertEqual(
            len(self.usages({"id": "ec2-002", "parent": {"id": "ec2-099", "modification": "x"}})), 1
        )

    def test_discovery_attribution_references_fail(self):
        path_data = {
            "id": "ec2-002",
            "discoveryAttribution": {
                "derivativeOf": {"pathId": "ec2-099"},
                "ultimateOrigin": {"pathId": "ec2-099"},
            },
        }
        self.assertEqual(len(self.usages(path_data)), 2)


if __name__ == "__main__":
    unittest.main()
