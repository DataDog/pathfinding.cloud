// ============================================================
// Leaderboard and profile pages
// ============================================================
// Shared page chrome (theme toggle, mobile menu) for pages that do not load
// one of the larger page scripts, plus the renderers for /leaderboard/ and
// /profile/. Data comes from pathfinding-backend via window.pfAccount.
// User-controlled text (usernames) is only ever written with textContent.

(function () {
    'use strict';

    function initTheme() {
        const themeToggle = document.getElementById('theme-toggle');
        if (!themeToggle) return;
        themeToggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('light-theme');
            const currentTheme = document.documentElement.classList.contains('light-theme') ? 'light' : 'dark';
            localStorage.setItem('theme', currentTheme);
        });
    }

    function initMobileMenu() {
        const toggle = document.getElementById('mobile-menu-toggle');
        const close = document.getElementById('mobile-menu-close');
        const overlay = document.getElementById('mobile-menu-overlay');
        if (!toggle || !close || !overlay) return;
        const closeMenu = () => { overlay.classList.remove('active'); document.body.style.overflow = ''; };
        toggle.addEventListener('click', () => { overlay.classList.add('active'); document.body.style.overflow = 'hidden'; });
        close.addEventListener('click', closeMenu);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) closeMenu(); });
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
    }

    function formatDate(isoDate) {
        return new Date(isoDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function milestoneLabel(milestone) {
        if (milestone === 'all') return 'Every lab';
        return milestone === '1' ? 'First lab' : `${milestone} labs`;
    }

    async function renderLeaderboard(container) {
        const { api, createElement } = window.pfAccount;
        let entries;
        try {
            ({ entries } = await api('GET', '/leaderboard'));
        } catch (_) {
            container.replaceChildren(createElement('p', { className: 'pf-empty' }, 'The leaderboard is unavailable right now. Try again later.'));
            return;
        }
        if (entries.length === 0) {
            container.replaceChildren(createElement('p', { className: 'pf-empty' }, 'Nobody is on the leaderboard yet. Sign in, pick a username and complete a lab to be first.'));
            return;
        }
        const me = await window.pfAccount.me();
        const rows = entries.map((entry) => createElement('tr', { className: me.username === entry.username ? 'pf-me' : '' },
            createElement('td', { className: 'pf-rank' }, `#${entry.rank}`),
            createElement('td', {}, createElement('a', { href: `/profile/?u=${encodeURIComponent(entry.username)}` }, entry.username)),
            createElement('td', { className: 'pf-count' }, String(entry.completedCount)),
            createElement('td', {}, formatDate(entry.lastCompletedAt))));
        container.replaceChildren(createElement('table', { className: 'pf-table' },
            createElement('thead', {}, createElement('tr', {},
                createElement('th', {}, 'Rank'), createElement('th', {}, 'Username'),
                createElement('th', {}, 'Labs completed'), createElement('th', {}, 'Last completion'))),
            createElement('tbody', {}, ...rows)));
    }

    async function renderProfile(container) {
        const { api, createElement } = window.pfAccount;
        const username = new URLSearchParams(window.location.search).get('u') || '';
        let profile;
        try {
            profile = await api('GET', `/users/${encodeURIComponent(username)}`);
        } catch (_) {
            container.replaceChildren(createElement('h1', {}, 'Profile not found'),
                createElement('p', { className: 'pf-empty' }, 'No pathfinding.cloud user has that username.'),
                createElement('a', { className: 'pf-button', href: '/leaderboard/' }, 'View the leaderboard'));
            return;
        }
        document.title = `${profile.username} - pathfinding.cloud`;
        const me = await window.pfAccount.me();
        const isOwnProfile = me.kind === 'user' && me.username === profile.username;
        const percent = profile.totalLabCount ? Math.round((profile.completedCount / profile.totalLabCount) * 100) : 0;

        // Your own milestones are buttons that open the share dialog.
        const badges = profile.milestones.map((milestone) => isOwnProfile
            ? createElement('button', { className: 'pf-badge', title: 'Share this milestone', onClick: () => window.pfAccount.shareMilestone(milestone) }, `${milestoneLabel(milestone)} ↗`)
            : createElement('span', { className: 'pf-badge' }, milestoneLabel(milestone)));

        const labRows = profile.completedLabs.slice().reverse().map((lab) => createElement('tr', {},
            createElement('td', {}, createElement('a', { href: `/labs/${encodeURIComponent(lab.labSlug)}/` }, lab.labSlug)),
            createElement('td', {}, formatDate(lab.completedAt))));

        const progress = createElement('div', { className: 'pf-progress', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' },
            createElement('div', { style: `width: ${percent}%` }));

        container.replaceChildren(
            createElement('h1', {}, profile.username),
            createElement('p', { className: 'pf-subtitle' }, `${profile.completedCount} of ${profile.totalLabCount} labs completed · member since ${formatDate(profile.memberSince)}`),
            progress,
            profile.milestones.length ? createElement('h2', {}, 'Milestones') : null,
            profile.milestones.length ? createElement('div', { className: 'pf-badges' }, ...badges) : null,
            isOwnProfile && profile.milestones.length ? createElement('p', { className: 'pf-fine-print' }, 'Select a milestone to share it.') : null,
            createElement('h2', {}, 'Completed labs'),
            labRows.length
                ? createElement('table', { className: 'pf-table' },
                    createElement('thead', {}, createElement('tr', {}, createElement('th', {}, 'Lab'), createElement('th', {}, 'Completed'))),
                    createElement('tbody', {}, ...labRows))
                : createElement('p', { className: 'pf-empty' }, 'No labs completed yet.'));
    }

    function start() {
        initTheme();
        initMobileMenu();
        const container = document.getElementById('pf-page-content');
        if (!container) return;
        if (container.dataset.page === 'leaderboard') renderLeaderboard(container);
        if (container.dataset.page === 'profile') renderProfile(container);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}());
