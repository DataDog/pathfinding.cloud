"""Load the hyphenated scripts in scripts/ as importable modules for tests."""

import importlib.util
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"


def load_script(script_filename: str, module_name: str):
    """Import scripts/<script_filename> under module_name and return the module."""
    script_path = SCRIPTS_DIR / script_filename
    module_spec = importlib.util.spec_from_file_location(module_name, script_path)
    loaded_module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(loaded_module)
    return loaded_module
