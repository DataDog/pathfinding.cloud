import argparse
import json
import logging
import sys
from pathlib import Path

import yaml
from jsonschema import Draft7Validator

__LOGGER__ = logging.getLogger(__name__)

logging.basicConfig(
    format="%(levelname)-8s [%(filename)s:%(funcName)s:%(lineno)d] %(message)s"
)


class SchemaValidator:
    """Validates YAML files against JSON schemas."""

    def __init__(self, schema_path: Path):
        self.schema = self._load_schema(schema_path)
        self.validator = Draft7Validator(self.schema)

    @staticmethod
    def _load_schema(schema_path: Path) -> dict:
        try:
            with open(schema_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            __LOGGER__.error(f"Schema file not found: {schema_path}")
            sys.exit(1)
        except json.JSONDecodeError as exc:
            __LOGGER__.error(f"Invalid JSON in schema file {schema_path}: {exc}")
            sys.exit(1)

    def validate_file(self, yaml_path: Path) -> tuple[bool, list[str]]:
        try:
            with open(yaml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)

            if data is None:
                return False, ["File is empty or contains only comments"]

            errors = [error.message for error in self.validator.iter_errors(data)]
            return (False, errors) if errors else (True, [])

        except yaml.YAMLError as exc:
            return False, [f"YAML parsing error: {exc}"]
        except Exception as exc:
            __LOGGER__.exception(f"Unexpected error validating {yaml_path}")
            return False, [str(exc)]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate YAML files in data/paths against JSON schema"
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        help="Set the logging level (default: INFO)",
    )
    args = parser.parse_args()
    __LOGGER__.setLevel(getattr(logging, args.log_level))

    base_dir = Path(__file__).parent.parent
    schema_path = base_dir / "schemas" / "path-schema.json"
    paths_dir = base_dir / "data" / "paths"

    if not schema_path.exists():
        __LOGGER__.error(f"Schema file not found: {schema_path}")
        sys.exit(1)

    if not paths_dir.exists():
        __LOGGER__.error(f"Path directory not found: {paths_dir}")
        sys.exit(1)

    yaml_files = sorted(set(paths_dir.rglob("*.yaml")) | set(paths_dir.rglob("*.yml")))

    if not yaml_files:
        __LOGGER__.warning(f"No YAML files found in {paths_dir}")
        sys.exit(0)

    validator = SchemaValidator(schema_path)

    total_success = 0
    total_failure = 0

    __LOGGER__.info(f"Validating {len(yaml_files)} YAML file(s)")

    for yaml_file in yaml_files:
        rel_path = yaml_file.relative_to(base_dir)
        __LOGGER__.debug(f"Validating: {rel_path}")

        success, errors = validator.validate_file(yaml_file)

        if success:
            __LOGGER__.debug(f"{rel_path} is valid")
            total_success += 1
        else:
            primary_error = errors[0]
            __LOGGER__.error(f"{rel_path} validation failed: {primary_error}")
            total_failure += 1

    status = "FAILED" if total_failure > 0 else "PASSED"

    __LOGGER__.info(
        "Validation_Summary: "
        f"passed={total_success} "
        f"failed={total_failure} "
        f"total={total_success + total_failure} "
        f"status={status}"
    )

    sys.exit(1 if total_failure > 0 else 0)


if __name__ == "__main__":
    main()
