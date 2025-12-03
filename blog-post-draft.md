# Introducing pathfinding.cloud: The Complete Map of AWS IAM Privilege Escalation

*A comprehensive, community-maintained library documenting every known AWS IAM privilege escalation path*

---

## The Problem: Detection Gaps in AWS IAM Privilege Escalation

If you've spent time securing AWS environments, you've probably heard of the classic IAM privilege escalation techniques: `iam:PassRole + ec2:RunInstances`, `iam:CreateAccessKey`, `iam:AttachUserPolicy`. These are well-documented attack paths that allow an IAM principal with limited permissions to gain administrative access or pivot to more privileged roles.

Most organizations running AWS security tools—whether open source or commercial—feel reasonably confident that they're detecting these common privilege escalation paths. After all, tools like PMapper, Cloudsplaining, and Prowler have been around for years and are widely deployed.

**But here's the uncomfortable truth: most security tools only detect a fraction of the known privilege escalation paths.**

And as someone who has spent years in penetration testing, I can tell you with certainty: attackers **always** find success in the gaps—the paths that aren't clearly documented, the combinations that aren't widely known, and the variations that security tools miss.

## How We Got Here: A Brief History

The story of AWS IAM privilege escalation research begins in 2018 with [Spencer Gietzen at Rhino Security Labs](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/). Spencer published groundbreaking research documenting around 21 IAM permission combinations that enable privilege escalation. This became foundational work that shaped how we think about AWS IAM security.

Shortly after, [Gerben Kleijn at Bishop Fox](https://bishopfox.com/blog/privilege-escalation-in-aws) expanded on this research with detailed exploitation steps and requirements. [Erik Steringer's PMapper](https://github.com/nccgroup/PMapper) added programmatic detection capabilities and identified 10 additional privilege escalation paths. Other researchers continued contributing, and the security community's understanding of AWS IAM privilege escalation grew significantly.

But then something interesting happened: **the tracking stopped.**

## Why the Gap Exists

Researchers who understood the problem well began to realize that many newly discovered privilege escalation paths were structurally similar to existing ones. For example:

- `iam:PassRole + ec2:RunInstances` (one of the original 21 paths)
- `iam:PassRole + lambda:CreateFunction` (also in the original research)
- `iam:PassRole + sagemaker:CreateTrainingJob` (documented later)
- `iam:PassRole + glue:CreateJob` (often overlooked)
- `iam:PassRole + bedrock-agentcore:CreateCodeInterpreter` (discovered in 2025)

From a researcher's perspective, these are fundamentally the same pattern: pass a privileged role to an AWS service that can execute code or commands. Once you understand the pattern, discovering a new service that follows it doesn't feel particularly novel.

**But this is where the gap emerges.**

While the pattern may be the same, the **detection coverage is not**. Open source and commercial security tools implemented detection for the well-known combinations—EC2 and Lambda are almost universally covered. But Bedrock AgentCore? Glue? App Runner? DataPipeline? These often slip through the cracks.

## The Security Impact: Known Unknowns

Let's look at real detection coverage from popular open source tools. For the classic `iam:PassRole + ec2:RunInstances` path:

- **PMapper**: ✅ Detects
- **Cloudsplaining**: ✅ Detects
- **Prowler**: ✅ Detects
- **Pacu**: ✅ Detects

Now compare that to `iam:PassRole + bedrock-agentcore:CreateCodeInterpreter` (a privilege escalation path [discovered by Sonrai Security in 2025](https://sonraisecurity.com/blog/aws-agentcore-privilege-escalation-bedrock-scp-fix/)):

- **PMapper**: ❌ Does not detect
- **Cloudsplaining**: ❌ Does not detect
- **Prowler**: ✅ Detects (recently added)
- **Pacu**: ❌ Does not detect

Both paths allow full AWS account compromise. Both follow the same exploitation pattern. But one has near-universal detection coverage while the other has significant gaps.

Organizations that have carefully deployed these security tools and fixed the findings feel protected—and they are, against the well-known paths. But they remain vulnerable to the lesser-documented variations that follow identical attack patterns.

**This is exactly where penetration testers and attackers find success.** Not in discovering completely new techniques, but in exploiting the known patterns that happen to fall through detection gaps.

## Introducing pathfinding.cloud

This is why I created [**pathfinding.cloud**](https://pathfinding.cloud) — a comprehensive, community-maintained library documenting **all** known AWS IAM privilege escalation paths, with explicit focus on detection tool coverage gaps.

### What Makes pathfinding.cloud Different

**1. Complete Coverage**

Every documented privilege escalation path is cataloged, including variations that security tools often miss. We currently document paths across IAM, EC2, Lambda, Glue, SageMaker, Bedrock, CloudFormation, CodeBuild, SSM, ECS, DataPipeline, App Runner, and more.

**2. Detection Tool Mapping**

For each privilege escalation path, we explicitly document which open source security tools detect it:

```yaml
detectionTools:
  pmapper: https://github.com/nccgroup/PMapper/blob/master/principalmapper/graphing/ec2_edges.py#L73
  cloudsplaining: https://github.com/salesforce/cloudsplaining/blob/master/cloudsplaining/shared/constants.py#L131
  prowler: https://github.com/prowler-cloud/prowler/blob/master/prowler/providers/aws/services/iam/lib/privilege_escalation.py#L26
  pacu: https://github.com/RhinoSecurityLabs/pacu/blob/master/pacu/modules/iam__privesc_scan/main.py#L733
```

We link directly to the specific line numbers in each tool's source code where the detection logic is implemented. If a tool isn't listed, it **doesn't detect that path**—and you should test whether your CSPM or CIEM solution catches it either.

**3. Practice Environments**

For each privilege escalation path, we provide links to intentionally vulnerable lab environments where you can:

- Practice exploiting the path yourself
- Test whether your security tools actually detect it
- Validate your detection and response capabilities

```yaml
learningEnvironments:
  pathfinder-labs:
    type: open-source
    githubLink: https://github.com/DataDog/pathfinder-labs
    scenario: "privesc-one-hop/to-admin/iam-passrole+ec2-runinstances"
    description: "Deploy Terraform into your own AWS account to practice this attack path"

  iam-vulnerable:
    type: open-source
    githubLink: https://github.com/BishopFox/iam-vulnerable
    scenario: EC2-CreateInstanceWithExistingProfile
    description: "Deploy Terraform and practice individual exploitation paths"
```

You can spin up these labs in your own AWS accounts, exploit them, and verify that your security controls actually work before an attacker tests them for you.

**4. Interactive Attack Visualizations**

Each privilege escalation path includes an interactive network diagram showing the complete attack flow—from starting permissions through exploitation methods to final outcomes. These visualizations make it easier to understand complex multi-step attacks and explain them to stakeholders.

**5. Machine-Readable Format**

All data is structured in validated YAML format and automatically exported to JSON for integration with security tools:

```bash
# All paths available as structured data
curl https://pathfinding.cloud/paths.json
```

Security teams can integrate this data into their own tooling, CSPM platforms, or detection pipelines.

**6. Five Attack Categories**

Privilege escalation paths are organized by attack pattern:

1. **Self-Escalation** — Modify your own permissions directly (e.g., `iam:CreatePolicyVersion`)
2. **Lateral Movement** — Gain access to other principals (e.g., `iam:CreateAccessKey` on another user)
3. **Service PassRole** — Escalate via service + PassRole combinations (e.g., `iam:PassRole + ec2:RunInstances`)
4. **Credential Access** — Access or extract credentials from AWS resources (e.g., `ssm:GetParameter` on credentials)
5. **Access Resource** — Modify or access existing resources to gain elevated access (e.g., `lambda:UpdateFunctionCode`)

## Real-World Example: The Bedrock Gap

Let's walk through a real example. In January 2025, Sonrai Security published research on a new privilege escalation path using AWS Bedrock AgentCore code interpreters.

The attack works like this:

1. Attacker has `iam:PassRole` and several `bedrock-agentcore` permissions
2. Create a code interpreter with a privileged execution role
3. The code interpreter runs on a Firecracker MicroVM with access to the metadata service at 169.254.169.254 (just like EC2)
4. Invoke Python code that queries the metadata service and exfiltrates the role's temporary credentials
5. Use those credentials to gain full administrative access

Sound familiar? It should—this is **structurally identical** to the EC2 `iam:PassRole` privilege escalation from 2018.

But here's what's different:

- EC2 PassRole escalation: Detected by nearly every security tool
- Bedrock AgentCore PassRole escalation: Only detected by Prowler (as of this writing)

At the time of discovery, most organizations running security scans would have **completely missed** this path—despite having tools that successfully detect the identical pattern in EC2.

On pathfinding.cloud, we document both paths side-by-side, showing exactly which tools detect each one. Security teams can use this information to:

- Identify gaps in their current security tooling
- Prioritize testing specific privilege escalation paths
- Validate that new services are properly covered
- Make informed decisions about tool adoption

## What You Can Do Today

**If you're a security practitioner:**

1. Visit [pathfinding.cloud](https://pathfinding.cloud) and review the documented privilege escalation paths
2. Filter by the AWS services you use most heavily
3. Check which paths your current security tools detect
4. Spin up practice labs for the paths you're not currently detecting
5. Test whether your CSPM/CIEM solution catches them

**If you're building security tools:**

1. Review the complete list of documented privilege escalation paths
2. Compare against your current detection capabilities
3. Use the machine-readable JSON export to test your coverage
4. Consider contributing detection improvements back to open source tools

**If you're a security researcher:**

1. Help us document newly discovered privilege escalation paths
2. Contribute variations of existing patterns
3. Update detection tool coverage as tools add new capabilities
4. Submit pull requests to expand the library

## The Path Forward

AWS IAM privilege escalation isn't going away. As AWS continues to add new services (and there are now over 200), new privilege escalation variations will continue to emerge. Most will follow existing patterns—PassRole combinations, service role assumption, credential access from resources—but they'll target new services that security tools don't yet cover.

The goal of pathfinding.cloud is to ensure that these gaps are visible, documented, and testable. Security teams shouldn't have to wait for an incident to discover that their tools miss a particular privilege escalation path.

By creating a comprehensive, community-maintained library with explicit detection tool mapping and practice environments, we can help close the gap between what security teams **think** they're detecting and what they **actually** catch.

Because in security, the most dangerous vulnerabilities aren't the ones we don't know about—they're the ones we think we've already fixed.

---

**Try it yourself:** [pathfinding.cloud](https://pathfinding.cloud)

**Contribute:** [github.com/DataDog/pathfinding.cloud](https://github.com/DataDog/pathfinding.cloud)

**Practice Labs:** [github.com/DataDog/pathfinder-labs](https://github.com/DataDog/pathfinder-labs)

---

*Seth Art is a Security Research Engineer at Datadog. Previously, he spent years as a penetration tester finding exactly these kinds of gaps in real-world AWS environments.*
