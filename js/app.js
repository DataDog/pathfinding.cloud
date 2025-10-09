// Main application state
let allPaths = [];
let filteredPaths = [];
let currentView = 'table'; // 'cards' or 'table' - default to table
let sortColumn = null;
let sortDirection = 'asc'; // 'asc' or 'desc'

// DOM elements
const pathsContainer = document.getElementById('paths-container');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');
const serviceFilter = document.getElementById('service-filter');
const resetButton = document.getElementById('reset-filters');
const viewCardsBtn = document.getElementById('view-cards');
const viewTableBtn = document.getElementById('view-table');
const headerTotalPathsEl = document.getElementById('header-total-paths');
const modal = document.getElementById('path-modal');
const modalBody = document.getElementById('modal-body');
const closeModal = document.querySelector('.close');

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    loadPaths();
    setupEventListeners();
    setupTabListeners();
});

// Setup event listeners
function setupEventListeners() {
    searchInput.addEventListener('input', debounce(applyFilters, 300));
    categoryFilter.addEventListener('change', applyFilters);
    serviceFilter.addEventListener('change', applyFilters);
    resetButton.addEventListener('click', resetFilters);
    viewCardsBtn.addEventListener('click', () => switchView('cards'));
    viewTableBtn.addEventListener('click', () => switchView('table'));
    closeModal.addEventListener('click', () => {
        modal.style.display = 'none';
        window.location.hash = '';
    });
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            window.location.hash = '';
        }
    });

    // Handle back/forward navigation
    window.addEventListener('hashchange', handleHashChange);
}

// Switch between card and table view
function switchView(view) {
    currentView = view;

    // Update button states
    if (view === 'cards') {
        viewCardsBtn.classList.add('active');
        viewTableBtn.classList.remove('active');
        pathsContainer.className = 'paths-grid';
    } else {
        viewTableBtn.classList.add('active');
        viewCardsBtn.classList.remove('active');
        pathsContainer.className = 'paths-table-container';
    }

    renderPaths();
}

// Load paths from data files
async function loadPaths() {
    try {
        // In production, this will load from a generated JSON file
        // For now, we'll use the data directory structure
        const paths = await fetchAllPaths();
        allPaths = paths;
        filteredPaths = paths;

        populateServiceFilter();
        updateStats();

        // Set initial view state
        if (currentView === 'table') {
            viewTableBtn.classList.add('active');
            viewCardsBtn.classList.remove('active');
            pathsContainer.className = 'paths-table-container';
        }

        renderPaths();

        // Check if there's a path ID in the URL hash
        if (window.location.hash) {
            handleHashChange();
        }
    } catch (error) {
        console.error('Error loading paths:', error);
        pathsContainer.innerHTML = `
            <div class="no-results">
                <p>Error loading privilege escalation paths</p>
                <p style="font-size: 0.9em;">Please check the console for details</p>
            </div>
        `;
    }
}

// Fetch all path files
async function fetchAllPaths() {
    try {
        // Load paths from the generated JSON file
        const response = await fetch('paths.json');
        if (!response.ok) {
            throw new Error(`Failed to load paths.json: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading paths:', error);
        // Fallback to demo data if paths.json is not available
        console.warn('Falling back to demo data');
        return getDemoData();
    }
}

// Demo data (this would be replaced by actual JSON from YAML conversion)
function getDemoData() {
    return [
        {
            id: 'iam-001',
            name: 'iam:CreatePolicyVersion',
            category: 'self-escalation',
            services: ['iam'],
            permissions: {
                required: [
                    {
                        permission: 'iam:CreatePolicyVersion',
                        resourceConstraints: 'Policy must be attached to actor'
                    }
                ]
            },
            description: 'Anyone with access to iam:CreatePolicyVersion can create a new version of an IAM policy. If a user can create a new version of a policy that is already attached to them, they can grant themselves administrative privileges.',
            exploitationSteps: [
                {
                    step: 1,
                    command: 'aws iam create-policy-version --policy-arn @arn --policy-document file://admin_policy.json --set-as-default',
                    description: 'Create a new policy version with administrative permissions and set it as default'
                }
            ],
            recommendation: 'Restrict access to iam:CreatePolicyVersion using the principle of least privilege. Very few principals need this permission.',
            toolSupport: {
                pmapper: true,
                iamVulnerable: true
            }
        },
        {
            id: 'iam-002',
            name: 'iam:CreateAccessKey',
            category: 'lateral-movement',
            services: ['iam'],
            permissions: {
                required: [
                    {
                        permission: 'iam:CreateAccessKey',
                        resourceConstraints: 'Target IAM user must be in the Resource section'
                    }
                ]
            },
            description: 'Anyone with access to iam:CreateAccessKey can create access keys for any user they have this permission on. This permission is often abused to gain access to another principal.',
            prerequisites: [
                {
                    condition: 'Target user must have fewer than 2 access keys already',
                    type: 'resource-state'
                }
            ],
            exploitationSteps: [
                {
                    step: 1,
                    command: 'aws iam create-access-key --user-name @username',
                    description: 'Create a new access key for the target user'
                }
            ],
            recommendation: 'Restrict access to iam:CreateAccessKey using the principle of least privilege. Only allow users to create access keys for themselves.',
            toolSupport: {
                pmapper: true,
                iamVulnerable: true
            }
        }
    ];
}

// Populate service filter dropdown
function populateServiceFilter() {
    const services = new Set();
    allPaths.forEach(path => {
        path.services.forEach(service => services.add(service));
    });

    serviceFilter.innerHTML = '<option value="">All Services</option>';
    Array.from(services).sort().forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service.toUpperCase();
        serviceFilter.appendChild(option);
    });
}

// Apply filters
function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase();
    const selectedCategory = categoryFilter.value;
    const selectedService = serviceFilter.value;

    filteredPaths = allPaths.filter(path => {
        // Search filter
        const matchesSearch = !searchTerm ||
            path.name.toLowerCase().includes(searchTerm) ||
            path.description.toLowerCase().includes(searchTerm) ||
            path.id.toLowerCase().includes(searchTerm) ||
            path.services.some(s => s.toLowerCase().includes(searchTerm));

        // Category filter
        const matchesCategory = !selectedCategory || path.category === selectedCategory;

        // Service filter
        const matchesService = !selectedService || path.services.includes(selectedService);

        return matchesSearch && matchesCategory && matchesService;
    });

    updateStats();
    renderPaths();
}

// Reset all filters
function resetFilters() {
    searchInput.value = '';
    categoryFilter.value = '';
    serviceFilter.value = '';
    applyFilters();
}

// Update statistics
function updateStats() {
    headerTotalPathsEl.textContent = allPaths.length;
}

// Render paths to the grid or table
function renderPaths() {
    if (filteredPaths.length === 0) {
        pathsContainer.innerHTML = `
            <div class="no-results">
                <p>No privilege escalation paths found</p>
                <p style="font-size: 0.9em;">Try adjusting your filters or search terms</p>
            </div>
        `;
        return;
    }

    if (currentView === 'cards') {
        pathsContainer.innerHTML = filteredPaths.map(path => createPathCard(path)).join('');

        // Add click event listeners
        document.querySelectorAll('.path-card').forEach((card, index) => {
            card.addEventListener('click', () => showPathDetails(filteredPaths[index]));
        });
    } else {
        pathsContainer.innerHTML = createPathTable(filteredPaths);

        // Add click event listeners for rows
        document.querySelectorAll('.paths-table tbody tr').forEach((row, index) => {
            row.addEventListener('click', () => showPathDetails(filteredPaths[index]));
        });

        // Add click event listeners for sortable headers
        document.querySelectorAll('.paths-table th.sortable').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.getAttribute('data-sort');
                sortTable(column);
            });
        });
    }
}

// Sort table by column
function sortTable(column) {
    // Toggle direction if clicking the same column
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }

    // Sort the filtered paths
    filteredPaths.sort((a, b) => {
        let aVal, bVal;

        switch (column) {
            case 'id':
                aVal = a.id.toLowerCase();
                bVal = b.id.toLowerCase();
                break;
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            case 'category':
                aVal = a.category.toLowerCase();
                bVal = b.category.toLowerCase();
                break;
            default:
                return 0;
        }

        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    renderPaths();
}

// Create a path card HTML
function createPathCard(path) {
    const categoryClass = `category-${path.category}`;

    return `
        <div class="path-card">
            <div class="path-card-header">
                <span class="path-id">${path.id.toUpperCase()}</span>
                <span class="path-category ${categoryClass}">${formatCategory(path.category)}</span>
            </div>
            <div class="path-name">${escapeHtml(path.name)}</div>
            <div class="path-description">${escapeHtml(path.description)}</div>
        </div>
    `;
}

// Create table view HTML
function createPathTable(paths) {
    const getSortIcon = (column) => {
        if (sortColumn !== column) return '↕';
        return sortDirection === 'asc' ? '↑' : '↓';
    };

    const getSortClass = (column) => {
        return sortColumn === column ? 'sorted' : '';
    };

    return `
        <table class="paths-table">
            <thead>
                <tr>
                    <th class="sortable ${getSortClass('id')}" data-sort="id">
                        Path ID <span class="sort-icon">${getSortIcon('id')}</span>
                    </th>
                    <th class="sortable ${getSortClass('name')}" data-sort="name">
                        Path Name <span class="sort-icon">${getSortIcon('name')}</span>
                    </th>
                    <th>Services</th>
                    <th class="sortable ${getSortClass('category')}" data-sort="category">
                        Category <span class="sort-icon">${getSortIcon('category')}</span>
                    </th>
                </tr>
            </thead>
            <tbody>
                ${paths.map(path => {
                    const categoryClass = `category-${path.category}`;
                    return `
                        <tr>
                            <td class="table-id">${path.id.toUpperCase()}</td>
                            <td class="table-name">${escapeHtml(path.name)}</td>
                            <td class="table-services">
                                ${path.services.map(s => `<span class="service-tag">${s}</span>`).join('')}
                            </td>
                            <td>
                                <span class="path-category ${categoryClass}">${formatCategory(path.category)}</span>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Show path details in modal
function showPathDetails(path) {
    // Update URL with path ID
    window.location.hash = path.id;

    const html = `
        <h2>${escapeHtml(path.name)}</h2>
        <p><strong>ID:</strong> ${path.id.toUpperCase()}</p>
        <p><strong>Category:</strong> ${formatCategory(path.category)}</p>
        <p><strong>Services:</strong> ${path.services.map(s => `<code>${s}</code>`).join(', ')}</p>

        <div class="modal-section">
            <h3>Description</h3>
            <div>${renderMarkdown(path.description)}</div>
        </div>

        ${path.discoveredBy ? `
            <div class="modal-section">
                <h3>Discovered By</h3>
                <p>
                    ${escapeHtml(path.discoveredBy.name)}${path.discoveredBy.organization ? ` (${escapeHtml(path.discoveredBy.organization)})` : ''}${path.discoveredBy.date ? `, ${escapeHtml(path.discoveredBy.date)}` : ''}
                </p>
            </div>
        ` : ''}

        <div class="modal-section">
            <h3>Permissions</h3>
            ${renderPermissions(path.permissions || (path.requiredPermissions ? { required: path.requiredPermissions } : null))}
        </div>

        ${path.prerequisites ? `
            <div class="modal-section">
                <h3>Prerequisites</h3>
                ${renderPrerequisites(path.prerequisites)}
            </div>
        ` : ''}

        ${path.limitations ? `
            <div class="modal-section">
                <h3>⚠️ Limitations</h3>
                <p style="white-space: pre-wrap;">${escapeHtml(path.limitations)}</p>
            </div>
        ` : ''}

        <div class="modal-section">
            <h3>Exploitation Steps</h3>
            ${renderExploitationSteps(path.exploitationSteps)}
        </div>

        <div class="modal-section">
            <h3>Recommended Remediation</h3>
            <div>${renderMarkdown(path.recommendation)}</div>
        </div>

        ${path.toolSupport ? `
            <div class="modal-section">
                <h3>Tool Support</h3>
                <div class="tool-support">
                    ${Object.entries(path.toolSupport).map(([tool, supported]) => `
                        <span class="tool-badge ${supported ? 'tool-supported' : 'tool-not-supported'}">
                            ${tool}: ${supported ? '✓' : '✗'}
                        </span>
                    `).join('')}
                </div>
            </div>
        ` : ''}

        ${path.references ? `
            <div class="modal-section">
                <h3>References</h3>
                <ul>
                    ${path.references.map(ref => `
                        <li><a href="${escapeHtml(ref.url)}" target="_blank">${escapeHtml(ref.title)}</a></li>
                    `).join('')}
                </ul>
            </div>
        ` : ''}

        ${path.relatedPaths ? `
            <div class="modal-section">
                <h3>Related Paths</h3>
                <p>${path.relatedPaths.map(id => `<code>${id}</code>`).join(', ')}</p>
            </div>
        ` : ''}
    `;

    modalBody.innerHTML = html;
    modal.style.display = 'block';
}

// Utility functions
function formatCategory(category) {
    return category.split('-').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    // Simple markdown renderer for code blocks
    let html = escapeHtml(text);

    // Convert ```language\ncode\n``` to <pre><code>code</code></pre>
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Convert inline `code` to <code>code</code>
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Preserve line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

// Render exploitation steps with tabs for different tools
function renderExploitationSteps(steps) {
    // Check if new format (dict) or legacy format (list)
    if (Array.isArray(steps)) {
        // Legacy format: render as simple list
        return steps.map(step => `
            <div class="step-item">
                <span class="step-number">Step ${step.step}</span>
                <pre><code>${escapeHtml(step.command)}</code></pre>
                <p>${escapeHtml(step.description)}</p>
            </div>
        `).join('');
    }

    // New format: render with tabs
    const tools = Object.keys(steps);
    if (tools.length === 0) return '<p>No exploitation steps available</p>';

    // Tool display names
    const toolNames = {
        'awscli': 'AWS CLI',
        'pacu': 'Pacu',
        'pmapper': 'PMapper',
        'stratus': 'Stratus',
        'leonidas': 'Leonidas',
        'nebula': 'Nebula',
        'pathfinder': 'Pathfinder'
    };

    const uniqueId = `tabs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const tabsHtml = tools.map((tool, index) => `
        <button class="tab-button ${index === 0 ? 'active' : ''}"
                data-tab-target="${uniqueId}-${tool}"
                data-tab-group="${uniqueId}">
            ${toolNames[tool] || tool}
        </button>
    `).join('');

    const contentHtml = tools.map((tool, index) => `
        <div id="${uniqueId}-${tool}" class="tab-content ${index === 0 ? 'active' : ''}" data-tab-group="${uniqueId}">
            ${steps[tool].map(step => `
                <div class="step-item">
                    <div class="step-header"><span class="step-number">Step ${step.step}</span> - ${escapeHtml(step.description)}</div>
                    <pre><code>${escapeHtml(step.command)}</code></pre>
                </div>
            `).join('')}
        </div>
    `).join('');

    return `
        <div class="tabs-container">
            <div class="tabs">
                ${tabsHtml}
            </div>
            <div class="tabs-content">
                ${contentHtml}
            </div>
        </div>
    `;
}

// Render prerequisites with tabs for admin/lateral or simple list
function renderPrerequisites(prerequisites) {
    // Check if new format (dict) or legacy format (array)
    if (Array.isArray(prerequisites)) {
        // Legacy format: render as simple list
        return `
            <ul>
                ${prerequisites.map(p => `
                    <li>${escapeHtml(typeof p === 'string' ? p : (p.condition || p))}</li>
                `).join('')}
            </ul>
        `;
    }

    // New format: render with tabs
    const tabs = Object.keys(prerequisites);
    if (tabs.length === 0) return '<p>No prerequisites specified</p>';

    // Tab display names
    const tabNames = {
        'admin': 'Admin Access',
        'lateral': 'Lateral Movement'
    };

    // Find unique prerequisites for each tab (for highlighting)
    const lateralSet = prerequisites.lateral ? new Set(prerequisites.lateral) : new Set();
    const adminSet = prerequisites.admin ? new Set(prerequisites.admin) : new Set();

    const uniqueId = `prereq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const tabsHtml = tabs.map((tab, index) => `
        <button class="tab-button ${index === 0 ? 'active' : ''}"
                data-tab-target="${uniqueId}-${tab}"
                data-tab-group="${uniqueId}">
            ${tabNames[tab] || tab}
        </button>
    `).join('');

    const contentHtml = tabs.map((tab, index) => `
        <div id="${uniqueId}-${tab}" class="tab-content ${index === 0 ? 'active' : ''}" data-tab-group="${uniqueId}">
            <ul>
                ${prerequisites[tab].map(prereq => {
                    // Check if this prereq is unique to this tab
                    let isUnique = false;
                    if (tab === 'admin' && !lateralSet.has(prereq)) {
                        isUnique = true;
                    } else if (tab === 'lateral' && !adminSet.has(prereq)) {
                        isUnique = true;
                    }

                    return `<li${isUnique ? ' class="unique-prereq"' : ''}>${escapeHtml(prereq)}</li>`;
                }).join('')}
            </ul>
        </div>
    `).join('');

    return `
        <div class="tabs-container">
            <div class="tabs">
                ${tabsHtml}
            </div>
            <div class="tabs-content">
                ${contentHtml}
            </div>
        </div>
    `;
}

// Render permissions with tabs for required/additional
function renderPermissions(permissions) {
    // Safety check
    if (!permissions) {
        return '<p>No permissions data available</p>';
    }

    // Handle legacy format (direct array as requiredPermissions)
    if (Array.isArray(permissions)) {
        return `
            <table class="permissions-table">
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Resource Constraints</th>
                    </tr>
                </thead>
                <tbody>
                    ${permissions.map(p => `
                        <tr>
                            <td><code>${escapeHtml(p.permission)}</code></td>
                            <td>${p.resourceConstraints ? escapeHtml(p.resourceConstraints) : '<em>None</em>'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    // New format with required/additional tabs
    const hasRequired = permissions.required && Array.isArray(permissions.required) && permissions.required.length > 0;
    const hasAdditional = permissions.additional && Array.isArray(permissions.additional) && permissions.additional.length > 0;

    if (!hasRequired && !hasAdditional) {
        return '<p>No permissions specified</p>';
    }

    // If only required permissions, show without tabs
    if (hasRequired && !hasAdditional) {
        return `
            <p style="margin-bottom: 15px; color: #666;">These are the only permissions needed by the principal that is exploiting this path. Additional get/list type permissions might be needed to exploit this in practice, but these could come from an additional principal that has more read level access.</p>
            <table class="permissions-table">
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Resource Constraints</th>
                    </tr>
                </thead>
                <tbody>
                    ${permissions.required.map(p => `
                        <tr>
                            <td><code>${escapeHtml(p.permission)}</code></td>
                            <td>${p.resourceConstraints ? escapeHtml(p.resourceConstraints) : '<em>None</em>'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    // Show tabs for required and additional
    const uniqueId = `perms-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const tabsHtml = `
        <button class="tab-button active"
                data-tab-target="${uniqueId}-required"
                data-tab-group="${uniqueId}">
            Minimum Permissions Required
        </button>
        ${hasAdditional ? `
            <button class="tab-button"
                    data-tab-target="${uniqueId}-additional"
                    data-tab-group="${uniqueId}">
                Helpful Additional Permissions
            </button>
        ` : ''}
    `;

    const contentHtml = `
        <div id="${uniqueId}-required" class="tab-content active" data-tab-group="${uniqueId}">
            <p style="margin-bottom: 15px; color: #666;">These are the only permissions needed by the principal that is exploiting this path. Additional get/list type permissions might be needed to exploit this in practice, but these could come from an additional principal that has more read level access. Those additional permissions are shown in the next tab.</p>
            <table class="permissions-table">
                <thead>
                    <tr>
                        <th>Permission</th>
                        <th>Resource Constraints</th>
                    </tr>
                </thead>
                <tbody>
                    ${permissions.required.map(p => `
                        <tr>
                            <td><code>${escapeHtml(p.permission)}</code></td>
                            <td>${p.resourceConstraints ? escapeHtml(p.resourceConstraints) : '<em>None</em>'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ${hasAdditional ? `
            <div id="${uniqueId}-additional" class="tab-content" data-tab-group="${uniqueId}">
                <p style="margin-bottom: 15px; color: #666;">These permissions are helpful for discovering and exploiting this path but are not strictly required. They could come from a separate read-only principal.</p>
                <table class="permissions-table">
                    <thead>
                        <tr>
                            <th>Permission</th>
                            <th>Resource Constraints</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${permissions.additional.map(p => `
                            <tr>
                                <td><code>${escapeHtml(p.permission)}</code></td>
                                <td>${p.resourceConstraints ? escapeHtml(p.resourceConstraints) : '<em>None</em>'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : ''}
    `;

    return `
        <div class="tabs-container">
            <div class="tabs">
                ${tabsHtml}
            </div>
            <div class="tabs-content">
                ${contentHtml}
            </div>
        </div>
    `;
}

// Setup tab event delegation when modal opens
function setupTabListeners() {
    // Remove existing listener if any
    document.removeEventListener('click', handleTabClick);
    // Add new listener
    document.addEventListener('click', handleTabClick);
}

// Handle tab clicks
function handleTabClick(event) {
    const tabButton = event.target.closest('.tab-button');
    if (!tabButton) return;

    const targetId = tabButton.getAttribute('data-tab-target');
    const tabGroup = tabButton.getAttribute('data-tab-group');

    if (!targetId || !tabGroup) return;

    // Hide all tab content in this group
    const tabContents = document.querySelectorAll(`.tab-content[data-tab-group="${tabGroup}"]`);
    tabContents.forEach(content => content.classList.remove('active'));

    // Remove active class from all buttons in this group
    const tabButtons = document.querySelectorAll(`.tab-button[data-tab-group="${tabGroup}"]`);
    tabButtons.forEach(button => button.classList.remove('active'));

    // Show selected tab content
    const targetContent = document.getElementById(targetId);
    if (targetContent) {
        targetContent.classList.add('active');
    }

    // Activate clicked button
    tabButton.classList.add('active');
}

// Handle URL hash changes (for direct links and back/forward navigation)
function handleHashChange() {
    const pathId = window.location.hash.substring(1); // Remove the '#'

    if (!pathId) {
        // No hash, close modal if open
        modal.style.display = 'none';
        return;
    }

    // Find the path with this ID
    const path = allPaths.find(p => p.id === pathId);

    if (path) {
        showPathDetails(path);
    } else {
        // Invalid path ID, clear hash
        window.location.hash = '';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
