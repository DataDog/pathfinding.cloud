# Introducing Pathfinding.cloud

In 2018, [Spencer Gietzen](https://rhinosecuritylabs.com/aws/aws-privilege-escalation-methods-mitigation/) outlined 21 permissions, or combinations of permissions, that allow for privilege escalation in AWS. Each of these represents a way that one AWS principal (IAM User or IAM Role) can gain access to another AWS principal. I’ll refer to these permissions or combinations of permissions as **PrivEsc paths,** or **paths** throughout this post. In the worst case scenario, these paths would allow a non-administrative principal to gain access to administrative permissions. Sometimes, these paths allow a non-administrative principal to gain access to another non-administrative principal. You might think this is not a big deal, but if the second principal has access to the most sensitive data in the organization, and the first principal does not, this path is still quite important and impactful. 

Sometimes seeing is believing. In 2019, Bishop Fox’s Gerben Kleijn [wrote an article](https://bishopfox.com/blog/privilege-escalation-in-aws) that showed how to manually exploit each of the 21 AWS privilege escalation paths from Spencer’s original research. In 2021, I created [IAM Vulnerable](https://github.com/BishopFox/iam-vulnerable), so that penetration testers and security practitioners could deploy those initial 21 paths in their own sandbox environments and then practice exploiting them. During that research, I added 10 additional paths to IAM Vulnerable, bringing the number of supported paths to 31\. Most of these new paths were added after looking at the source code of `pmapper`, an open source tool, written by Erik Steringer, that tries to detect these privilege escalation paths in an AWS account. Speaking of open source tools, in [follow up research](https://bishopfox.com/blog/assessing-the-aws-assessment-tools), I assessed four open-source IAM PrivEsc assessment tools to see how many paths each of them identified. They ranged from detecting between 14-22 of the 31 paths supported by IAM Vulnerable at the time.  

# The problem: Undocumented paths, and documented paths not supported by tools

Over the years, I’ve noticed that new AWS privilege escalation paths are still being introduced and documented, yet the open source assessment tools in this space are not keeping pace with the new additions. Another thing I’ve noticed is that some paths are known in theory to some, because they are so similar to ones that are already documented, but they themselves are not documented.

The result is that our open source assessment tools are missing many of the paths that allow for privilege escalation. What this means in practice is that even organizations that take the time to lint policies for privilege escalation, or the ones that perform automated privilege escalation identification activities, are potentially missing paths in their environments.   

So how can we fix this disparity between tool coverage, general awareness, and reality? 

# A solution: Let’s document the unique edges

The approach I’ve taken is simple: Document all of the known privilege escalation paths using a standardized schema, focusing on disambiguation using unique identifiers. Then, show them in a clean frontend, but open-source the project so that anyone can contribute additional paths by simply adding a single yaml file.   

At this point I encourage you to stop reading this post and just head over to [https://pathfinding.cloud](https://pathfinding.cloud). 

But for those of you that just enjoy the behind the scenes a bit, I’m going to share the decisions I’ve made and the reasons I made them. 

# The approach

## Five attack categories

One of the first decisions I made was to categorize privilege escalation paths into five distinct types. This wasn't just organizational—each category represents a fundamentally different attack pattern:

**Self-Escalation** involves a principal modifying their own permissions directly (like `iam:CreatePolicyVersion` on an attached policy). 

**Lateral Movement** is when you gain access to a *different* principal's credentials (like `iam:CreateAccessKey` on another user). I separated these because the defensive implications are different: self-escalation often requires catching the act itself, while lateral movement creates new credentials that can be monitored independently.

**Service PassRole** paths deserved their own category because they follow a consistent pattern: pass a privileged role to an AWS service that executes code or commands. Whether it's EC2, Lambda, Glue, or Bedrock, the exploitation is structurally the same—only the service changes. Grouping these together makes it obvious when detection tools miss certain services.

**Credential Access** covers finding hardcoded credentials in resources (like SSM parameters or Secrets Manager), while **Access Resource** involves modifying existing resources to gain elevated access (like `lambda:UpdateFunctionCode`). These needed separation because one is about discovery and the other is about modification.

## Admin vs. Lateral prerequisites

For PassRole-based privilege escalation paths, the outcome depends entirely on what roles exist in the environment. If there's a role with `AdministratorAccess`, you get admin. If there's only a role with `s3:GetObject` on specific buckets, you get limited S3 access.

Rather than treating these as separate paths, I use a tabbed prerequisite format that shows both scenarios. The "admin" tab lists requirements for full administrative escalation (must have a role with admin permissions), while the "lateral" tab shows requirements for any privilege gain (any role with elevated permissions). This makes it clear that the same permission combination can have different impacts depending on the environment.

## Required vs. Additional permissions

I separated permissions into two categories: `required` (minimum needed to exploit) and `additional` (helpful for reconnaissance). For example, `iam:PassRole` is required to pass a role to EC2, but `iam:ListRoles` just helps you discover available roles—you could get that information from a separate read-only principal.

This distinction matters for both detection and prevention. If you're building detection logic, you care about the required permissions. If you're restricting access, you might allow the additional ones for operational visibility while blocking the dangerous combinations.

## Learning environments and detection coverage

Two fields in the schema directly address the "awareness gap" problem: `learningEnvironments` and `detectionTools`.

For each path, I document which open-source and commercial lab environments let you practice it. This serves two purposes: penetration testers can sharpen their exploitation skills, and security teams can validate whether their detection tools actually catch it. There's nothing like deploying an intentionally vulnerable environment, exploiting it, and checking your SIEM to see if an alert fired.

The `detectionTools` field shows exactly which open-source tools detect each path, linking directly to the source code line numbers. When a tool isn't listed, that's a visible gap. This transparency lets security teams understand what they're missing and helps tool maintainers see where to add coverage.

## Unique identifiers and machine-readable schema

Every path gets a unique ID like `iam-001` or `ec2-003`. For PassRole paths, I use the service being exploited (not IAM), so `iam:PassRole + lambda:CreateFunction` becomes `lambda-001`. This makes it immediately clear which service is involved.

The entire schema is machine-readable YAML that exports to JSON. This isn't just for the website—it's designed for security tools to consume. Want to check if your CSPM covers all Lambda-based PassRole escalations? Query for `category: service-passrole` and `services: [lambda]`. Want to see which paths PMapper misses? Filter for paths where `detectionTools.pmapper` is absent.

## Attack visualizations

For complex paths with multiple exploitation methods or conditional branches, I added interactive attack visualizations. These show the complete attack flow: starting principal → resources created → credentials obtained → outcomes (admin vs. limited access). Each node and edge is clickable with detailed descriptions.

This was important because text-based exploitation steps can be hard to follow, especially for paths with multiple options (like EC2 where you can exfiltrate credentials via user data, reverse shell, or SDK calls). The visualization makes the decision tree explicit.

# Conclusion

The gap between documented privilege escalation paths and tool coverage isn't going away—AWS keeps adding services, and each new service brings new privilege escalation variations. But the gap doesn't need to be invisible.

pathfinding.cloud makes these gaps visible and actionable. Security teams can see exactly which paths their tools miss, penetration testers can find less-documented techniques, and tool builders can identify where to add coverage. Everything is open-source, machine-readable, and designed for contribution.

If you secure AWS environments, I encourage you to browse the documented paths, check your tool coverage, and deploy a few lab scenarios to validate your detections. If you're a researcher who's identified a new path or variation, submit a pull request—it takes one YAML file.

The goal isn't just comprehensive documentation. It's making sure that when someone deploys AWS security tools and fixes all the findings, they actually closed the privilege escalation paths they think they did.

Visit [pathfinding.cloud](https://pathfinding.cloud) to explore all documented paths, or check out [github.com/DataDog/pathfinding.cloud](https://github.com/DataDog/pathfinding.cloud) to contribute.
