# Getting Started

Pathrunner automates the exploitation of AWS IAM privilege escalation paths. It is the execution layer of a three-project ecosystem: [pathfinding.cloud](/paths/) documents each path, [pathfinding-labs](/labs/) deploys vulnerable AWS infrastructure to practice against, and Pathrunner chains modules and payloads to escalate from an initial identity to elevated access.

## Installation

Requires Go 1.26+ and valid AWS credentials.

### go install

```
go install github.com/DataDog/pathrunner/cmd/pathrunner@latest
```

### Homebrew

```
brew tap DataDog/pathrunner https://github.com/DataDog/pathrunner
brew install DataDog/pathrunner/pathrunner
```

### Build from source

```
git clone https://github.com/DataDog/pathrunner.git
cd pathrunner
make build
cp pathrunner /usr/local/bin/
```

Prebuilt binaries are also attached to each [GitHub release](https://github.com/DataDog/pathrunner/releases).

## Quick Start

Pathrunner offers a Metasploit-style interactive REPL and a 1:1 scriptable CLI. The REPL walkthrough:

```
# Start the interactive shell
./pathrunner

# Add your AWS identity
pathrunner> identity add --profile my-aws-profile

# Browse available modules
pathrunner> search lambda
pathrunner> info lambda-001

# Select and configure a module
pathrunner> use lambda-001
pathrunner> show options
pathrunner> set ROLE_ARN arn:aws:iam::123456789012:role/TargetRole

# Choose a payload and execute
pathrunner> show payloads
pathrunner> set PAYLOAD exfil/response
pathrunner> exploit
```

After a successful exploit that captures credentials, they are auto-extracted and available as a new identity:

```
pathrunner> identity list          # New identity appears automatically
pathrunner> identity switch lambda_AB12
pathrunner> pmapper analyze        # See what is reachable from here
```

## Core Concepts

- **Identities are the sessions of the cloud.** Attacks hop from one identity to another by capturing credentials. Import an identity from almost any text format (`identity add --from-clipboard`) and switch between them instantly (`identity switch`).
- **Modular exploits.** A single interface over the full catalog of AWS privilege escalation [modules](/pathrunner/modules), influenced by Metasploit, NetExec, and Pacu.
- **Modular payloads build better detections.** Each module supports multiple interchangeable [payloads](/pathrunner/payloads), so you can pick one that works around network/SCP restrictions — and walk every payload to build a detection for each variant.
- **Attacker infrastructure, built in.** Configure an attacker identity and stand up a remote listener in your own account (`attacker infra ec2 create`, `attacker listener start`) to catch credentials and shells.
- **Hand the blue team an audit log.** `workspace report --output pathrunner.html` produces a handoff report of the resources created or modified and the CloudTrail events your activity generated, with timestamps.
- **Workspace isolation.** Each workspace maintains isolated identities, history, and tracked resources.

## Integrations

- **[PMapper](https://github.com/nccgroup/PMapper)** — `pmapper import` a graph, then `pmapper analyze` to see which escalation paths you can currently exploit, with suggested commands for each hop.
- **[CloudFox](https://github.com/BishopFox/cloudfox)** — `cloudfox import` its output to browse discovered AWS resources (`resources list`) and auto-populate them as module option values.

## Next steps

Browse the [exploit modules](/pathrunner/modules) and [payloads](/pathrunner/payloads), or read the full source at [github.com/DataDog/pathrunner](https://github.com/DataDog/pathrunner).
