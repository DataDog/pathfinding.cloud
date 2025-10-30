# Azure Privilege Escalation Paths - Future Research

This document outlines potential Azure privilege escalation paths for a future expansion of the pathfinding.cloud project. This research was conducted in January 2025 based on recent security research and vulnerability disclosures.

## Overview

Similar to AWS IAM privilege escalation paths, Azure has a rich landscape of privilege escalation techniques across:
- **Azure RBAC** (Role-Based Access Control for resource management)
- **Microsoft Entra ID** (formerly Azure AD - identity and directory services)
- **Managed Identities** (Azure's equivalent to AWS IAM roles for services)
- **Service Principals** (Application identities similar to AWS service roles)

Key differences from AWS:
- Separate control planes: Entra ID (identity) vs Azure RBAC (resources)
- Hierarchical scope: Management Groups → Subscriptions → Resource Groups → Resources
- Managed identities tied to Azure resources (VMs, Functions, etc.)
- Microsoft Graph API permissions (separate from Azure RBAC)
- Hybrid cloud scenarios (on-premises AD integration via Azure AD Connect)

## Azure Privilege Escalation Paths by Category

### 1. Role Assignment Manipulation

These paths involve directly manipulating Azure RBAC role assignments to escalate privileges:

**1.1 Direct Role Assignment**
- **Permission**: `Microsoft.Authorization/roleAssignments/write`
- **Description**: Can assign any role (Owner, Contributor, User Access Administrator) to self or controlled principals at the same scope level
- **Scope**: Works at subscription, resource group, or resource scope
- **Impact**: Direct path to Owner/Contributor privileges

**1.2 User Access Administrator Role**
- **Permission**: User Access Administrator built-in role
- **Description**: Full control over access management for Azure resources without requiring other administrative permissions
- **Impact**: Can assign any Azure RBAC role including Owner
- **Note**: Analogous to AWS IAM full access but scoped to Azure resources only

### 2. Managed Identity Exploitation

Managed identities in Azure can have excessive permissions. Principals with access to resources using managed identities can assume those identities:

**2.1 VM Command Execution (System-Assigned Identity)**
- **Permissions**: `Microsoft.Compute/virtualMachines/runCommand/action`
- **Prerequisites**: VM must have system-assigned or user-assigned managed identity with elevated permissions
- **Exploitation**: Execute commands on VM → Access IMDS endpoint (169.254.169.254) → Retrieve managed identity access token → Use token with Azure APIs
- **Impact**: Full access to whatever permissions the managed identity has
- **Detection**: Monitor RunCommand operations, IMDS access patterns

**2.2 VM Login (Managed Identity Assumption)**
- **Permissions**: `Microsoft.Compute/virtualMachines/login/action` OR `Microsoft.Compute/virtualMachines/loginAsAdmin/action`
- **Prerequisites**: VM must have privileged managed identity
- **Exploitation**: Login to VM → Access IMDS → Retrieve token → Assume managed identity
- **Impact**: Full managed identity access
- **Note**: Similar to AWS SSM Session Manager + instance profile exploitation

**2.3 Attach Managed Identity to VM**
- **Permissions**:
  - `Microsoft.ManagedIdentity/userAssignedIdentities/assign/action`
  - `Microsoft.Compute/virtualMachines/runCommand/action` OR login permissions
- **Prerequisites**: User-assigned managed identity with elevated permissions must exist
- **Exploitation**: Attach privileged managed identity to VM you control → Execute commands or login → Access IMDS → Retrieve token
- **Impact**: Assume any user-assigned managed identity permissions
- **Scope Boundary**: User-assigned identities created at resource group scope can be assigned roles outside that scope (subscription-level escalation)

**2.4 Function App Configuration Access**
- **Permissions**: `Microsoft.Web/sites/config/list/action`
- **Target**: Azure Functions, Web Apps, Logic Apps with managed identities
- **Exploitation**: Read app configuration → Extract managed identity information → Access KUDU console or deployment credentials
- **Impact**: Execute code as the app's managed identity

### 3. Service Principal & Application Abuse

Service principals are the runtime identities for applications. Controlling service principals = controlling their permissions:

**3.1 Add Credentials to Application**
- **Permissions**: `Microsoft.Graph/applications/credentials/update` OR `Application.ReadWrite.All` (MS Graph API)
- **Prerequisites**: Application/Service Principal must already exist with elevated permissions
- **Exploitation**: Add new password or certificate to application → Authenticate as that application → Assume service principal permissions
- **Impact**: Full access to service principal's assigned roles
- **Real-world**: Application Administrator → Global Administrator escalation path

**3.2 Service Principal Owner Manipulation**
- **Permissions**: `Microsoft.Graph/servicePrincipals/owners/update`
- **Exploitation**: Add self as owner of service principal → Add credentials → Authenticate as service principal
- **Impact**: Assume service principal permissions
- **Note**: Similar to AWS IAM role trust policy modification

**3.3 App Role Assignment**
- **Permissions**: `AppRoleAssignment.ReadWrite.All` (MS Graph)
- **Exploitation**: Assign privileged app roles to controlled service principals
- **Impact**: Elevate service principal permissions via role assignments
- **Target**: Often targets Microsoft Graph or other Azure AD integrated apps

### 4. Azure Automation Exploitation

Azure Automation Accounts can run scripts (Runbooks) with managed identities or stored credentials:

**4.1 Create Malicious Automation Jobs**
- **Permissions**: `Microsoft.Automation/automationAccounts/jobs/write`
- **Prerequisites**: Automation Account with privileged managed identity or stored credentials
- **Exploitation**: Create job using existing runbook → Job executes with Automation Account's managed identity
- **Impact**: Execute arbitrary code with managed identity permissions

**4.2 Create and Execute Malicious Runbooks**
- **Permissions**:
  - `Microsoft.Automation/automationAccounts/runbooks/write`
  - `Microsoft.Automation/automationAccounts/jobs/write`
- **Exploitation**: Upload malicious PowerShell/Python runbook → Create job to execute it → Run as managed identity
- **Impact**: Full control with managed identity permissions
- **Analogous to**: AWS Lambda function creation with privileged execution role

**4.3 Read Automation Account Credentials**
- **Permissions**: `Microsoft.Automation/automationAccounts/credentials/read`
- **Exploitation**: Read stored credentials from Automation Account credential assets
- **Impact**: Access to stored privileged credentials
- **Note**: Credentials are stored encrypted but readable by authorized principals

### 5. Azure Functions & Logic Apps

Serverless compute resources that execute with managed identities:

**5.1 Deploy Malicious Function**
- **Permissions**: `Microsoft.Web/sites/functions/write`
- **Prerequisites**: Function App with privileged managed identity
- **Exploitation**: Deploy malicious function code → Trigger function → Execute as managed identity
- **Impact**: Code execution with Function App's managed identity permissions
- **Analogous to**: AWS Lambda + execution role privilege escalation

**5.2 Create Malicious Logic App**
- **Permissions**: `Microsoft.Logic/workflows/write`
- **Prerequisites**: Logic App with privileged managed identity or API connections
- **Exploitation**: Create workflow with malicious actions → Trigger workflow → Execute with managed identity
- **Impact**: Access to managed identity or connected API permissions

**5.3 Function App Publishing**
- **Permissions**:
  - `Microsoft.Web/sites/config/list/action` (to get publish profile)
  - `Microsoft.Web/sites/publish/action`
- **Exploitation**: Get publishing credentials → Deploy malicious code → Execute as managed identity
- **Impact**: Code execution as Function App identity

### 6. Key Vault Exploitation

Azure Key Vault stores secrets, keys, and certificates. Access to Key Vault can provide credentials for privilege escalation:

**6.1 Read Key Vault Secrets**
- **Permissions**: `Microsoft.KeyVault/vaults/secrets/read` OR Key Vault access policy with Get Secrets
- **Exploitation**: List and read secrets → Extract credentials, connection strings, API keys
- **Impact**: Access to any credentials stored in Key Vault (often service principal credentials, database passwords, etc.)

**6.2 Modify Key Vault Access Policies**
- **Permissions**: `Microsoft.KeyVault/vaults/accessPolicies/write`
- **Exploitation**: Grant self full permissions to Key Vault → Read all secrets/keys/certificates
- **Impact**: Full access to Key Vault contents

**6.3 Key Vault Deployment Access**
- **Permissions**: `Microsoft.KeyVault/vaults/deploy/action`
- **Context**: ARM template deployments can reference Key Vault secrets
- **Exploitation**: Create ARM deployment that references secrets → Extract secrets from deployment
- **Impact**: Access to secrets during deployment operations

### 7. Storage Account Access

Storage accounts often contain application code, configuration, and data:

**7.1 List Storage Account Keys**
- **Permissions**: `Microsoft.Storage/storageAccounts/listKeys/action`
- **Exploitation**: List storage account access keys → Full access to all storage account data
- **Impact**: Read/write/delete access to blobs, files, tables, queues
- **Note**: Keys provide full access regardless of RBAC or SAS tokens

**7.2 Storage Blob Data Owner**
- **Permissions**: Storage Blob Data Owner built-in role
- **Exploitation**: Modify application code stored in blob storage → Application executes modified code
- **Impact**: Code execution in application context
- **Target**: Static websites, Function App code, application deployments

**7.3 Modify Storage Containers**
- **Permissions**: `Microsoft.Storage/storageAccounts/blobServices/containers/write`
- **Exploitation**: Modify container properties, access policies → Gain access to blob data
- **Impact**: Access to application data and code

### 8. Container & Kubernetes Exploitation

Azure Kubernetes Service (AKS) and Container Registry paths:

**8.1 List AKS Cluster User Credentials**
- **Permissions**: `Microsoft.ContainerService/managedClusters/listClusterUserCredential/action`
- **Exploitation**: Get kubeconfig for cluster → Access Kubernetes API → Enumerate pods with privileged service accounts
- **Impact**: Access to Kubernetes cluster resources and workload identities

**8.2 List AKS Cluster Admin Credentials**
- **Permissions**: `Microsoft.ContainerService/managedClusters/listClusterAdminCredential/action`
- **Exploitation**: Get admin kubeconfig → Full cluster access → Access any pod's service account token
- **Impact**: Cluster admin access, can assume any workload identity

**8.3 Container Registry Image Manipulation**
- **Permissions**:
  - `Microsoft.ContainerRegistry/registries/pull/read`
  - `Microsoft.ContainerRegistry/registries/push/write`
- **Exploitation**: Pull application images → Modify to include backdoor → Push modified image → Wait for deployment
- **Impact**: Code execution when applications deploy modified images
- **Analogous to**: AWS ECR image manipulation

### 9. Entra ID (Azure AD) Directory Roles

Directory roles provide permissions within Entra ID (identity plane) separate from Azure RBAC (resource plane):

**9.1 Application Administrator → Global Administrator**
- **Initial Role**: Application Administrator
- **Path**: Add credentials to enterprise application that has Global Administrator role assignment → Authenticate as that application → Assume Global Admin
- **Impact**: Full tenant administrative access
- **Real-world**: Documented by multiple security researchers in 2023-2024

**9.2 Cloud Application Administrator → Global Administrator**
- **Initial Role**: Cloud Application Administrator
- **Path**: Similar to Application Administrator, but for cloud-only apps
- **Impact**: Full tenant administrative access

**9.3 Privileged Authentication Administrator**
- **Initial Role**: Privileged Authentication Administrator
- **Path**: Reset password of any user including Global Administrators → Login as Global Admin
- **Impact**: Full tenant administrative access
- **Note**: Extremely powerful role that should be monitored closely

**9.4 Authentication Administrator**
- **Initial Role**: Authentication Administrator
- **Path**: Reset passwords for non-admin users and certain admin roles → Lateral movement → Chain to other escalation paths
- **Impact**: Partial admin access, stepping stone for further escalation

**9.5 User Administrator**
- **Initial Role**: User Administrator
- **Path**: Create new users → Assign to privileged groups (if dynamic group membership rules allow) → Assume created user identity
- **Impact**: Varies based on group membership possibilities

**9.6 Partner Tier1/Tier2 Support**
- **Initial Role**: Partner Tier1 Support or Partner Tier2 Support
- **Path**: Reset passwords with certain limitations → Lateral movement
- **Impact**: Limited but can be chained with other attacks
- **Note**: Often overlooked roles in security audits

### 10. Dynamic Group Manipulation

Dynamic groups automatically add members based on user/device attributes:

**10.1 Modify User Attributes for Group Membership**
- **Permissions**: `User.ReadWrite.All` (MS Graph) OR `Microsoft.Graph/users/update`
- **Prerequisites**: Privileged dynamic group exists with predictable membership rules (e.g., department="IT" → grants admin access)
- **Exploitation**: Modify user attributes to match dynamic group rules → Automatically added to privileged group
- **Impact**: Access to privileges assigned to dynamic group
- **Real-world**: Documented by Mnemonic Security researchers

**10.2 Device Attribute Manipulation**
- **Permissions**: Device write permissions
- **Prerequisites**: Dynamic groups based on device attributes
- **Exploitation**: Modify device attributes → Device added to privileged group → Access granted
- **Impact**: Device-based access escalation

### 11. Azure DevOps & ARM Template Deployment

Infrastructure-as-Code deployment paths:

**11.1 Deploy Malicious ARM Template**
- **Permissions**: `Microsoft.Resources/deployments/write`
- **Exploitation**: Deploy ARM template that creates resources with privileged managed identities → Access those resources → Assume managed identity
- **Impact**: Create privileged resources under your control

**11.2 Read and Modify Existing Deployments**
- **Permissions**:
  - `Microsoft.Resources/deployments/read`
  - `Microsoft.Resources/deployments/write`
- **Exploitation**: Read deployment templates (may contain secrets) → Modify and redeploy → Inject malicious configurations
- **Impact**: Extract secrets from templates, modify infrastructure

### 12. Certificate & API Management

**12.1 Upload Malicious Certificates**
- **Permissions**: `Microsoft.Web/certificates/write`
- **Prerequisites**: Services using certificate-based authentication
- **Exploitation**: Upload certificate → Use for authentication to privileged services
- **Impact**: Authenticate as service using certificate-based auth

**12.2 Generate API Management Tokens**
- **Permissions**: `Microsoft.ApiManagement/service/users/token/action`
- **Exploitation**: Generate management API tokens → Access API Management control plane
- **Impact**: Modify API policies, access backend services

### 13. Hybrid Cloud - Pass-Through Authentication (PTA)

Azure AD Connect synchronization and Pass-Through Authentication:

**13.1 On-Premises Directory Synchronization Service Account Compromise**
- **Context**: Azure AD Connect creates "On-Premises Directory Synchronization Service Account" in cloud
- **Path**: Compromise on-premises AD Connect server → Extract sync account credentials OR use Temporary Access Pass feature → Authenticate to Azure AD → Modify sync rules → Escalate cloud privileges
- **Impact**: Full tenant compromise from on-premises breach
- **Real-world**: Critical attack path in hybrid environments

**13.2 PTA Agent Exploitation (Multi-Domain)**
- **Context**: When multiple on-premises AD domains sync to single Azure tenant with PTA
- **Vulnerability**: PTA agents may mishandle authentication requests across domains
- **Exploitation**: Manipulate credential validation process → Authenticate as privileged synced user
- **Impact**: Gain access to high-privilege accounts synced from on-premises
- **Discovered**: 2024 by Cymulate researchers

**13.3 Azure AD Connect Admin Access**
- **Permissions**: Administrator on Azure AD Connect server
- **Path**: Access AD Connect → Modify synchronization rules → Grant privileged roles to controlled accounts during sync
- **Impact**: Escalate privileges in cloud via sync rule manipulation

### 14. Conditional Access Policy Manipulation

Conditional Access (CA) controls access requirements (MFA, device compliance, location):

**14.1 Modify Conditional Access Policies**
- **Permissions**: `Microsoft.Graph/policies/conditionalAccessPolicies/update`
- **Exploitation**: Disable or modify CA policies to exclude self from MFA or other requirements → Bypass security controls
- **Impact**: Bypass MFA, device compliance, location restrictions

**14.2 Security Administrator Role**
- **Role**: Security Administrator
- **Permissions**: Can manage some security settings including certain CA policies
- **Exploitation**: Modify security policies to weaken controls → Enable other attacks
- **Impact**: Weaken security posture for further exploitation

### 15. Cross-Tenant & B2B Collaboration

Multi-tenant and Business-to-Business (B2B) guest scenarios:

**15.1 Privileged B2B Guest Account**
- **Context**: External user invited as guest to resource tenant with elevated permissions
- **Path**: Compromise guest user in home tenant → Use guest access in resource tenant → Exploit elevated permissions
- **Impact**: Cross-tenant privilege escalation

**15.2 B2B Collaboration with Overprivileged Guest**
- **Context**: Guest users granted excessive permissions in resource tenant
- **Path**: Guest account compromise → Lateral movement in resource tenant → Privilege escalation using guest's elevated permissions
- **Impact**: External attacker gains internal privileged access

## Key Differences Between Azure and AWS

### Architecture
- **Azure**: Separate control planes (Entra ID for identity, Azure RBAC for resources)
- **AWS**: Unified control plane (IAM for both identity and resource permissions)

### Scope Hierarchy
- **Azure**: Management Groups → Subscriptions → Resource Groups → Resources
- **AWS**: Organizations → Accounts → Resources

### Identity for Services
- **Azure**: Managed Identities (system-assigned or user-assigned)
- **AWS**: IAM Roles with instance profiles or execution roles

### Permission Model
- **Azure**: RBAC with Actions and DataActions, scope-based inheritance
- **AWS**: Policy-based with explicit Allow/Deny, resource and identity-based policies

### API Permissions
- **Azure**: Microsoft Graph API permissions separate from Azure RBAC
- **AWS**: All permissions in unified IAM policy language

### Hybrid Scenarios
- **Azure**: Native hybrid with Azure AD Connect, PTA, federation
- **AWS**: Primarily federation-based (SAML, OIDC)

## Schema Design Considerations for Azure Version

If creating an Azure version of pathfinding.cloud, the schema would need these adaptations:

### Required Fields (Additional/Modified)

```yaml
# Standard fields (similar to AWS version)
id: azure-rbac-001  # or azure-entra-001 for Entra ID paths
name: Microsoft.Authorization/roleAssignments/write
category: self-escalation  # Same categories work
services: [Azure RBAC]  # Or [Entra ID], [Managed Identity], etc.

# Azure-specific additions
controlPlane: azure-rbac  # Values: azure-rbac, entra-id, microsoft-graph
scopeLevel: subscription  # Values: management-group, subscription, resource-group, resource, directory
permissionType: action  # Values: action, dataAction, graph-permission, directory-role

permissions:
  required:
  - permission: Microsoft.Authorization/roleAssignments/write
    scope: subscription  # or resource-group, resource
    resourceConstraints: Must have permission at same or higher scope than target role
  additional:
  - permission: Microsoft.Authorization/roleDefinitions/read
    scope: subscription

# For managed identity paths
managedIdentityType: user-assigned  # Values: system-assigned, user-assigned, both, n/a

# For hybrid paths
requiresHybrid: true  # Boolean: requires on-premises integration
hybridComponent: azure-ad-connect  # Values: azure-ad-connect, pta, federation, n/a

# For Entra ID paths
initialDirectoryRole: Application Administrator  # Starting role for Entra ID escalations
targetDirectoryRole: Global Administrator  # Target role

# Cross-tenant scenarios
crossTenant: false  # Boolean: involves B2B or multi-tenant
```

### Category Mapping

The existing categories work well for Azure:
- `self-escalation`: Direct privilege escalation (e.g., roleAssignments/write)
- `lateral-movement`: Moving between identities (e.g., managed identity assumption)
- `service-passrole`: Azure equivalent would be managed identity assignment
- `credential-access`: Reading secrets from Key Vault, Storage Account keys
- `access-resource`: Accessing resources to pivot (e.g., VM login for IMDS access)

### Additional Metadata

```yaml
# Detection considerations
detectionRules:
  microsoftDefender: true  # If Microsoft Defender for Cloud detects it
  sentinelAnalytics: true  # If Microsoft Sentinel has built-in detection

# Tool support
toolSupport:
  azureHound: true  # Similar to AWS pmapper
  stormspotter: true  # Azure attack path visualization
  roadTools: true  # Azure AD reconnaissance
  azureGoat: true  # Training/testing environment

# Mitigation (Azure-specific)
azurePolicyDeny: true  # If Azure Policy can deny the action
pimEligible: true  # If should use Privileged Identity Management
```

## Recommended Tools for Azure Research

### Reconnaissance & Enumeration
- **AzureHound** (BloodHound for Azure) - Attack path visualization
- **ROADtools** - Azure AD reconnaissance
- **StormSpotter** - Azure Red Team tool
- **Azucar** - Security auditing for Azure
- **ScoutSuite** - Multi-cloud security auditing

### Exploitation & Testing
- **MicroBurst** - PowerShell toolkit for Azure security assessments
- **Azure Goat** - Vulnerable-by-design Azure environment (like CloudGoat for AWS)
- **Pacu-Azure** - Azure exploitation framework (if exists)

### Detection & Defense
- **Microsoft Defender for Cloud** - Native threat detection
- **Microsoft Sentinel** - SIEM with built-in Azure detections
- **Azure Policy** - Preventive controls
- **Privileged Identity Management (PIM)** - Just-in-time access

## References

### Research Papers & Blog Posts
1. **Praetorian** - "Azure RBAC Privilege Escalations: Azure VM" (February 2025)
   - https://www.praetorian.com/blog/azure-rbac-privilege-escalations-azure-vm/

2. **XM Cyber** - "Privilege Escalation and Lateral Movement on Azure" (Parts 1 & 2)
   - Part 1: https://xmcyber.com/blog/privilege-escalation-and-lateral-movement-on-azure-part-1/
   - Part 2: https://xmcyber.com/blog/privilege-escalation-and-lateral-movement-on-azure-part-2/

3. **NetSPI** - "Azure Privilege Escalation Using Managed Identities"
   - https://www.netspi.com/blog/technical-blog/cloud-penetration-testing/azure-privilege-escalation-using-managed-identities/

4. **Orca Security** - "Azure AD & IAM - Leveraging Managed Identities for Privilege Escalation" (Parts II & III)
   - https://orca.security/resources/blog/azure-ad-iam-part-ii-leveraging-managed-identities-for-privilege-escalation/

5. **Check Point** - "Privilege Escalation in Azure: Keep Your Enemies Close and Your Permissions Closer" (2022)
   - https://blog.checkpoint.com/2022/06/08/privilege-escalation-in-azure-keep-your-enemies-close-and-your-permissions-closer/

6. **Silverfort** - "Privilege Escalation in Entra ID (formerly Azure AD)"
   - https://www.silverfort.com/blog/privilege-escalation-in-azure-ad/

7. **Cymulate** - "Exploiting Pass-through Authentication Validation in Azure AD" (2024)
   - https://cymulate.com/blog/exploiting-pta-credential-validation-in-azure-ad/

8. **Mnemonic** - "Abusing Dynamic Groups in Azure AD for Privilege Escalation"
   - https://www.mnemonic.io/resources/blog/abusing-dynamic-groups-in-azure-ad-for-privilege-escalation/

9. **Microsoft MSRC** - "Potential Risk of Privilege Escalation in Azure AD Applications" (2023)
   - https://msrc.microsoft.com/blog/2023/06/potential-risk-of-privilege-escalation-in-azure-ad-applications/

10. **Pwned Labs** - "Climbing the Azure RBAC Ladder"
    - https://blog.pwnedlabs.io/climbing-the-azure-ladder-part-1

11. **Cloud Architekt** - "AzureAD-Attack-Defense" (GitHub Repository)
    - https://github.com/Cloud-Architekt/AzureAD-Attack-Defense

### Microsoft Official Documentation
- **Azure RBAC Documentation**: https://learn.microsoft.com/en-us/azure/role-based-access-control/
- **Managed Identities**: https://learn.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/
- **Microsoft Entra ID Roles**: https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/
- **Azure Threat Research Matrix**: https://microsoft.github.io/Azure-Threat-Research-Matrix/

## Next Steps for Azure Version

### Phase 1: Foundation (Weeks 1-2)
1. Create separate repository: `azure-pathfinding.cloud` or subdirectory structure
2. Adapt schema for Azure-specific fields (control plane, scope, managed identity types)
3. Set up validation scripts for Azure permission format
4. Create initial 10-15 high-impact paths as examples

### Phase 2: Core Paths (Weeks 3-6)
1. Document all managed identity exploitation paths (highest impact)
2. Document Azure RBAC role assignment paths
3. Document Entra ID directory role escalations
4. Document Key Vault and Storage Account paths

### Phase 3: Advanced Paths (Weeks 7-10)
1. Document hybrid scenarios (Azure AD Connect, PTA)
2. Document container/Kubernetes paths
3. Document serverless exploitation (Functions, Logic Apps, Automation)
4. Document cross-tenant and B2B scenarios

### Phase 4: Tooling & Community (Weeks 11-12)
1. Integrate with AzureHound data structures
2. Create detection rule mappings for Microsoft Sentinel
3. Set up GitHub Actions for validation
4. Deploy website for browsing paths

### Community Engagement
- Reach out to Azure security researchers (Karl Fosaaen at NetSPI, Dirk-jan Mollema for ROADtools, etc.)
- Cross-reference with Microsoft's Azure Threat Research Matrix
- Engage with BloodHound/AzureHound community
- Coordinate with Microsoft Security Response Center (MSRC) for responsible disclosure considerations

## Estimated Scope

Based on current research, an Azure version would include approximately:
- **50-70 distinct privilege escalation paths** (vs 30+ AWS paths currently documented)
- **5 primary categories** (same as AWS)
- **Multiple services**: Azure RBAC, Entra ID, Compute, Storage, Key Vault, Automation, Functions, Containers, etc.
- **Hybrid scenarios**: Unique to Azure, adds complexity but critical for real-world environments

## Maintenance Considerations

Azure updates more frequently than AWS in some areas:
- **Entra ID features**: New directory roles, PIM enhancements
- **Managed Identity improvements**: New services supporting managed identities
- **Security controls**: Conditional Access evolution, new Azure Policy definitions
- **Detection capabilities**: Microsoft Defender for Cloud and Sentinel updates

Recommend quarterly reviews of:
1. New Azure services supporting managed identities
2. New Entra ID directory roles
3. Microsoft security research blog posts
4. MSRC security advisories
5. Community tool updates (AzureHound, ROADtools)

---

**Document Version**: 1.0
**Last Updated**: January 2025
**Research By**: Based on community security research 2022-2025
**Status**: Planning phase - not yet implemented
