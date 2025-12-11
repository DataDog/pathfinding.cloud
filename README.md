# pathfinding.cloud

**The definitive source of truth for AWS IAM privilege escalation paths**

[![Validate Schema](https://github.com/DataDog/pathfinding.cloud/actions/workflows/validate.yml/badge.svg)](https://github.com/DataDog/pathfinding.cloud/actions/workflows/validate.yml)
[![Deploy to GitHub Pages](https://github.com/DataDog/pathfinding.cloud/actions/workflows/deploy.yml/badge.svg)](https://github.com/DataDog/pathfinding.cloud/actions/workflows/deploy.yml)

**Website:** [https://pathfinding.cloud](https://pathfinding.cloud)

## Overview

pathfinding.cloud is a comprehensive, community-maintained library documenting AWS IAM privilege escalation paths. This project builds upon foundational research by Spencer Gietzen at Rhino Security Labs and subsequent contributions from many other security researchers.

The website provides detailed documentation of each privilege escalation path including:

- Attack description
- Interactive attack visualizations 
- Prerequisites and conditions required for exploitation
- Step-by-step exploitation commands for multiple tools (AWS CLI, Pacu, etc.)
- Links to detection tools and learning environments
- Discovery attribution and references
- Detection and mitigation strategies

### Why This Project?

While several excellent resources document AWS IAM privilege escalation, no single source captures:
- **All known paths** including variations and nuances
- **Precise prerequisites** (e.g., "works only if user has < 2 access keys")
- **Path variations** (e.g., `iam:CreateAccessKey` alone vs. with `iam:DeleteAccessKey`)
- **OSS detection tool coverage** and learning environment links 

pathfinding.cloud aims to be that single source of truth.

## Key Features

### Data & Documentation
- **Structured Data**: All paths documented in validated YAML format
- **Machine-Readable**: JSON export for security tool integration
- **Community-Driven**: Easy contribution via pull requests


### Website Features
- **Interactive Visualizations**: Attack flow diagrams showing step-by-step exploitation paths
- **Advanced Search & Filtering**: Filter by service, category, detection tool support, or search terms
- **Multiple View Modes**: Switch between card and table views
- **Responsive Design**: Fully optimized for desktop and mobile devices
- **Detection Tool Coverage**: Links to open-source detection tools (PMapper, Cloudsplaining, Prowler, etc.)
- **Learning Environments**: Links to practice labs and CTF environments

## Categories

Privilege escalation paths are organized into five categories:

1. **Self-Escalation** - Modify own permissions directly
2. **Principal Access** - Gain access to other principals
3. **New PassRole** - Escalate via service + PassRole combinations
4. **Existing PassRole** - Modify or access existing resources to gain elevated access
5. **Credential Access** - Access or extract credentials from AWS resources


## Project Structure

```
pathfinding.cloud/
├── data/
│   └── paths/              # YAML files for each escalation path (source data)
│       ├── iam/
│       ├── ec2/
│       ├── lambda/
│       ├── ssm/
│       ├── cloudformation/
│       └── [other services]/
├── docs/                   # Website files (deployed to GitHub Pages)
│   ├── index.html          # Landing page
│   ├── 404.html            # SPA routing handler
│   ├── paths/
│   │   └── index.html      # Path detail pages index
│   ├── css/
│   │   └── style.css       # Website styles
│   ├── js/
│   │   └── app.js          # Website JavaScript (SPA routing, visualizations)
│   ├── images/             # Website images and logos
│   ├── paths.json          # Generated from YAML files
│   ├── metadata.json       # Detection tools and learning environments metadata
│   └── dev-server.py       # Local development server (SPA routing support)
├── scripts/
│   ├── validate-schema.py  # Schema validation
│   └── generate-json.py    # YAML to JSON conversion (outputs to docs/)
├── .github/
│   └── workflows/          # CI/CD automation
│       ├── validate.yml    # PR validation
│       └── deploy.yml      # GitHub Pages deployment (deploys docs/ dir)
├── .claude/
│   └── CLAUDE.md           # AI assistant guidelines (anti-patterns, style)
├── SCHEMA.md               # Complete schema documentation
├── CLAUDE.md               # Development workflow and commands
├── CONTRIBUTING.md         # Contribution guidelines
└── README.md               # This file
```

## Contributing

We welcome contributions!

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
pip install -r scripts/requirements.txt

# Validate all paths
python scripts/validate-schema.py data/paths/

# Generate JSON for website
python scripts/generate-json.py

# Start local development server (required for SPA routing)
cd docs && python3 dev-server.py

# Visit http://localhost:8888 in your browser
```

**Note:** The website uses client-side routing (SPA). Always use `docs/dev-server.py` for local testing rather than opening `index.html` directly, as direct file access won't support routing features.

### Validation

```bash
# Validate a single file
python scripts/validate-schema.py data/paths/iam/iam-001.yaml

# Validate all files
python scripts/validate-schema.py data/paths/

# Validate and see detailed errors
python scripts/validate-schema.py data/paths/ --verbose
```

### Website Architecture

The website is built as a Single Page Application (SPA) with:

- **Client-Side Routing**: Uses History API for proper URLs (e.g., `/paths/iam-001`)
- **No Page Reloads**: Instant navigation with dynamic content loading
- **Interactive Visualizations**: Built with vis.js for network diagrams
- **Responsive Design**: Mobile-first CSS with breakpoints for all screen sizes
- **Theme System**: CSS custom properties for light/dark mode switching
- **Performance**: Lazy loading and optimized rendering for large datasets

**Key Technologies:**
- Vanilla JavaScript (no frameworks)
- CSS Custom Properties for theming
- vis.js for attack visualizations
- Python for validation and JSON generation

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
