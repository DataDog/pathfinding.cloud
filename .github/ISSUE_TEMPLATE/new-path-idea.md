---
name: New Path Idea
about: Suggest a new AWS IAM privilege escalation path
title: '[PATH IDEA] '
labels: 'new-path'
assignees: ''
---

## Path Idea

**Have you discovered or read about an AWS IAM privilege escalation technique?**

Share it here! Don't worry about having all the details - even a rough idea helps. We'll investigate and build out the full documentation.

---

### Required Information

**Name / Permissions Involved** *(required)*
<!-- What IAM permissions are needed? Use format: iam:PassRole + lambda:CreateFunction -->


**Description** *(required)*
<!-- How does this privilege escalation work? What can an attacker gain? -->


**Required Permissions** *(required)*
<!-- List the minimum IAM permissions needed to exploit this path -->
-
-

---

### Optional Information

*Fill in what you know - everything helps!*

**AWS Services Involved**
<!-- e.g., IAM, Lambda, EC2, etc. -->


**Category**
<!-- Which category best fits? -->
- [ ] Self-escalation (modify own permissions)
- [ ] Principal access (gain access to other users/roles)
- [ ] New PassRole (create resource + pass role)
- [ ] Existing PassRole (modify existing resources with attached roles)
- [ ] Credential access (extract credentials from resources)

**Prerequisites**
<!-- What conditions must exist in the environment for this to work? -->


**Exploitation Commands**
<!-- If you have AWS CLI commands or other steps, include them here -->
```bash

```

**Where did you find this?**
<!-- Blog post, research paper, tool source code, personal discovery, etc. -->
<!-- Include links if available -->


**Who should be credited?**
<!-- If you know who originally discovered this technique -->


**Related Paths**
<!-- Are there similar paths already documented on pathfinding.cloud? -->


---

### Additional Context

<!-- Any other information that might be helpful -->


---

*Thank you for contributing to pathfinding.cloud! Even rough ideas help expand the community's knowledge of AWS privilege escalation paths.*
