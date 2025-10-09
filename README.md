# pathfinding.cloud

**The definitive source of truth for AWS IAM privilege escalation paths**

[![Validate Schema](https://github.com/DataDog/pathfinding.cloud/actions/workflows/validate.yml/badge.svg)](https://github.com/DataDog/pathfinding.cloud/actions/workflows/validate.yml)
[![Deploy to GitHub Pages](https://github.com/DataDog/pathfinding.cloud/actions/workflows/deploy.yml/badge.svg)](https://github.com/DataDog/pathfinding.cloud/actions/workflows/deploy.yml)

> **Live Website:** [https://miniature-broccoli-wr5lkze.pages.github.io/](https://miniature-broccoli-wr5lkze.pages.github.io/)

## Overview

pathfinding.cloud is a comprehensive, human-curated libraryßdocumenting all known AWS IAM privilege escalation paths. This project builds upon the foundational research by Spencer Gietzen at Rhino Security Labs and subsequent contributions by many others. 

This site providing detailed documentation of:

- **35 documented privilege escalation techniques**
- Prerequisites and conditions for exploitation
- Step-by-step exploitation commands 
- Step-by-step simulation commands
- Detection and mitigation strategies

### Why This Project?

While several excellent resources document AWS IAM privilege escalation, no single source captures:
- **All known paths** including variations and nuances
- **Precise prerequisites** (e.g., "works only if user has < 2 access keys")
- **Path variations** (e.g., `iam:CreateAccessKey` alone vs. with `iam:DeleteAccessKey`)
- **Up-to-date detection rules** and tool support

pathfinding.cloud aims to be that single source of truth.

## Key Features

- **Structured Data**: All paths documented in validated YAML format
- **Searchable Website**: Filter by service, category, or search terms
- **Machine-Readable**: JSON export for security tool integration
- **Community-Driven**: Easy contribution via pull requests
- **Automated Validation**: GitHub Actions ensure data quality
- **Detection Rules**: Links to CloudSIEM, AWS Config, and other platforms

## Categories

Privilege escalation paths are organized into four categories:

1. **Self-Escalation** - Modify own permissions directly
2. **Lateral Movement** - Gain access to other principals
3. **Service PassRole** - Escalate via service + PassRole combinations
4. **Access Resource** - Modify or access existing resources to gain elevated access

## Project Structure

```
pathfinding.cloud/
├── data/
│   └── paths/              # YAML files for each escalation path
│       ├── iam/
│       ├── ec2/
│       ├── lambda/
│       ├── ssm/
│       └── cloudformation/
├── website/                # Static website
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── paths.json         # Generated from YAML files
├── scripts/
│   ├── validate-schema.py # Schema validation
│   └── generate-json.py   # YAML to JSON conversion
├── .github/
│   └── workflows/         # CI/CD automation
├── SCHEMA.md              # Complete schema documentation
├── CONTRIBUTING.md        # Contribution guidelines
└── README.md              # This file
```

## Contributing

We welcome contributions! Here's how to add a new privilege escalation path:

### Quick Start

1. **Fork this repository**

2. **Create a new YAML file** in `data/paths/{service}/`
   ```bash
   # Find the next available ID for your service
   ls data/paths/iam/
   # Create your file (e.g., iam-013.yaml)
   ```

3. **Follow the schema** (see [SCHEMA.md](SCHEMA.md))
   ```yaml
   id: "iam-013"
   name: "iam:YourPermission"
   category: "self-escalation"
   services:
     - iam
   permissions:
     required:
       - permission: "iam:YourPermission"
         resourceConstraints: "Describe any constraints"
   description: "Explain how this works..."
   # ... see SCHEMA.md for all fields
   ```

4. **Validate your file**
   ```bash
   pip install -r requirements.txt
   python scripts/validate-schema.py data/paths/iam/iam-013.yaml
   ```

5. **Submit a pull request**
   - Automated validation runs on all PRs
   - Maintainers review for accuracy
   - Once merged, website auto-deploys

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Development

### Prerequisites

- Python 3.11+
- PyYAML

### Setup

```bash
# Clone the repository
git clone https://github.com/DataDog/pathfinding.cloud.git
cd pathfinding.cloud

# Install dependencies
pip install -r requirements.txt

# Validate all paths
python scripts/validate-schema.py data/paths/

# Generate JSON for website
python scripts/generate-json.py

# Open website locally
open website/index.html
```

### Validation

```bash
# Validate a single file
python scripts/validate-schema.py data/paths/iam/iam-001.yaml

# Validate all files
python scripts/validate-schema.py data/paths/

# Validate and see detailed errors
python scripts/validate-schema.py data/paths/ --verbose
```

## Research Credits

This project builds upon groundbreaking research by:

- **Spencer Gietzen** (Rhino Security Labs) - Original 21 privilege escalation methods
  - [AWS Privilege Escalation Methods and Mitigation](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/)

- **Gerben Kleijn** (Bishop Fox) - Exploitation steps and requirements guide for original 21 paths
  - [Privilege Escalation in AWS](https://bishopfox.com/blog/privilege-escalation-in-aws)

- **Erik Steringer** - PMapper privilege escalation detection (10 additional privilege escalation paths)
  - [PMapper](https://github.com/nccgroup/PMapper)

- **Rhino Security Labs** - Pacu AWS exploitation framework
  - [Pacu](https://github.com/RhinoSecurityLabs/pacu)

## Related Projects

- [PMapper](https://github.com/nccgroup/PMapper) - AWS IAM privilege escalation analysis
- [IAM Vulnerable](https://github.com/BishopFox/iam-vulnerable) - Terraform lab for testing
- [Pacu](https://github.com/RhinoSecurityLabs/pacu) - AWS exploitation framework
- [Prowler](https://github.com/prowler-cloud/prowler) - AWS security assessment tool
- [CloudSploit](https://github.com/aquasecurity/cloudsploit) - Cloud security scanning
- [ScoutSuite](https://github.com/nccgroup/ScoutSuite) - Multi-cloud security auditing

## Disclaimer

This information is provided for **educational and defensive security purposes only**. The techniques documented here should only be used:

- For authorized security assessments with explicit permission
- In your own AWS environments for testing defensive controls
- For educational purposes to understand AWS security
- To improve detection and prevention capabilities

**Do not use this information for unauthorized access to systems you don't own or have explicit permission to test.**

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Special thanks to:
- The AWS security research community
- All contributors to this project
- Organizations that have shared their research publicly

## Contact

- **Issues**: Open an issue in this repository
- **Discussions**: Use GitHub Discussions for questions
- **Security**: For security concerns about this repository, please open a private security advisory

---

**Maintained by Seth Art from Datadog**
