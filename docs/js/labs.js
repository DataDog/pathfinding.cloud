// Labs application state
let allLabs = [];
let filteredLabs = [];
let pathsData = []; // For cross-linking to paths
let labDetailCache = {}; // Cache for fetched per-scenario detail JSON
let currentRoute = { view: 'list', slug: null };
let sortColumn = 'name';
let sortDirection = 'asc';
let currentView = 'cards';

// Card style from URL param (A, B) -- default A
const cardStyleParam = new URLSearchParams(window.location.search).get('cardStyle');
const cardStyle = ['A', 'B'].includes(cardStyleParam) ? cardStyleParam : 'A';

// DOM elements
const labsContainer = document.getElementById('labs-container');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');
const pathTypeFilter = document.getElementById('path-type-filter');
const targetFilter = document.getElementById('target-filter');
const costFilter = document.getElementById('cost-filter');
const resetButton = document.getElementById('reset-filters');
const totalLabsCountEl = document.getElementById('total-labs-count');
const filteredLabsCountEl = document.getElementById('filtered-labs-count');
const themeToggle = document.getElementById('theme-toggle');
const viewCardsBtn = document.getElementById('view-cards');
const viewTableBtn = document.getElementById('view-table');

// Category display configuration
// Keys must match the category values from scenario.yaml data
const categoryConfig = {
    'Privilege Escalation': { label: 'Priv Esc', cssClass: 'lab-badge-privesc' },
    'CSPM Misconfiguration': { label: 'CSPM', cssClass: 'lab-badge-cspm' },
    'Toxic Combination': { label: 'Toxic Combo', cssClass: 'lab-badge-toxic' },
    'Tool Testing': { label: 'Tool Testing', cssClass: 'lab-badge-tooltest' },
};

// Category banner configuration for card graphics
const categoryBannerConfig = {
    'Privilege Escalation': { bannerClass: 'lab-banner-privesc', bannerText: 'PRIVILEGE ESCALATION' },
    'CSPM Misconfiguration': { bannerClass: 'lab-banner-cspm', bannerText: 'CSPM MISCONFIGURATION' },
    'Toxic Combination': { bannerClass: 'lab-banner-toxic', bannerText: 'TOXIC COMBINATION' },
    'Tool Testing': { bannerClass: 'lab-banner-tooltest', bannerText: 'TOOL TESTING' },
};

// Path type display labels and colors
const pathTypeLabels = {
    'self-escalation': 'Self',
    'one-hop': '1-Hop',
    'multi-hop': 'Multi-Hop',
    'cross-account': 'Cross-Acct',
    'single-condition': 'Single',
    'toxic-combination': 'Toxic',
};

const pathTypeColors = {
    'self-escalation': 'lab-pathtype-self',
    'one-hop': 'lab-pathtype-onehop',
    'multi-hop': 'lab-pathtype-multihop',
    'cross-account': 'lab-pathtype-crossacct',
    'single-condition': 'lab-pathtype-single',
    'toxic-combination': 'lab-pathtype-toxic',
};

const targetColors = {
    'to-admin': 'lab-target-admin',
    'to-bucket': 'lab-target-bucket',
};

// AWS service icon config — maps permission prefix to display label + AWS category color
const awsServiceConfig = {
    'iam':            { label: 'IAM',            color: '#BF0816' }, // Security, Identity & Compliance
    'sts':            { label: 'STS',            color: '#BF0816' },
    'kms':            { label: 'KMS',            color: '#BF0816' },
    'secretsmanager': { label: 'Secrets Mgr',    color: '#BF0816' },
    'cognito-idp':    { label: 'Cognito',        color: '#BF0816' },
    'ec2':            { label: 'EC2',            color: '#E8702A' }, // Compute
    'lambda':         { label: 'Lambda',         color: '#E8702A' },
    'ecs':            { label: 'ECS',            color: '#E8702A' },
    'eks':            { label: 'EKS',            color: '#E8702A' },
    'apprunner':      { label: 'App Runner',     color: '#E8702A' },
    'batch':          { label: 'Batch',          color: '#E8702A' },
    's3':             { label: 'S3',             color: '#3F8624' }, // Storage
    'glue':           { label: 'Glue',           color: '#8C4FFF' }, // Analytics
    'athena':         { label: 'Athena',         color: '#8C4FFF' },
    'mwaa':           { label: 'MWAA',           color: '#8C4FFF' },
    'airflow':        { label: 'MWAA',           color: '#8C4FFF' }, // airflow:* permissions → MWAA
    'sagemaker':      { label: 'SageMaker',      color: '#01A88D' }, // Machine Learning
    'bedrock':        { label: 'Bedrock',        color: '#01A88D' },
    'bedrockagentcore': { label: 'Bedrock',      color: '#01A88D' },
    'cloudformation': { label: 'CloudFormation', color: '#E7157B' }, // Management & Governance
    'ssm':            { label: 'SSM',            color: '#E7157B' },
    'codebuild':      { label: 'CodeBuild',      color: '#C7131F' }, // Developer Tools
    'codecommit':     { label: 'CodeCommit',     color: '#C7131F' },
    'codepipeline':   { label: 'CodePipeline',   color: '#C7131F' },
    'rds':            { label: 'RDS',            color: '#2E73B8' }, // Database
    'dynamodb':       { label: 'DynamoDB',       color: '#2E73B8' },
    'elasticache':    { label: 'ElastiCache',    color: '#2E73B8' },
};

// Extract unique AWS services from required permissions by splitting on ':'
function parseServicesFromPermissions(permissions) {
    if (!permissions?.required?.length) return [];
    const seen = new Set();
    const services = [];
    for (const p of permissions.required) {
        const service = p.permission?.split(':')?.[0]?.toLowerCase();
        if (service && !seen.has(service)) {
            seen.add(service);
            services.push(service);
        }
    }
    return services;
}

// Render small AWS service icon chips from a lab's permissions
function renderServiceIcons(permissions) {
    const services = parseServicesFromPermissions(permissions);
    if (services.length === 0) return '';
    return services.map(service => {
        const cfg = awsServiceConfig[service] || { label: service.toUpperCase(), color: '#6B7280' };
        return `<span class="lab-service-icon" style="background:${cfg.color}" title="AWS ${cfg.label}">${escapeHtml(cfg.label)}</span>`;
    }).join('');
}

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-theme');
    }
}

function toggleTheme() {
    document.documentElement.classList.toggle('light-theme');
    const currentTheme = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
    localStorage.setItem('theme', currentTheme);
}

// Mobile menu management
function initMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileMenuClose = document.getElementById('mobile-menu-close');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');

    if (!mobileMenuToggle || !mobileMenuClose || !mobileMenuOverlay) return;

    mobileMenuToggle.addEventListener('click', () => {
        mobileMenuOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    });

    const closeMobileMenu = () => {
        mobileMenuOverlay.classList.remove('active');
        document.body.style.overflow = '';
    };

    mobileMenuClose.addEventListener('click', closeMobileMenu);

    mobileMenuOverlay.addEventListener('click', (e) => {
        if (e.target === mobileMenuOverlay) closeMobileMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenuOverlay.classList.contains('active')) {
            closeMobileMenu();
        }
    });
}

// View toggle
function switchView(view) {
    currentView = view;

    if (view === 'cards') {
        viewCardsBtn.classList.add('active');
        viewTableBtn.classList.remove('active');
        labsContainer.className = `labs-grid labs-grid-${cardStyle.toLowerCase()}`;
    } else {
        viewTableBtn.classList.add('active');
        viewCardsBtn.classList.remove('active');
        labsContainer.className = 'paths-table-container';
    }

    renderLabs();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileMenu();
    setupEventListeners();
    setupTabListeners();

    // Set initial view toggle button state
    if (currentView === 'cards') {
        viewCardsBtn.classList.add('active');
        viewTableBtn.classList.remove('active');
    }

    loadLabs();
});

function setupEventListeners() {
    searchInput.addEventListener('input', debounce(applyFilters, 300));
    categoryFilter.addEventListener('change', applyFilters);
    pathTypeFilter.addEventListener('change', applyFilters);
    targetFilter.addEventListener('change', applyFilters);
    costFilter.addEventListener('change', applyFilters);
    resetButton.addEventListener('click', resetFilters);
    themeToggle.addEventListener('click', toggleTheme);

    if (viewCardsBtn) viewCardsBtn.addEventListener('click', () => switchView('cards'));
    if (viewTableBtn) viewTableBtn.addEventListener('click', () => switchView('table'));

    window.addEventListener('popstate', () => routeFromURL());
}

// Data loading
async function loadLabs() {
    try {
        const [labs, paths] = await Promise.all([
            fetch('/labs.json').then(r => {
                if (!r.ok) throw new Error(`Failed to load labs.json: ${r.status}`);
                return r.json();
            }),
            fetch('/paths.json').then(r => r.ok ? r.json() : []).catch(() => []),
        ]);

        allLabs = labs;
        filteredLabs = labs;
        pathsData = paths;

        updateStats();
        renderLabs();
        initRouter();
    } catch (error) {
        console.error('Error loading labs:', error);
        labsContainer.innerHTML = `
            <div class="no-results">
                <p>Error loading lab scenarios</p>
                <p style="font-size: 0.9em;">Please check the console for details</p>
            </div>
        `;
    }
}

// Fetch full detail data for a single lab
async function fetchLabDetail(slug) {
    if (labDetailCache[slug]) return labDetailCache[slug];

    const response = await fetch(`/labs/data/${slug}.json`);
    if (!response.ok) throw new Error(`Failed to load lab detail: ${response.status}`);

    const data = await response.json();
    labDetailCache[slug] = data;
    return data;
}

// Router
function initRouter() {
    const redirectPath = sessionStorage.getItem('redirectPath');
    if (redirectPath) {
        sessionStorage.removeItem('redirectPath');
        history.replaceState(null, '', redirectPath);
    }
    routeFromURL();
}

function routeFromURL() {
    const pathname = window.location.pathname;

    // Match /labs/{slug} where slug can contain letters, numbers, hyphens, plus signs
    const labMatch = pathname.match(/^\/labs\/([a-z0-9+\-]+)$/);

    if (labMatch) {
        const slug = labMatch[1];
        const lab = allLabs.find(l => l.slug === slug);

        if (lab) {
            if (window.DD_RUM) {
                window.DD_RUM.startView({ name: `/labs/${slug}`, service: 'pathfinding.cloud' });
            }
            currentRoute = { view: 'detail', slug };
            showLabDetail(slug);
        } else {
            navigateToList();
        }
    } else if (pathname === '/labs' || pathname === '/labs/') {
        if (window.DD_RUM) {
            window.DD_RUM.startView({ name: '/labs/', service: 'pathfinding.cloud' });
        }
        currentRoute = { view: 'list', slug: null };
        showListView();
    }
}

function navigateToLab(slug) {
    const lab = allLabs.find(l => l.slug === slug);
    if (!lab) return;

    history.pushState(null, '', `/labs/${slug}`);
    if (window.DD_RUM) {
        window.DD_RUM.startView({ name: `/labs/${slug}`, service: 'pathfinding.cloud' });
    }
    currentRoute = { view: 'detail', slug };
    showLabDetail(slug);
}

function navigateToList() {
    history.pushState(null, '', '/labs/');
    if (window.DD_RUM) {
        window.DD_RUM.startView({ name: '/labs/', service: 'pathfinding.cloud' });
    }
    currentRoute = { view: 'list', slug: null };
    showListView();
}

function showListView() {
    const listView = document.getElementById('list-view');
    const detailView = document.getElementById('detail-view');
    const nav = document.querySelector('nav.container');

    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    if (nav) nav.style.display = 'block';

    document.title = 'pathfinding.cloud - Labs';
}

// Filtering
function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const selectedCategory = categoryFilter.value;
    const selectedPathType = pathTypeFilter.value;
    const selectedTarget = targetFilter.value;
    const selectedCost = costFilter.value;

    filteredLabs = allLabs.filter(lab => {
        // Search filter
        if (searchTerm) {
            const searchableText = [
                lab.name,
                lab.description,
                lab.slug,
                lab.pathfindingCloudId || '',
                lab.subCategory || '',
                ...(lab.permissions.required || []).map(p => p.permission),
                ...(lab.permissions.helpful || []).map(p => p.permission),
            ].join(' ').toLowerCase();

            if (!searchableText.includes(searchTerm)) return false;
        }

        // Category filter
        if (selectedCategory && lab.category !== selectedCategory) return false;

        // Path type filter
        if (selectedPathType && lab.pathType !== selectedPathType) return false;

        // Target filter
        if (selectedTarget && lab.target !== selectedTarget) return false;

        // Cost filter
        if (selectedCost) {
            const isFree = lab.costEstimate === 'free' || lab.costEstimate === '$0/mo';
            if (selectedCost === 'free' && !isFree) return false;
            if (selectedCost === 'paid' && isFree) return false;
        }

        return true;
    });

    updateStats();
    renderLabs();
}

function resetFilters() {
    searchInput.value = '';
    categoryFilter.value = '';
    pathTypeFilter.value = '';
    targetFilter.value = '';
    costFilter.value = '';
    filteredLabs = allLabs;
    updateStats();
    renderLabs();
}

function updateStats() {
    if (totalLabsCountEl) totalLabsCountEl.textContent = allLabs.length;
    if (filteredLabsCountEl) filteredLabsCountEl.textContent = filteredLabs.length;
}

// Helper: get common lab display values
function getLabDisplayValues(lab) {
    const catConfig = categoryConfig[lab.category] || { label: lab.category, cssClass: '' };
    const pathTypeLabel = pathTypeLabels[lab.pathType] || lab.pathType;
    const pathTypeClass = pathTypeColors[lab.pathType] || 'lab-badge-pathtype';
    const targetLabel = lab.target === 'to-admin' ? 'Admin' : lab.target === 'to-bucket' ? 'Bucket' : lab.target;
    const targetClass = targetColors[lab.target] || 'lab-badge-target';
    const isFree = lab.costEstimate === 'free' || lab.costEstimate === '$0/mo';
    const costLabel = isFree ? 'Free' : lab.costEstimate;
    const costClass = isFree ? 'lab-cost-free' : 'lab-cost-paid';
    return { catConfig, pathTypeLabel, pathTypeClass, targetLabel, targetClass, isFree, costLabel, costClass };
}

// Rendering - dispatches to table or card view
function renderLabs() {
    if (!labsContainer) return;

    if (filteredLabs.length === 0) {
        labsContainer.innerHTML = `
            <div class="no-results">
                <p>No lab scenarios match your filters</p>
                <button onclick="resetFilters()">Reset Filters</button>
            </div>
        `;
        return;
    }

    if (currentView === 'cards') {
        renderLabCards();
    } else {
        renderLabTable();
    }
}

// Sort helper
function getSortedLabs() {
    return [...filteredLabs].sort((a, b) => {
        let aVal, bVal;
        switch (sortColumn) {
            case 'name': aVal = a.name; bVal = b.name; break;
            case 'category': aVal = a.category; bVal = b.category; break;
            case 'pathType': aVal = a.pathType; bVal = b.pathType; break;
            case 'target': aVal = a.target; bVal = b.target; break;
            case 'cost': aVal = a.costEstimate; bVal = b.costEstimate; break;
            default: aVal = a.name; bVal = b.name;
        }
        const cmp = String(aVal || '').localeCompare(String(bVal || ''));
        return sortDirection === 'asc' ? cmp : -cmp;
    });
}

// Rendering - Table View (improved: merged Name+Description, no Docs, renamed Cost)
function renderLabTable() {
    const sorted = getSortedLabs();

    const sortIndicator = (col) => {
        if (sortColumn !== col) return '';
        return sortDirection === 'asc' ? ' &#9650;' : ' &#9660;';
    };

    let html = `<table class="paths-table labs-table">
        <thead>
            <tr>
                <th class="sortable labs-name-col" data-sort="name">Name${sortIndicator('name')}</th>
                <th class="sortable" data-sort="category">Category${sortIndicator('category')}</th>
                <th class="sortable" data-sort="pathType">Path Type${sortIndicator('pathType')}</th>
                <th class="sortable" data-sort="target">Target${sortIndicator('target')}</th>
                <th class="sortable" data-sort="cost">Est. AWS Cost${sortIndicator('cost')}</th>
            </tr>
        </thead>
        <tbody>`;

    for (const lab of sorted) {
        const { catConfig, pathTypeLabel, pathTypeClass, targetLabel, targetClass, costLabel, costClass } = getLabDisplayValues(lab);

        html += `
            <tr class="lab-row" data-slug="${lab.slug}">
                <td class="lab-name-desc-cell">
                    <a href="/labs/${lab.slug}" class="lab-name-link" onclick="event.preventDefault(); navigateToLab('${lab.slug}')">${escapeHtml(lab.name)}</a>
                    <div class="lab-table-description">${escapeHtml(truncate(lab.description, 120))}</div>
                </td>
                <td><span class="lab-badge ${catConfig.cssClass}">${catConfig.label}</span></td>
                <td><span class="lab-badge ${pathTypeClass}">${pathTypeLabel}</span></td>
                <td>${targetLabel ? `<span class="lab-badge ${targetClass}">${targetLabel}</span>` : ''}</td>
                <td><span class="lab-badge ${costClass}">${costLabel}</span></td>
            </tr>`;
    }

    html += '</tbody></table>';
    labsContainer.innerHTML = html;

    // Add sort listeners
    labsContainer.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortColumn === col) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = col;
                sortDirection = 'asc';
            }
            renderLabs();
        });
    });
}

// Rendering - Card View (dispatches to style A/B/C/D)
function renderLabCards() {
    // Ensure grid class matches card style (for initial mobile load)
    labsContainer.className = `labs-grid labs-grid-${cardStyle.toLowerCase()}`;

    const sorted = getSortedLabs();
    let html = '';

    for (const lab of sorted) {
        if (cardStyle === 'B') {
            html += renderCardB(lab);
        } else {
            html += renderCardA(lab);
        }
    }

    labsContainer.innerHTML = html;

    // Add click handlers for card navigation
    labsContainer.querySelectorAll('.lab-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't navigate if clicking a link
            if (e.target.closest('a')) return;
            const slug = card.dataset.slug;
            if (slug) navigateToLab(slug);
        });
        card.addEventListener('mousedown', (e) => {
            // Middle-click opens in new tab
            if (e.button === 1) {
                e.preventDefault();
                const slug = card.dataset.slug;
                if (slug) window.open(`/labs/${slug}`, '_blank');
            }
        });
    });
}

// Render category banner -- background-only watermark (Style A) or foreground-only label (Style B)
function renderBannerA(lab) {
    const banner = categoryBannerConfig[lab.category] || { bannerClass: 'lab-banner-privesc', bannerText: lab.category.toUpperCase() };
    return `
        <div class="lab-card-banner lab-card-banner-bg ${banner.bannerClass}">
            <span class="lab-card-banner-watermark">${banner.bannerText}</span>
        </div>`;
}

function renderBannerB(lab) {
    const banner = categoryBannerConfig[lab.category] || { bannerClass: 'lab-banner-privesc', bannerText: lab.category.toUpperCase() };
    return `
        <div class="lab-card-banner lab-card-banner-fg ${banner.bannerClass}">
            <span class="lab-card-banner-label">${banner.bannerText}</span>
        </div>`;
}

// Card Style A: 2-column, background-only banner, name + description + labeled bottom pills
function renderCardA(lab) {
    const { catConfig, pathTypeLabel, pathTypeClass, targetLabel, targetClass, costLabel, costClass } = getLabDisplayValues(lab);

    return `
        <div class="lab-card lab-card-a" data-slug="${lab.slug}">
            ${renderBannerA(lab)}
            <div class="lab-card-body">
                <div class="lab-card-name">${escapeHtml(lab.name)}</div>
                <div class="lab-card-description">${escapeHtml(truncate(lab.description, 450))}</div>
                <div class="lab-card-badges">
                    <span class="lab-card-badge-item"><span class="lab-card-badge-label">Path Type</span> <span class="lab-badge ${pathTypeClass}">${pathTypeLabel}</span></span>
                    ${targetLabel ? `<span class="lab-card-badge-item"><span class="lab-card-badge-label">Target</span> <span class="lab-badge ${targetClass}">${targetLabel}</span></span>` : ''}
                    <span class="lab-card-badge-item"><span class="lab-card-badge-label">Est. AWS Cost</span> <span class="lab-badge ${costClass}">${costLabel}</span></span>
                </div>
            </div>
        </div>`;
}

// Card Style B: 1-column, foreground-only banner, name + full description + bottom pills
function renderCardB(lab) {
    const { catConfig, pathTypeLabel, pathTypeClass, targetLabel, targetClass, costLabel, costClass } = getLabDisplayValues(lab);

    return `
        <div class="lab-card lab-card-b" data-slug="${lab.slug}">
            ${renderBannerB(lab)}
            <div class="lab-card-body">
                <div class="lab-card-name">${escapeHtml(lab.name)}</div>
                <div class="lab-card-description lab-card-description-full">${escapeHtml(lab.description)}</div>
                <div class="lab-card-badges">
                    <span class="lab-badge ${pathTypeClass}">${pathTypeLabel}</span>
                    ${targetLabel ? `<span class="lab-badge ${targetClass}">${targetLabel}</span>` : ''}
                    <span class="lab-badge ${costClass}">${costLabel}</span>
                </div>
            </div>
        </div>`;
}

// ============================================================
// Detail View - Two-column layout with tabs
// ============================================================

async function showLabDetail(slug) {
    const listView = document.getElementById('list-view');
    const detailView = document.getElementById('detail-view');
    const detailContent = document.getElementById('detail-content');
    const nav = document.querySelector('nav.container');

    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    if (nav) nav.style.display = 'none';

    // Show loading skeleton while fetching detail data
    const indexLab = allLabs.find(l => l.slug === slug);
    const labName = indexLab ? indexLab.name : slug;
    document.title = `${labName} - Labs - pathfinding.cloud`;

    detailContent.innerHTML = renderDetailSkeleton(labName);

    try {
        const lab = await fetchLabDetail(slug);
        renderLabDetailContent(lab, detailContent);
    } catch (error) {
        console.error('Error loading lab detail:', error);
        detailContent.innerHTML = `
            <div class="detail-sticky-header">
                <nav class="breadcrumb">
                    <a href="/labs/" onclick="event.preventDefault(); navigateToList();">All Labs</a>
                    <span class="breadcrumb-separator">></span>
                    <span class="breadcrumb-current">${escapeHtml(labName)}</span>
                </nav>
            </div>
            <div class="detail-scrollable-content">
                <div class="no-results">
                    <p>Error loading lab details</p>
                    <p style="font-size: 0.9em;">Please check the console for details</p>
                </div>
            </div>`;
    }

    window.scrollTo(0, 0);
}

function renderDetailSkeleton(labName) {
    return `
        <div class="detail-sticky-header">
            <nav class="breadcrumb">
                <a href="/labs/" onclick="event.preventDefault(); navigateToList();">All Labs</a>
                <span class="breadcrumb-separator">></span>
                <span class="breadcrumb-current">${escapeHtml(labName)}</span>
            </nav>
        </div>
        <div class="detail-scrollable-content">
            <div class="lab-detail-skeleton">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-badges">
                    <div class="skeleton-badge"></div>
                    <div class="skeleton-badge"></div>
                    <div class="skeleton-badge"></div>
                </div>
                <div class="skeleton-two-col">
                    <div class="skeleton-sidebar">
                        <div class="skeleton-block"></div>
                        <div class="skeleton-block"></div>
                    </div>
                    <div class="skeleton-main">
                        <div class="skeleton-tabs"></div>
                        <div class="skeleton-block skeleton-content"></div>
                    </div>
                </div>
            </div>
        </div>`;
}

function renderLabDetailContent(lab, container) {
    const catConfig = categoryConfig[lab.category] || { label: lab.category, cssClass: '' };
    const pathTypeLabel = pathTypeLabels[lab.pathType] || lab.pathType;
    const pathTypeClass = pathTypeColors[lab.pathType] || 'lab-badge-pathtype';
    const isFree = lab.costEstimate === 'free' || lab.costEstimate === '$0/mo';
    const targetLabel = lab.target === 'to-admin' ? 'Admin' : lab.target === 'to-bucket' ? 'Bucket' : lab.target;
    const targetClass = targetColors[lab.target] || 'lab-badge-target';

    // Find matching path for cross-link
    const matchingPath = lab.pathfindingCloudId
        ? pathsData.find(p => p.id === lab.pathfindingCloudId)
        : null;

    const hasReadme = lab.readme && Object.keys(lab.readme).length > 0;

    let html = `
        <div class="detail-sticky-header">
            <nav class="breadcrumb">
                <a href="/labs/" onclick="event.preventDefault(); navigateToList();">All Labs</a>
                <span class="breadcrumb-separator">></span>
                <span class="breadcrumb-current">${escapeHtml(lab.name)}</span>
            </nav>
        </div>

        <div class="detail-scrollable-content">
            <div class="lab-detail-header">
                <h1 class="detail-title">${escapeHtml(lab.name)}</h1>
                <div class="lab-detail-badges">
                    <span class="lab-badge ${catConfig.cssClass}">${catConfig.label}</span>
                    ${lab.pathType ? `<span class="lab-badge ${pathTypeClass}">${pathTypeLabel}</span>` : ''}
                    ${targetLabel ? `<span class="lab-badge ${targetClass}">${targetLabel}</span>` : ''}
                    <span class="lab-badge ${isFree ? 'lab-cost-free' : 'lab-cost-paid'}">${isFree ? 'Free' : lab.costEstimate}</span>
                    ${lab.environments && lab.environments.length > 0 ? lab.environments.map(env =>
                        `<span class="lab-badge lab-badge-env">${escapeHtml(env)}</span>`
                    ).join('') : ''}
                    ${renderServiceIcons(lab.permissions) ? `<span class="lab-service-icons-right">${renderServiceIcons(lab.permissions)}</span>` : ''}
                </div>
            </div>

            <div class="lab-detail-layout">
                ${renderSidebar(lab, matchingPath)}
                <div class="lab-detail-main">
                    ${renderDetailTabs(lab, hasReadme, matchingPath)}
                </div>
            </div>
        </div>`;

    container.innerHTML = html;
    setupTabListeners();

    // Activate the first tab
    const firstTab = container.querySelector('.lab-detail-tab-btn');
    if (firstTab) firstTab.click();
}

// ---- Sidebar ----

function renderSidebar(lab, matchingPath) {
    let html = '<div class="lab-detail-sidebar">';

    // Attack path summary
    if (lab.attackPath && lab.attackPath.summary) {
        html += `
            <div class="lab-sidebar-section">
                <h3 class="lab-sidebar-heading">Attack Path</h3>
                <div class="lab-attack-summary">${escapeHtml(lab.attackPath.summary)}</div>
            </div>`;
    }

    // Permissions
    html += renderSidebarPermissions(lab.permissions, lab.slug);

    // MITRE ATT&CK
    if (lab.mitreAttack && (lab.mitreAttack.tactics.length > 0 || lab.mitreAttack.techniques.length > 0)) {
        html += `
            <div class="lab-sidebar-section">
                <h3 class="lab-sidebar-heading">MITRE ATT&CK</h3>
                <div class="lab-mitre-tags">
                    ${lab.mitreAttack.tactics.map(t => {
                        const tacticId = t.split(' - ')[0];
                        return `<a href="https://attack.mitre.org/tactics/${tacticId}/" target="_blank" rel="noopener noreferrer" class="lab-mitre-tag lab-mitre-tactic">${escapeHtml(t)}</a>`;
                    }).join('')}
                    ${lab.mitreAttack.techniques.map(t => {
                        const techId = t.split(' - ')[0].replace('.', '/');
                        return `<a href="https://attack.mitre.org/techniques/${techId}/" target="_blank" rel="noopener noreferrer" class="lab-mitre-tag">${escapeHtml(t)}</a>`;
                    }).join('')}
                </div>
            </div>`;
    }

    // Links
    html += `
        <div class="lab-sidebar-section">
            <h3 class="lab-sidebar-heading">Links</h3>
            <div class="lab-sidebar-links">
                <a href="${lab.githubUrl}" target="_blank" rel="noopener noreferrer" class="lab-sidebar-link">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    View on GitHub
                </a>
                ${matchingPath ? `
                <a href="/paths/${lab.pathfindingCloudId}" class="lab-sidebar-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    Docs: ${escapeHtml(lab.pathfindingCloudId.toUpperCase())}
                </a>` : ''}
            </div>
        </div>`;

    html += '</div>';
    return html;
}

function renderSidebarPermissions(permissions, labSlug) {
    if (!permissions) return '';

    const hasRequired = permissions.required && permissions.required.length > 0;
    const hasHelpful = permissions.helpful && permissions.helpful.length > 0;

    if (!hasRequired && !hasHelpful) return '';

    let html = `<div class="lab-sidebar-section">
        <h3 class="lab-sidebar-heading">Permissions</h3>`;

    if (hasRequired) {
        html += `<div class="lab-sidebar-perms">
            <div class="lab-sidebar-perm-label">Required</div>
            ${permissions.required.map(p =>
                `<code class="lab-sidebar-perm">${escapeHtml(p.permission)}</code>`
            ).join('')}
        </div>`;
    }

    if (hasHelpful) {
        html += `
            <button class="lab-sidebar-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                Helpful (${permissions.helpful.length})
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="lab-sidebar-perms lab-sidebar-perms-collapsible">
                ${permissions.helpful.map(p =>
                    `<code class="lab-sidebar-perm">${escapeHtml(p.permission)}</code>`
                ).join('')}
            </div>`;
    }

    html += '</div>';
    return html;
}

// ---- Tabs ----

// Renders a set of inner tabs (e.g. Non-Interactive | TUI, CSPM | CloudSIEM).
// tabs: array of { id, label, show, content }
// Returns empty string if no visible tabs have content.
function renderInnerTabContent(tab) {
    if (tab.id === 'tui') {
        return `<pre><code>${escapeHtml(tab.content)}</code></pre>`;
    }
    return renderLabMarkdown(tab.content);
}

function renderInnerTabSection(groupId, tabs) {
    const visible = tabs.filter(t => t.show && t.content);
    if (visible.length === 0) return '';
    if (visible.length === 1) {
        return `<div class="lab-inner-tab-content">${renderInnerTabContent(visible[0])}</div>`;
    }
    const buttons = visible.map((t, i) =>
        `<button class="lab-inner-tab-btn ${i === 0 ? 'active' : ''}"
            data-tab-target="${groupId}-${t.id}" data-tab-group="${groupId}">${t.label}</button>`
    ).join('');
    const panels = visible.map((t, i) =>
        `<div id="${groupId}-${t.id}" class="tab-content ${i === 0 ? 'active' : ''}"
            data-tab-group="${groupId}"><div class="lab-inner-tab-content">${renderInnerTabContent(t)}</div></div>`
    ).join('');
    return `<div class="lab-inner-tabs"><div class="lab-inner-tab-bar">${buttons}</div>${panels}</div>`;
}

function renderDetailTabs(lab, hasReadme, matchingPath) {
    const tabGroup = 'lab-detail-tabs';
    const tabs = [];

    // V1 schema: tabs map directly to ## sections in the README
    const isV1 = hasReadme && lab.readme?.attackLab;

    if (isV1) {
        // ## Attack Overview
        tabs.push({ id: 'overview', label: 'Attack Overview', content: renderOverviewTabV1(lab) });
        // ## Attack Lab
        tabs.push({ id: 'lab', label: 'Attack Lab', content: renderLabTabV1(lab, hasReadme, matchingPath) });
        // ## Detecting Misconfiguration (CSPM)
        if (lab.readme?.cspm) {
            tabs.push({ id: 'cspm', label: 'Detecting Misconfiguration (CSPM)', content: renderCspmTab(lab) });
        }
        // ## Detection Abuse (CloudSIEM)
        if (lab.readme?.cloudSiem) {
            tabs.push({ id: 'siem', label: 'Detection Abuse (CloudSIEM)', content: renderCloudSiemTab(lab) });
        }
    } else {
        // Legacy schema: existing tab structure
        tabs.push({ id: 'overview', label: 'Overview', content: renderOverviewTab(lab, hasReadme) });
        tabs.push({ id: 'lab', label: 'Lab', content: renderLabTab(lab, hasReadme, matchingPath) });

        const hasAttackContent = (hasReadme && (lab.readme?.attackSteps || lab.readme?.accessPathDetails))
            || (lab.attackPath && lab.attackPath.principals && lab.attackPath.principals.length > 0);
        if (hasAttackContent) {
            tabs.push({ id: 'attack', label: 'Attack', content: renderAttackTab(lab, hasReadme) });
        }

        const hasDetectionContent = lab.cspmDetection || lab.risk
            || (hasReadme && (lab.readme?.cspm || lab.readme?.cloudSiem));
        if (hasDetectionContent) {
            tabs.push({ id: 'detection', label: 'Detection', content: renderDetectionTab(lab, hasReadme) });
        }

        const hasPreventionContent = (hasReadme && (lab.readme?.prevention || lab.readme?.cspm?.prevention))
            || lab.remediation;
        if (hasPreventionContent) {
            tabs.push({ id: 'prevent', label: 'Prevention', content: renderPreventionTab(lab, hasReadme) });
        }
    }

    // Build tab buttons
    const tabButtons = tabs.map((tab, idx) =>
        `<button class="lab-detail-tab-btn ${idx === 0 ? 'active' : ''}"
                data-tab-target="${tabGroup}-${tab.id}"
                data-tab-group="${tabGroup}">${tab.label}</button>`
    ).join('');

    // Build tab content panels
    const tabPanels = tabs.map((tab, idx) =>
        `<div id="${tabGroup}-${tab.id}" class="tab-content ${idx === 0 ? 'active' : ''}" data-tab-group="${tabGroup}">
            ${tab.content}
        </div>`
    ).join('');

    return `
        <div class="lab-detail-tabs-container">
            <div class="lab-detail-tab-bar">${tabButtons}</div>
            <div class="lab-detail-tab-panels">${tabPanels}</div>
        </div>`;
}

// ---- Tab Content Renderers ----

function renderOverviewTab(lab, hasReadme) {
    let html = '';

    // Rich overview from README, or fall back to description
    if (hasReadme && lab.readme.overview) {
        html += `<div class="lab-tab-prose">${renderLabMarkdown(lab.readme.overview)}</div>`;
    } else {
        html += `<div class="lab-tab-prose"><p>${escapeHtml(lab.description)}</p></div>`;
    }

    // Attack diagram (mermaid source as code block)
    if (hasReadme && lab.readme.attackDiagram) {
        html += `
            <div class="lab-tab-section">
                <h3>Attack Diagram</h3>
                <div class="lab-diagram-block">
                    <div class="lab-diagram-header">
                        <span>Mermaid</span>
                        <button class="lab-copy-btn" onclick="copyToClipboard(\`${escapeAttr(lab.readme.attackDiagram)}\`, this)" title="Copy diagram source">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                    </div>
                    <pre><code>${escapeHtml(lab.readme.attackDiagram)}</code></pre>
                </div>
            </div>`;
    }

    // Security implications
    if (hasReadme && lab.readme.securityImplications) {
        html += `
            <div class="lab-tab-section">
                <h3>Security Implications</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(lab.readme.securityImplications)}</div>
            </div>`;
    }

    // CSPM-specific sections on overview if no separate prevention tab content
    if (lab.testGroups) {
        html += `
            <div class="lab-tab-section">
                <h3>Test Groups</h3>
                ${lab.adminDefinition ? `<p><strong>Admin Definition:</strong> ${escapeHtml(lab.adminDefinition)}</p>` : ''}
                <pre class="lab-code-block-pre"><code>${escapeHtml(JSON.stringify(lab.testGroups, null, 2))}</code></pre>
            </div>`;
    }

    return html;
}

// V1 schema Overview tab: renders ## Attack Overview H3 subsections
function renderOverviewTabV1(lab) {
    let html = '';
    const readme = lab.readme;

    // Overview prose (content before first ###)
    if (readme?.overview) {
        html += `<div class="lab-tab-prose">${renderLabMarkdown(readme.overview)}</div>`;
    } else {
        html += `<div class="lab-tab-prose"><p>${escapeHtml(lab.description)}</p></div>`;
    }

    // ### Attack Path Diagram
    if (readme?.attackDiagram) {
        html += `
            <div class="lab-tab-section">
                <h3>Attack Path Diagram</h3>
                <div class="lab-diagram-block">
                    <div class="lab-diagram-header">
                        <span>Mermaid</span>
                        <button class="lab-copy-btn" onclick="copyToClipboard(\`${escapeAttr(readme.attackDiagram)}\`, this)" title="Copy diagram source">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                    </div>
                    <pre><code>${escapeHtml(readme.attackDiagram)}</code></pre>
                </div>
            </div>`;
    }

    // ### Attack Steps
    if (readme?.attackSteps) {
        html += `
            <div class="lab-tab-section">
                <h3>Attack Steps</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(readme.attackSteps)}</div>
            </div>`;
    }

    // ### Scenario specific resources created
    if (readme?.resourcesCreated) {
        html += `
            <div class="lab-tab-section">
                <h3>Scenario Resources</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(readme.resourcesCreated)}</div>
            </div>`;
    }

    // ### MITRE ATT&CK Mapping
    if (readme?.mitreAttack) {
        html += `
            <div class="lab-tab-section">
                <h3>MITRE ATT&amp;CK Mapping</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(readme.mitreAttack)}</div>
            </div>`;
    }

    // Principals (from metadata)
    if (lab.attackPath?.principals?.length > 0) {
        html += `
            <div class="lab-tab-section">
                <h3>Principals</h3>
                <div class="lab-principals-compact">
                    ${lab.attackPath.principals.map(p => `<code class="lab-principal-arn">${escapeHtml(p)}</code>`).join('')}
                </div>
            </div>`;
    }

    return html;
}

// V1 schema CSPM tab: renders ## Detecting Misconfiguration (CSPM) H3 subsections
function renderCspmTab(lab) {
    let html = '';
    const cspm = lab.readme?.cspm;

    // ### What CSPM tools should detect
    if (cspm?.whatToDetect) {
        html += `
            <div class="lab-tab-section">
                <h3>What CSPM Tools Should Detect</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(cspm.whatToDetect)}</div>
            </div>`;
    }

    // ### Prevention recommendations
    if (cspm?.prevention) {
        html += `
            <div class="lab-tab-section">
                <h3>Prevention Recommendations</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(cspm.prevention)}</div>
            </div>`;
    }

    // Legacy CSPM metadata (rule ID, severity, etc.)
    if (lab.cspmDetection) {
        html += `<div class="lab-tab-section"><h3>CSPM Detection Rule</h3>${renderCspmDetection(lab.cspmDetection)}</div>`;
    }

    if (lab.risk) {
        html += `<div class="lab-tab-section"><h3>Risk</h3>${renderRisk(lab.risk)}</div>`;
    }

    return html;
}

// V1 schema CloudSIEM tab: renders ## Detection Abuse (CloudSIEM) H3 subsections
function renderCloudSiemTab(lab) {
    let html = '';
    const siem = lab.readme?.cloudSiem;

    // ### CloudTrail events to monitor
    if (siem?.cloudTrailEvents) {
        html += `
            <div class="lab-tab-section">
                <h3>CloudTrail Events to Monitor</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(siem.cloudTrailEvents)}</div>
            </div>`;
    }

    // ### Detonation logs
    if (siem?.detonationLogs) {
        html += `
            <div class="lab-tab-section">
                <h3>Detonation Logs</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(siem.detonationLogs)}</div>
            </div>`;
    }

    return html;
}

function renderAttackTab(lab, hasReadme) {
    let html = '';

    // Attack steps from README
    if (hasReadme && lab.readme.attackSteps) {
        html += `<div class="lab-tab-prose">${renderLabMarkdown(lab.readme.attackSteps)}</div>`;
    }

    // Access path details from README
    if (hasReadme && lab.readme.accessPathDetails) {
        html += `
            <div class="lab-tab-section">
                <h3>Access Path Details</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(lab.readme.accessPathDetails)}</div>
            </div>`;
    }

    // Resources created
    if (hasReadme && lab.readme.resourcesCreated) {
        html += `
            <div class="lab-tab-section">
                <h3>Resources Created</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(lab.readme.resourcesCreated)}</div>
            </div>`;
    }

    // Principals
    if (lab.attackPath && lab.attackPath.principals && lab.attackPath.principals.length > 0) {
        html += `
            <div class="lab-tab-section">
                <h3>Principals</h3>
                <div class="lab-principals-compact">
                    ${lab.attackPath.principals.map(p => `<code class="lab-principal-arn">${escapeHtml(p)}</code>`).join('')}
                </div>
            </div>`;
    }

    // Attack path summary (fallback if no README attack steps)
    if (!hasReadme || !lab.readme.attackSteps) {
        if (lab.attackPath && lab.attackPath.summary) {
            html += `
                <div class="lab-tab-section">
                    <h3>Attack Path Summary</h3>
                    <div class="lab-attack-summary">${escapeHtml(lab.attackPath.summary)}</div>
                </div>`;
        }
    }

    return html;
}

function buildCspmContent(lab, hasReadme) {
    let content = '';
    if (hasReadme && lab.readme?.cspm?.whatToDetect) {
        content += `<div class="lab-tab-prose">${renderLabMarkdown(lab.readme.cspm.whatToDetect)}</div>`;
    }
    if (lab.cspmDetection) {
        content += `<div class="lab-tab-section"><h3>CSPM Detection</h3>${renderCspmDetection(lab.cspmDetection)}</div>`;
    }
    if (lab.risk) {
        content += `<div class="lab-tab-section"><h3>Risk</h3>${renderRisk(lab.risk)}</div>`;
    }
    return content;
}

function buildSiemContent(lab) {
    let content = '';
    if (lab.readme?.cloudSiem?.cloudTrailEvents) {
        content += `<div class="lab-tab-section"><h3>CloudTrail Events</h3>
            <div class="lab-tab-prose">${renderLabMarkdown(lab.readme.cloudSiem.cloudTrailEvents)}</div>
        </div>`;
    }
    if (lab.readme?.cloudSiem?.detonationLogs) {
        content += `<div class="lab-tab-section"><h3>Detonation Logs</h3>
            <div class="lab-tab-prose">${renderLabMarkdown(lab.readme.cloudSiem.detonationLogs)}</div>
        </div>`;
    }
    return content;
}

function renderDetectionTab(lab, hasReadme) {
    const hasNewCspm = hasReadme && lab.readme?.cspm;
    const hasNewSiem = hasReadme && lab.readme?.cloudSiem;

    if (hasNewCspm || hasNewSiem) {
        const group = `lab-detection-${lab.slug}`;
        return renderInnerTabSection(group, [
            { id: 'cspm', label: 'CSPM', show: !!hasNewCspm, content: buildCspmContent(lab, hasReadme) },
            { id: 'siem', label: 'CloudSIEM', show: !!hasNewSiem, content: buildSiemContent(lab) },
        ]);
    }

    // Legacy fallback
    let html = '';
    if (lab.cspmDetection) {
        html += `<div class="lab-tab-section"><h3>CSPM Detection</h3>${renderCspmDetection(lab.cspmDetection)}</div>`;
    }
    if (lab.risk) {
        html += `<div class="lab-tab-section"><h3>Risk</h3>${renderRisk(lab.risk)}</div>`;
    }
    return html;
}

function renderPreventionTab(lab, hasReadme) {
    let html = '';

    // Prefer new-schema cspm.prevention, fall back to legacy readme.prevention
    const preventionContent = (hasReadme && lab.readme?.cspm?.prevention)
        || (hasReadme && lab.readme?.prevention);
    if (preventionContent) {
        html += `<div class="lab-tab-prose">${renderLabMarkdown(preventionContent)}</div>`;
    }

    // Remediation (from scenario.yaml)
    if (lab.remediation) {
        html += `<div class="lab-tab-section"><h3>Remediation</h3>${renderRemediation(lab.remediation)}</div>`;
    }

    return html;
}

// Extract the source links block — reused by both lab tab renderers
function renderLabSourceLinks(lab, matchingPath) {
    return `
        <div class="lab-tab-section">
            <h3>Source</h3>
            <div class="lab-deploy-actions">
                <a href="${lab.githubUrl}" target="_blank" rel="noopener noreferrer" class="lab-action-link">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    View Source on GitHub
                </a>
                ${matchingPath ? `
                <a href="/paths/${lab.pathfindingCloudId}" class="lab-action-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    Full Documentation: ${escapeHtml(matchingPath.name)}
                </a>` : ''}
            </div>
        </div>`;
}

// Dispatcher: use V1 renderer when new schema data is present, otherwise legacy
function renderLabTab(lab, hasReadme, matchingPath) {
    if (hasReadme && lab.readme?.attackLab) {
        return renderLabTabV1(lab, hasReadme, matchingPath);
    }
    return renderLabTabLegacy(lab, hasReadme, matchingPath);
}

// V1 schema lab tab: Prerequisites, Deploy, Demo, Manual Attack, Cleanup, Teardown, Source
function renderLabTabV1(lab, hasReadme, matchingPath) {
    let html = '';
    const attackLab = lab.readme.attackLab;
    const slug = lab.slug;

    // Prerequisites
    if (attackLab.prerequisites) {
        html += `
            <div class="lab-tab-section">
                <h3>Prerequisites</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(attackLab.prerequisites)}</div>
            </div>`;
    }

    // Deploy this lab — Non-Interactive | TUI inner tabs
    html += `
        <div class="lab-tab-section">
            <h3>Deploy this lab</h3>
            ${renderInnerTabSection(`${slug}-deploy`, [
                { id: 'cli', label: 'Non-Interactive', show: !!attackLab.deployNonInteractive, content: attackLab.deployNonInteractive },
                { id: 'tui', label: 'TUI', show: !!attackLab.deployTui, content: attackLab.deployTui },
            ])}
        </div>`;

    // Executing the Attack with the Automated Script
    if (attackLab.demoAttack) {
        const demo = attackLab.demoAttack;
        html += `<div class="lab-tab-section"><h3>Executing the Attack with the Automated Script</h3>`;
        html += renderInnerTabSection(`${slug}-demo`, [
            { id: 'cli', label: 'Non-Interactive', show: !!demo.nonInteractive, content: demo.nonInteractive },
            { id: 'tui', label: 'TUI', show: !!demo.tui, content: demo.tui },
        ]);
        if (demo.resourcesCreated) {
            html += `
                <div class="lab-tab-subsection">
                    <h4>Resources created by attack script</h4>
                    <div class="lab-tab-prose">${renderLabMarkdown(demo.resourcesCreated)}</div>
                </div>`;
        }
        html += '</div>';
    }

    // Executing the Attack Manually (optional)
    if (attackLab.manualAttack) {
        html += `
            <div class="lab-tab-section">
                <h3>Executing the Attack Manually</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(attackLab.manualAttack)}</div>
            </div>`;
    }

    // Remove Attack Artifacts — Non-Interactive | TUI inner tabs
    if (attackLab.cleanup) {
        const cleanup = attackLab.cleanup;
        html += `
            <div class="lab-tab-section">
                <h3>Remove Attack Artifacts</h3>
                ${renderInnerTabSection(`${slug}-cleanup`, [
                    { id: 'cli', label: 'Non-Interactive', show: !!cleanup.nonInteractive, content: cleanup.nonInteractive },
                    { id: 'tui', label: 'TUI', show: !!cleanup.tui, content: cleanup.tui },
                ])}
            </div>`;
    }

    // Teardown this lab — Non-Interactive | TUI inner tabs
    const hasTeardownCli = !!attackLab.teardownNonInteractive;
    const hasTeardownTui = !!attackLab.teardownTui;
    if (hasTeardownCli || hasTeardownTui) {
        html += `
            <div class="lab-tab-section">
                <h3>Teardown this lab</h3>
                ${renderInnerTabSection(`${slug}-teardown`, [
                    { id: 'cli', label: 'Non-Interactive', show: hasTeardownCli, content: attackLab.teardownNonInteractive },
                    { id: 'tui', label: 'TUI', show: hasTeardownTui, content: attackLab.teardownTui },
                ])}
            </div>`;
    }

    // Source links
    html += renderLabSourceLinks(lab, matchingPath);

    return html;
}

// Legacy lab tab: plabs CLI/TUI quickstart + execution guide from README
function renderLabTabLegacy(lab, hasReadme, matchingPath) {
    let html = '';

    // plabs CLI sub-section
    html += `
        <div class="lab-tab-section">
            <h3>plabs cli</h3>
            <p class="lab-tab-prose">Deploy this scenario from the command line using the <a href="https://github.com/DataDog/pathfinding-labs" target="_blank" rel="noopener noreferrer">pathfinding-labs</a> CLI.</p>
            <div class="lab-code-block">
                <code>plabs deploy ${escapeHtml(lab.slug)}</code>
                <button class="lab-copy-btn" onclick="copyToClipboard('plabs deploy ${escapeAttr(lab.slug)}', this)" title="Copy to clipboard">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                </button>
            </div>
            <p class="lab-deploy-tf-var">Terraform variable: <code>${escapeHtml(lab.terraform.variableName)}</code></p>
        </div>`;

    // plabs TUI sub-section
    html += `
        <div class="lab-tab-section">
            <h3>plabs tui</h3>
            <p class="lab-tab-prose">Launch the interactive terminal UI to browse and deploy scenarios visually.</p>
            <div class="lab-code-block">
                <code>plabs tui</code>
                <button class="lab-copy-btn" onclick="copyToClipboard('plabs tui', this)" title="Copy to clipboard">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                </button>
            </div>
        </div>`;

    // Execution guide from README
    if (hasReadme && lab.readme.executionGuide) {
        html += `
            <div class="lab-tab-section">
                <h3>Execution Guide</h3>
                <div class="lab-tab-prose">${renderLabMarkdown(lab.readme.executionGuide)}</div>
            </div>`;
    }

    html += renderLabSourceLinks(lab, matchingPath);

    return html;
}

// ---- CSPM / Risk / Remediation renderers (reused from before, inline format) ----

function renderCspmDetection(cspmDetection) {
    if (typeof cspmDetection === 'string') {
        return `<p>${escapeHtml(cspmDetection)}</p>`;
    }

    let content = '';
    if (cspmDetection.description) {
        content += `<p>${escapeHtml(cspmDetection.description)}</p>`;
    }
    if (cspmDetection.rule_id) {
        content += `<p><strong>Rule ID:</strong> <code>${escapeHtml(cspmDetection.rule_id)}</code></p>`;
    }
    if (cspmDetection.severity) {
        content += `<p><strong>Severity:</strong> ${escapeHtml(cspmDetection.severity)}</p>`;
    }
    if (cspmDetection.expected_finding) {
        const ef = cspmDetection.expected_finding;
        content += `<div style="margin-top: 12px;"><strong>Expected Finding:</strong></div>`;
        if (ef.resource_type) content += `<p style="margin-left: 16px;"><strong>Resource Type:</strong> <code>${escapeHtml(ef.resource_type)}</code></p>`;
        if (ef.resource_id) content += `<p style="margin-left: 16px;"><strong>Resource ID:</strong> <code>${escapeHtml(ef.resource_id)}</code></p>`;
        if (ef.finding) content += `<p style="margin-left: 16px;"><strong>Finding:</strong> ${escapeHtml(ef.finding)}</p>`;
    }
    return content;
}

function renderRisk(risk) {
    if (typeof risk === 'string') {
        return `<p>${escapeHtml(risk)}</p>`;
    }

    let content = '';
    if (risk.summary) {
        content += `<p>${escapeHtml(risk.summary)}</p>`;
    }
    if (risk.impact && risk.impact.length > 0) {
        content += `<div style="margin-top: 12px;"><strong>Impact:</strong></div><ul>${risk.impact.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    }
    if (risk.access_vectors && risk.access_vectors.length > 0) {
        content += `<div style="margin-top: 12px;"><strong>Access Vectors:</strong></div><ul>${risk.access_vectors.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`;
    }
    return content;
}

function renderRemediation(remediation) {
    if (typeof remediation === 'string') {
        return `<p>${escapeHtml(remediation)}</p>`;
    }

    let content = '';
    if (remediation.summary) {
        content += `<p>${escapeHtml(remediation.summary)}</p>`;
    }
    if (remediation.recommendations && remediation.recommendations.length > 0) {
        content += `<ul>${remediation.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
    }
    return content;
}

// ---- Markdown Rendering ----

function renderLabMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Convert ```language\ncode\n``` to <pre><code>code</code></pre>
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Convert inline `code` to <code>code</code>
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert **bold** to <strong>bold</strong>
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert *italic* to <em>italic</em>
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Convert [text](url) to <a href="url">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Convert ### headings
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');

    // Convert markdown tables
    html = convertMarkdownTables(html);

    // Convert lists (ordered and unordered)
    html = convertMarkdownLists(html);

    // Convert remaining paragraphs: double newlines become paragraph breaks
    html = html.replace(/\n\n+/g, '</p><p>');

    // Single newlines (not inside pre/code) become <br>
    html = html.replace(/\n(?![<])/g, '<br>');

    // Clean up breaks around block elements
    html = html.replace(/<br>\s*<(ul|ol|pre|h[1-6]|table|\/p|p)/g, '<$1');
    html = html.replace(/<\/(ul|ol|pre|h[1-6]|table)>\s*<br>/g, '</$1>');
    html = html.replace(/<br>\s*<li>/g, '<li>');
    html = html.replace(/<\/li>\s*<br>/g, '</li>');
    html = html.replace(/<br>\s*<h4>/g, '<h4>');
    html = html.replace(/<\/h4>\s*<br>/g, '</h4>');
    html = html.replace(/<br>\s*<tr>/g, '<tr>');
    html = html.replace(/<\/tr>\s*<br>/g, '</tr>');

    // Wrap in paragraph if not starting with a block element
    if (!html.match(/^\s*<(ul|ol|pre|h[1-6]|table|div)/)) {
        html = `<p>${html}</p>`;
    }

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
}

function convertMarkdownTables(html) {
    // Match markdown table blocks (header row, separator row, data rows)
    const tableRegex = /(?:^|\n)(\|[^\n]+\|)\n(\|[-:\s|]+\|)\n((?:\|[^\n]+\|\n?)*)/g;

    return html.replace(tableRegex, function(match, headerRow, separatorRow, bodyRows) {
        // Parse header
        const headers = headerRow.split('|').filter(c => c.trim()).map(c => c.trim());

        // Parse alignment from separator
        const alignments = separatorRow.split('|').filter(c => c.trim()).map(c => {
            const cell = c.trim();
            if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
            if (cell.endsWith(':')) return 'right';
            return 'left';
        });

        // Parse body rows
        const rows = bodyRows.trim().split('\n').filter(r => r.includes('|')).map(row =>
            row.split('|').filter(c => c.trim() !== '' || c.includes(' ')).map(c => c.trim()).filter(c => c !== '')
        );

        let table = '<table class="lab-md-table"><thead><tr>';
        headers.forEach((h, i) => {
            const align = alignments[i] ? ` style="text-align:${alignments[i]}"` : '';
            table += `<th${align}>${h}</th>`;
        });
        table += '</tr></thead><tbody>';

        rows.forEach(row => {
            table += '<tr>';
            row.forEach((cell, i) => {
                const align = alignments[i] ? ` style="text-align:${alignments[i]}"` : '';
                table += `<td${align}>${cell}</td>`;
            });
            table += '</tr>';
        });

        table += '</tbody></table>';
        return table;
    });
}

function convertMarkdownLists(html) {
    const lines = html.split('\n');
    let inOrderedList = false;
    let inUnorderedList = false;
    const result = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const unorderedMatch = line.match(/^(\s*)[-*] (.+)$/);
        const orderedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);

        if (unorderedMatch) {
            if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
            if (!inUnorderedList) { result.push('<ul>'); inUnorderedList = true; }
            result.push(`<li>${unorderedMatch[2]}</li>`);
        } else if (orderedMatch) {
            if (inUnorderedList) { result.push('</ul>'); inUnorderedList = false; }
            if (!inOrderedList) { result.push('<ol>'); inOrderedList = true; }
            result.push(`<li>${orderedMatch[2]}</li>`);
        } else {
            if (inUnorderedList) { result.push('</ul>'); inUnorderedList = false; }
            if (inOrderedList) { result.push('</ol>'); inOrderedList = false; }
            result.push(line);
        }
    }

    if (inUnorderedList) result.push('</ul>');
    if (inOrderedList) result.push('</ol>');

    return result.join('\n');
}

// ---- Tab click handling ----

function setupTabListeners() {
    document.removeEventListener('click', handleTabClick);
    document.addEventListener('click', handleTabClick);
}

function handleTabClick(event) {
    const tabButton = event.target.closest('[data-tab-target]');
    if (!tabButton) return;

    const targetId = tabButton.getAttribute('data-tab-target');
    const tabGroup = tabButton.getAttribute('data-tab-group');

    if (!targetId || !tabGroup) return;

    // Hide all tab content in this group
    const tabContents = document.querySelectorAll(`.tab-content[data-tab-group="${tabGroup}"]`);
    tabContents.forEach(content => content.classList.remove('active'));

    // Remove active class from all buttons in this group
    const tabButtons = document.querySelectorAll(`[data-tab-group="${tabGroup}"][data-tab-target]`);
    tabButtons.forEach(button => button.classList.remove('active'));

    // Show selected tab content
    const targetContent = document.getElementById(targetId);
    if (targetContent) {
        targetContent.classList.add('active');
    }

    // Activate clicked button
    tabButton.classList.add('active');
}

// ---- Utility functions ----

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text || '';
    return text.substring(0, maxLength) + '...';
}

function debounce(fn, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        const originalHTML = button.innerHTML;
        button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        button.classList.add('copied');
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 2000);
    });
}
