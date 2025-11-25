#!/usr/bin/env python3
"""
Validates AWS IAM privilege escalation path YAML files against the schema.

Usage:
    python validate-schema.py <file_or_directory>
    python validate-schema.py data/paths/iam/iam-001.yaml
    python validate-schema.py data/paths/
"""

import sys
import yaml
import os
from pathlib import Path
from typing import Dict, List, Any, Tuple

# Schema definition
REQUIRED_FIELDS = {
    'id': str,
    'name': str,
    'category': str,
    'services': list,
    'permissions': dict,  # New format: dict with 'required' and optional 'additional' arrays
    'description': str,
    'exploitationSteps': (dict, list),  # dict (new format) or list (legacy)
    'recommendation': str,
    'discoveredBy': dict,
}

# For backward compatibility during migration
LEGACY_FIELDS = {
    'requiredPermissions': list,  # Old format, being migrated to 'permissions'
}

OPTIONAL_FIELDS = {
    'prerequisites': (dict, list),  # dict (new tabbed format) or list (legacy)
    'limitations': str,  # Explains admin vs. limited access
    'references': list,
    'relatedPaths': list,
    'detectionRules': list,
    'detectionTools': dict,  # New field for open source detection tool coverage (v1.4.0)
    'learningEnvironments': dict,  # New field for learning labs and CTF environments
    'toolSupport': dict,  # DEPRECATED in v1.3.0, kept for backward compatibility
    'attackVisualization': (dict, str),  # dict (new structured format) or str (legacy Mermaid)
    'discoveryAttribution': (dict, list),  # dict (object format) or list (legacy array format)
}

ALLOWED_CATEGORIES = [
    'self-escalation',
    'lateral-movement',
    'service-passrole',
    'credential-access',
    'access-resource',
]

ALLOWED_PREREQUISITE_TYPES = [
    'resource-state',
    'trust-relationship',
    'service-config',
]

ALLOWED_EXPLOITATION_TOOLS = [
    'awscli',
    'pacu',
    'pmapper',
    'stratus',
    'leonidas',
    'nebula',
    'pathfinder',
]

ALLOWED_PREREQUISITE_TABS = [
    'admin',
    'lateral',
]

class ValidationError(Exception):
    """Custom exception for validation errors."""
    pass


def validate_id(id_value: str) -> None:
    """Validate the ID field format (service-###)."""
    if not id_value:
        raise ValidationError("ID cannot be empty")

    parts = id_value.split('-')
    if len(parts) != 2:
        raise ValidationError(f"ID '{id_value}' must be in format 'service-###'")

    service, number = parts
    if not service.isalnum():
        raise ValidationError(f"Service part of ID '{id_value}' must be alphanumeric")

    if not number.isdigit() or len(number) != 3:
        raise ValidationError(f"Number part of ID '{id_value}' must be exactly 3 digits")


def validate_category(category: str) -> None:
    """Validate the category field."""
    if category not in ALLOWED_CATEGORIES:
        raise ValidationError(
            f"Category '{category}' is not valid. "
            f"Allowed values: {', '.join(ALLOWED_CATEGORIES)}"
        )


def validate_services(services: List[str]) -> None:
    """Validate the services field."""
    if not services:
        raise ValidationError("Services list cannot be empty")

    if not isinstance(services, list):
        raise ValidationError("Services must be a list")

    for service in services:
        if not isinstance(service, str):
            raise ValidationError(f"Service '{service}' must be a string")


def validate_permissions(permissions: Dict) -> None:
    """Validate the permissions field (new format with required/additional)."""
    if not isinstance(permissions, dict):
        raise ValidationError("Permissions must be a dictionary")

    if 'required' not in permissions:
        raise ValidationError("Permissions must have a 'required' field")

    # Validate required permissions
    if not isinstance(permissions['required'], list):
        raise ValidationError("Permissions 'required' must be a list")

    if not permissions['required']:
        raise ValidationError("Permissions 'required' list cannot be empty")

    for perm in permissions['required']:
        validate_permission_object(perm, "required")

    # Validate additional permissions if present
    if 'additional' in permissions:
        if not isinstance(permissions['additional'], list):
            raise ValidationError("Permissions 'additional' must be a list")

        for perm in permissions['additional']:
            validate_permission_object(perm, "additional")


def validate_permission_object(perm: Dict, perm_type: str) -> None:
    """Validate a single permission object."""
    if not isinstance(perm, dict):
        raise ValidationError(f"Each {perm_type} permission must be a dictionary")

    if 'permission' not in perm:
        raise ValidationError(f"Each {perm_type} permission must have a 'permission' field")

    if not isinstance(perm['permission'], str):
        raise ValidationError(f"Permission value in {perm_type} must be a string")

    # Validate IAM permission format (service:Action)
    if ':' not in perm['permission']:
        raise ValidationError(
            f"Permission '{perm['permission']}' in {perm_type} must be in format 'service:Action'"
        )


def validate_required_permissions(permissions: List[Dict]) -> None:
    """Validate the requiredPermissions field (legacy format)."""
    if not permissions:
        raise ValidationError("RequiredPermissions list cannot be empty")

    if not isinstance(permissions, list):
        raise ValidationError("RequiredPermissions must be a list")

    for perm in permissions:
        if not isinstance(perm, dict):
            raise ValidationError("Each permission must be a dictionary")

        if 'permission' not in perm:
            raise ValidationError("Each permission must have a 'permission' field")

        if not isinstance(perm['permission'], str):
            raise ValidationError("Permission value must be a string")

        # Validate IAM permission format (service:Action)
        if ':' not in perm['permission']:
            raise ValidationError(
                f"Permission '{perm['permission']}' must be in format 'service:Action'"
            )


def validate_prerequisites(prerequisites) -> None:
    """Validate the prerequisites field (supports dict with tabs or list)."""
    if isinstance(prerequisites, dict):
        # New tabbed format: dict with admin/lateral keys
        if not prerequisites:
            raise ValidationError("Prerequisites dict cannot be empty")

        for tab, tab_prereqs in prerequisites.items():
            if tab not in ALLOWED_PREREQUISITE_TABS:
                raise ValidationError(
                    f"Prerequisites tab '{tab}' is not valid. "
                    f"Allowed values: {', '.join(ALLOWED_PREREQUISITE_TABS)}"
                )

            if not isinstance(tab_prereqs, list):
                raise ValidationError(f"Prerequisites for tab '{tab}' must be a list")

            for prereq in tab_prereqs:
                if not isinstance(prereq, str):
                    raise ValidationError(f"Each prerequisite in tab '{tab}' must be a string")

    elif isinstance(prerequisites, list):
        # Legacy format: simple list
        for prereq in prerequisites:
            # Support both string format and dict format (with condition/type)
            if isinstance(prereq, str):
                continue
            elif isinstance(prereq, dict):
                # Legacy format: dict with condition and type
                if 'condition' not in prereq:
                    raise ValidationError("Each prerequisite dict must have a 'condition' field")
                if 'type' in prereq and prereq['type'] not in ALLOWED_PREREQUISITE_TYPES:
                    raise ValidationError(
                        f"Prerequisite type '{prereq['type']}' is not valid. "
                        f"Allowed values: {', '.join(ALLOWED_PREREQUISITE_TYPES)}"
                    )
            else:
                raise ValidationError("Each prerequisite must be a string or dictionary")
    else:
        raise ValidationError("Prerequisites must be a dict or list")


def validate_exploitation_steps(steps) -> None:
    """Validate the exploitationSteps field (supports both dict and list formats)."""
    if not steps:
        raise ValidationError("ExploitationSteps cannot be empty")

    # Support legacy format (list) and new format (dict with tool keys)
    if isinstance(steps, list):
        # Legacy format: list of steps
        validate_step_list(steps)
    elif isinstance(steps, dict):
        # New format: dict with tool names as keys
        if not steps:
            raise ValidationError("ExploitationSteps dict cannot be empty")

        for tool, tool_steps in steps.items():
            if tool not in ALLOWED_EXPLOITATION_TOOLS:
                raise ValidationError(
                    f"Tool '{tool}' is not valid. "
                    f"Allowed values: {', '.join(ALLOWED_EXPLOITATION_TOOLS)}"
                )

            if not isinstance(tool_steps, list):
                raise ValidationError(f"Steps for tool '{tool}' must be a list")

            validate_step_list(tool_steps, tool_name=tool)
    else:
        raise ValidationError("ExploitationSteps must be a dict or list")


def validate_step_list(steps: List[Dict], tool_name: str = None) -> None:
    """Validate a list of exploitation steps."""
    if not steps:
        prefix = f"Tool '{tool_name}' " if tool_name else ""
        raise ValidationError(f"{prefix}steps list cannot be empty")

    step_numbers = []
    for step in steps:
        if not isinstance(step, dict):
            raise ValidationError("Each exploitation step must be a dictionary")

        required_step_fields = ['step', 'command', 'description']
        for field in required_step_fields:
            if field not in step:
                raise ValidationError(f"Each exploitation step must have a '{field}' field")

        if not isinstance(step['step'], int):
            raise ValidationError("Step number must be an integer")

        step_numbers.append(step['step'])

    # Validate sequential numbering starting from 1
    expected = list(range(1, len(steps) + 1))
    if sorted(step_numbers) != expected:
        prefix = f"Tool '{tool_name}' " if tool_name else ""
        raise ValidationError(
            f"{prefix}steps must be numbered sequentially starting from 1. "
            f"Found: {sorted(step_numbers)}, Expected: {expected}"
        )


def validate_discovered_by(discovered_by: Dict) -> None:
    """Validate the discoveredBy field."""
    if not isinstance(discovered_by, dict):
        raise ValidationError("DiscoveredBy must be a dictionary")

    if 'name' not in discovered_by:
        raise ValidationError("DiscoveredBy must have a 'name' field")


def validate_discovery_attribution(discovery_attribution) -> None:
    """Validate the discoveryAttribution field.

    Supports two formats:
    1. Object format (preferred): {firstDocumented: {...}, derivativeOf: {...}, ultimateOrigin: {...}}
    2. List format (legacy): [{item: "...", link: "..."}]
    """
    # Object format - new structured format with firstDocumented, derivativeOf, ultimateOrigin
    if isinstance(discovery_attribution, dict):
        if 'firstDocumented' not in discovery_attribution:
            raise ValidationError("Object-format discoveryAttribution must have 'firstDocumented' field")

        first_doc = discovery_attribution['firstDocumented']
        if not isinstance(first_doc, dict):
            raise ValidationError("firstDocumented must be a dictionary")

        # Validate firstDocumented fields
        if 'author' in first_doc and not isinstance(first_doc['author'], str):
            raise ValidationError("firstDocumented.author must be a string")
        if 'organization' in first_doc and not isinstance(first_doc['organization'], str):
            raise ValidationError("firstDocumented.organization must be a string")
        if 'source' in first_doc and not isinstance(first_doc['source'], str):
            raise ValidationError("firstDocumented.source must be a string")
        if 'date' in first_doc and not isinstance(first_doc['date'], (str, int)):
            raise ValidationError("firstDocumented.date must be a string or integer")
        if 'link' in first_doc and not isinstance(first_doc['link'], str):
            raise ValidationError("firstDocumented.link must be a string")

        # Validate derivativeOf if present
        if 'derivativeOf' in discovery_attribution:
            deriv = discovery_attribution['derivativeOf']
            if not isinstance(deriv, dict):
                raise ValidationError("derivativeOf must be a dictionary")
            if 'pathId' not in deriv:
                raise ValidationError("derivativeOf must have 'pathId' field")
            if not isinstance(deriv['pathId'], str):
                raise ValidationError("derivativeOf.pathId must be a string")
            if 'modification' in deriv and not isinstance(deriv['modification'], str):
                raise ValidationError("derivativeOf.modification must be a string")

        # Validate ultimateOrigin if present
        if 'ultimateOrigin' in discovery_attribution:
            origin = discovery_attribution['ultimateOrigin']
            if not isinstance(origin, dict):
                raise ValidationError("ultimateOrigin must be a dictionary")

        return

    # List format - legacy format with array of items
    if isinstance(discovery_attribution, list):
        if not discovery_attribution:
            raise ValidationError("DiscoveryAttribution list cannot be empty")

        for idx, attribution in enumerate(discovery_attribution):
            if not isinstance(attribution, dict):
                raise ValidationError(f"DiscoveryAttribution item {idx + 1} must be a dictionary")

            if 'item' not in attribution:
                raise ValidationError(f"DiscoveryAttribution item {idx + 1} must have an 'item' field")

            if not isinstance(attribution['item'], str):
                raise ValidationError(f"DiscoveryAttribution item {idx + 1} 'item' field must be a string")

            if 'link' in attribution and not isinstance(attribution['link'], str):
                raise ValidationError(f"DiscoveryAttribution item {idx + 1} 'link' field must be a string")

        return

    # Neither format
    raise ValidationError("DiscoveryAttribution must be either an object (with firstDocumented) or a list")


def validate_references(references: List[Dict]) -> None:
    """Validate the references field."""
    if not isinstance(references, list):
        raise ValidationError("References must be a list")

    for ref in references:
        if not isinstance(ref, dict):
            raise ValidationError("Each reference must be a dictionary")

        if 'title' not in ref or 'url' not in ref:
            raise ValidationError("Each reference must have 'title' and 'url' fields")


def validate_related_paths(related_paths: List[str]) -> None:
    """Validate the relatedPaths field."""
    if not isinstance(related_paths, list):
        raise ValidationError("RelatedPaths must be a list")

    for path_id in related_paths:
        if not isinstance(path_id, str):
            raise ValidationError(f"Related path ID '{path_id}' must be a string")

        # Validate ID format
        try:
            validate_id(path_id)
        except ValidationError as e:
            raise ValidationError(f"Invalid related path ID '{path_id}': {e}")


def validate_detection_rules(detection_rules: List[Dict]) -> None:
    """Validate the detectionRules field."""
    if not isinstance(detection_rules, list):
        raise ValidationError("DetectionRules must be a list")

    for rule in detection_rules:
        if not isinstance(rule, dict):
            raise ValidationError("Each detection rule must be a dictionary")

        if 'platform' not in rule:
            raise ValidationError("Each detection rule must have a 'platform' field")


def validate_learning_environments(learning_envs: Dict) -> None:
    """Validate the learningEnvironments field."""
    if not isinstance(learning_envs, dict):
        raise ValidationError("LearningEnvironments must be a dictionary")

    if not learning_envs:
        raise ValidationError("LearningEnvironments dict cannot be empty")

    allowed_types = ['open-source', 'closed-source']
    allowed_pricing_models = ['paid', 'free']

    for env_name, env_data in learning_envs.items():
        if not isinstance(env_data, dict):
            raise ValidationError(f"Learning environment '{env_name}' must be a dictionary")

        # Validate required common fields
        if 'type' not in env_data:
            raise ValidationError(f"Learning environment '{env_name}' must have a 'type' field")

        if env_data['type'] not in allowed_types:
            raise ValidationError(
                f"Learning environment '{env_name}' has invalid type '{env_data['type']}'. "
                f"Allowed: {', '.join(allowed_types)}"
            )

        if 'description' not in env_data:
            raise ValidationError(f"Learning environment '{env_name}' must have a 'description' field")

        if not isinstance(env_data['description'], str):
            raise ValidationError(f"Learning environment '{env_name}' description must be a string")

        # Validate type-specific fields
        if env_data['type'] == 'open-source':
            # Open-source environments require githubLink
            if 'githubLink' not in env_data:
                raise ValidationError(
                    f"Open-source learning environment '{env_name}' must have a 'githubLink' field"
                )

            if not isinstance(env_data['githubLink'], str):
                raise ValidationError(f"Learning environment '{env_name}' githubLink must be a string")

        elif env_data['type'] == 'closed-source':
            # Closed-source environments require scenarioPricingModel
            if 'scenarioPricingModel' not in env_data:
                raise ValidationError(
                    f"Closed-source learning environment '{env_name}' must have a 'scenarioPricingModel' field"
                )

            if env_data['scenarioPricingModel'] not in allowed_pricing_models:
                raise ValidationError(
                    f"Learning environment '{env_name}' has invalid scenarioPricingModel "
                    f"'{env_data['scenarioPricingModel']}'. Allowed: {', '.join(allowed_pricing_models)}"
                )

            # scenario field is recommended for closed-source
            if 'scenario' not in env_data:
                # Warning, not error - scenario is optional but recommended
                pass


def validate_tool_support(tool_support: Dict) -> None:
    """Validate the toolSupport field. [DEPRECATED in v1.3.0]"""
    if not isinstance(tool_support, dict):
        raise ValidationError("ToolSupport must be a dictionary")

    allowed_tools = ['pmapper', 'iamVulnerable', 'pacu', 'prowler']
    for tool, supported in tool_support.items():
        if tool not in allowed_tools:
            raise ValidationError(
                f"Unknown tool '{tool}' in toolSupport. "
                f"Allowed: {', '.join(allowed_tools)}"
            )

        if not isinstance(supported, bool):
            raise ValidationError(f"Tool support value for '{tool}' must be boolean")


def has_artificial_line_breaks(text: str) -> bool:
    """
    Check if a description has artificial line breaks (~80 chars).

    Returns True if the text likely has artificial line breaks that should be removed.
    Ignores intentional multi-line structures like code blocks, lists, and paragraph breaks.
    """
    if not text or '\n' not in text:
        return False

    lines = text.split('\n')

    # Filter out empty lines and lines that are part of intentional structures
    text_lines = []
    in_code_block = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Track code blocks
        if stripped.startswith('```'):
            in_code_block = not in_code_block
            continue

        # Skip lines in code blocks
        if in_code_block:
            continue

        # Skip empty lines (intentional paragraph breaks)
        if not stripped:
            continue

        # Skip list items (intentional line breaks)
        if stripped.startswith('-') or stripped.startswith('*') or \
           (len(stripped) > 2 and stripped[0].isdigit() and stripped[1] in '.):'):
            continue

        # Skip lines that are clearly part of multi-line formatting
        # (like "Command:", "Example:", etc.)
        if stripped.endswith(':') and len(stripped) < 20:
            continue

        text_lines.append(line)

    # Check if we have multiple text lines that look like they should be combined
    if len(text_lines) <= 1:
        return False

    # Look for lines that end mid-sentence (not at sentence boundaries)
    # and are around 70-90 characters (typical artificial wrap point)
    suspicious_breaks = 0
    for i, line in enumerate(text_lines[:-1]):  # Don't check last line
        stripped = line.strip()
        length = len(stripped)

        # Check if line is around typical wrap length
        if 60 <= length <= 95:
            # Check if it ends mid-sentence (doesn't end with . ! ? : or ,)
            if stripped and stripped[-1] not in '.!?:,':
                # Check if next line continues the sentence (starts with lowercase or common continuations)
                if i + 1 < len(text_lines):
                    next_line = text_lines[i + 1].strip()
                    if next_line and (next_line[0].islower() or next_line.startswith('(')):
                        suspicious_breaks += 1

    # If we find multiple suspicious breaks, it's likely artificial wrapping
    return suspicious_breaks >= 2


def validate_attack_visualization(attack_viz) -> None:
    """Validate the attackVisualization field (supports both old string and new dict format)."""
    # Legacy format: string (Mermaid)
    if isinstance(attack_viz, str):
        return  # String format is valid (legacy Mermaid)

    # New format: structured dict
    if not isinstance(attack_viz, dict):
        raise ValidationError("AttackVisualization must be either a string (Mermaid) or dict (structured)")

    # Validate nodes
    if 'nodes' not in attack_viz:
        raise ValidationError("AttackVisualization dict must have 'nodes' field")

    if not isinstance(attack_viz['nodes'], list):
        raise ValidationError("AttackVisualization 'nodes' must be a list")

    if not attack_viz['nodes']:
        raise ValidationError("AttackVisualization 'nodes' list cannot be empty")

    node_ids = set()
    allowed_node_types = ['principal', 'resource', 'payload', 'action', 'outcome']

    for node in attack_viz['nodes']:
        if not isinstance(node, dict):
            raise ValidationError("Each node must be a dictionary")

        # Validate required node fields
        if 'id' not in node:
            raise ValidationError("Each node must have an 'id' field")
        if 'label' not in node:
            raise ValidationError("Each node must have a 'label' field")
        if 'type' not in node:
            raise ValidationError("Each node must have a 'type' field")

        # Check for duplicate IDs
        if node['id'] in node_ids:
            raise ValidationError(f"Duplicate node ID: {node['id']}")
        node_ids.add(node['id'])

        # Validate node type
        if node['type'] not in allowed_node_types:
            raise ValidationError(
                f"Node type '{node['type']}' is not valid. "
                f"Allowed: {', '.join(allowed_node_types)}"
            )

        # Check for artificial line breaks in node descriptions
        if 'description' in node and node['description']:
            if has_artificial_line_breaks(node['description']):
                raise ValidationError(
                    f"Node '{node['id']}' has artificial line breaks in description. "
                    f"Text should flow as single-line paragraphs without ~80 character wraps. "
                    f"See SCHEMA.md Description Formatting Guidelines."
                )

    # Validate edges
    if 'edges' not in attack_viz:
        raise ValidationError("AttackVisualization dict must have 'edges' field")

    if not isinstance(attack_viz['edges'], list):
        raise ValidationError("AttackVisualization 'edges' must be a list")

    if not attack_viz['edges']:
        raise ValidationError("AttackVisualization 'edges' list cannot be empty")

    for edge in attack_viz['edges']:
        if not isinstance(edge, dict):
            raise ValidationError("Each edge must be a dictionary")

        # Validate required edge fields
        if 'from' not in edge:
            raise ValidationError("Each edge must have a 'from' field")
        if 'to' not in edge:
            raise ValidationError("Each edge must have a 'to' field")
        if 'label' not in edge:
            raise ValidationError("Each edge must have a 'label' field")

        # Validate edge references existing nodes
        if edge['from'] not in node_ids:
            raise ValidationError(f"Edge references non-existent node: {edge['from']}")
        if edge['to'] not in node_ids:
            raise ValidationError(f"Edge references non-existent node: {edge['to']}")

        # Check for artificial line breaks in edge descriptions
        if 'description' in edge and edge['description']:
            if has_artificial_line_breaks(edge['description']):
                raise ValidationError(
                    f"Edge from '{edge['from']}' to '{edge['to']}' has artificial line breaks in description. "
                    f"Text should flow as single-line paragraphs without ~80 character wraps. "
                    f"See SCHEMA.md Description Formatting Guidelines."
                )


def validate_file(file_path: str) -> Tuple[bool, List[str]]:
    """
    Validate a single YAML file against the schema.

    Returns:
        Tuple of (success: bool, errors: List[str])
    """
    errors = []

    try:
        with open(file_path, 'r') as f:
            data = yaml.safe_load(f)

        if not isinstance(data, dict):
            return False, ["File must contain a YAML dictionary"]

        # Check required fields (with backward compatibility support)
        has_new_permissions = 'permissions' in data
        has_legacy_permissions = 'requiredPermissions' in data

        for field, expected_type in REQUIRED_FIELDS.items():
            # Special handling for permissions field during migration
            if field == 'permissions':
                if not has_new_permissions and not has_legacy_permissions:
                    errors.append(f"Missing required field: {field} (or legacy 'requiredPermissions')")
                elif has_new_permissions and not isinstance(data[field], expected_type):
                    errors.append(
                        f"Field '{field}' must be of type {expected_type.__name__}, "
                        f"got {type(data[field]).__name__}"
                    )
            else:
                if field not in data:
                    errors.append(f"Missing required field: {field}")
                elif not isinstance(data[field], expected_type):
                    errors.append(
                        f"Field '{field}' must be of type {expected_type.__name__}, "
                        f"got {type(data[field]).__name__}"
                    )

        # If we have critical errors, return early
        if errors:
            return False, errors

        # Validate specific field formats
        try:
            validate_id(data['id'])
        except ValidationError as e:
            errors.append(str(e))

        try:
            validate_category(data['category'])
        except ValidationError as e:
            errors.append(str(e))

        try:
            validate_services(data['services'])
        except ValidationError as e:
            errors.append(str(e))

        # Validate permissions (new format) or requiredPermissions (legacy format)
        if 'permissions' in data:
            try:
                validate_permissions(data['permissions'])
            except ValidationError as e:
                errors.append(str(e))
        elif 'requiredPermissions' in data:
            try:
                validate_required_permissions(data['requiredPermissions'])
            except ValidationError as e:
                errors.append(str(e))

        try:
            validate_exploitation_steps(data['exploitationSteps'])
        except ValidationError as e:
            errors.append(str(e))

        try:
            validate_discovered_by(data['discoveredBy'])
        except ValidationError as e:
            errors.append(str(e))

        # Validate optional fields if present
        if 'prerequisites' in data:
            try:
                validate_prerequisites(data['prerequisites'])
            except ValidationError as e:
                errors.append(str(e))

        if 'references' in data:
            try:
                validate_references(data['references'])
            except ValidationError as e:
                errors.append(str(e))

        if 'relatedPaths' in data:
            try:
                validate_related_paths(data['relatedPaths'])
            except ValidationError as e:
                errors.append(str(e))

        if 'detectionRules' in data:
            try:
                validate_detection_rules(data['detectionRules'])
            except ValidationError as e:
                errors.append(str(e))

        if 'learningEnvironments' in data:
            try:
                validate_learning_environments(data['learningEnvironments'])
            except ValidationError as e:
                errors.append(str(e))

        if 'toolSupport' in data:
            try:
                validate_tool_support(data['toolSupport'])
            except ValidationError as e:
                errors.append(str(e))

        if 'attackVisualization' in data:
            try:
                validate_attack_visualization(data['attackVisualization'])
            except ValidationError as e:
                errors.append(str(e))

        if 'discoveryAttribution' in data:
            try:
                validate_discovery_attribution(data['discoveryAttribution'])
            except ValidationError as e:
                errors.append(str(e))

        # Check for unexpected fields
        all_allowed_fields = set(REQUIRED_FIELDS.keys()) | set(OPTIONAL_FIELDS.keys())
        unexpected_fields = set(data.keys()) - all_allowed_fields
        if unexpected_fields:
            errors.append(f"Unexpected fields: {', '.join(unexpected_fields)}")

        return len(errors) == 0, errors

    except yaml.YAMLError as e:
        return False, [f"YAML parsing error: {e}"]
    except Exception as e:
        return False, [f"Unexpected error: {e}"]


def find_yaml_files(path: str) -> List[str]:
    """Recursively find all YAML files in a directory."""
    yaml_files = []
    path_obj = Path(path)

    if path_obj.is_file():
        if path_obj.suffix in ['.yaml', '.yml']:
            return [str(path_obj)]
        else:
            print(f"Warning: {path} is not a YAML file")
            return []

    if path_obj.is_dir():
        for file_path in path_obj.rglob('*.yaml'):
            yaml_files.append(str(file_path))
        for file_path in path_obj.rglob('*.yml'):
            yaml_files.append(str(file_path))

    return sorted(yaml_files)


def main():
    """Main validation entry point."""
    if len(sys.argv) != 2:
        print("Usage: python validate-schema.py <file_or_directory>")
        sys.exit(1)

    target = sys.argv[1]

    if not os.path.exists(target):
        print(f"Error: Path '{target}' does not exist")
        sys.exit(1)

    yaml_files = find_yaml_files(target)

    if not yaml_files:
        print(f"No YAML files found in '{target}'")
        sys.exit(1)

    print(f"Validating {len(yaml_files)} file(s)...\n")

    total_files = len(yaml_files)
    passed = 0
    failed = 0

    for file_path in yaml_files:
        success, errors = validate_file(file_path)

        if success:
            print(f"✓ {file_path}")
            passed += 1
        else:
            print(f"✗ {file_path}")
            for error in errors:
                print(f"  - {error}")
            print()
            failed += 1

    print("\n" + "=" * 70)
    print(f"Results: {passed} passed, {failed} failed out of {total_files} total")
    print("=" * 70)

    if failed > 0:
        sys.exit(1)
    else:
        print("\n✓ All files passed validation!")
        sys.exit(0)


if __name__ == '__main__':
    main()
