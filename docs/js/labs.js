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

// Debug mode: append ?debug to any lab URL to see the JSON field path for each rendered value.
// Example: /labs/ssm-002?debug
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

// Returns an inline badge showing the JSON field path, only when DEBUG_MODE is active.
function debugTag(fieldPath) {
    if (!DEBUG_MODE) return '';
    return `<span class="debug-field-tag" title="${escapeHtml(fieldPath)}">[${escapeHtml(fieldPath)}]</span>`;
}

// Returns a block-level source banner for a section, only when DEBUG_MODE is active.
function debugSection(fieldPath) {
    if (!DEBUG_MODE) return '';
    return `<div class="debug-section-source">source: ${escapeHtml(fieldPath)}</div>`;
}

// DOM elements
const labsContainer = document.getElementById('labs-container');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');
const pathTypeFilter = document.getElementById('path-type-filter');
const targetFilter = document.getElementById('target-filter');
const costFilter = document.getElementById('cost-filter');
const hopsFilter = document.getElementById('hops-filter');
const startFilter = document.getElementById('start-filter');
const serviceFilter = document.getElementById('service-filter');
const onlineFilter = document.getElementById('online-filter');
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
    'CSPM: Misconfig': { label: 'CSPM', cssClass: 'lab-badge-cspm' },
    'Toxic Combination': { label: 'Toxic Combo', cssClass: 'lab-badge-toxic' },
    'CSPM: Toxic Combination': { label: 'Toxic Combo', cssClass: 'lab-badge-toxic' },
    'Tool Testing': { label: 'Tool Testing', cssClass: 'lab-badge-tooltest' },
    'CTF': { label: 'CTF', cssClass: 'lab-badge-ctf' },
    'Attack Simulation': { label: 'Attack Sim', cssClass: 'lab-badge-attacksim' },
};

// Category banner configuration for card graphics
const categoryBannerConfig = {
    'Privilege Escalation': { bannerClass: 'lab-banner-privesc', bannerText: 'PRIVILEGE ESCALATION' },
    'CSPM Misconfiguration': { bannerClass: 'lab-banner-cspm', bannerText: 'CSPM MISCONFIGURATION' },
    'CSPM: Misconfig': { bannerClass: 'lab-banner-cspm', bannerText: 'CSPM MISCONFIGURATION' },
    'Toxic Combination': { bannerClass: 'lab-banner-toxic', bannerText: 'TOXIC COMBINATION' },
    'CSPM: Toxic Combination': { bannerClass: 'lab-banner-toxic', bannerText: 'TOXIC COMBINATION' },
    'Tool Testing': { bannerClass: 'lab-banner-tooltest', bannerText: 'TOOL TESTING' },
    'CTF': { bannerClass: 'lab-banner-ctf', bannerText: 'CTF CHALLENGE' },
    'Attack Simulation': { bannerClass: 'lab-banner-attacksim', bannerText: 'ATTACK SIMULATION' },
};

// Path type display labels and colors
const pathTypeLabels = {
    'self-escalation': 'Self',
    'one-hop': '1-Hop',
    'multi-hop': 'Multi-Hop',
    'cross-account': 'Cross-Acct',
    'single-condition': 'Single',
    'toxic-combination': 'Toxic',
    'ctf': 'CTF',
    'attack-simulation': 'Atk Sim',
};

const pathTypeColors = {
    'self-escalation': 'lab-pathtype-self',
    'one-hop': 'lab-pathtype-onehop',
    'multi-hop': 'lab-pathtype-multihop',
    'cross-account': 'lab-pathtype-crossacct',
    'single-condition': 'lab-pathtype-single',
    'toxic-combination': 'lab-pathtype-toxic',
    'ctf': 'lab-pathtype-ctf',
    'attack-simulation': 'lab-pathtype-attacksim',
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
    'ec2':                  { label: 'EC2',            color: '#E8702A' },
    'ec2-instance-connect': { label: 'EC2 Connect',    color: '#E8702A' }, // Compute
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

// ---------------------------------------------------------------------------
// Compatibility accessors: work with both v2 and v3 data structures
// ---------------------------------------------------------------------------

function getOverview(lab) {
    return lab.readme?.objective || lab.readme?.overview || lab.description;
}

function getSetup(lab) {
    return lab.readme?.setup || lab.readme?.attackLab || {};
}

function getAttackDemo(lab) {
    return lab.readme?.attack?.demoAttack || lab.readme?.attackLab?.demoAttack;
}

function getCleanup(lab) {
    return lab.readme?.attack?.cleanup || lab.readme?.attackLab?.cleanup;
}

function getTeardown(lab) {
    const setup = getSetup(lab);
    const teardown = lab.readme?.teardown;
    if (teardown) return teardown;
    // v2 stored teardown inside attackLab
    if (setup.teardownNonInteractive || setup.teardownTui) {
        return {
            nonInteractive: setup.teardownNonInteractive,
            tui: setup.teardownTui,
        };
    }
    return {};
}

function getDefendCspm(lab) {
    return lab.readme?.defend?.cspm || lab.readme?.cspm;
}

function getDefendSiem(lab) {
    return lab.readme?.defend?.cloudSiem || lab.readme?.cloudSiem;
}

function getResourcesCreated(lab) {
    return lab.readme?.attack?.resourcesCreated || lab.readme?.resourcesCreated;
}

function getSolution(lab) {
    return lab.readme?.solution ?? lab.readme?.guidedWalkthrough;
}

function isV3Schema(lab) {
    return lab.schemaVersion?.startsWith('3') || !!lab.readme?.objective;
}

// Determine if an ARN represents a principal (IAM user/role), a public entry point, or a resource
function classifyArn(arn) {
    if (!arn) return { type: 'resource', label: 'Resource' };
    // Public URLs (Lambda function URLs, API Gateway, etc.) — no IAM identity required
    if (arn.startsWith('https://') || arn.startsWith('http://')) {
        return { type: 'public', label: 'Public URL', icon: 'public' };
    }
    // IAM users and roles are principals
    if (arn.includes(':user/')) return { type: 'principal', label: 'IAM User', icon: 'user' };
    if (arn.includes(':role/')) return { type: 'principal', label: 'IAM Role', icon: 'role' };
    if (arn.includes(':group/')) return { type: 'principal', label: 'IAM Group', icon: 'group' };
    // Non-ARN descriptive labels (e.g., "anonymous (public URL)") — public/anonymous access
    if (!arn.startsWith('arn:')) return { type: 'public', label: 'Public Access', icon: 'public' };
    // Everything else is a resource
    return { type: 'resource', label: formatArnServiceLabel(arn), icon: 'resource' };
}

// Extract a human-readable service label from an ARN
function formatArnServiceLabel(arn) {
    if (!arn) return 'Resource';
    const arnParts = arn.split(':');
    if (arnParts.length < 6) return 'Resource';
    const service = arnParts[2]; // e.g. 'ec2', 'lambda', 's3'
    const resourcePart = arnParts.slice(5).join(':'); // e.g. 'instance/*', 'function/foo'
    const resourceType = resourcePart.split('/')[0]; // e.g. 'instance', 'function'
    const serviceLabels = {
        'ec2': 'EC2',
        'lambda': 'Lambda',
        's3': 'S3',
        'iam': 'IAM',
        'cloudformation': 'CloudFormation',
        'ssm': 'SSM',
        'ecs': 'ECS',
        'sagemaker': 'SageMaker',
        'bedrock': 'Bedrock',
        'glue': 'Glue',
        'codebuild': 'CodeBuild',
    };
    const svcLabel = serviceLabels[service] || service.toUpperCase();
    const typeLabel = resourceType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${svcLabel} ${typeLabel}`;
}

// Extract the short resource name from an ARN (last segment after /)
// For URLs, returns the URL as-is since truncating would lose meaningful context.
function getArnShortName(arn) {
    if (!arn) return '';
    if (arn.startsWith('https://') || arn.startsWith('http://')) return arn;
    const parts = arn.split('/');
    return parts[parts.length - 1] || arn;
}

// Format an ARN with the service and resource-type segments highlighted
// ARN format: arn:partition:service:region:account:resource-type/resource-name
function formatArnHighlighted(arn) {
    if (!arn) return '';
    const parts = arn.split(':');
    if (parts.length < 6) return escapeHtml(arn);

    // parts: [arn, partition, service, region, account, ...resource]
    const prefix = escapeHtml(parts.slice(0, 2).join(':') + ':');   // arn:aws:
    const service = escapeHtml(parts[2]);                            // iam, ec2, etc.
    const middle = escapeHtml(':' + parts[3] + ':' + parts[4] + ':'); // :region:account:
    const resourceFull = parts.slice(5).join(':');                   // e.g. role/my-role-name or instance/i-xxx

    // Split resource into type and name (on first /)
    const slashIdx = resourceFull.indexOf('/');
    if (slashIdx > 0) {
        const resourceType = escapeHtml(resourceFull.substring(0, slashIdx));
        const resourceName = escapeHtml(resourceFull.substring(slashIdx));
        return `${prefix}<span class="lab-arn-service">${service}</span>${middle}<span class="lab-arn-resource-type">${resourceType}</span>${resourceName}`;
    }

    // No slash -- just highlight the whole resource segment as type
    return `${prefix}<span class="lab-arn-service">${service}</span>${middle}<span class="lab-arn-resource-type">${escapeHtml(resourceFull)}</span>`;
}

// Build start/destination card data from attackMap nodes
function getStartDestination(lab) {
    const nodes = lab.attackMap?.nodes;
    const edges = lab.attackMap?.edges;
    if (!nodes?.length) return null;

    // Start node: first node (no incoming edges or explicitly the first)
    const incomingCount = {};
    nodes.forEach(n => { incomingCount[n.id] = 0; });
    if (edges) {
        edges.forEach(e => { incomingCount[e.to] = (incomingCount[e.to] || 0) + 1; });
    }
    const startNode = nodes.find(n => incomingCount[n.id] === 0) || nodes[0];

    // Destination node: last reachable node following edges
    let destNode = startNode;
    if (edges?.length) {
        const visited = new Set();
        let current = startNode.id;
        while (current && !visited.has(current)) {
            visited.add(current);
            const outEdge = edges.find(e => e.from === current && !visited.has(e.to));
            if (outEdge) {
                current = outEdge.to;
            } else {
                break;
            }
        }
        const found = nodes.find(n => n.id === current);
        if (found && found.id !== startNode.id) destNode = found;
    }

    return { start: startNode, destination: destNode };
}

// Extract unique AWS services from required permissions by splitting on ':'
// Reads from the starting principal only (principals[0]) for display purposes.
// Falls back to flat permissions.required for legacy (v1/v2) index data.
function parseServicesFromPermissions(permissions) {
    const required = permissions?.principals?.[0]?.required ?? permissions?.required ?? [];
    if (!required.length) return [];
    const seen = new Set();
    const services = [];
    for (const p of required) {
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

// Keyboard navigation for walkthrough (V3) and guided mode - left/right arrow keys
document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Don't intercept if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const direction = e.key === 'ArrowRight' ? 1 : -1;

        // Check for guided mode container first
        const activeGuided = document.querySelector('.lab-guided-container');
        if (activeGuided) {
            guidedNav(activeGuided.id, direction);
            return;
        }

        // Check if a walkthrough is visible
        const activeWt = document.querySelector('.ov-wt-container:not([style*="display: none"])');
        if (!activeWt) return;
        const wtId = activeWt.id;
        if (!wtId) return;
        walkthroughNav(wtId, direction);
    }
});

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
    hopsFilter.addEventListener('change', applyFilters);
    startFilter.addEventListener('change', applyFilters);
    serviceFilter.addEventListener('change', applyFilters);
    onlineFilter.addEventListener('change', applyFilters);
    resetButton.addEventListener('click', resetFilters);
    themeToggle.addEventListener('click', toggleTheme);

    if (viewCardsBtn) viewCardsBtn.addEventListener('click', () => switchView('cards'));
    if (viewTableBtn) viewTableBtn.addEventListener('click', () => switchView('table'));

    window.addEventListener('popstate', () => routeFromURL());
}

// Populate the hops filter dropdown with all distinct hop counts from labs data
function populateHopsFilter(labs) {
    const hopCounts = new Set();
    labs.forEach(lab => {
        if (lab.principalHopCount !== null && lab.principalHopCount !== undefined) {
            hopCounts.add(lab.principalHopCount);
        }
    });
    const sorted = [...hopCounts].sort((a, b) => a - b);
    sorted.forEach(count => {
        const opt = document.createElement('option');
        opt.value = String(count);
        opt.textContent = count === 0 ? '0 (self)' : `${count} hop${count === 1 ? '' : 's'}`;
        hopsFilter.appendChild(opt);
    });
}

// Populate the service filter dropdown from labs data
function populateServiceFilter(labs) {
    const serviceSet = new Set();
    labs.forEach(lab => {
        (lab.services || []).forEach(s => serviceSet.add(s));
    });
    const sorted = [...serviceSet].sort();
    sorted.forEach(service => {
        const cfg = awsServiceConfig[service] || { label: service.toUpperCase() };
        const opt = document.createElement('option');
        opt.value = service;
        opt.textContent = cfg.label;
        serviceFilter.appendChild(opt);
    });
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

        populateHopsFilter(labs);
        populateServiceFilter(labs);
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

function navigateToLab(slug, e) {
    // Ctrl+click or Cmd+click opens in a new tab
    if (e && (e.ctrlKey || e.metaKey)) {
        window.open(`/labs/${slug}`, '_blank');
        return;
    }
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
    document.body.classList.remove('lab-game-mode');
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
    const selectedHops = hopsFilter.value;
    const selectedStart = startFilter.value;
    const selectedService = serviceFilter.value;
    const selectedOnline = onlineFilter.value;

    filteredLabs = allLabs.filter(lab => {
        // Search filter
        if (searchTerm) {
            const searchableText = [
                lab.displayName || lab.name,
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

        // Hops filter (exact match against dynamically populated counts)
        if (selectedHops !== '' && String(lab.principalHopCount) !== selectedHops) return false;

        // Start access type filter
        if (selectedStart && lab.startAccessType !== selectedStart) return false;

        // Service filter
        if (selectedService && !(lab.services || []).includes(selectedService)) return false;

        // Online play filter
        if (selectedOnline === 'yes' && !lab.supportsOnlineMode) return false;
        if (selectedOnline === 'no' && lab.supportsOnlineMode) return false;

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
    hopsFilter.value = '';
    startFilter.value = '';
    serviceFilter.value = '';
    onlineFilter.value = '';
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
            case 'name': aVal = a.displayName || a.name; bVal = b.displayName || b.name; break;
            case 'category': aVal = a.category; bVal = b.category; break;
            case 'pathType': aVal = a.pathType; bVal = b.pathType; break;
            case 'start': aVal = a.startAccessType; bVal = b.startAccessType; break;
            case 'target': aVal = a.target; bVal = b.target; break;
            case 'hops': aVal = a.principalHopCount ?? -1; bVal = b.principalHopCount ?? -1;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            case 'cost': aVal = a.costEstimate; bVal = b.costEstimate; break;
            case 'online': aVal = a.supportsOnlineMode ? 1 : 0; bVal = b.supportsOnlineMode ? 1 : 0;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            default: aVal = a.displayName || a.name; bVal = b.displayName || b.name;
        }
        const cmp = String(aVal || '').localeCompare(String(bVal || ''));
        return sortDirection === 'asc' ? cmp : -cmp;
    });
}

// Short display labels for startAccessType
const startAccessLabels = {
    'assumed-breach-credentials': 'Creds',
    'assumed-breach-network':     'Network',
    'public-network':             'Public',
};

// Rendering - Table View
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
                <th class="sortable" data-sort="start">Start${sortIndicator('start')}</th>
                <th class="sortable" data-sort="target">Target${sortIndicator('target')}</th>
                <th class="sortable" data-sort="hops">Hops${sortIndicator('hops')}</th>
                <th class="sortable" data-sort="cost">Cost${sortIndicator('cost')}</th>
                <th>Services</th>
            </tr>
        </thead>
        <tbody>`;

    for (const lab of sorted) {
        const { catConfig, pathTypeLabel, pathTypeClass, targetLabel, targetClass, costLabel, costClass } = getLabDisplayValues(lab);
        const startLabel = startAccessLabels[lab.startAccessType] || '';
        const hopsVal = lab.principalHopCount !== null && lab.principalHopCount !== undefined ? lab.principalHopCount : '';
        const serviceIcons = renderServiceIcons(lab.permissions || {});
        const onlineLabel = lab.supportsOnlineMode ? 'Yes' : '';

        html += `
            <tr class="lab-row" data-slug="${lab.slug}">
                <td class="lab-name-desc-cell">
                    <span class="lab-name-text">${escapeHtml(lab.displayName || lab.name)}</span>
                    <div class="lab-table-description">${escapeHtml(truncate(lab.description, 120))}</div>
                </td>
                <td><span class="lab-badge ${catConfig.cssClass}">${catConfig.label}</span></td>
                <td><span class="lab-badge ${pathTypeClass}">${pathTypeLabel}</span></td>
                <td class="lab-table-nowrap">${startLabel ? `<span class="lab-badge lab-badge-start">${escapeHtml(startLabel)}</span>` : ''}</td>
                <td>${targetLabel ? `<span class="lab-badge ${targetClass}">${targetLabel}</span>` : ''}</td>
                <td class="lab-table-center">${hopsVal !== '' ? `<span class="lab-hops-count">${hopsVal}</span>` : ''}</td>
                <td><span class="lab-badge ${costClass}">${costLabel}</span></td>
                <td class="lab-table-services">${serviceIcons}</td>
            </tr>`;
    }

    html += '</tbody></table>';
    labsContainer.innerHTML = html;

    // Add click listeners to make entire row clickable
    labsContainer.querySelectorAll('.lab-row').forEach(row => {
        const slug = row.dataset.slug;
        row.addEventListener('click', (e) => {
            if (e.target.closest('a')) return; // let anchor handle its own clicks
            navigateToLab(slug, e);
        });
        row.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                window.open(`/labs/${slug}`, '_blank');
            }
        });
    });

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
            if (slug) navigateToLab(slug, e);
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
    const hopsVal = lab.principalHopCount !== null && lab.principalHopCount !== undefined ? lab.principalHopCount : '?';
    const hopsLabel = hopsVal === 0 ? '0 (self)' : `${hopsVal} hop${hopsVal === 1 ? '' : 's'}`;

    return `
        <div class="lab-card lab-card-a" data-slug="${lab.slug}">
            ${renderBannerA(lab)}
            <div class="lab-card-body">
                <div class="lab-card-name">${escapeHtml(lab.displayName || lab.name)}</div>
                <div class="lab-card-description">${escapeHtml(truncate(lab.description, 450))}</div>
                <div class="lab-card-badges">
                    <span class="lab-card-badge-item"><span class="lab-card-badge-label">Principal Hops</span> <span class="lab-badge lab-hops-badge">${hopsLabel}</span></span>
                    ${targetLabel ? `<span class="lab-card-badge-item"><span class="lab-card-badge-label">Target</span> <span class="lab-badge ${targetClass}">${targetLabel}</span></span>` : ''}
                    <span class="lab-card-badge-item"><span class="lab-card-badge-label">Est. AWS Cost</span> <span class="lab-badge ${costClass}">${costLabel}</span></span>
                </div>
            </div>
        </div>`;
}

// Card Style B: 1-column, foreground-only banner, name + full description + bottom pills
function renderCardB(lab) {
    const { catConfig, pathTypeLabel, pathTypeClass, targetLabel, targetClass, costLabel, costClass } = getLabDisplayValues(lab);
    const hopsVal = lab.principalHopCount !== null && lab.principalHopCount !== undefined ? lab.principalHopCount : '?';
    const hopsLabel = hopsVal === 0 ? '0 (self)' : `${hopsVal} hop${hopsVal === 1 ? '' : 's'}`;

    return `
        <div class="lab-card lab-card-b" data-slug="${lab.slug}">
            ${renderBannerB(lab)}
            <div class="lab-card-body">
                <div class="lab-card-name">${escapeHtml(lab.displayName || lab.name)}</div>
                <div class="lab-card-description lab-card-description-full">${escapeHtml(lab.description)}</div>
                <div class="lab-card-badges">
                    <span class="lab-badge lab-hops-badge">${hopsLabel}</span>
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
    const hasReadme = lab.readme && Object.keys(lab.readme).length > 0;
    const hasRichContent = hasReadme || isV3Schema(lab);

    // Two modes: Guided v2 (default) and Game
    const savedMode = localStorage.getItem('labs-detail-mode') || 'guidedv2';
    const currentMode = hasRichContent ? savedMode : 'guidedv2';

    // Mode toggle
    const modeToggle = hasRichContent ? `
        <div class="lab-mode-toggle">
            <button class="lab-mode-btn ${currentMode === 'mapgame' ? 'active' : ''}" data-mode="mapgame"
                onclick="switchDetailMode('mapgame', window._currentLabDetail)">Game Mode</button>
            <button class="lab-mode-btn ${currentMode === 'guidedv2' ? 'active' : ''}" data-mode="guidedv2"
                onclick="switchDetailMode('guidedv2', window._currentLabDetail)">Single Page Mode</button>
        </div>` : '';

    // Store lab reference for mode switching
    window._currentLabDetail = lab;

    const shareUrl = `https://pathfinding.cloud/labs/${lab.slug || ''}`;
    const shareTitle = escapeHtml(lab.displayName || lab.name);
    const shareDropdown = `
        <div class="lab-share-wrapper">
            <button class="lab-share-trigger" aria-haspopup="true" aria-expanded="false">Share this lab</button>
            <div class="lab-share-dropdown" role="menu">
                <button class="lab-share-option" data-share-action="copy-link" data-share-url="${shareUrl}" data-share-name="${shareTitle}">Copy Link</button>
                <button class="lab-share-option" data-share-action="linkedin" data-share-url="${shareUrl}" data-share-name="${shareTitle}">LinkedIn</button>
                <button class="lab-share-option" data-share-action="twitter" data-share-url="${shareUrl}" data-share-name="${shareTitle}">X</button>
                <button class="lab-share-option" data-share-action="bluesky" data-share-url="${shareUrl}" data-share-name="${shareTitle}">Bluesky</button>
                <button class="lab-share-option" data-share-action="mastodon" data-share-url="${shareUrl}" data-share-name="${shareTitle}">Mastodon</button>
            </div>
        </div>`;

    let html = `
        <div class="detail-sticky-header">
            <nav class="breadcrumb">
                <span class="breadcrumb-links">
                    <a href="/labs/" onclick="event.preventDefault(); navigateToList();">All Labs</a>
                    <span class="breadcrumb-separator">></span>
                    <span class="breadcrumb-current">${escapeHtml(lab.displayName || lab.name)}</span>
                </span>
                <span class="breadcrumb-actions">
                    ${shareDropdown}
                    ${modeToggle}
                </span>
            </nav>
        </div>

        <div class="detail-scrollable-content">
        ${DEBUG_MODE ? '<div class="debug-mode-banner">Debug mode active — field sources are shown inline. Remove <code>?debug</code> from the URL to hide them.</div>' : ''}`;

    html += '</div>'; // close detail-scrollable-content (mode fills it after render)
    container.innerHTML = html;

    // Share dropdown toggle
    const shareWrapper = container.querySelector('.lab-share-wrapper');
    if (shareWrapper) {
        const trigger = shareWrapper.querySelector('.lab-share-trigger');
        const dropdown = shareWrapper.querySelector('.lab-share-dropdown');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = shareWrapper.classList.toggle('open');
            trigger.setAttribute('aria-expanded', open);
        });

        dropdown.addEventListener('click', (e) => {
            const btn = e.target.closest('.lab-share-option');
            if (!btn) return;
            const action = btn.dataset.shareAction;
            if (action === 'copy-link') {
                navigator.clipboard.writeText(btn.dataset.shareUrl).then(() => {
                    const original = btn.textContent;
                    btn.textContent = 'Copied!';
                    setTimeout(() => { btn.textContent = original; }, 1500);
                });
            } else if (typeof labShareAction === 'function') {
                const previewCanvas = document.querySelector(`#gv2-map-preview-container-${lab.slug} canvas`);
                labShareAction(action, previewCanvas, lab);
            }
            shareWrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        });

        // Close on outside click; use once-per-open to avoid listener accumulation
        const closeOnOutsideClick = (e) => {
            if (!shareWrapper.contains(e.target)) {
                shareWrapper.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', closeOnOutsideClick);
            }
        };
        trigger.addEventListener('click', () => {
            if (shareWrapper.classList.contains('open')) {
                document.addEventListener('click', closeOnOutsideClick);
            }
        });
    }

    const scrollableContent = container.querySelector('.detail-scrollable-content');
    document.body.classList.toggle('lab-game-mode', currentMode === 'mapgame');
    if (currentMode === 'mapgame') {
        renderLabDetailContentMapGame(lab, scrollableContent);
    } else {
        renderLabDetailContentGuidedV2(lab, scrollableContent);
    }
}


// ---- Permissions ----

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

// Render permissions as horizontal pill layout (used in guided v2 main content)
// Handles multi-principal scenarios (e.g., public entry point + IAM recon user) and
// public/anonymous principals that require no AWS credentials.
function renderPermissionsPills(permissions, labSlug) {
    if (!permissions) return '';

    // Per-principal structure (v4+)
    if (permissions.principals?.length) {
        // Only show the starting principal's permissions (principals[0]).
        // Intermediate principals in the chain are not shown here.
        const principal = permissions.principals[0];
        const isPublic = principal.principalType === 'public';
        const required = principal.required ?? [];
        const helpful = principal.helpful ?? [];
        let html = '';

        if (required.length) {
            const rowContent = isPublic
                ? `<span class="lab-perms-public-note">No AWS credentials required — public access</span>`
                : required.map(p => `<code class="lab-perm-pill">${escapeHtml(p.permission)}</code>`).join('');
            html += `<div class="lab-perms-pills-section">
                <div class="lab-perms-pills-label">Required Permissions for Starting User${debugTag('permissions.principals[0].required[].permission')}</div>
                <div class="lab-perms-pills-row">${rowContent}</div>
            </div>`;
        }

        if (helpful.length) {
            html += `<div class="lab-perms-pills-section">
                <button class="lab-perms-pills-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                    Helpful Permissions for Starting User (${helpful.length})${debugTag('permissions.principals[0].helpful[].permission')}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div class="lab-perms-pills-row lab-perms-pills-collapsible">
                    ${helpful.map(p => `<code class="lab-perm-pill">${escapeHtml(p.permission)}</code>`).join('')}
                </div>
            </div>`;
        }

        return html;
    }

    // Legacy flat arrays (v2/v3)
    const required = permissions.required ?? [];
    const helpful = permissions.helpful ?? [];
    if (!required.length && !helpful.length) return '';

    let html = '';

    if (required.length) {
        html += `<div class="lab-perms-pills-section">
            <div class="lab-perms-pills-label">Required Permissions for Starting User${debugTag('permissions.required[].permission')}</div>
            <div class="lab-perms-pills-row">
                ${required.map(p =>
                    `<code class="lab-perm-pill">${escapeHtml(p.permission)}</code>`
                ).join('')}
            </div>
        </div>`;
    }

    if (helpful.length) {
        html += `<div class="lab-perms-pills-section">
            <button class="lab-perms-pills-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                Helpful Permissions for Starting User (${helpful.length})${debugTag('permissions.helpful[].permission')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="lab-perms-pills-row lab-perms-pills-collapsible">
                ${helpful.map(p =>
                    `<code class="lab-perm-pill">${escapeHtml(p.permission)}</code>`
                ).join('')}
            </div>
        </div>`;
    }

    return html;
}

// ---- Resource Cards ----

// Parse a markdown table of resources (ARN | Purpose) and render as compact cards
function renderResourceCards(markdownTable) {
    if (!markdownTable) return '';
    // Parse table rows: | `arn:...` | description |
    const rows = [];
    const lines = markdownTable.split('\n');
    for (const line of lines) {
        if (!line.includes('|')) continue;
        // Skip header row and separator row
        if (line.match(/^\|\s*ARN\s*\|/i)) continue;
        if (line.match(/^\|\s*-+/)) continue;

        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length >= 2) {
            // Strip backticks from ARN
            const arn = cells[0].replace(/`/g, '');
            const purpose = cells[1].replace(/`/g, '');
            rows.push({ arn, purpose });
        }
    }

    if (rows.length === 0) {
        // Fallback to regular markdown rendering if we can't parse the table
        return renderLabMarkdown(markdownTable);
    }

    let html = `<table class="lab-resource-table">
        <thead>
            <tr>
                <th>ARN</th>
                <th>Purpose</th>
            </tr>
        </thead>
        <tbody>`;

    for (const row of rows) {
        html += `<tr>
            <td><code class="lab-resource-arn">${formatArnHighlighted(row.arn)}</code></td>
            <td class="lab-resource-purpose">${escapeHtml(row.purpose)}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    return html;
}

// ---- Tabs ----

// Renders a set of inner tabs (e.g. Non-Interactive | TUI, CSPM | CloudSIEM).
// tabs: array of { id, label, show, content }
// Returns empty string if no visible tabs have content.
function renderInnerTabContent(tab) {
    if (tab.rawHtml !== undefined) return tab.rawHtml;
    if (tab.id === 'tui') {
        return `<pre><code>${escapeHtml(tab.content)}</code></pre>`;
    }
    return renderLabMarkdown(tab.content);
}

// Outer-level tabs for setup section (underline style, visually distinct from inner bordered tabs)
function renderSetupTabSection(groupId, tabs) {
    if (tabs.length === 0) return '';
    if (tabs.length === 1) {
        return `<div class="lab-setup-tab-panel-solo">${tabs[0].renderContent()}</div>`;
    }
    const buttons = tabs.map((t, i) =>
        `<button class="lab-outer-tab-btn ${i === 0 ? 'active' : ''}"
            data-tab-target="${groupId}-${t.id}" data-tab-group="${groupId}">${escapeHtml(t.label)}</button>`
    ).join('');
    const panels = tabs.map((t, i) =>
        `<div id="${groupId}-${t.id}" class="tab-content ${i === 0 ? 'active' : ''}"
            data-tab-group="${groupId}"><div class="lab-setup-tab-panel">${t.renderContent()}</div></div>`
    ).join('');
    return `<div class="lab-setup-tabs"><div class="lab-setup-tab-bar">${buttons}</div>${panels}</div>`;
}

function renderInnerTabSection(groupId, tabs) {
    const visible = tabs.filter(t => t.show && (t.content || t.rawHtml !== undefined));
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

// ---- Helper Parsers (used by Game mode in map-game.js) ----

function parseAttackStepsToCards(markdown) {
    if (!markdown) return [];
    const steps = [];
    const regex = /(\d+)\.\s+\*\*([^*]+)\*\*:?\s*(.*)/g;
    let match;
    while ((match = regex.exec(markdown)) !== null) {
        steps.push({ num: parseInt(match[1]), title: match[2].trim(), desc: match[3].trim() });
    }
    return steps;
}

// Parse mermaid graph into ordered steps: [{fromNode, toNode, edgeLabel}]
function parseMermaidToSteps(mermaidCode) {
    if (!mermaidCode) return { nodes: [], edges: [], steps: [] };
    const parsed = parseMermaidGraph(mermaidCode);
    // Build ordered step list by following edges from root
    const nodeMap = new Map(parsed.nodes.map(n => [n.id, n]));
    const incomingCount = {};
    parsed.nodes.forEach(n => incomingCount[n.id] = 0);
    parsed.edges.forEach(e => { incomingCount[e.to] = (incomingCount[e.to] || 0) + 1; });
    // Find root (no incoming edges)
    let current = parsed.nodes.find(n => incomingCount[n.id] === 0);
    const steps = [];
    const visited = new Set();
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const outEdge = parsed.edges.find(e => e.from === current.id && !visited.has(e.to));
        if (outEdge) {
            const toNode = nodeMap.get(outEdge.to);
            steps.push({ fromNode: current, toNode, edgeLabel: outEdge.label || '' });
            current = toNode;
        } else {
            // Check for multiple outgoing (branching) - add all remaining
            const remaining = parsed.edges.filter(e => e.from === current.id && !visited.has(e.to));
            remaining.forEach(e => {
                const toNode = nodeMap.get(e.to);
                steps.push({ fromNode: current, toNode, edgeLabel: e.label || '' });
                visited.add(e.to);
            });
            break;
        }
    }
    return { nodes: parsed.nodes, edges: parsed.edges, steps };
}

// Get node type color from its vis.js color object
function getNodeTypeFromColor(colorObj) {
    let bg = '#e8f4f8';
    if (typeof colorObj === 'string') bg = colorObj;
    else if (colorObj?.background) bg = colorObj.background;
    else if (colorObj?.color?.background) bg = colorObj.color.background;
    const colorMap = {
        '#ff9999': { type: 'principal', label: 'Principal', cssClass: 'ov-type-principal' },
        '#ffcc99': { type: 'resource', label: 'Resource', cssClass: 'ov-type-resource' },
        '#99ccff': { type: 'payload', label: 'Payload', cssClass: 'ov-type-payload' },
        '#99ff99': { type: 'outcome', label: 'Outcome', cssClass: 'ov-type-outcome' },
        '#ffeb99': { type: 'outcome', label: 'Partial', cssClass: 'ov-type-partial' },
        '#cccccc': { type: 'outcome', label: 'Dead End', cssClass: 'ov-type-deadend' }
    };
    return colorMap[bg] || { type: 'unknown', label: 'Node', cssClass: 'ov-type-unknown' };
}

// ---- Mode Switching ----

function switchDetailMode(mode, lab) {
    localStorage.setItem('labs-detail-mode', mode);

    // Toggle body class so CSS can expand/restore max-width constraints for game mode
    document.body.classList.toggle('lab-game-mode', mode === 'mapgame');

    // Update toggle buttons
    document.querySelectorAll('.lab-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const container = document.querySelector('.detail-scrollable-content');
    if (!container) return;

    if (mode === 'mapgame') {
        renderLabDetailContentMapGame(lab, container);
    } else {
        renderLabDetailContentGuidedV2(lab, container);
    }
}

// ---- Markdown Rendering ----

function renderLabMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Convert ```language\ncode\n``` to <pre><code>code</code></pre>
    // Stash code blocks to protect their contents from further transformations
    const codeBlocks = [];
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        const placeholder = `\x00CODEBLOCK${codeBlocks.length}\x00`;
        codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
        return placeholder;
    });

    // Convert inline `code` to <code>code</code>
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert **bold** to <strong>bold</strong>
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert *italic* to <em>italic</em>
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Convert [text](url) to <a href="url">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Convert headings (order matters: ### before ## before #)
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<div class="lab-md-h2">$1</div>');
    html = html.replace(/^# (.+)$/gm, '<div class="lab-md-h1">$1</div>');

    // Convert markdown tables
    html = convertMarkdownTables(html);

    // Convert lists (ordered and unordered)
    html = convertMarkdownLists(html);

    // Convert remaining paragraphs: double newlines become paragraph breaks
    html = html.replace(/\n\n+/g, '</p><p>');

    // Single newlines (not inside pre/code) become <br>
    html = html.replace(/\n(?![<])/g, '<br>');

    // Clean up breaks around block elements
    html = html.replace(/<br>\s*<(ul|ol|pre|h[1-6]|table|div|\/p|p)/g, '<$1');
    html = html.replace(/<\/(ul|ol|pre|h[1-6]|table|div)>\s*<br>/g, '</$1>');
    html = html.replace(/<br>\s*<li>/g, '<li>');
    html = html.replace(/<\/li>\s*<br>/g, '</li>');
    html = html.replace(/<br>\s*<h4>/g, '<h4>');
    html = html.replace(/<\/h4>\s*<br>/g, '</h4>');
    html = html.replace(/<br>\s*<tr>/g, '<tr>');
    html = html.replace(/<\/tr>\s*<br>/g, '</tr>');

    // Wrap in paragraph if not starting with a block element
    if (!html.match(/^\s*<(ul|ol|pre|h[1-6]|table|div|section)/)) {
        html = `<p>${html}</p>`;
    }

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    // Restore stashed code blocks
    codeBlocks.forEach((block, i) => {
        html = html.replace(`\x00CODEBLOCK${i}\x00`, block);
    });

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

// ---------------------------------------------------------------------------
// Guided v2 Mode: Continuous scroll with scroll-spy TOC
// ---------------------------------------------------------------------------

// Renders the key/value two-part pill row for a lab.
// Each pill has a grey key half and a colored value half (Option A style).
function renderLabKVPills(lab) {
    const catConfig = categoryConfig[lab.category] || { label: lab.category, cssClass: '' };
    const pathTypeLabel = pathTypeLabels[lab.pathType] || lab.pathType;
    const pathTypeClass = pathTypeColors[lab.pathType] || 'lab-badge-pathtype';
    const isFree = lab.costEstimate === 'free' || lab.costEstimate === '$0/mo';
    const targetLabel = lab.target === 'to-admin' ? 'Admin' : lab.target === 'to-bucket' ? 'Bucket' : lab.target;
    const targetClass = targetColors[lab.target] || 'lab-badge-target';

    const pill = (key, valueClass, valueText, fieldPath = '') =>
        `<span class="lab-kv-pill">
            <span class="lab-kv-pill-key">${key}</span>
            <span class="lab-badge ${valueClass} lab-kv-pill-value">${escapeHtml(valueText)}</span>${debugTag(fieldPath)}
        </span>`;

    const pills = [
        pill('Category', catConfig.cssClass, catConfig.label, 'category ← README: **Category:**'),
        lab.pathType ? pill('Path Type', pathTypeClass, pathTypeLabel, 'pathType ← README: **Path Type:**') : '',
        targetLabel ? pill('Target', targetClass, targetLabel, 'target ← README: **Target:**') : '',
        pill('Est. AWS Cost', isFree ? 'lab-cost-free' : 'lab-cost-paid', isFree ? 'Free' : lab.costEstimate, 'costEstimate ← README: **Cost Estimate:**'),
        ...(lab.environments || []).map(env => pill('Env', 'lab-badge-env', env, 'environments[] ← README: **Environments:** (comma list)')),
    ].filter(Boolean);

    const serviceIconsHtml = renderServiceIcons(lab.permissions);

    return `<div class="lab-detail-badges lab-kv-pills-row" style="margin-bottom:16px;">
        ${pills.join('')}
        ${serviceIconsHtml ? `<span class="lab-service-icons-right">${serviceIconsHtml}</span>` : ''}
    </div>`;
}

// Builds the inner HTML for the map preview badge footer overlay.
// Reuses the same pill logic as renderLabKVPills, plus service name tags right-justified.
function buildPreviewFooterHTML(lab) {
    const catConfig = categoryConfig[lab.category] || { label: lab.category, cssClass: '' };
    const pathTypeLabel = pathTypeLabels[lab.pathType] || lab.pathType;
    const pathTypeClass = pathTypeColors[lab.pathType] || 'lab-badge-pathtype';
    const isFree = lab.costEstimate === 'free' || lab.costEstimate === '$0/mo';
    const targetLabel = lab.target === 'to-admin' ? 'Admin' : lab.target === 'to-bucket' ? 'Bucket' : (lab.target || '');
    const targetClass = targetColors[lab.target] || 'lab-badge-target';

    const pill = (key, valueClass, valueText) =>
        `<span class="lab-kv-pill">
            <span class="lab-kv-pill-key">${key}</span>
            <span class="lab-badge ${valueClass} lab-kv-pill-value">${escapeHtml(valueText)}</span>
        </span>`;

    const pills = [
        pill('Category', catConfig.cssClass, catConfig.label),
        lab.pathType ? pill('Path Type', pathTypeClass, pathTypeLabel) : '',
        targetLabel ? pill('Target', targetClass, targetLabel) : '',
        pill('Est. AWS Cost', isFree ? 'lab-cost-free' : 'lab-cost-paid', isFree ? 'Free' : lab.costEstimate),
        ...(lab.environments || []).map(env => pill('Env', 'lab-badge-env', env)),
    ].filter(Boolean).join('');

    // Extract unique service labels from required permissions
    const required = lab.permissions?.principals?.[0]?.required ?? lab.permissions?.required ?? [];
    const seenPrefixes = new Set();
    const serviceLabels = [];
    for (const p of required) {
        const prefix = (p.permission || '').split(':')[0].toLowerCase();
        if (prefix && awsServiceConfig[prefix] && !seenPrefixes.has(prefix)) {
            seenPrefixes.add(prefix);
            serviceLabels.push(awsServiceConfig[prefix].label);
        }
    }
    const serviceTagsHtml = serviceLabels.length
        ? `<div class="map-preview-service-tags">${serviceLabels.map(s => `<span class="map-preview-service-tag">${s}</span>`).join('')}</div>`
        : '';

    return pills + serviceTagsHtml;
}

function buildGuidedV2Sections(lab) {
    const slug = lab.slug || 'default';
    const sections = [];

    // Color mapping for H2 sections
    const sectionColors = {
        'Objective': 'lab-guided-section-overview',
        'Self-hosted Lab Setup': 'lab-guided-section-setup',
        'Attack': 'lab-guided-section-attack',
        'Teardown': 'lab-guided-section-teardown',
        'Defend': 'lab-guided-section-conclusion',
    };

    // --- Attack Map preview (shown first, before Objective) ---
    if (lab.attackMap?.nodes?.length || lab.readme?.attackDiagram) {
        sections.push({
            id: `gv2-map-preview-${slug}`,
            h2Section: 'Objective',
            title: 'Attack Map',
            level: 2,
            hideHeading: true,
            noDivider: true,
            colorClass: sectionColors['Objective'],
            renderContent: () => `<div class="lab-gv2-map-preview" id="gv2-map-preview-container-${slug}"></div>`,
        });
    }

    // --- Objective ---
    const overview = getOverview(lab);
    if (overview || lab.description) {
        sections.push({
            id: `gv2-objective-${slug}`,
            h2Section: 'Objective',
            title: 'Objective',
            level: 2,
            colorClass: sectionColors['Objective'],
            debugSource: 'readme.objective (prose) + attackMap.nodes/edges (cards)',
            renderContent: () => {
                let html = '';

                // Source attribution (Attack Simulation scenarios)
                if (lab.source?.title || lab.source?.url) {
                    const titleHtml = lab.source.url
                        ? `<a href="${escapeHtml(lab.source.url)}" target="_blank" rel="noopener noreferrer" class="lab-source-link">${escapeHtml(lab.source.title || lab.source.url)}</a>${debugTag('source.url ← README: **Source URL:**')}`
                        : escapeHtml(lab.source.title) + debugTag('source.title ← README: **Source Title:**');
                    const metaParts = [
                        lab.source.author ? escapeHtml(lab.source.author) + debugTag('source.author ← README: **Source Author:**') : null,
                        lab.source.date   ? escapeHtml(lab.source.date)   + debugTag('source.date ← README: **Source Date:**')   : null,
                    ].filter(Boolean);
                    const hasModifications = lab.modifications?.length || lab.readme?.attack?.modificationsFromOriginal;
                    const modLinkHtml = hasModifications
                        ? `<div class="lab-source-modifications-link"><a href="#gv2-modifications-${slug}" onclick="event.preventDefault();document.getElementById('gv2-modifications-${slug}')?.scrollIntoView({behavior:'smooth'})">See what was changed for this lab</a></div>`
                        : '';
                    html += `<div class="lab-source-attribution">
                        <div class="lab-source-label">Based on real-world incident</div>
                        <div class="lab-source-title">${titleHtml}</div>
                        ${metaParts.length ? `<div class="lab-source-meta">${metaParts.join(' · ')}</div>` : ''}
                        ${modLinkHtml}
                    </div>`;
                }

                // Detect public/network-start scenarios. Primary signal: access field on the first
                // attackMap node (schema v1.1.0+). Fallback: README "- **Start:**" line regex for
                // older data that predates the access field.
                const rawOverview = overview || lab.description || '';
                const startLineMatch = rawOverview.match(/^-\s*\*\*Start:\*\*\s*`?([^`\n]+)`?/m);
                const startLineValue = startLineMatch?.[1]?.trim() || '';
                const startNodeAccess = lab.attackMap?.nodes?.[0]?.access;
                const isPublicStart = startNodeAccess?.type === 'public-network'
                    || startNodeAccess?.type === 'assumed-breach-network'
                    || startLineValue.startsWith('https://')
                    || startLineValue.startsWith('http://')
                    || startLineValue.toLowerCase().includes('(public');

                // Strip start/destination lines from overview text since we show them as cards
                let overviewText = rawOverview.replace(/^-\s*\*\*Start:\*\*.*$/gm, '').replace(/^-\s*\*\*Destination.*?\*\*.*$/gm, '').trim();

                if (overviewText) {
                    html += `<div class="lab-tab-prose">${renderLabMarkdown(overviewText)}</div>`;
                }

                // Start/Destination cards from attackMap
                const sd = getStartDestination(lab);
                if (sd) {
                    // For public-start scenarios, override the type label so the card communicates
                    // that no AWS credentials are required, even if the node's ARN is a Lambda ARN.
                    const startClassify = isPublicStart
                        ? { type: 'public', label: 'Public Access' }
                        : classifyArn(sd.start.arn);
                    const destClassify = classifyArn(sd.destination.arn);
                    const startName = getArnShortName(sd.start.arn);
                    const destName = getArnShortName(sd.destination.arn);

                    // For public-start, show the access endpoint URL/IP/domain as a subtitle.
                    // Prefer the structured access field over the README regex value.
                    const displayUrl = startNodeAccess?.url || startNodeAccess?.ip
                        || startNodeAccess?.domain || startLineValue;
                    const startArnLine = isPublicStart && displayUrl
                        ? `<div class="lab-objective-card-arn lab-objective-card-public-url" title="${escapeHtml(displayUrl)}">${escapeHtml(displayUrl)}</div>`
                        : `<div class="lab-objective-card-arn" title="${escapeHtml(sd.start.arn || '')}">${escapeHtml(startName)}</div>`;

                    const permsPillsHtml = renderPermissionsPills(lab.permissions, slug);

                    html += `<div class="lab-objective-flow${permsPillsHtml ? ' lab-objective-flow-with-perms' : ''}">
                        <div class="lab-objective-flow-cards">
                            <div class="lab-objective-card lab-objective-card-${startClassify.type}">
                                <div class="lab-objective-card-type">${escapeHtml(startClassify.label)}${debugTag('attackMap.nodes[start].arn → classifyArn().label')}</div>
                                <div class="lab-objective-card-label">${escapeHtml(sd.start.label || sd.start.id)}${debugTag('attackMap.nodes[start].label')}</div>
                                ${startArnLine}${DEBUG_MODE ? debugTag('attackMap.nodes[start].arn') : ''}
                            </div>
                            <div class="lab-objective-arrow">
                                <svg width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="0" y1="12" x2="26" y2="12"/>
                                    <polyline points="20 6 26 12 20 18"/>
                                </svg>
                            </div>
                            <div class="lab-objective-card lab-objective-card-${destClassify.type}">
                                <div class="lab-objective-card-type">${escapeHtml(destClassify.label)}${debugTag('attackMap.nodes[dest].arn → classifyArn().label')}</div>
                                <div class="lab-objective-card-label">${escapeHtml(sd.destination.label || sd.destination.id)}${debugTag('attackMap.nodes[dest].label')}</div>
                                <div class="lab-objective-card-arn" title="${escapeHtml(sd.destination.arn || '')}">${escapeHtml(destName)}${debugTag('attackMap.nodes[dest].arn')}</div>
                            </div>
                        </div>
                        ${permsPillsHtml ? `<div class="lab-objective-flow-perms">${permsPillsHtml}</div>` : ''}
                    </div>`;
                }

                return html;
            }
        });

        // Starting Permissions are embedded directly in the Objective card flow wrapper above
    }

    // --- Self-hosted Lab Setup ---
    const setup = getSetup(lab);
    const resourcesCreated = getResourcesCreated(lab);
    if (setup.prerequisites || setup.deployNonInteractive || setup.deployTui || resourcesCreated) {
        const setupTabs = [];
        if (setup.prerequisites) {
            setupTabs.push({
                id: 'prereqs',
                label: 'Prerequisites',
                renderContent: () => `<div class="lab-tab-prose">${renderLabMarkdown(setup.prerequisites)}</div>`,
            });
        }
        if (setup.deployNonInteractive || setup.deployTui) {
            setupTabs.push({
                id: 'deploy',
                label: 'Deploy',
                renderContent: () => renderInnerTabSection(`gv2-deploy-inner-${slug}`, [
                    { id: 'cli', label: 'Non-Interactive', show: !!setup.deployNonInteractive, content: setup.deployNonInteractive },
                    { id: 'tui', label: 'TUI', show: !!setup.deployTui, content: setup.deployTui },
                ]),
            });
        }
        if (resourcesCreated) {
            setupTabs.push({
                id: 'resources',
                label: 'Resources Created',
                renderContent: () => `
                    <details class="lab-gv2-collapsible">
                        <summary class="lab-gv2-collapsible-summary">
                            Show Scenario Specific Resources — collapsed by default as viewing resource names may reveal parts of the challenge.
                            <svg class="lab-gv2-collapsible-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                        </summary>
                        <div class="lab-gv2-body">${renderResourceCards(resourcesCreated)}</div>
                    </details>`,
            });
        }
        const setupTabGroupId = `gv2-setup-tabs-${slug}`;
        sections.push({
            id: `gv2-setup-${slug}`,
            h2Section: 'Self-hosted Lab Setup',
            title: 'Self-hosted Lab Setup',
            level: 2,
            colorClass: sectionColors['Self-hosted Lab Setup'],
            debugSource: 'readme.setup.{prerequisites, deployNonInteractive, deployTui} + readme.attack.resourcesCreated',
            tabSyncItems: setupTabs.map(t => ({
                label: t.label,
                tabGroupId: setupTabGroupId,
                tabPanelId: `${setupTabGroupId}-${t.id}`,
            })),
            renderContent: () => renderSetupTabSection(setupTabGroupId, setupTabs),
        });
    }

    // --- Attack ---

    // Guided Challenge from attackMap
    if (lab.attackMap?.nodes?.length && lab.attackMap?.edges?.length) {
        sections.push({
            id: `gv2-ctf-${slug}`,
            h2Section: 'Attack',
            title: 'Guided Challenge',
            level: 3,
            colorClass: sectionColors['Attack'],
            debugSource: 'attackMap.nodes[].{label, description} + attackMap.edges[].{label, hints[], commands[]}',
            renderContent: () => {
                let html = '<p class="lab-section-intro">Try to complete the attack path on your own using only the hints below. Each step reveals progressively more detail.</p>';
                html += renderGuidedV2CTFChallenge(lab.attackMap, slug);
                return html;
            },
        });
    }

    // Attack Walkthrough — tabbed: Pentest Report Style | Scripted Attack Demo | Setup and Run Yourself
    const solution = getSolution(lab);
    const demoAttack = getAttackDemo(lab);
    const cleanupData = getCleanup(lab);
    const labDisplayName = lab.displayName || lab.name || slug;

    if (solution || lab.hasDemoTranscript || demoAttack) {
        const walkthroughTabs = [];

        // Tab 1: Scripted Attack Demo (ANSI transcript with spoiler gate)
        if (lab.hasDemoTranscript) {
            walkthroughTabs.push({
                id: 'transcript',
                label: 'Scripted Attack Demo',
                show: true,
                rawHtml: `
                    <div class="lab-demo-transcript-wrapper">
                        <div class="lab-demo-spoiler-gate" data-slug="${escapeHtml(slug)}" data-lab-name="${escapeHtml(labDisplayName)}">
                            <div class="lab-demo-spoiler-icon">⚠</div>
                            <h4 class="lab-demo-spoiler-title">Contains Spoilers</h4>
                            <p class="lab-demo-spoiler-text">This demo walks through the complete attack path step by step. Watch it after you've tried the lab on your own.</p>
                            <button class="lab-demo-spoiler-btn">Watch Exploitation Demo</button>
                        </div>
                        <div class="lab-demo-terminal-area" style="display:none;width:100%;box-sizing:border-box;flex-direction:column;background:#000;border-radius:8px;overflow:hidden;">
                            <div class="mg-transcript-header" style="background:#111;border-bottom:1px solid rgba(255,255,255,0.12);color:#fff;">
                                <span style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#f0b040;">${escapeHtml(labDisplayName)}</span>
                            </div>
                            <pre class="mg-transcript-pre" style="background:#000;color:#e0e0e0;border-radius:0;max-height:400px;width:100%;box-sizing:border-box;"><span class="ansi-dim">Loading\u2026</span></pre>
                        </div>
                    </div>`,
            });
        }

        // Tab 2: Pentest Report Style (solution text, behind spoiler gate)
        if (solution) {
            const solutionCleaned = '## Summary\n\n' + solution.replace(/^# [^\n]+\n+/, '');
            const solutionHtml = `<div class="lab-walkthrough-container"><div class="lab-tab-prose">${renderLabMarkdown(solutionCleaned)}</div></div>`;
            walkthroughTabs.push({
                id: 'report',
                label: 'Pentest Report Style',
                show: true,
                rawHtml: `
                    <div class="lab-demo-transcript-wrapper">
                        <div class="lab-demo-spoiler-gate" data-slug="${escapeHtml(slug)}-report" data-raw-html="${escapeHtml(btoa(encodeURIComponent(solutionHtml)))}">
                            <div class="lab-demo-spoiler-icon">⚠</div>
                            <h4 class="lab-demo-spoiler-title">Contains Spoilers</h4>
                            <p class="lab-demo-spoiler-text">This report details the full attack path and exploitation steps. Read it after you've tried the lab on your own.</p>
                            <button class="lab-demo-spoiler-btn">Read the Report</button>
                        </div>
                        <div class="lab-demo-terminal-area" style="display:none;width:100%;box-sizing:border-box;"></div>
                    </div>`,
            });
        }

        // Tab 3: Setup and Run the Attack Demo Yourself (automated demo + cleanup)
        if (demoAttack || cleanupData) {
            let runHtml = '';
            if (demoAttack) {
                if (demoAttack.executing) {
                    runHtml += `<div class="lab-tab-prose">${renderLabMarkdown(demoAttack.executing)}</div>`;
                }
                runHtml += renderInnerTabSection(`gv2-demo-inner-${slug}`, [
                    { id: 'cli', label: 'Non-Interactive', show: !!demoAttack.nonInteractive, content: demoAttack.nonInteractive },
                    { id: 'tui', label: 'TUI', show: !!demoAttack.tui, content: demoAttack.tui },
                ]);
                if (demoAttack.resourcesCreated) {
                    runHtml += `<div class="lab-tab-subsection"><h4>Resources Created by Attack Script</h4>
                        <div class="lab-tab-prose">${renderLabMarkdown(demoAttack.resourcesCreated)}</div></div>`;
                }
            }
            if (cleanupData) {
                runHtml += `<div class="lab-tab-subsection"><h4>Cleanup</h4>`;
                runHtml += renderInnerTabSection(`gv2-cleanup-inner-${slug}`, [
                    { id: 'cli', label: 'Non-Interactive', show: !!cleanupData.nonInteractive, content: cleanupData.nonInteractive },
                    { id: 'tui', label: 'TUI', show: !!cleanupData.tui, content: cleanupData.tui },
                ]);
                runHtml += '</div>';
            }
            walkthroughTabs.push({
                id: 'run',
                label: 'Setup and Run the Attack Demo Yourself',
                show: true,
                rawHtml: runHtml,
            });
        }

        sections.push({
            id: `gv2-attack-walkthrough-${slug}`,
            h2Section: 'Attack',
            title: 'Attack Walkthrough',
            level: 3,
            colorClass: sectionColors['Attack'],
            debugSource: 'readme.solution (Pentest Report) | /labs/demo-transcripts/{slug}.txt (Scripted Demo) | readme.attack.demoAttack.* (Run Yourself)',
            renderContent: () => renderInnerTabSection(`gv2-walkthrough-tabs-${slug}`, walkthroughTabs),
        });
    }

    // Modifications from Original Attack (Attack Simulation scenarios only) — kept separate
    const modificationsFromOriginal = lab.readme?.attack?.modificationsFromOriginal;
    if (modificationsFromOriginal) {
        sections.push({
            id: `gv2-modifications-${slug}`,
            h2Section: 'Attack',
            title: 'Modifications from Original Attack',
            level: 3,
            colorClass: sectionColors['Attack'],
            debugSource: 'readme.attack.modificationsFromOriginal',
            renderContent: () => `<div class="lab-tab-prose">${renderLabMarkdown(modificationsFromOriginal)}</div>`,
        });
    }

    // --- Teardown ---
    const teardownData = getTeardown(lab);
    if (teardownData.nonInteractive || teardownData.tui) {
        sections.push({
            id: `gv2-teardown-${slug}`,
            h2Section: 'Teardown',
            title: 'Teardown',
            level: 3,
            colorClass: sectionColors['Teardown'],
            debugSource: 'readme.teardown.{nonInteractive, tui}',
            renderContent: () => renderInnerTabSection(`gv2-teardown-inner-${slug}`, [
                { id: 'cli', label: 'Non-Interactive', show: !!teardownData.nonInteractive, content: teardownData.nonInteractive },
                { id: 'tui', label: 'TUI', show: !!teardownData.tui, content: teardownData.tui },
            ]),
        });
    }

    // --- Defend ---
    const cspmData = getDefendCspm(lab);
    const siemData = getDefendSiem(lab);
    const defendTabGroupId = `gv2-defend-tabs-${slug}`;
    const defendTabs = [];

    if (cspmData?.whatToDetect) {
        defendTabs.push({
            id: 'cspm',
            label: 'What CSPM Tools Should Detect',
            renderContent: () => `<div class="lab-tab-prose">${renderLabMarkdown(cspmData.whatToDetect)}</div>`,
        });
    }
    if (siemData?.cloudTrailEvents) {
        defendTabs.push({
            id: 'cloudtrail',
            label: 'CloudTrail Events to Monitor',
            renderContent: () => `<div class="lab-tab-prose">${renderLabMarkdown(siemData.cloudTrailEvents)}</div>`,
        });
    }
    if (siemData?.detonationLogs) {
        defendTabs.push({
            id: 'logs',
            label: 'Detonation Logs',
            renderContent: () => `<div class="lab-tab-prose">${renderLabMarkdown(siemData.detonationLogs)}</div>`,
        });
    }
    if (lab.readme?.references) {
        defendTabs.push({
            id: 'references',
            label: 'References',
            renderContent: () => `<div class="lab-tab-prose">${renderLabMarkdown(lab.readme.references)}</div>`,
        });
    }

    if (defendTabs.length > 0) {
        sections.push({
            id: `gv2-defend-${slug}`,
            h2Section: 'Defend',
            title: 'Defend',
            level: 2,
            colorClass: sectionColors['Defend'],
            debugSource: 'readme.defend.cspm.whatToDetect | readme.defend.cloudSiem.{cloudTrailEvents, detonationLogs} | readme.references',
            tabSyncItems: defendTabs.map(t => ({
                label: t.label,
                tabGroupId: defendTabGroupId,
                tabPanelId: `${defendTabGroupId}-${t.id}`,
            })),
            renderContent: () => renderSetupTabSection(defendTabGroupId, defendTabs),
        });
    }

    return sections;
}

function setupDemoTranscriptSections() {
    document.querySelectorAll('.lab-demo-spoiler-gate').forEach(gate => {
        const wrapper = gate.closest('.lab-demo-transcript-wrapper');
        const terminalArea = wrapper.querySelector('.lab-demo-terminal-area');
        const slug = gate.dataset.slug;
        const rawHtmlEncoded = gate.dataset.rawHtml;

        gate.querySelector('.lab-demo-spoiler-btn').addEventListener('click', async () => {
            const gateWidth = gate.offsetWidth;
            gate.style.display = 'none';
            terminalArea.style.width = gateWidth + 'px';
            terminalArea.style.display = 'flex';

            // Pentest report tab: reveal pre-rendered HTML stored in data attribute
            if (rawHtmlEncoded) {
                terminalArea.innerHTML = decodeURIComponent(atob(rawHtmlEncoded));
                return;
            }

            // Scripted attack demo tab: fetch and render ANSI transcript
            const pre = wrapper.querySelector('.mg-transcript-pre');
            try {
                const resp = await fetch(`/labs/demo-transcripts/${slug}.txt`);
                if (!resp.ok) throw new Error('not found');
                const text = await resp.text();
                pre.innerHTML = typeof ansiToHtml === 'function'
                    ? ansiToHtml(text)
                    : escapeHtml(text);
            } catch (_) {
                pre.innerHTML = '<span class="ansi-red">Transcript not available for this lab.</span>';
            }
        });
    });
}

function renderLabDetailContentGuidedV2(lab, container) {
    const sections = buildGuidedV2Sections(lab);
    const gv2Id = `gv2-${lab.slug || 'default'}`;

    if (sections.length === 0) {
        container.innerHTML = '<div class="lab-tab-prose"><p>No content available for Guided v2 mode.</p></div>';
        return;
    }

    // Build TOC from sections
    let tocHtml = '';
    let currentH2 = '';
    const sectionColors = {
        'Objective': 'lab-guided-section-overview',
        'Self-hosted Lab Setup': 'lab-guided-section-setup',
        'Attack': 'lab-guided-section-attack',
        'Teardown': 'lab-guided-section-teardown',
        'Defend': 'lab-guided-section-conclusion',
    };

    sections.forEach(sec => {
        if (sec.h2Section !== currentH2) {
            if (currentH2) tocHtml += '</div>';
            currentH2 = sec.h2Section;
            // If the first section under this h2 hides its TOC item, make the heading itself the scroll target
            const firstSecUnderH2 = sections.find(s => s.h2Section === sec.h2Section);
            const h2ScrollTarget = firstSecUnderH2?.hideTocItem ? firstSecUnderH2.id : null;
            const h2HeadingAttrs = h2ScrollTarget
                ? `class="lab-guided-index-heading ${sectionColors[sec.h2Section] || ''} lab-guided-index-heading-link lab-gv2-toc-item" data-gv2-target="${h2ScrollTarget}" onclick="document.getElementById('${h2ScrollTarget}').scrollIntoView({behavior:'smooth'})"`
                : `class="lab-guided-index-heading ${sectionColors[sec.h2Section] || ''}"`;
            tocHtml += `<div class="lab-guided-index-section">
                <div ${h2HeadingAttrs}>${escapeHtml(sec.h2Section)}</div>`;
        }
        if (sec.tabSyncItems) {
            sec.tabSyncItems.forEach((item, i) => {
                tocHtml += `<div class="lab-guided-index-item lab-gv2-toc-item lab-tabsync-item ${i === 0 ? 'active' : ''}"
                    data-gv2-target="${sec.id}"
                    data-tabsync-group="${item.tabGroupId}"
                    data-tabsync-panel="${item.tabPanelId}">${escapeHtml(item.label)}</div>`;
            });
        } else if (!sec.hideTocItem) {
            tocHtml += `<div class="lab-guided-index-item lab-gv2-toc-item" data-gv2-target="${sec.id}"
                onclick="document.getElementById('${sec.id}').scrollIntoView({behavior:'smooth'})">${escapeHtml(sec.title)}</div>`;
        }
    });
    if (currentH2) tocHtml += '</div>';

    // Build main content from sections
    const slug = lab.slug || 'default';
    const labShareUrl = `https://pathfinding.cloud/labs/${slug}`;
    const labTitle = lab.displayName || lab.name;
    let mainHtml = '';
    let prevH2 = '';
    sections.forEach(sec => {
        if (sec.h2Section !== prevH2) {
            prevH2 = sec.h2Section;
        }
        const headingTag = sec.level === 2 ? 'h2' : 'h3';
        const headingHtml = sec.hideHeading ? '' : `<${headingTag} class="lab-gv2-heading ${sec.colorClass || ''}">${escapeHtml(sec.title)}</${headingTag}>`;
        const sectionClass = `lab-gv2-section${sec.noDivider ? ' lab-gv2-section-no-divider' : ''}`;
        const debugSourceHtml = sec.debugSource ? debugSection(sec.debugSource) : '';
        if (sec.collapsed) {
            const summaryText = sec.collapsedSummary || `Show ${escapeHtml(sec.title)}`;
            mainHtml += `
                <div class="${sectionClass}" id="${sec.id}" data-gv2-h2="${sec.h2Section}">
                    ${headingHtml}
                    <details class="lab-gv2-collapsible">
                        <summary class="lab-gv2-collapsible-summary">
                            ${summaryText}
                            <svg class="lab-gv2-collapsible-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                        </summary>
                        <div class="lab-gv2-body">${debugSourceHtml}${sec.renderContent()}</div>
                    </details>
                </div>`;
        } else {
            mainHtml += `
                <div class="${sectionClass}" id="${sec.id}" data-gv2-h2="${sec.h2Section}">
                    ${headingHtml}
                    <div class="lab-gv2-body">${debugSourceHtml}${sec.renderContent()}</div>
                </div>`;
        }
    });

    container.innerHTML = `
        <div class="lab-gv2-layout" id="${gv2Id}">
            <div class="lab-gv2-toc">${tocHtml}</div>
            <div class="lab-gv2-main">${mainHtml}</div>
        </div>`;

    setupTabListeners();
    setupDemoTranscriptSections();
    setupGuidedV2ScrollSpy(gv2Id);
    setupGuidedV2TabSync(gv2Id);

    // Initialize static map preview after DOM is ready
    setTimeout(() => {
        const previewContainer = document.getElementById(`gv2-map-preview-container-${slug}`);
        if (previewContainer && typeof renderStaticMapPreview === 'function') {
            renderStaticMapPreview(previewContainer, lab);
        }
    }, 60);

}

function setupGuidedV2ScrollSpy(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tocItems = container.querySelectorAll('.lab-gv2-toc-item');
    const sectionEls = container.querySelectorAll('.lab-gv2-section');

    if (sectionEls.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
        // Find the first visible section
        let activeId = null;
        for (const entry of entries) {
            if (entry.isIntersecting) {
                activeId = entry.target.id;
                break;
            }
        }

        if (activeId) {
            tocItems.forEach(item => {
                if (item.dataset.gv2Target !== activeId) {
                    item.classList.remove('active');
                } else if (item.classList.contains('lab-tabsync-item')) {
                    // Multiple sidebar items share this section — activate only the one whose
                    // outer tab panel is currently visible.
                    const panel = document.getElementById(item.dataset.tabsyncPanel);
                    item.classList.toggle('active', panel?.classList.contains('active') ?? false);
                } else {
                    item.classList.add('active');
                }
            });
        }
    }, {
        rootMargin: '-130px 0px -60% 0px',
        threshold: 0,
    });

    sectionEls.forEach(el => observer.observe(el));
}

// Syncs outer section tabs ↔ sidebar TOC items bidirectionally.
// Handles any section using the lab-tabsync-item pattern (Setup, Defend, etc.).
// Called once per lab detail render. Uses event delegation on the gv2 container.
function setupGuidedV2TabSync(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Activate the sidebar item whose panel matches activeTabPanelId, within the same tab group.
    function syncTocToTab(activeTabPanelId, tabGroupId) {
        container.querySelectorAll(`.lab-tabsync-item[data-tabsync-group="${tabGroupId}"]`).forEach(item => {
            item.classList.toggle('active', item.dataset.tabsyncPanel === activeTabPanelId);
        });
    }

    container.addEventListener('click', (e) => {
        // Sidebar item clicked → switch outer tab + update sidebar
        const tocItem = e.target.closest('.lab-tabsync-item');
        if (tocItem) {
            const tabGroupId = tocItem.dataset.tabsyncGroup;
            const tabPanelId = tocItem.dataset.tabsyncPanel;
            const sectionId = tocItem.dataset.gv2Target;

            // Switch the outer tab (same logic handleTabClick would do)
            document.querySelectorAll(`[data-tab-group="${tabGroupId}"][data-tab-target]`)
                .forEach(b => b.classList.remove('active'));
            document.querySelectorAll(`.tab-content[data-tab-group="${tabGroupId}"]`)
                .forEach(p => p.classList.remove('active'));
            const btn = document.querySelector(`[data-tab-target="${tabPanelId}"]`);
            if (btn) btn.classList.add('active');
            const panel = document.getElementById(tabPanelId);
            if (panel) panel.classList.add('active');

            syncTocToTab(tabPanelId, tabGroupId);

            const sectionEl = document.getElementById(sectionId);
            if (sectionEl) sectionEl.scrollIntoView({ behavior: 'smooth' });
            return;
        }

        // Outer tab button clicked → update sidebar after handleTabClick has switched the tab
        const tabBtn = e.target.closest('.lab-outer-tab-btn');
        if (tabBtn) {
            const tabPanelId = tabBtn.dataset.tabTarget;
            const tabGroupId = tabBtn.dataset.tabGroup;
            if (tabPanelId && tabGroupId) setTimeout(() => syncTocToTab(tabPanelId, tabGroupId), 0);
        }
    });
}

function renderGuidedV2CTFChallenge(attackMap, slug) {
    if (!attackMap?.nodes?.length || !attackMap?.edges?.length) return '';

    const nodeById = new Map(attackMap.nodes.map(n => [n.id, n]));

    // Walk edges in order
    const incomingCount = {};
    attackMap.nodes.forEach(n => { incomingCount[n.id] = 0; });
    attackMap.edges.forEach(e => { incomingCount[e.to] = (incomingCount[e.to] || 0) + 1; });
    let rootId = attackMap.nodes.find(n => incomingCount[n.id] === 0)?.id || attackMap.nodes[0]?.id;

    // Build ordered edge list
    const orderedEdges = [];
    const visited = new Set();
    let currentId = rootId;
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const outEdge = attackMap.edges.find(e => e.from === currentId && !visited.has(e.to));
        if (outEdge) {
            orderedEdges.push(outEdge);
            currentId = outEdge.to;
        } else {
            break;
        }
    }

    if (orderedEdges.length === 0) return '<p>No attack edges found.</p>';

    let html = '<div class="lab-gv2-ctf-container">';

    // Show starting node
    const startNode = nodeById.get(rootId);
    if (startNode) {
        html += `<div class="lab-gv2-ctf-start">
            <span class="lab-gv2-ctf-node-label">${escapeHtml(startNode.label || startNode.id)}${debugTag('attackMap.nodes[start].label')}</span>
            ${startNode.subType ? `<span class="lab-gv2-ctf-subtype">${escapeHtml(startNode.subType)}${debugTag('attackMap.nodes[start].subType')}</span>` : ''}
            ${startNode.description ? `<div class="lab-gv2-ctf-desc">${escapeHtml(startNode.description)}${debugTag('attackMap.nodes[start].description')}</div>` : ''}
        </div>`;
    }

    orderedEdges.forEach((edge, i) => {
        const edgeId = `gv2-ctf-edge-${slug}-${i}`;
        const fromNode = nodeById.get(edge.from);
        const toNode = nodeById.get(edge.to);
        const hints = edge.hints || [];

        html += `<div class="lab-gv2-ctf-edge" id="${edgeId}">
            <div class="lab-gv2-ctf-action">${escapeHtml(edge.label || 'Action')}${debugTag('attackMap.edges[n].label')}</div>
            <div class="lab-gv2-ctf-to">
                <span class="lab-gv2-ctf-node-label">${escapeHtml(toNode?.label || edge.to)}${debugTag('attackMap.nodes[to].label')}</span>
                ${toNode?.subType ? `<span class="lab-gv2-ctf-subtype">${escapeHtml(toNode.subType)}${debugTag('attackMap.nodes[to].subType')}</span>` : ''}
                ${toNode?.description ? `<div class="lab-gv2-ctf-desc">${escapeHtml(toNode.description)}${debugTag('attackMap.nodes[to].description')}</div>` : ''}
            </div>`;

        // Progressive hint reveal
        if (hints.length > 0) {
            html += `<div class="lab-gv2-ctf-hints" data-edge-id="${edgeId}">
                <button class="lab-gv2-ctf-hint-btn" onclick="guidedV2RevealHint('${edgeId}', 0)">
                    Show Hint (1/${hints.length})${debugTag('attackMap.edges[n].hints[]')}
                </button>`;
            hints.forEach((hint, hIdx) => {
                html += `<div class="lab-gv2-ctf-hint lab-gv2-ctf-hint-hidden" data-hint-idx="${hIdx}">
                    ${escapeHtml(hint)}${debugTag(`attackMap.edges[n].hints[${hIdx}]`)}
                </div>`;
            });
            html += '</div>';
        }

        html += '</div>';
    });

    html += '</div>';
    return html;
}

function guidedV2RevealHint(edgeId, hintIdx) {
    const edgeEl = document.getElementById(edgeId);
    if (!edgeEl) return;

    const hintsContainer = edgeEl.querySelector('.lab-gv2-ctf-hints');
    if (!hintsContainer) return;

    const allHints = hintsContainer.querySelectorAll('.lab-gv2-ctf-hint');
    const btn = hintsContainer.querySelector('.lab-gv2-ctf-hint-btn');

    // Reveal the hint at hintIdx
    if (allHints[hintIdx]) {
        allHints[hintIdx].classList.remove('lab-gv2-ctf-hint-hidden');
    }

    // Update button for next hint
    const nextIdx = hintIdx + 1;
    if (nextIdx < allHints.length) {
        btn.textContent = `Show Hint (${nextIdx + 1}/${allHints.length})`;
        btn.onclick = () => guidedV2RevealHint(edgeId, nextIdx);
    } else {
        btn.style.display = 'none';
    }
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

        // Refit any vis.js networks that were rendered while hidden
        setTimeout(() => {
            targetContent.querySelectorAll('.attack-viz-container, .lab-attack-viz-container').forEach(vizEl => {
                if (vizEl._visNetwork) {
                    vizEl._visNetwork.fit();
                }
            });
        }, 50);
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
