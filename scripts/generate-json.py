#!/usr/bin/env python3
"""
Converts YAML privilege escalation path files to a single JSON file for the website.

Usage:
    python generate-json.py
"""

import json
import yaml
import os
from pathlib import Path

def load_yaml_file(file_path):
    """Load and parse a YAML file."""
    with open(file_path, 'r') as f:
        return yaml.safe_load(f)

def find_all_yaml_files(data_dir='data/paths'):
    """Find all YAML files in the data directory."""
    yaml_files = []
    data_path = Path(data_dir)

    if not data_path.exists():
        print(f"Warning: Data directory '{data_dir}' does not exist")
        return []

    for file_path in data_path.rglob('*.yaml'):
        yaml_files.append(file_path)
    for file_path in data_path.rglob('*.yml'):
        yaml_files.append(file_path)

    return sorted(yaml_files)

def convert_yaml_to_json(input_dir='data/paths', output_file='paths.json'):
    """Convert all YAML files to a single JSON file."""
    print("Converting YAML files to JSON...")

    yaml_files = find_all_yaml_files(input_dir)

    if not yaml_files:
        print(f"No YAML files found in '{input_dir}'")
        return

    print(f"Found {len(yaml_files)} YAML file(s)")

    paths = []
    errors = []

    for yaml_file in yaml_files:
        try:
            print(f"  Processing: {yaml_file}")
            data = load_yaml_file(yaml_file)
            paths.append(data)
        except Exception as e:
            error_msg = f"Error processing {yaml_file}: {e}"
            print(f"  ✗ {error_msg}")
            errors.append(error_msg)

    if errors:
        print(f"\n⚠️  {len(errors)} error(s) occurred during conversion")
        for error in errors:
            print(f"  - {error}")

    # Sort paths by ID
    paths.sort(key=lambda x: x.get('id', ''))

    # Write JSON file
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(paths, f, indent=2)

    print(f"\n✓ Successfully converted {len(paths)} path(s) to JSON")
    print(f"  Output: {output_file}")

    # Generate metadata
    metadata = {
        'totalPaths': len(paths),
        'services': list(set([
            service
            for path in paths
            for service in path.get('services', [])
        ])),
        'categories': list(set([
            path.get('category')
            for path in paths
            if path.get('category')
        ])),
        'lastUpdated': None  # Could add timestamp here
    }

    metadata_file = output_path.parent / 'metadata.json'
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"  Metadata: {metadata_file}")
    print(f"\nStatistics:")
    print(f"  Total paths: {metadata['totalPaths']}")
    print(f"  Services: {len(metadata['services'])}")
    print(f"  Categories: {len(metadata['categories'])}")

def main():
    """Main entry point."""
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    os.chdir(project_root)

    convert_yaml_to_json()

if __name__ == '__main__':
    main()
