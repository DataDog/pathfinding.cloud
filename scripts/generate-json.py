#!/usr/bin/env python3
"""
Converts YAML privilege escalation path files to a single JSON file for the website.

Usage:
    python generate-json.py
"""

import json
import yaml
import os
import subprocess
import requests
from datetime import datetime
from pathlib import Path

def load_yaml_file(file_path):
    """Load and parse a YAML file."""
    with open(file_path, 'r') as f:
        return yaml.safe_load(f)

def get_git_metadata_from_github(file_path, github_token=None):
    """Extract git metadata using GitHub API."""
    try:
        # GitHub repository details
        owner = 'DataDog'
        repo = 'pathfinding.cloud'

        # Convert local file path to repository path
        # file_path could be a Path object or string, convert to relative path string
        repo_path = str(file_path).replace('\\', '/')

        # If it's an absolute path, make it relative to the current directory
        if os.path.isabs(repo_path):
            # Get the current working directory
            cwd = os.getcwd()
            # Make the path relative to cwd
            repo_path = os.path.relpath(file_path, cwd).replace('\\', '/')

        # Prepare headers
        headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }
        if github_token:
            headers['Authorization'] = f'Bearer {github_token}'

        # Get commits for this file
        url = f'https://api.github.com/repos/{owner}/{repo}/commits'
        params = {'path': repo_path}

        # Debug: print the exact API call
        print(f"    → Querying GitHub API: {url}?path={repo_path}")

        response = requests.get(url, headers=headers, params=params, timeout=10)

        if response.status_code != 200:
            print(f"  ⚠️  GitHub API returned status {response.status_code} for {repo_path}")
            if response.status_code == 404:
                print(f"      File may not exist in the repository yet or path is incorrect")
            return None

        commits = response.json()

        if not commits:
            return None

        # Get creation date (last commit in the list)
        creation_date = commits[-1]['commit']['author']['date']

        # Get last update date (first commit in the list)
        last_update = commits[0]['commit']['author']['date']

        # Get unique contributors
        contributors = []
        seen_logins = set()
        seen_emails = set()

        for commit in commits:
            author = commit.get('author')  # GitHub user object
            commit_author = commit['commit']['author']  # Git author object

            # Prefer GitHub user info if available
            if author and author.get('login'):
                login = author['login']
                if login not in seen_logins:
                    seen_logins.add(login)
                    contributors.append({
                        'name': commit_author['name'],
                        'email': commit_author['email'],
                        'githubUsername': login
                    })
            else:
                # Fall back to email if GitHub user is not available
                email = commit_author['email']
                if email not in seen_emails:
                    seen_emails.add(email)
                    contributors.append({
                        'name': commit_author['name'],
                        'email': email,
                        'githubUsername': None
                    })

        return {
            'created': creation_date,
            'lastUpdated': last_update,
            'contributors': contributors
        }
    except Exception as e:
        print(f"  ⚠️  GitHub API error for {file_path}: {e}")
        return None

def get_git_metadata_from_git(file_path):
    """Extract git metadata using git log (fallback method)."""
    try:
        # Get creation date (first commit)
        creation_result = subprocess.run(
            ['git', 'log', '--diff-filter=A', '--format=%aI', '--', str(file_path)],
            capture_output=True,
            text=True,
            check=False
        )
        creation_date = None
        if creation_result.returncode == 0 and creation_result.stdout.strip():
            creation_date = creation_result.stdout.strip().split('\n')[-1]

        # Get last update date (most recent commit)
        update_result = subprocess.run(
            ['git', 'log', '-1', '--format=%aI', '--', str(file_path)],
            capture_output=True,
            text=True,
            check=False
        )
        last_update = None
        if update_result.returncode == 0 and update_result.stdout.strip():
            last_update = update_result.stdout.strip()

        # Get contributors (unique authors)
        contributors_result = subprocess.run(
            ['git', 'log', '--format=%aN|%aE', '--', str(file_path)],
            capture_output=True,
            text=True,
            check=False
        )
        contributors = []
        if contributors_result.returncode == 0 and contributors_result.stdout.strip():
            seen = set()
            for line in contributors_result.stdout.strip().split('\n'):
                if '|' in line:
                    name, email = line.split('|', 1)
                    if email not in seen:
                        seen.add(email)
                        # Extract GitHub username from email if possible
                        github_username = None
                        if '@users.noreply.github.com' in email:
                            username_part = email.split('@')[0]
                            if '+' in username_part:
                                github_username = username_part.split('+')[1]
                            else:
                                github_username = username_part

                        contributors.append({
                            'name': name,
                            'email': email,
                            'githubUsername': github_username
                        })

        return {
            'created': creation_date,
            'lastUpdated': last_update,
            'contributors': contributors
        }
    except Exception as e:
        print(f"  ⚠️  Git log error for {file_path}: {e}")
        return {
            'created': None,
            'lastUpdated': None,
            'contributors': []
        }

def get_git_metadata(file_path, github_token=None):
    """Extract git metadata for a file, trying GitHub API first, then falling back to git log."""
    # Try GitHub API first if token is available
    if github_token:
        metadata = get_git_metadata_from_github(file_path, github_token)
        if metadata:
            return metadata
        print(f"  ⚠️  Falling back to git log for {file_path}")

    # Fall back to git log
    return get_git_metadata_from_git(file_path)

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

def check_github_access(github_token):
    """Check if we can access the repository via GitHub API."""
    try:
        owner = 'DataDog'
        repo = 'pathfinding.cloud'
        url = f'https://api.github.com/repos/{owner}/{repo}'

        headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }
        if github_token:
            headers['Authorization'] = f'Bearer {github_token}'

        response = requests.get(url, headers=headers, timeout=10)

        if response.status_code == 404:
            print(f"  ⚠️  Warning: Cannot access repository {owner}/{repo}")
            print(f"      Repository may be private. Ensure your token has 'repo' scope")
            print(f"      Falling back to git log for all files")
            return False
        elif response.status_code != 200:
            print(f"  ⚠️  GitHub API returned status {response.status_code}")
            print(f"      Falling back to git log for all files")
            return False

        return True
    except Exception as e:
        print(f"  ⚠️  Error checking GitHub access: {e}")
        return False

def check_git_sync():
    """Check if local branch is synced with remote."""
    try:
        # Check if we're ahead of origin
        result = subprocess.run(
            ['git', 'rev-list', '--count', 'origin/main..HEAD'],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode == 0:
            commits_ahead = int(result.stdout.strip())
            if commits_ahead > 0:
                print(f"  ⚠️  Warning: Your branch is {commits_ahead} commit(s) ahead of origin/main")
                print(f"      Some files may not be available via GitHub API yet")
    except Exception:
        pass  # Silently ignore if we can't check

def convert_yaml_to_json(input_dir='data/paths', output_file='paths.json'):
    """Convert all YAML files to a single JSON file."""
    print("Converting YAML files to JSON...")

    # Get GitHub token from environment variable
    github_token = os.environ.get('GITHUB_TOKEN')
    use_github_api = False

    if github_token:
        print("  ✓ GitHub token found, checking repository access...")
        if check_github_access(github_token):
            print("  ✓ GitHub API access confirmed")
            use_github_api = True
            check_git_sync()
        else:
            # Access check failed, will use git log fallback
            github_token = None
    else:
        print("  ⚠️  No GITHUB_TOKEN found, using git log")
        print("     Set GITHUB_TOKEN environment variable to use GitHub API")

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

            # Add git metadata
            git_metadata = get_git_metadata(yaml_file, github_token)
            data['gitMetadata'] = git_metadata

            # Add relative file path for GitHub links
            relative_path = str(yaml_file).replace('\\', '/')
            data['filePath'] = relative_path

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
