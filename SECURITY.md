# Security Policy

## Reporting Security Vulnerabilities

### For This Repository

If you discover a security vulnerability in this repository (website, scripts, github actions, etc.), please report it responsibly:

**Preferred Method:** Open a [GitHub Security Advisory](https://github.com/DataDog/pathfinding.cloud/security/advisories/new)

**Alternative:** Email the maintainers with details about the vulnerability. Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if available)

**Please do not:**
- Open public issues for security vulnerabilities
- Share vulnerability details publicly before a fix is available


### For AWS IAM Escalation Paths

This repository documents AWS IAM privilege escalation techniques for **defensive and educational purposes**.

**If you discover a new AWS privilege escalation path:**
1. Consider responsible disclosure to AWS first (though AWS generally considers IAM misconfigurations to be customer responsibility)
2. Once appropriate, submit a pull request to document the path
3. Follow our [contribution guidelines](CONTRIBUTING.md)
4. Ensure proper attribution to the original researcher

**If you find an error in documented paths:**
- Open a regular GitHub issue or pull request
- These are not security vulnerabilities but documentation corrections

## Supported Versions

We accept security reports for:
- ✅ The current version of the website and documentation
- ✅ All Python validation scripts
- ✅ GitHub Actions workflows

## Security Best Practices

When contributing to this project:
- Never commit AWS credentials, tokens, or secrets
- Use `.gitignore` for sensitive local configuration
- Validate all YAML input with provided validation scripts
- Follow secure coding practices in Python scripts

## Scope

**In Scope:**
- Website vulnerabilities (XSS, injection, etc.)
- CI/CD security issues
- Credential exposure in repository
- Malicious code injection risks

**Out of Scope:**
- Theoretical AWS privilege escalation paths (these should be PRs)
- Issues with AWS services themselves (report to AWS)
- Misuse of documented techniques by third parties

## Recognition

We appreciate responsible security research and will:
- Credit researchers in fix commits and releases (with permission)
- Respond promptly to all valid reports
- Work with you on coordinated disclosure timelines

Thank you for helping keep pathfinding.cloud secure!
