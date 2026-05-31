// Site-wide left sidebar: expand/collapse, group toggles, active state, localStorage persistence.
(function () {
    const COLLAPSED_KEY = 'sidebarCollapsed';
    const GROUP_PREFIX = 'sidebarGroup_';
    const RESPONSIVE_BREAKPOINT = 1600;

    // Track the last-known narrow state so resize only acts on threshold crossings.
    let _wasNarrow = null;

    function init() {
        const sidebar = document.getElementById('site-sidebar');
        if (!sidebar) return;

        // Responsive collapse: force collapse below breakpoint regardless of saved setting.
        _wasNarrow = window.innerWidth < RESPONSIVE_BREAKPOINT;
        if (_wasNarrow) {
            document.documentElement.classList.add('sidebar-collapsed');
        }

        // Sync collapse button tooltip to current state
        syncCollapseTooltip();

        // Collapse toggle
        const collapseBtn = document.getElementById('sidebar-collapse-toggle');
        if (collapseBtn) collapseBtn.addEventListener('click', toggleCollapse);

        // Group toggles
        sidebar.querySelectorAll('.sidebar-group-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const group = this.closest('.sidebar-group');
                toggleGroup(group.id.replace('sidebar-group-', ''));
            });
        });

        // Restore group states (paths collapsed by default, labs expanded by default)
        restoreGroup('paths', false);
        restoreGroup('labs', true);

        // Mark the active nav item
        markActive();

        // Responsive resize handler: collapse when crossing below breakpoint,
        // restore saved preference when crossing back above it.
        window.addEventListener('resize', function () {
            const isNarrow = window.innerWidth < RESPONSIVE_BREAKPOINT;
            if (isNarrow === _wasNarrow) return;
            _wasNarrow = isNarrow;
            if (isNarrow) {
                document.documentElement.classList.add('sidebar-collapsed');
            } else {
                if (localStorage.getItem(COLLAPSED_KEY) !== 'true') {
                    document.documentElement.classList.remove('sidebar-collapsed');
                }
            }
            syncCollapseTooltip();
        });
    }

    function restoreGroup(id, defaultOpen) {
        const stored = localStorage.getItem(GROUP_PREFIX + id);
        const open = stored !== null ? stored === 'open' : defaultOpen;
        const el = document.getElementById('sidebar-group-' + id);
        if (el && open) el.classList.add('open');
    }

    function toggleGroup(id) {
        const el = document.getElementById('sidebar-group-' + id);
        if (!el) return;
        const isOpen = el.classList.toggle('open');
        localStorage.setItem(GROUP_PREFIX + id, isOpen ? 'open' : 'closed');
    }

    function toggleCollapse() {
        const isCollapsed = document.documentElement.classList.toggle('sidebar-collapsed');
        localStorage.setItem(COLLAPSED_KEY, isCollapsed ? 'true' : 'false');
        syncCollapseTooltip();
    }

    function syncCollapseTooltip() {
        const btn = document.getElementById('sidebar-collapse-toggle');
        if (!btn) return;
        const isCollapsed = document.documentElement.classList.contains('sidebar-collapsed');
        btn.setAttribute('data-tooltip', isCollapsed ? 'Expand' : 'Collapse');
    }

    function markActive() {
        const path = window.location.pathname;
        let best = null;
        let bestLen = 0;

        document.querySelectorAll('.sidebar-item[href]').forEach(function (link) {
            const href = link.getAttribute('href');
            // Home only matches exact root
            const matches = href === '/' ? path === '/' : path.startsWith(href);
            if (matches && href.length > bestLen) {
                best = link;
                bestLen = href.length;
            }
        });

        if (best) {
            best.classList.add('active');
            const group = best.closest('.sidebar-group');
            if (group) {
                group.querySelector('.sidebar-group-toggle')?.classList.add('active');
            }
        }
    }

    // Expose for SPA pages that do pushState navigation
    window.sidebarMarkActive = markActive;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
