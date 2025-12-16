// Main application state
let allPaths = [];
let filteredPaths = [];
let toolMetadata = {}; // Detection tool metadata from metadata.json
// Default to cards on mobile (<=768px), table on desktop
let currentView = window.innerWidth <= 768 ? 'cards' : 'table';
let sortColumn = null;
let sortDirection = 'asc'; // 'asc' or 'desc'
let currentRoute = { view: 'list', pathId: null }; // Track current route

// Category tooltips
const categoryTooltips = {
    'self-escalation': 'Modify your own permissions directly',
    'principal-access': 'Gain access to a different principal',
    'new-passrole': 'Create a new resource. Pass a privileged role to it. Gain access to that role',
    'existing-passrole': 'Modify an existing resource with an attached role, and gain access to that role',
    'credential-access': 'Read permissions that may expose credentials'
};

// DOM elements
const pathsContainer = document.getElementById('paths-container');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');
const serviceFilter = document.getElementById('service-filter');
const detectionFilter = document.getElementById('detection-filter');
const resetButton = document.getElementById('reset-filters');
const viewCardsBtn = document.getElementById('view-cards');
const viewTableBtn = document.getElementById('view-table');
const totalPathsCountEl = document.getElementById('total-paths-count');
const filteredPathsCountEl = document.getElementById('filtered-paths-count');
const themeToggle = document.getElementById('theme-toggle');

// Theme management
function initTheme() {
    // Check localStorage for saved theme, default to light
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-theme');
    }
    updateThemeText();
}

function toggleTheme() {
    document.documentElement.classList.toggle('light-theme');
    const currentTheme = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
    localStorage.setItem('theme', currentTheme);
    updateThemeText();
}

function updateThemeText() {
    const themeText = document.querySelector('.theme-text');
    if (themeText) {
        const isLight = document.documentElement.classList.contains('light-theme');
        themeText.textContent = isLight ? 'Mode' : 'Mode';
    }
}

// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();
    setupTabListeners();
    setupInstantTooltips(); // Setup tooltips for detection circles and category chips
    loadPaths(); // This will call initRouter() when data is loaded
});

// Setup event listeners
function setupEventListeners() {
    searchInput.addEventListener('input', debounce(applyFilters, 300));
    categoryFilter.addEventListener('change', applyFilters);
    serviceFilter.addEventListener('change', applyFilters);
    detectionFilter.addEventListener('change', applyFilters);
    resetButton.addEventListener('click', resetFilters);
    viewCardsBtn.addEventListener('click', () => switchView('cards'));
    viewTableBtn.addEventListener('click', () => switchView('table'));
    themeToggle.addEventListener('click', toggleTheme);

    // Handle browser back/forward navigation
    window.addEventListener('popstate', handlePopState);

    // Handle backward compatibility: redirect old hash URLs to new format
    window.addEventListener('hashchange', handleLegacyHashRedirect);
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
        // Load both paths and tool metadata
        const [paths, metadata] = await Promise.all([
            fetchAllPaths(),
            fetchMetadata()
        ]);
        allPaths = paths;
        filteredPaths = paths;
        toolMetadata = metadata.detectionTools || {};

        populateServiceFilter();
        updateStats();

        // Set initial view state
        if (currentView === 'table') {
            viewTableBtn.classList.add('active');
            viewCardsBtn.classList.remove('active');
            pathsContainer.className = 'paths-table-container';
        } else {
            viewCardsBtn.classList.add('active');
            viewTableBtn.classList.remove('active');
            pathsContainer.className = 'paths-grid';
        }

        renderPaths();

        // Initialize router AFTER paths are loaded
        initRouter();
    } catch (error) {
        pathsContainer.innerHTML = `
            <div class="no-results">
                <p>Error loading privilege escalation paths</p>
                <p style="font-size: 0.9em;">Please check the console for details</p>
            </div>
        `;
    }
}

// Router functions
function initRouter() {
    // Check if we were redirected from 404.html (GitHub Pages SPA routing pattern)
    // When a user accesses a direct URL like /paths/iam-001, GitHub Pages serves 404.html
    // The 404.html captures the path and redirects to index.html with the path in sessionStorage
    const redirectPath = sessionStorage.getItem('redirectPath');
    if (redirectPath) {
        sessionStorage.removeItem('redirectPath');
        history.replaceState(null, '', redirectPath);
    }

    // Check for legacy hash URLs and redirect
    if (window.location.hash) {
        const pathId = window.location.hash.substring(1);
        if (pathId) {
            // Redirect to new URL format
            history.replaceState(null, '', `/paths/${pathId}`);
        }
    }

    // Route to the current URL
    routeFromURL();
}

function routeFromURL() {
    const pathname = window.location.pathname;

    // Check if it's a path detail URL: /paths/{id}
    // Match format: /paths/{service}-{number} where service can have letters/numbers/hyphens
    const pathMatch = pathname.match(/^\/paths\/([a-z0-9-]+)$/);

    if (pathMatch) {
        const pathId = pathMatch[1];
        const path = allPaths.find(p => p.id === pathId);

        if (path) {
            // Track view change in Datadog RUM
            if (window.DD_RUM) {
                window.DD_RUM.startView({
                    name: `/paths/${pathId}`,
                    service: 'pathfinding.cloud'
                });
            }
            currentRoute = { view: 'detail', pathId };
            showPathDetails(path);
        } else {
            // Invalid path ID, redirect to list
            navigateToList();
        }
    } else if (pathname === '/paths' || pathname === '/paths/') {
        // Paths list view
        // Track view change in Datadog RUM
        if (window.DD_RUM) {
            window.DD_RUM.startView({
                name: '/paths/',
                service: 'pathfinding.cloud'
            });
        }
        currentRoute = { view: 'list', pathId: null };
        showListView();
    } else {
        // Home/landing view
        // Track view change in Datadog RUM
        if (window.DD_RUM) {
            window.DD_RUM.startView({
                name: '/',
                service: 'pathfinding.cloud'
            });
        }
        currentRoute = { view: 'list', pathId: null };
        showListView();
    }
}

function handlePopState(event) {
    // Handle browser back/forward buttons
    routeFromURL();
}

function handleLegacyHashRedirect() {
    // Redirect old hash-based URLs (#iam-001) to new format (/paths/iam-001)
    // But ignore section anchors (like #permissions, #description)
    const hash = window.location.hash.substring(1);
    if (hash) {
        // Only redirect if it matches path ID format: service-### (e.g., iam-001)
        const pathIdPattern = /^[a-z0-9]+-\d{3}$/i;
        if (pathIdPattern.test(hash)) {
            history.replaceState(null, '', `/paths/${hash}`);
            routeFromURL();
        }
        // Otherwise, it's a section anchor, let the browser handle it normally
    }
}

function navigateToPath(pathId) {
    const path = allPaths.find(p => p.id === pathId);
    if (!path) return;

    // Update URL
    history.pushState(null, '', `/paths/${pathId}`);

    // Track view change in Datadog RUM
    if (window.DD_RUM) {
        window.DD_RUM.startView({
            name: `/paths/${pathId}`,
            service: 'pathfinding.cloud'
        });
    }

    // Update route state
    currentRoute = { view: 'detail', pathId };

    // Show detail view
    showPathDetails(path);

    // Track pageview for analytics
    trackPageView(`/paths/${pathId}`, `${path.name} - pathfinding.cloud`);
}

function navigateToList() {
    // Update URL
    history.pushState(null, '', '/paths/');

    // Track view change in Datadog RUM
    if (window.DD_RUM) {
        window.DD_RUM.startView({
            name: '/paths/',
            service: 'pathfinding.cloud'
        });
    }

    // Update route state
    currentRoute = { view: 'list', pathId: null };

    // Show list view
    showListView();

    // Track pageview for analytics
    trackPageView('/paths/', 'pathfinding.cloud - AWS IAM Privilege Escalation Paths');
}

function showListView() {
    // Hide detail view, show list view
    const listView = document.getElementById('list-view');
    const detailView = document.getElementById('detail-view');
    const nav = document.querySelector('nav.container'); // Target search/filter nav specifically

    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    if (nav) nav.style.display = 'block';

    // Update page title
    document.title = 'pathfinding.cloud - AWS IAM Privilege Escalation Paths';

    // Update meta description
    updateMetaTag('description', 'Comprehensive library of AWS IAM privilege escalation paths, techniques, and mitigations');
}

function trackPageView(path, title) {
    // Update page title
    document.title = title;

    // Track with Plausible if available
    if (typeof plausible === 'function') {
        plausible('pageview', { props: { path, title } });
    }
}

function updateMetaTag(name, content) {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', name);
        document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
}

function updateOpenGraphTags(path) {
    // Update Open Graph tags for social sharing
    const tags = {
        'og:title': `${path.name} - pathfinding.cloud`,
        'og:description': path.description.substring(0, 200) + '...',
        'og:url': `${window.location.origin}/paths/${path.id}`,
        'twitter:card': 'summary_large_image',
        'twitter:title': `${path.name} - pathfinding.cloud`,
        'twitter:description': path.description.substring(0, 200) + '...'
    };

    Object.entries(tags).forEach(([property, content]) => {
        let meta = document.querySelector(`meta[property="${property}"]`) ||
                   document.querySelector(`meta[name="${property}"]`);
        if (!meta) {
            meta = document.createElement('meta');
            if (property.startsWith('og:')) {
                meta.setAttribute('property', property);
            } else {
                meta.setAttribute('name', property);
            }
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', content);
    });
}

// Fetch all path files
async function fetchAllPaths() {
    try {
        // Load paths from the generated JSON file
        const response = await fetch('/paths.json');
        if (!response.ok) {
            throw new Error(`Failed to load paths.json: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        // Fallback to demo data if paths.json is not available
        return getDemoData();
    }
}

async function fetchMetadata() {
    try {
        const response = await fetch('/metadata.json');
        if (!response.ok) {
            throw new Error(`Failed to load metadata.json: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        return { detectionTools: {} };
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
            category: 'principal-access',
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
    const selectedDetection = detectionFilter.value;

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

        // Detection filter
        let matchesDetection = true;
        if (selectedDetection) {
            if (selectedDetection === 'none') {
                // Show paths with no detection tools
                matchesDetection = !path.detectionTools || Object.keys(path.detectionTools).length === 0;
            } else {
                // Show paths that have the selected detection tool
                matchesDetection = path.detectionTools && path.detectionTools[selectedDetection];
            }
        }

        return matchesSearch && matchesCategory && matchesService && matchesDetection;
    });

    updateStats();
    renderPaths();
}

// Reset all filters
function resetFilters() {
    searchInput.value = '';
    categoryFilter.value = '';
    serviceFilter.value = '';
    detectionFilter.value = '';
    applyFilters();
}

// Update statistics
function updateStats() {
    if (totalPathsCountEl) {
        totalPathsCountEl.textContent = allPaths.length;
    }
    if (filteredPathsCountEl) {
        filteredPathsCountEl.textContent = filteredPaths.length;
    }
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
            card.addEventListener('click', (e) => handlePathClick(e, filteredPaths[index]));
            card.addEventListener('mousedown', (e) => {
                // Handle middle-click
                if (e.button === 1) {
                    e.preventDefault();
                    openPathInNewTab(filteredPaths[index]);
                }
            });
        });
    } else {
        pathsContainer.innerHTML = createPathTable(filteredPaths);

        // Add click event listeners for rows
        document.querySelectorAll('.paths-table tbody tr').forEach((row, index) => {
            row.addEventListener('click', (e) => handlePathClick(e, filteredPaths[index]));
            row.addEventListener('mousedown', (e) => {
                // Handle middle-click
                if (e.button === 1) {
                    e.preventDefault();
                    openPathInNewTab(filteredPaths[index]);
                }
            });
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
                <span class="path-category ${categoryClass}" data-category-tooltip="${categoryTooltips[path.category] || ''}">${formatCategory(path.category)}</span>
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
                    <th class="sortable ${getSortClass('category')}" data-sort="category">
                        Category <span class="sort-icon">${getSortIcon('category')}</span>
                    </th>
                    <th>OSS Detection</th>
                </tr>
            </thead>
            <tbody>
                ${paths.map(path => {
                    const categoryClass = `category-${path.category}`;
                    // Get detection tools for this path
                    const detectionTools = path.detectionTools ? Object.keys(path.detectionTools) : [];

                    return `
                        <tr>
                            <td class="table-id-cell">
                                <div class="table-id">${path.id.toUpperCase()}</div>
                                <div class="table-services">
                                    ${path.services.map(s => `<span class="service-tag">${s}</span>`).join('')}
                                </div>
                            </td>
                            <td class="table-name">${escapeHtml(path.name)}</td>
                            <td class="table-category">
                                <span class="path-category ${categoryClass}" data-category-tooltip="${categoryTooltips[path.category] || ''}">${formatCategory(path.category)}</span>
                            </td>
                            <td class="table-detection">
                                ${detectionTools.length > 0 ?
                                    detectionTools.map(tool => {
                                        const toolInfo = toolMetadata[tool] || { name: tool };
                                        return `<span class="detection-tool-circle" data-tool="${tool}" data-tool-name="${toolInfo.name || tool}">${getToolInitials(tool)}</span>`;
                                    }).join('')
                                    : '<span class="no-detection">—</span>'}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Setup instant tooltips for detection circles and category chips
let tooltipsInitialized = false;
function setupInstantTooltips() {
    // Only initialize once
    if (tooltipsInitialized) return;
    tooltipsInitialized = true;

    // Create tooltip element (reuse single element)
    const tooltip = document.createElement('div');
    tooltip.className = 'detection-tooltip';
    document.body.appendChild(tooltip);

    // Use event delegation for hover on detection circles and category chips
    document.body.addEventListener('mouseover', (e) => {
        const circle = e.target.closest('.detection-tool-circle');
        const category = e.target.closest('.path-category');

        if (circle) {
            const toolName = circle.getAttribute('data-tool-name');
            if (toolName) {
                tooltip.textContent = toolName;

                // Position tooltip above the circle
                const rect = circle.getBoundingClientRect();
                tooltip.style.left = `${rect.left + rect.width / 2}px`;
                tooltip.style.top = `${rect.top - 10}px`;
                tooltip.style.transform = 'translate(-50%, -100%)';

                // Show immediately
                tooltip.classList.add('visible');
            }
        } else if (category) {
            const categoryTooltip = category.getAttribute('data-category-tooltip');
            if (categoryTooltip) {
                tooltip.textContent = categoryTooltip;

                // Position tooltip above the category chip
                const rect = category.getBoundingClientRect();
                tooltip.style.left = `${rect.left + rect.width / 2}px`;
                tooltip.style.top = `${rect.top - 10}px`;
                tooltip.style.transform = 'translate(-50%, -100%)';

                // Show immediately
                tooltip.classList.add('visible');
            }
        }
    });

    document.body.addEventListener('mouseout', (e) => {
        const circle = e.target.closest('.detection-tool-circle');
        const category = e.target.closest('.path-category');

        if (circle || category) {
            tooltip.classList.remove('visible');
        }
    });
}

// Handle path click with modifier keys
function handlePathClick(event, path) {
    // Check if Ctrl (Windows/Linux) or Cmd (Mac) is pressed, or if it's a middle-click
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        openPathInNewTab(path);
    } else {
        event.preventDefault();
        navigateToPath(path.id);
    }
}

// Open path in a new tab
function openPathInNewTab(path) {
    const url = `${window.location.origin}/paths/${path.id}`;
    window.open(url, '_blank');
}

// Show path details in full-page view
function showPathDetails(path) {
    // Hide list view and search/filter nav, show detail view
    const listView = document.getElementById('list-view');
    const detailView = document.getElementById('detail-view');
    const detailContent = document.getElementById('detail-content');
    const nav = document.querySelector('nav.container'); // Target search/filter nav specifically

    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    if (nav) nav.style.display = 'none';

    // Update page title and meta tags
    document.title = `${path.name} - pathfinding.cloud`;
    updateMetaTag('description', path.description.substring(0, 160));
    updateOpenGraphTags(path);

    // Render breadcrumb
    const breadcrumbHtml = `
        <nav class="breadcrumb">
            <a href="/paths/" onclick="event.preventDefault(); navigateToList();">All Paths</a>
            <span class="breadcrumb-separator">></span>
            <span class="breadcrumb-current">${escapeHtml(path.name)}</span>
        </nav>
    `;

    // Render path details
    const html = `
        ${breadcrumbHtml}

        <h1 class="detail-title">${escapeHtml(path.name)}</h1>

        <div class="detail-top-metadata">
            <div class="metadata-item">
                <span class="metadata-label">ID:</span>
                <span class="metadata-value metadata-id">${path.id.toUpperCase()}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Services:</span>
                <span class="metadata-value">${path.services.map(s => `<span class="service-tag">${s}</span>`).join('')}</span>
            </div>
            <div class="metadata-item">
                <span class="metadata-label">Category:</span>
                <span class="path-category category-${path.category}" data-category-tooltip="${categoryTooltips[path.category] || ''}">${formatCategory(path.category)}</span>
            </div>
        </div>

        <div class="detail-section">
            ${createHeadingWithAnchor('Description')}
            <div>${renderMarkdown(path.description)}</div>
        </div>

        ${path.attackVisualization ? `
            <div class="detail-section">
                <h2 id="attack-visualization" class="heading-with-anchor">
                    Attack Visualization
                    <a href="#attack-visualization" class="heading-anchor" aria-label="Anchor link for: Attack Visualization">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z"/>
                        </svg>
                    </a>
                    <button class="fullscreen-viz-btn" onclick="openFullscreenVisualization('${path.id}')" title="Open in fullscreen">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/>
                        </svg>
                    </button>
                </h2>
                <div class="attack-viz-container" id="attack-viz-${path.id}"></div>
            </div>
        ` : ''}

        <div class="detail-section">
            ${createHeadingWithAnchor('Permissions')}
            ${renderPermissions(path.permissions || (path.requiredPermissions ? { required: path.requiredPermissions } : null))}
        </div>

        ${path.prerequisites ? `
            <div class="detail-section">
                ${createHeadingWithAnchor('Prerequisites')}
                ${renderPrerequisites(path.prerequisites, path.limitations)}
            </div>
        ` : ''}

        <div class="detail-section">
            ${createHeadingWithAnchor('Exploitation Steps')}
            ${renderExploitationSteps(path.exploitationSteps)}
        </div>

        ${path.learningEnvironments ? `
            <div class="detail-section">
                ${createHeadingWithAnchor('Learning Environment Options')}
                ${renderLearningEnvironments(path.learningEnvironments)}
            </div>
        ` : ''}

        <div class="detail-section">
            ${createHeadingWithAnchor('Detection Coverage (Open Source Tools)')}
            ${renderDetectionTools(path.detectionTools)}
        </div>

        <div class="detail-section">
            ${createHeadingWithAnchor('Recommended Remediation')}
            <div class="boxed-section">
                ${renderMarkdown(path.recommendation)}
            </div>
        </div>

        ${path.discoveryAttribution ? `
            <div class="detail-section">
                ${createHeadingWithAnchor('Discovery Attribution')}
                <div class="boxed-section">
                    ${renderDiscoveryAttribution(path.discoveryAttribution)}
                </div>
            </div>
        ` : path.discoveredBy ? `
            <div class="detail-section">
                ${createHeadingWithAnchor('Discovered By')}
                <p>
                    ${escapeHtml(path.discoveredBy.name)}${path.discoveredBy.organization ? ` (${escapeHtml(path.discoveredBy.organization)})` : ''}${path.discoveredBy.date ? `, ${escapeHtml(path.discoveredBy.date)}` : ''}
                </p>
            </div>
        ` : ''}

        ${path.references ? `
            <div class="detail-section">
                ${createHeadingWithAnchor('References')}
                <div class="boxed-section">
                    <ul>
                        ${path.references.map(ref => `
                            <li><a href="${escapeHtml(ref.url)}" target="_blank">${escapeHtml(ref.title)}</a></li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        ` : ''}

        ${renderGitMetadata(path)}
    `;

    detailContent.innerHTML = html;

    // Handle anchor scrolling if present in URL
    const hash = window.location.hash;
    if (hash) {
        // Wait for content to render, then scroll to anchor
        setTimeout(() => {
            const element = document.querySelector(hash);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    } else {
        // Scroll to top if no anchor
        window.scrollTo(0, 0);
    }

    // Render attack visualization if present
    if (path.attackVisualization && window.vis) {
        setTimeout(() => {
            renderAttackVisualization(path.id, path.attackVisualization);
        }, 10);
    }
}

// Calculate hierarchical levels for nodes based on edges
function calculateHierarchicalLevels(nodes, edges) {
    const levels = {};
    const nodeToLevel = {};

    // Find nodes with no incoming edges (root nodes)
    const incomingEdges = {};
    nodes.forEach(n => incomingEdges[n.id] = []);
    edges.forEach(e => {
        if (!incomingEdges[e.to]) incomingEdges[e.to] = [];
        incomingEdges[e.to].push(e.from);
    });

    // BFS to assign levels
    const queue = [];
    nodes.forEach(n => {
        if (incomingEdges[n.id].length === 0) {
            nodeToLevel[n.id] = 0;
            queue.push({ id: n.id, level: 0 });
        }
    });

    while (queue.length > 0) {
        const current = queue.shift();
        if (!levels[current.level]) levels[current.level] = [];
        levels[current.level].push(current.id);

        // Find all nodes that this node points to
        edges.forEach(e => {
            if (e.from === current.id && nodeToLevel[e.to] === undefined) {
                nodeToLevel[e.to] = current.level + 1;
                queue.push({ id: e.to, level: current.level + 1 });
            }
        });
    }

    return levels;
}

// Render attack visualization (supports both structured and legacy Mermaid format)
function renderAttackVisualization(pathId, visualization) {
    const container = document.getElementById(`attack-viz-${pathId}`);
    if (!container) {
        return;
    }

    try {
        let nodes, edges;

        // Check if it's the new structured format or legacy Mermaid string
        if (typeof visualization === 'string') {
            // Legacy Mermaid format
            const parsed = parseMermaidGraph(visualization);
            nodes = parsed.nodes;
            edges = parsed.edges;
        } else if (typeof visualization === 'object' && visualization.nodes && visualization.edges) {
            // New structured format
            const converted = convertStructuredToVisData(visualization);
            nodes = converted.nodes;
            edges = converted.edges;
        } else {
            throw new Error('Invalid visualization format');
        }

        // Get theme-aware colors
        const isLightTheme = document.documentElement.classList.contains('light-theme');
        const nodeFontColor = '#232f3e'; // Always dark for contrast with bright node colors
        const edgeFontColor = isLightTheme ? '#666' : '#FFFFFF';
        const edgeLabelBg = isLightTheme ? 'rgba(255,255,255,0.9)' : 'rgba(26,26,36,0.9)';

        // Calculate hierarchical levels and center nodes at each level
        const nodeSpacing = 250;
        const levelSeparation = 120;
        const levels = calculateHierarchicalLevels(nodes, edges);
        const levelNumbers = Object.keys(levels).map(Number).sort((a, b) => a - b);

        // Set both X and Y positions for all nodes manually
        levelNumbers.forEach((levelNum, levelIndex) => {
            const nodesAtLevel = levels[levelNum];

            // Calculate Y position for this level
            const y = levelIndex * levelSeparation;

            // Calculate the center point based on the previous level (or 0 for first level)
            let centerX = 0;
            if (levelIndex > 0) {
                const prevLevelNum = levelNumbers[levelIndex - 1];
                const prevLevelNodes = levels[prevLevelNum];
                const prevLevelXPositions = prevLevelNodes.map(nodeId => {
                    const node = nodes.find(n => n.id === nodeId);
                    return node ? node.x : 0;
                });
                const prevLevelMinX = Math.min(...prevLevelXPositions);
                const prevLevelMaxX = Math.max(...prevLevelXPositions);
                centerX = (prevLevelMinX + prevLevelMaxX) / 2;
            }

            // Calculate positions for current level centered relative to previous level
            const currentLevelWidth = (nodesAtLevel.length - 1) * nodeSpacing;
            const startX = centerX - (currentLevelWidth / 2);

            // Set x and y coordinates for each node at this level
            nodesAtLevel.forEach((nodeId, index) => {
                const node = nodes.find(n => n.id === nodeId);
                if (node) {
                    node.x = startX + (index * nodeSpacing);
                    node.y = y;
                    node.fixed = true; // Fix both x and y positions
                }
            });
        });

        // Create vis.js network
        const data = { nodes, edges };
        const options = {
            layout: {
                hierarchical: false  // Disable hierarchical layout since we're setting positions manually
            },
            nodes: {
                shape: 'box',
                margin: 10,
                widthConstraint: {
                    minimum: 120,
                    maximum: 200
                },
                font: {
                    size: 14,
                    face: 'Arial',
                    color: nodeFontColor
                },
                borderWidth: 2,
                shadow: true
            },
            edges: {
                arrows: {
                    to: {
                        enabled: true,
                        scaleFactor: 1.2,
                        type: 'arrow'
                    }
                },
                font: {
                    size: 12,
                    align: 'horizontal',
                    color: edgeFontColor,
                    strokeWidth: 0,
                    background: edgeLabelBg,
                    multi: true
                },
                color: {
                    color: '#848484',
                    highlight: '#ff9900'
                },
                width: 2,
                length: 180,
                smooth: {
                    type: 'cubicBezier',
                    forceDirection: 'vertical',
                    roundness: 0.5
                }
            },
            physics: {
                enabled: false
            },
            interaction: {
                dragNodes: true,
                dragView: true,
                zoomView: false,  // Disable mouse wheel zoom
                hover: true
            }
        };

        const network = new vis.Network(container, data, options);

        // Add zoom controls
        const zoomControls = document.createElement('div');
        zoomControls.className = 'viz-zoom-controls';
        zoomControls.innerHTML = `
            <button class="viz-zoom-btn viz-zoom-in" title="Zoom In">+</button>
            <button class="viz-zoom-btn viz-zoom-out" title="Zoom Out">−</button>
            <button class="viz-zoom-btn viz-zoom-reset" title="Reset Zoom">⊙</button>
        `;
        container.appendChild(zoomControls);

        // Add zoom button handlers
        zoomControls.querySelector('.viz-zoom-in').addEventListener('click', () => {
            const scale = network.getScale();
            network.moveTo({ scale: scale * 1.2 });
        });
        zoomControls.querySelector('.viz-zoom-out').addEventListener('click', () => {
            const scale = network.getScale();
            network.moveTo({ scale: scale * 0.8 });
        });
        zoomControls.querySelector('.viz-zoom-reset').addEventListener('click', () => {
            network.fit();
        });

        // Add click event handlers for nodes and edges
        network.on('click', function(params) {
            if (params.nodes.length > 0) {
                // Node clicked
                const nodeId = params.nodes[0];
                const node = nodes.find(n => n.id === nodeId);
                if (node && node.description) {
                    showVisualizationTooltip(node.label, node.description, container);
                }
            } else if (params.edges.length > 0) {
                // Edge clicked
                const edgeId = params.edges[0];
                const edge = edges.find(e => e.id === edgeId);
                if (edge && edge.description) {
                    // Use originalLabel (which has the label from YAML) for tooltip title
                    const title = edge.originalLabel || edge.label || 'Edge Details';
                    showVisualizationTooltip(title, edge.description, container);
                }
            }
        });

        // Add legend after network is created (so it appears above the canvas)
        const legend = document.createElement('div');
        legend.className = 'viz-legend';
        legend.innerHTML = `
            <div class="viz-legend-title">Legend</div>
            <div class="viz-legend-section">
                <div class="viz-legend-subtitle">Node Types</div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #ff9999;"></div>
                    <span>Principal (Users/Roles)</span>
                </div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #ffcc99;"></div>
                    <span>Resource</span>
                </div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #99ccff;"></div>
                    <span>Payload (Attacker Actions)</span>
                </div>
                <div class="viz-legend-item">
                    <div class="viz-legend-box" style="background-color: #99ff99;"></div>
                    <div class="viz-legend-box" style="background-color: #ffeb99;"></div>
                    <div class="viz-legend-box" style="background-color: #cccccc;"></div>
                    <span>Outcomes</span>
                </div>
            </div>
            <div class="viz-legend-section">
                <div class="viz-legend-subtitle">Edge Types</div>
                <div class="viz-legend-item">
                    <svg width="40" height="2" style="margin-right: 8px;">
                        <line x1="0" y1="1" x2="40" y2="1" stroke="#848484" stroke-width="2"/>
                    </svg>
                    <span>Transitive Actions</span>
                </div>
                <div class="viz-legend-item">
                    <svg width="40" height="2" style="margin-right: 8px;">
                        <line x1="0" y1="1" x2="40" y2="1" stroke="#999" stroke-width="2" stroke-dasharray="5,5"/>
                    </svg>
                    <span>Potential Outcomes</span>
                </div>
            </div>
        `;
        container.appendChild(legend);

        // Make legend collapsible on mobile
        if (window.innerWidth <= 768) {
            legend.classList.add('collapsed');
        }

        legend.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                legend.classList.toggle('collapsed');
            }
        });

        // Store network instance for potential cleanup
        container._visNetwork = network;

    } catch (error) {
        container.innerHTML = '<p style="color: #d13212;">Error rendering visualization</p>';
    }
}

// Convert structured format to vis.js data
function convertStructuredToVisData(structured) {
    // Use dark font color for all nodes (bright backgrounds)
    const nodeFontColor = '#232f3e';

    const nodes = structured.nodes.map(node => {
        // Default colors by type
        const colorDefaults = {
            'principal': '#ff9999',
            'resource': '#ffcc99',
            'payload': '#99ccff',
            'action': '#99ccff',  // Deprecated - use 'payload' instead
            'outcome': '#99ff99'
        };

        // Override with special outcome colors
        if (node.type === 'outcome' && !node.color) {
            if (node.label.includes('No ') || node.label.includes('Dead')) {
                node.color = '#cccccc'; // gray for dead ends
            } else if (node.label.includes('Check') || node.label.includes('Some')) {
                node.color = '#ffeb99'; // yellow for partial
            }
        }

        const color = node.color || colorDefaults[node.type] || '#e8f4f8';

        return {
            id: node.id,
            label: node.label,
            color: {
                background: color,
                border: getDarkerColor(color),
                highlight: {
                    background: color,
                    border: '#ff9900'
                }
            },
            description: node.description || '',
            font: {
                size: 14,
                face: 'Arial',
                color: nodeFontColor
            }
        };
    });

    const edges = structured.edges.map((edge, index) => {
        const edgeStyle = {
            id: `edge-${index}`,
            from: edge.from,
            to: edge.to,
            description: edge.description || '',
            originalLabel: edge.label // Store original label for tooltips
        };

        // Style conditional branches differently
        if (edge.branch || edge.condition) {
            edgeStyle.dashes = [5, 5]; // Dashed line for conditions
            edgeStyle.color = {
                color: '#999',
                highlight: '#ff9900'
            };
            // No label displayed on conditional edges
        } else {
            // Add label for non-conditional edges
            edgeStyle.label = edge.label;
        }

        return edgeStyle;
    });

    return { nodes, edges };
}

// Show tooltip for node/edge descriptions
function showVisualizationTooltip(title, description, vizContainer) {
    // Remove existing tooltip
    const existingTooltip = document.querySelector('.viz-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'viz-tooltip';
    tooltip.innerHTML = `
        <div class="viz-tooltip-header">${escapeHtml(title)}</div>
        <div class="viz-tooltip-body">${renderMarkdown(description)}</div>
        <div class="viz-tooltip-close">&times;</div>
    `;

    // Append to the visualization container instead of body
    vizContainer.appendChild(tooltip);

    // Position tooltip at bottom left of the container
    tooltip.style.position = 'absolute';
    tooltip.style.left = '10px';
    tooltip.style.bottom = '10px';
    tooltip.style.top = 'auto';

    // Add close handler
    tooltip.querySelector('.viz-tooltip-close').addEventListener('click', () => {
        tooltip.remove();
    });

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closeTooltip(e) {
            if (!tooltip.contains(e.target)) {
                tooltip.remove();
                document.removeEventListener('click', closeTooltip);
            }
        });
    }, 100);
}

// Parse Mermaid "graph LR" format into vis.js nodes/edges
function parseMermaidGraph(mermaidCode) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    // Use dark font color for all nodes (bright backgrounds)
    const nodeFontColor = '#232f3e';

    // Split into lines and filter out empty/comment lines
    const lines = mermaidCode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'));

    // Track node colors from style declarations
    const nodeStyles = new Map();

    lines.forEach(line => {
        // Skip graph declaration
        if (line.startsWith('graph ')) return;

        // Parse style declarations: style A fill:#ff9999,stroke:#333,stroke-width:2px
        if (line.startsWith('style ')) {
            const styleMatch = line.match(/style\s+(\w+)\s+fill:(#[0-9a-fA-F]+)/);
            if (styleMatch) {
                nodeStyles.set(styleMatch[1], styleMatch[2]);
            }
            return;
        }

        // Parse edge with label: A[label] -->|edge label| B[label]
        let edgeMatch = line.match(/(\w+)\[([^\]]+)\]\s*-->(?:\|([^|]+)\|)?\s*(\w+)\[([^\]]+)\]/);

        // Also try to parse edge without explicit nodes (references existing nodes): B --> C[label]
        if (!edgeMatch) {
            edgeMatch = line.match(/(\w+)\s*-->(?:\|([^|]+)\|)?\s*(\w+)\[([^\]]+)\]/);
            if (edgeMatch) {
                const [, fromId, edgeLabel, toId, toLabel] = edgeMatch;
                // From node already exists (no label on this line)
                const fromLabel = null;

                // Add to node if not exists
                if (!nodeMap.has(toId)) {
                    const color = nodeStyles.get(toId) || '#e8f4f8';
                    nodes.push({
                        id: toId,
                        label: toLabel,
                        color: {
                            background: color,
                            border: getDarkerColor(color),
                            highlight: {
                                background: color,
                                border: '#ff9900'
                            }
                        },
                        font: {
                            size: 14,
                            face: 'Arial',
                            color: nodeFontColor
                        }
                    });
                    nodeMap.set(toId, true);
                }

                // Add edge
                edges.push({
                    from: fromId,
                    to: toId,
                    label: edgeLabel || ''
                });
                return;
            }
        }

        if (edgeMatch) {
            const [, fromId, fromLabel, edgeLabel, toId, toLabel] = edgeMatch;

            // Add from node if not exists
            if (!nodeMap.has(fromId)) {
                const color = nodeStyles.get(fromId) || '#e8f4f8';
                nodes.push({
                    id: fromId,
                    label: fromLabel,
                    color: {
                        background: color,
                        border: getDarkerColor(color),
                        highlight: {
                            background: color,
                            border: '#ff9900'
                        }
                    },
                    font: {
                        size: 14,
                        face: 'Arial',
                        color: nodeFontColor
                    }
                });
                nodeMap.set(fromId, true);
            }

            // Add to node if not exists
            if (!nodeMap.has(toId)) {
                const color = nodeStyles.get(toId) || '#e8f4f8';
                nodes.push({
                    id: toId,
                    label: toLabel,
                    color: {
                        background: color,
                        border: getDarkerColor(color),
                        highlight: {
                            background: color,
                            border: '#ff9900'
                        }
                    },
                    font: {
                        size: 14,
                        face: 'Arial',
                        color: nodeFontColor
                    }
                });
                nodeMap.set(toId, true);
            }

            // Add edge
            edges.push({
                from: fromId,
                to: toId,
                label: edgeLabel || ''
            });
        }
    });

    return { nodes, edges };
}

// Helper function to get a darker version of a color for borders
function getDarkerColor(hex) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Darken by 30%
    const darkerR = Math.floor(r * 0.7);
    const darkerG = Math.floor(g * 0.7);
    const darkerB = Math.floor(b * 0.7);

    // Convert back to hex
    return `#${darkerR.toString(16).padStart(2, '0')}${darkerG.toString(16).padStart(2, '0')}${darkerB.toString(16).padStart(2, '0')}`;
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

// Convert text to URL-friendly slug for anchor links
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .trim();
}

// Create a heading with GitHub-style anchor link
function createHeadingWithAnchor(text, level = 2) {
    const slug = slugify(text);
    return `
        <h${level} id="${slug}" class="heading-with-anchor">
            ${text}
            <a href="#${slug}" class="heading-anchor" aria-label="Anchor link for: ${escapeHtml(text)}">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z"/>
                </svg>
            </a>
        </h${level}>
    `;
}

// Get initials for detection tool circles
function getToolInitials(toolName) {
    const toolMap = {
        'pmapper': 'PM',
        'cloudsplaining': 'CS',
        'pacu': 'PA',
        'prowler': 'PR'    
    };
    return toolMap[toolName.toLowerCase()] || toolName.substring(0, 2).toUpperCase();
}

// Open attack visualization in fullscreen modal
function openFullscreenVisualization(pathId) {
    const path = allPaths.find(p => p.id === pathId);
    if (!path || !path.attackVisualization) return;

    // Create fullscreen modal
    const fullscreenModal = document.createElement('div');
    fullscreenModal.className = 'fullscreen-viz-modal';
    fullscreenModal.innerHTML = `
        <div class="fullscreen-viz-content">
            <div class="fullscreen-viz-header">
                <h2>${escapeHtml(path.name)} - Attack Visualization</h2>
                <button class="fullscreen-viz-close" onclick="closeFullscreenVisualization()">&times;</button>
            </div>
            <div class="fullscreen-viz-container" id="attack-viz-fullscreen-${pathId}"></div>
        </div>
    `;

    document.body.appendChild(fullscreenModal);

    // Render visualization in fullscreen container
    setTimeout(() => {
        renderAttackVisualization('fullscreen-' + pathId, path.attackVisualization);
    }, 10);

    // Close on background click
    fullscreenModal.addEventListener('click', (e) => {
        if (e.target === fullscreenModal) {
            closeFullscreenVisualization();
        }
    });

    // Close on ESC key
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeFullscreenVisualization();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Close fullscreen visualization modal
function closeFullscreenVisualization() {
    const modal = document.querySelector('.fullscreen-viz-modal');
    if (modal) {
        modal.remove();
    }
}

// Render git metadata section with contributors and dates
function renderGitMetadata(path) {
    if (!path.gitMetadata && !path.filePath) {
        return '';
    }

    const metadata = path.gitMetadata || {};
    const repoOwner = 'DataDog';
    const repoName = 'pathfinding.cloud';
    const branch = 'main';
    const githubFileUrl = path.filePath
        ? `https://github.com/${repoOwner}/${repoName}/blob/${branch}/${path.filePath}`
        : null;
    const contributingUrl = `https://github.com/${repoOwner}/${repoName}/blob/${branch}/CONTRIBUTING.md`;

    // Format dates
    const formatDate = (isoDate) => {
        if (!isoDate) return 'Unknown';
        const date = new Date(isoDate);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const createdDate = formatDate(metadata.created);
    const updatedDate = formatDate(metadata.lastUpdated);

    // Render contributors with GitHub avatars
    const renderContributors = () => {
        if (!metadata.contributors || metadata.contributors.length === 0) {
            return '<p>No contributors information available</p>';
        }

        return metadata.contributors.map(contributor => {
            const avatarUrl = contributor.githubUsername
                ? `https://github.com/${contributor.githubUsername}.png?size=40`
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(contributor.name)}&size=40&background=random`;

            const profileUrl = contributor.githubUsername
                ? `https://github.com/${contributor.githubUsername}`
                : null;

            if (profileUrl) {
                return `
                    <a href="${profileUrl}" target="_blank" class="contributor-link" title="${escapeHtml(contributor.name)}">
                        <img src="${avatarUrl}" alt="${escapeHtml(contributor.name)}" class="contributor-avatar">
                    </a>
                `;
            } else {
                return `
                    <span class="contributor-no-link" title="${escapeHtml(contributor.name)} (${escapeHtml(contributor.email)})">
                        <img src="${avatarUrl}" alt="${escapeHtml(contributor.name)}" class="contributor-avatar">
                    </span>
                `;
            }
        }).join('');
    };

    return `
        <div class="modal-section">
            <div class="boxed-section git-metadata-section">
                <div class="git-metadata-contributing">
                    See an issue? Want to make a change? Want to add your blog as a reference? See our <a href="${contributingUrl}" target="_blank">contributing guide</a>!
                </div>
                <div class="git-metadata-content">
                    <div class="git-metadata-row">
                        <div class="git-metadata-dates">
                            ${metadata.created ? `<span><strong>Created:</strong> ${createdDate}</span>` : ''}
                            ${metadata.lastUpdated ? `<span><strong>Last Updated:</strong> ${updatedDate}</span>` : ''}
                        </div>
                        ${githubFileUrl ? `
                            <a href="${githubFileUrl}" target="_blank" class="edit-github-link">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                                </svg>
                                Edit on GitHub
                            </a>
                        ` : ''}
                    </div>
                    ${metadata.contributors && metadata.contributors.length > 0 ? `
                        <div class="git-metadata-contributors">
                            <strong>Contributors:</strong>
                            <div class="contributors-list">
                                ${renderContributors()}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

function renderMarkdown(text) {
    // Simple markdown renderer for code blocks and lists
    let html = escapeHtml(text);

    // Convert ```language\ncode\n``` to <pre><code>code</code></pre>
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Convert inline `code` to <code>code</code>
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert **bold** to <strong>bold</strong>
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert markdown lists to HTML lists
    // Match lines that start with "- " (with optional leading whitespace)
    const lines = html.split('\n');
    let inList = false;
    let result = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const listMatch = line.match(/^(\s*)- (.+)$/);

        if (listMatch) {
            if (!inList) {
                result.push('<ul>');
                inList = true;
            }
            result.push(`<li>${listMatch[2]}</li>`);
        } else {
            if (inList) {
                result.push('</ul>');
                inList = false;
            }
            result.push(line);
        }
    }

    // Close list if still open
    if (inList) {
        result.push('</ul>');
    }

    html = result.join('\n');

    // Preserve line breaks (but not inside lists)
    html = html.replace(/\n(?![<])/g, '<br>');
    // Clean up extra breaks around list tags
    html = html.replace(/<br>\s*<ul>/g, '<ul>');
    html = html.replace(/<\/ul>\s*<br>/g, '</ul>');
    html = html.replace(/<br>\s*<li>/g, '<li>');
    html = html.replace(/<\/li>\s*<br>/g, '</li>');

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

// Render learning environments with tabs for different platforms
function renderLearningEnvironments(environments) {
    const envNames = Object.keys(environments);
    if (envNames.length === 0) return '<p>No learning environments available</p>';

    // Environment display names
    const envDisplayNames = {
        'iam-vulnerable': 'IAM Vulnerable',
        'pathfinding-labs': 'Pathfinding Labs',
        'cloudfoxable': 'CloudFoxable',
        'cybr': 'Cybr',
        'pwndlabs': 'Pwned Labs'
    };

    const uniqueId = `env-tabs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const tabsHtml = envNames.map((envName, index) => `
        <button class="tab-button ${index === 0 ? 'active' : ''}"
                data-tab-target="${uniqueId}-${envName}"
                data-tab-group="${uniqueId}">
            ${envDisplayNames[envName] || envName}
        </button>
    `).join('');

    const contentHtml = envNames.map((envName, index) => {
        const envData = environments[envName];

        if (envData.type === 'open-source') {
            const isPathfinderLabs = envData.githubLink && envData.githubLink.includes('pathfinding-labs');
            return `
                <div id="${uniqueId}-${envName}" class="tab-content ${index === 0 ? 'active' : ''}" data-tab-group="${uniqueId}">
                    <div class="learning-env-content">
                        <div class="env-meta">
                            ${isPathfinderLabs ? `
                                <span class="unified-action-button disabled" title="Repository coming soon">
                                    <svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                                    </svg>
                                    View Repository
                                    <span class="coming-soon-badge">Coming Soon</span>
                                </span>
                            ` : `
                                <a href="${escapeHtml(envData.githubLink)}" target="_blank" class="unified-action-button">
                                    <svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                                    </svg>
                                    View Repository
                                </a>
                            `}
                            ${envData.scenario ? `<span class="env-scenario-name"><strong>Scenario:</strong> <code>${escapeHtml(envData.scenario)}</code></span>` : ''}
                        </div>
                        <p class="env-description">${escapeHtml(envData.description)}</p>
                    </div>
                </div>
            `;
        } else if (envData.type === 'closed-source') {
            return `
                <div id="${uniqueId}-${envName}" class="tab-content ${index === 0 ? 'active' : ''}" data-tab-group="${uniqueId}">
                    <div class="learning-env-content">
                        <div class="env-meta">
                            <span class="pricing-badge ${envData.scenarioPricingModel}">
                                ${envData.scenarioPricingModel === 'paid' ? '💳 Paid' : '🆓 Free'}
                            </span>
                        </div>
                        <p class="env-description">${escapeHtml(envData.description)}</p>
                        ${envData.scenario ? `<p class="env-scenario-link"><a href="${escapeHtml(envData.scenario)}" target="_blank">View Lab →</a></p>` : ''}
                    </div>
                </div>
            `;
        }
        return '';
    }).join('');

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

// Render detection tools coverage
function renderDetectionTools(detectionTools) {
    // Always show this section, even if no tools detect this path
    if (!detectionTools || Object.keys(detectionTools).length === 0) {
        return `
            <div class="boxed-section">
                <p style="color: var(--text-secondary); font-style: italic;">
                    This path is not currently supported by any open source detection tools.
                </p>
            </div>
        `;
    }

    const toolNames = Object.keys(detectionTools);
    const uniqueId = `detection-tabs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const tabsHtml = toolNames.map((toolName, index) => {
        const toolInfo = toolMetadata[toolName];
        const displayName = toolInfo ? toolInfo.name : toolName;
        return `
            <button class="tab-button ${index === 0 ? 'active' : ''}"
                    data-tab-target="${uniqueId}-${toolName}"
                    data-tab-group="${uniqueId}">
                ${escapeHtml(displayName)}
            </button>
        `;
    }).join('');

    const contentHtml = toolNames.map((toolName, index) => {
        const detectionSource = detectionTools[toolName];
        const toolInfo = toolMetadata[toolName];

        return `
            <div id="${uniqueId}-${toolName}" class="tab-content ${index === 0 ? 'active' : ''}" data-tab-group="${uniqueId}">
                <div class="detection-tool-content">
                    ${toolInfo ? `
                        <div class="tool-meta">
                            <a href="${escapeHtml(toolInfo.githubLink)}" target="_blank" class="unified-action-button">
                                <svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                                </svg>
                                Tool Repository
                            </a>
                            <a href="${escapeHtml(detectionSource)}" target="_blank" class="unified-action-button">
                                <svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M4.72 3.22a.75.75 0 011.06 1.06L2.06 8l3.72 3.72a.75.75 0 11-1.06 1.06L.47 8.53a.75.75 0 010-1.06l4.25-4.25zm6.56 0a.75.75 0 10-1.06 1.06L13.94 8l-3.72 3.72a.75.75 0 101.06 1.06l4.25-4.25a.75.75 0 000-1.06l-4.25-4.25z"></path>
                                </svg>
                                Detection Source
                            </a>
                        </div>
                        <p class="tool-description">${escapeHtml(toolInfo.description)}</p>
                    ` : `
                        <div class="tool-meta">
                            <a href="${escapeHtml(detectionSource)}" target="_blank" class="unified-action-button">
                                <svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M4.72 3.22a.75.75 0 011.06 1.06L2.06 8l3.72 3.72a.75.75 0 11-1.06 1.06L.47 8.53a.75.75 0 010-1.06l4.25-4.25zm6.56 0a.75.75 0 10-1.06 1.06L13.94 8l-3.72 3.72a.75.75 0 101.06 1.06l4.25-4.25a.75.75 0 000-1.06l-4.25-4.25z"></path>
                                </svg>
                                Detection Source
                            </a>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');

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

// Render discovery attribution (supports both TABLE and CARD views)
// To switch between views, change the return statement at the end of this function
function renderDiscoveryAttribution(attribution) {
    // Handle legacy array format (convert to new object format)
    if (Array.isArray(attribution)) {
        return `
            <ul>
                ${attribution.map(attr => `
                    <li>${escapeHtml(attr.item)}${attr.link ? ` <a href="${escapeHtml(attr.link)}" target="_blank">[source]</a>` : ''}</li>
                `).join('')}
            </ul>
        `;
    }

    // New object format with firstDocumented, derivativeOf, ultimateOrigin
    if (!attribution.firstDocumented) {
        return '<p>No attribution information available</p>';
    }

    // TABLE VIEW
    const tableView = () => {
        let rows = [];

        // First documented row - includes modification context if derivative
        const firstDoc = attribution.firstDocumented;
        const firstDocAuthor = firstDoc.author
            ? `${escapeHtml(firstDoc.author)}${firstDoc.organization ? ` (${escapeHtml(firstDoc.organization)})` : ''}`
            : escapeHtml(firstDoc.source || 'Unknown');
        const firstDocDate = firstDoc.date ? escapeHtml(String(firstDoc.date)) : 'Unknown';
        const firstDocContext = attribution.derivativeOf
            ? escapeHtml(attribution.derivativeOf.modification)  // Show what's different in this version
            : 'Original discovery of this escalation path';
        const firstDocLink = firstDoc.link
            ? `<a href="${escapeHtml(firstDoc.link)}" target="_blank" class="attribution-link">View Source →</a>`
            : '—';

        rows.push(`
            <tr>
                <td class="attr-type"><span class="badge badge-primary">First Documented</span></td>
                <td class="attr-author">${firstDocAuthor}</td>
                <td class="attr-date">${firstDocDate}</td>
                <td class="attr-context">${firstDocContext}</td>
                <td class="attr-link">${firstDocLink}</td>
            </tr>
        `);

        // Derivative of row - shows info about the source path
        if (attribution.derivativeOf) {
            const deriv = attribution.derivativeOf;
            const origin = attribution.ultimateOrigin;

            // Build author info from ultimateOrigin if available
            let derivAuthor = `<a href="/paths/${escapeHtml(deriv.pathId)}" onclick="event.preventDefault(); navigateToPath('${escapeHtml(deriv.pathId)}');">${escapeHtml(deriv.pathId.toUpperCase())}</a>`;
            if (origin) {
                derivAuthor += ` (${escapeHtml(origin.author)}${origin.organization ? `, ${escapeHtml(origin.organization)}` : ''})`;
            }

            const derivDate = origin && origin.date ? escapeHtml(String(origin.date)) : '—';
            const derivContext = 'Original discovery of parent attack';
            const derivLink = origin && origin.link
                ? `<a href="${escapeHtml(origin.link)}" target="_blank" class="attribution-link">View Source →</a>`
                : '—';

            rows.push(`
                <tr>
                    <td class="attr-type"><span class="badge badge-derivative">Derivative Of</span></td>
                    <td class="attr-author">${derivAuthor}</td>
                    <td class="attr-date">${derivDate}</td>
                    <td class="attr-context">${derivContext}</td>
                    <td class="attr-link">${derivLink}</td>
                </tr>
            `);
        }

        return `
            <table class="attribution-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Author/Source</th>
                        <th>Year</th>
                        <th>Context</th>
                        <th>Source</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.join('')}
                </tbody>
            </table>
        `;
    };

    // CARD VIEW
    const cardView = () => {
        let cards = [];

        // First documented card
        const firstDoc = attribution.firstDocumented;
        const firstDocAuthor = firstDoc.author
            ? `${escapeHtml(firstDoc.author)}${firstDoc.organization ? ` <span class="org-badge">${escapeHtml(firstDoc.organization)}</span>` : ''}`
            : escapeHtml(firstDoc.source || 'Unknown');
        const firstDocDate = firstDoc.date ? ` • ${escapeHtml(String(firstDoc.date))}` : '';
        const firstDocLink = firstDoc.link
            ? `<a href="${escapeHtml(firstDoc.link)}" target="_blank" class="card-link">View Source →</a>`
            : '';

        cards.push(`
            <div class="attribution-card attribution-card-primary">
                <div class="card-header">
                    <span class="card-badge">🎯 First Documented</span>
                </div>
                <div class="card-body">
                    <div class="card-author">${firstDocAuthor}${firstDocDate}</div>
                    ${firstDocLink ? `<div class="card-link-container">${firstDocLink}</div>` : ''}
                </div>
            </div>
        `);

        // Derivative of card
        if (attribution.derivativeOf) {
            const deriv = attribution.derivativeOf;
            cards.push(`
                <div class="attribution-card attribution-card-derivative">
                    <div class="card-header">
                        <span class="card-badge">🔗 Derivative Of</span>
                    </div>
                    <div class="card-body">
                        <div class="card-path-link">
                            <a href="/paths/${escapeHtml(deriv.pathId)}" onclick="event.preventDefault(); navigateToPath('${escapeHtml(deriv.pathId)}');">
                                ${escapeHtml(deriv.pathId.toUpperCase())}
                            </a>
                        </div>
                        <div class="card-context">${escapeHtml(deriv.modification)}</div>
                    </div>
                </div>
            `);
        }

        // Ultimate origin card
        if (attribution.ultimateOrigin) {
            const origin = attribution.ultimateOrigin;
            const originAuthor = `${escapeHtml(origin.author)}${origin.organization ? ` <span class="org-badge">${escapeHtml(origin.organization)}</span>` : ''}`;
            const originDate = origin.date ? ` • ${escapeHtml(String(origin.date))}` : '';
            const originLink = origin.link
                ? `<a href="${escapeHtml(origin.link)}" target="_blank" class="card-link">View Original Research →</a>`
                : '';

            cards.push(`
                <div class="attribution-card attribution-card-origin">
                    <div class="card-header">
                        <span class="card-badge">⭐ Ultimate Origin</span>
                    </div>
                    <div class="card-body">
                        <div class="card-author">${originAuthor}${originDate}</div>
                        <div class="card-context">Original discovery of parent attack</div>
                        ${originLink ? `<div class="card-link-container">${originLink}</div>` : ''}
                    </div>
                </div>
            `);
        }

        return `<div class="attribution-cards">${cards.join('')}</div>`;
    };

    // CHOOSE VIEW: Change this line to switch between table and card views
     return tableView();  // Use this for TABLE view
    //return cardView();     // Use this for CARD view
}

// Render prerequisites with tabs for admin/lateral or simple list
function renderPrerequisites(prerequisites, limitations) {
    // Render limitations text if provided
    const limitationsHtml = limitations ? `
        <p style="white-space: pre-wrap; margin-bottom: 20px; color: var(--text-secondary);">${escapeHtml(limitations)}</p>
    ` : '';

    // Check if new format (dict) or legacy format (array)
    if (Array.isArray(prerequisites)) {
        // Legacy format: render as simple list
        return `
            ${limitationsHtml}
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
        ${limitationsHtml}
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
            <div class="permissions-table-wrapper">
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
            </div>
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
            <p style="margin-bottom: 15px; color: #666;">These are the only permissions needed by the principal that is exploiting this path. Additional get/list type permissions might be needed to exploit this in practice, but sometimes the attacker has already gained that read level access through other means (e.g, read-only access, knowledge base systems).</p>
            <div class="permissions-table-wrapper">
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
            <p style="margin-bottom: 15px; color: #666;">These are the only permissions needed by the principal that is exploiting this path. Additional get/list type permissions might be needed to exploit this in practice, but sometimes the attacker has already gained that read level access through other means (e.g, read-only access, knowledge base systems). Those additional permissions are shown in the next tab.</p>
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

// Removed old handleHashChange function - now using proper routing with History API

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
