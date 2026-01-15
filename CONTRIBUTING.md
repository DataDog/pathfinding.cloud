# Contributing to pathfinding.cloud

Thank you for your interest in contributing to pathfinding.cloud! This project aims to be a comprehensive source of AWS IAM privilege escalation paths, and **every contribution helps** - from rough ideas to fully documented paths.

## Ways to Contribute

We've designed multiple ways to contribute based on how much time and detail you have. Choose the option that works best for you:

| Option | Effort | What You Provide | What We Do |
|--------|--------|------------------|------------|
| **[Option 1: Share an idea](#option-1-share-an-idea-easiest)** | Lowest | Description of the attack | Everything else |
| **[Option 2: Submit a draft](#option-2-submit-a-draft-pr)** | Medium | Core fields (ID, name, permissions, description) | Any missing sections |
| **[Option 3: Use Claude Code, and <br> our workflow [RECOMMENDED]](#option-3-use-claude-code)** | Medium | You direct our Claude workflow | Review and merge |
| **[Option 4: Submit a complete path](#option-4-submit-a-complete-path-pr)** | Higher | All required fields manually | Review and merge |

---

## Option 1: Share an Idea (Easiest)

**Don't have time to write YAML? Just tell us about it!**

[Open a New Path Idea issue](../../issues/new?template=new-path-idea.md) and describe:
- What permissions are involved
- How the attack works
- Where you learned about it (optional)

We'll investigate, validate, and build out the full documentation. Your contribution will be credited in the path's attribution.

**This is perfect when you:**
- Found something interesting but don't have time to document it
- Aren't comfortable with Git/YAML
- Aren't sure if the path is valid or novel

---

## Option 2: Submit a Draft (PR)

**Have some details but not everything? Submit what you know!**

Draft submissions let you contribute the core information while we handle the rest (exploitation steps, visualization, detection tools, etc.).

### Draft Required Fields

| Field | Description |
|-------|-------------|
| `status` | Must be `draft` |
| `id` | Unique identifier (e.g., `lambda-007`) |
| `name` | Permission syntax (e.g., `iam:PassRole + lambda:CreateFunction`) |
| `category` | One of: `self-escalation`, `principal-access`, `new-passrole`, `credential-access`, `existing-passrole` |
| `services` | AWS services involved (e.g., `[iam, lambda]`) |
| `permissions.required` | List of required permissions with resource constraints |
| `description` | How the escalation works |

### How to Submit a Draft

1. **Copy the draft template:**
   ```bash
   cp data/example-path-draft.yaml data/paths/{service}/{service}-{number}.yaml
   ```

2. **Fill in the required fields** (see template for guidance)

3. **Add any optional fields you know** (uncomment and fill in)

4. **Validate your file:**
   ```bash
   python scripts/validate-schema.py data/paths/{service}/{service}-{number}.yaml
   ```

5. **Submit your PR** - our CI will validate, and we'll enhance it from there

### Example Draft Submission

```yaml
status: draft

id: lambda-007
name: iam:PassRole + lambda:CreateFunction + lambda:InvokeFunction
category: new-passrole
services:
  - iam
  - lambda

permissions:
  required:
    - permission: iam:PassRole
      resourceConstraints: Must be able to pass a role that trusts lambda.amazonaws.com
    - permission: lambda:CreateFunction
      resourceConstraints: Must be able to create Lambda functions
    - permission: lambda:InvokeFunction
      resourceConstraints: Must be able to invoke the created function

description: A principal with `iam:PassRole`, `lambda:CreateFunction`, and `lambda:InvokeFunction` can create a Lambda function with an attached privileged role, then invoke it to execute code as that role and retrieve temporary credentials.

# Optional: Add more if you have it!
# prerequisites:
#   admin:
#     - A role must exist that trusts lambda.amazonaws.com
#     - The role must have administrative permissions
```

---

## Option 3: Use Claude Code, and our workflow and sub-agents

**This is our recommended path and how we add paths.**

This project includes a custom [Claude Code](https://claude.ai/code) workflow and specialized sub-agents that automate most of the path creation process. You guide the AI, review the output, and submit the PR.

### What's Included

We've built custom tooling specifically for this project:

- **Orchestrator workflow** (`/workflows:orchestrator`) - Coordinates the entire path creation process
- **Specialized sub-agents**:
  - `add-vis` - Creates interactive attack visualizations
  - `attribution` - Researches and adds discoverer information
  - `detection-tools` - Finds which OSS tools detect this path
  - `learning-environments` - Locates practice labs and CTF environments

### How to Use Claude Code

1. **Install Claude Code** from [claude.ai/code](https://claude.ai/code)

2. **Clone the repository:**
   ```bash
   git clone https://github.com/DataDog/pathfinding.cloud.git
   cd pathfinding.cloud
   ```

3. **Start Claude Code** in the repository directory

4. **Run the orchestrator:**
   ```
   /workflows:orchestrator
   ```

5. **Follow the prompts** - The orchestrator will:
   - Ask you about the attack path 
   - Build the base YAML file
   - Automatically run all enrichment sub-agents in parallel
   - Validate the final file

   
Example workflow run: 

```
>  /workflows:orchestrator
  ⎿  Read SCHEMA.md (974 lines)
  ⎿  Read .claude/CLAUDE.md (349 lines)
  ⎿  Read CLAUDE.md (350 lines)

⏺ I'm ready to help you create a new attack path for pathfinding.cloud!

  To get started, please tell me about the attack path you'd like to document. You can either:

  1. Point me to a pathfinding-labs scenario:
  ~/Documents/projects/pathfinding-labs/modules/scenarios/...
  2. Describe the attack path directly:
    - What AWS permissions are involved?
    - How does the escalation work?
    - What services are involved?
    - Any references or sources where you learned about it?

  What would you like to create?

───────────────────────────────────────────────────────────────────────────────────────────────────
```

Your prompt could be: 
```
❯ Can you create a path for me based on iam:passrole and lambda:createfunction and lambda:invokefunction? 
The way this works is that a user who has these permissions can create a lambda function with malicious code, 
and then pass a role to that function that trusts the lambda service. Then the attacker can invoke the 
function. There are a few different payload options: The lambda can send the credentials to an attacker 
remote listener or webhook type site. the lambda can also just simply print the session credentials as lambda 
output for the user.  You can use this resource as supporting info: [resource]
```


Another prompt could be: 

```
Can you create a pathfinding.cloud path for the privesc described in this blog post: [insert_link]
```

6. **Review and submit your PR**

### What You Provide

- Description of the attack mechanism
- AWS services and permissions involved
- Any references or sources you have

### What the AI Handles

- Proper YAML formatting and field ordering
- Exploitation step commands
- Attack visualization diagrams
- Detection tool research
- Learning environment discovery
- Attribution research

**Great for:**
- Contributors who want a complete path without manual YAML editing
- Creating multiple paths efficiently
- Ensuring consistent formatting across contributions

---

## Option 4: Submit a Complete Path (PR)

**Prefer to do it manually? Or using an agent other than Claude Code? That's fine by us! Submit a complete path for fastest review!**

Complete submissions include all required fields and pass full validation. This is the traditional contribution method.

### Complete Path Required Fields

All draft fields plus:

| Field | Description |
|-------|-------------|
| `exploitationSteps` | Step-by-step commands (at minimum, `awscli` steps) |
| `recommendation` | Prevention and detection strategies |
| `discoveryAttribution` | Who discovered this technique |

### How to Submit a Complete Path

1. **Copy the complete template:**
   ```bash
   cp data/example-path-complete.yaml data/paths/{service}/{service}-{number}.yaml
   ```

2. **Fill in all required fields** (see [SCHEMA.md](SCHEMA.md) for details)

3. **Validate your file:**
   ```bash
   python scripts/validate-schema.py data/paths/{service}/{service}-{number}.yaml
   ```

4. **Submit your PR**

### Optional Enrichments

Complete paths can also include:
- `attackVisualization` - Interactive attack flow diagram
- `detectionTools` - Links to OSS tools that detect this path
- `learningEnvironments` - Practice labs and CTF environments
- `references` - Blog posts, papers, documentation

Don't worry if you don't have these - we can add them!

---

## Field Reference

### ID Format

- Format: `{service}-{number}` (e.g., `iam-001`, `lambda-007`)
- Number must be exactly 3 digits
- For PassRole paths, use the service of the resource being created:
  - `iam:PassRole + ec2:RunInstances` → `ec2-001`
  - `iam:PassRole + lambda:CreateFunction` → `lambda-001`

### Finding the Next ID

```bash
ls data/paths/{service}/ | sort | tail -n 1
```

### Categories

| Category | Description |
|----------|-------------|
| `self-escalation` | Modify own permissions directly |
| `principal-access` | Gain access to other principals (users/roles) |
| `new-passrole` | Escalate via creating resources + PassRole |
| `credential-access` | Access or extract credentials |
| `existing-passrole` | Modify existing resources to gain elevated access |

### Name Field Formatting

- Use AWS IAM permission syntax
- **Spaces around `+`**: `iam:PassRole + ec2:RunInstances` (not `iam:PassRole+ec2:RunInstances`)

### Full Schema Documentation

See [SCHEMA.md](SCHEMA.md) for complete field definitions, validation rules, and examples.

---

## Validation

### Validate Your File

```bash
# Install dependencies (first time only)
pip install -r requirements.txt

# Validate a single file
python scripts/validate-schema.py data/paths/{service}/{service}-{number}.yaml

# Validate all files
python scripts/validate-schema.py data/paths/
```

### Draft vs Complete Validation

- **Drafts** (`status: draft`): Only core fields are required
- **Complete** (no status field): All required fields must be present

Our CI automatically validates PRs and allows drafts. When merging to main, we ensure all paths are complete.

---

## Pull Request Guidelines

### PR Title Format

- `Add {service}-{number}: {name}` - For new paths
- `Update {service}-{number}: {description}` - For updates
- `Fix {service}-{number}: {description}` - For corrections

### PR Description

Include:
- Brief description of the path
- Where you learned about it (if applicable)
- Any testing performed

### Review Process

1. Automated validation runs on all PRs
2. Maintainers review for accuracy and completeness
3. For drafts: maintainers will enhance before merging
4. Once merged, the website automatically rebuilds

---

## Other Ways to Contribute

Beyond new paths, we welcome:

1. **Path variations** - Document nuances of existing paths
2. **Corrections** - Fix errors in existing documentation
3. **Detection tools** - Add links to tools that detect paths
4. **Learning environments** - Add links to practice labs
5. **Website improvements** - Enhance the UI or functionality

---

## Code of Conduct

- Be respectful and professional
- Focus on improving AWS security knowledge
- Credit original researchers appropriately
- Do not submit malicious content

---

## Questions?

- **Issues**: [Open an issue](../../issues/new/choose)
- **Discussions**: Use [GitHub Discussions](../../discussions) for questions
- **Schema questions**: See [SCHEMA.md](SCHEMA.md)

Thank you for contributing to pathfinding.cloud!
