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

    /** replaceChildren() would print null placeholders as text; drop them. */
    function setChildren(container, ...children) {
        container.replaceChildren(...children.filter((child) => child !== null && child !== undefined));
    }

    function formatDate(isoDate) {
        return new Date(isoDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    async function renderLeaderboard(container) {
        const { api, createElement } = window.pfAccount;
        let entries;
        try {
            ({ entries } = await api('GET', '/leaderboard'));
        } catch (_) {
            setChildren(container, createElement('p', { className: 'pf-empty' }, 'The leaderboard is unavailable right now. Try again later.'));
            return;
        }
        if (entries.length === 0) {
            setChildren(container, createElement('p', { className: 'pf-empty' }, 'Nobody is on the leaderboard yet. Sign in, pick a username and complete a lab to be first.'));
            return;
        }
        const me = await window.pfAccount.me();
        const rows = entries.map((entry) => createElement('tr', { className: me.username === entry.username ? 'pf-me' : '' },
            createElement('td', { className: 'pf-rank' }, `#${entry.rank}`),
            createElement('td', {}, me.username === entry.username ? createElement('a', { href: '/profile/' }, entry.username) : entry.username),
            createElement('td', { className: 'pf-count' }, String(entry.completedCount)),
            createElement('td', {}, formatDate(entry.lastCompletedAt))));
        setChildren(container, createElement('table', { className: 'pf-table' },
            createElement('thead', {}, createElement('tr', {},
                createElement('th', {}, 'Rank'), createElement('th', {}, 'Username'),
                createElement('th', {}, 'Labs completed'), createElement('th', {}, 'Last completion'))),
            createElement('tbody', {}, ...rows)));
    }

    // One card per milestone: earned ones can be shared (on your own profile),
    // locked ones show how far along you are.
    function milestoneCard(milestone, completedCount, isOwnProfile) {
        const { createElement } = window.pfAccount;
        const card = createElement('div', { className: `pf-milestone ${milestone.achieved ? 'earned' : 'locked'}` });
        const countLabel = milestone.id === 'all' ? `All ${milestone.threshold} labs` : milestone.id === '1' ? 'First lab' : `${milestone.threshold} labs`;
        card.append(
            createElement('span', { className: 'pf-milestone-count' }, countLabel),
            createElement('span', { className: 'pf-milestone-name' }, milestone.name));
        if (milestone.achieved) {
            card.append(isOwnProfile
                ? createElement('button', { className: 'pf-button pf-button-primary pf-milestone-action', onClick: () => window.pfAccount.shareMilestone(milestone.id) }, 'Share')
                : createElement('span', { className: 'pf-milestone-status' }, 'Earned'));
        } else {
            const percent = Math.min(100, Math.round((completedCount / milestone.threshold) * 100));
            card.append(
                createElement('div', { className: 'pf-milestone-bar', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${milestone.name} progress` },
                    createElement('div', { style: `width: ${percent}%` })),
                createElement('span', { className: 'pf-milestone-status' }, `${completedCount} / ${milestone.threshold}`));
        }
        return card;
    }

    function accountSection(me) {
        const { createElement } = window.pfAccount;
        const renameNote = me.renameAllowedAt
            ? createElement('p', { className: 'pf-fine-print' }, `You can change your username again on ${formatDate(me.renameAllowedAt)}.`)
            : createElement('p', { className: 'pf-fine-print' }, 'You can change your username once every 30 days.');
        const deleteButton = createElement('button', { className: 'pf-button pf-button-danger', onClick: async () => {
            deleteButton.disabled = true;
            if (await window.pfAccount.deleteAccount()) window.location.assign('/labs/');
            else deleteButton.disabled = false;
        } }, 'Delete account');
        return createElement('section', { className: 'pf-account-section' },
            createElement('h2', {}, 'Account'),
            createElement('div', { className: 'pf-account-row' },
                createElement('div', {},
                    createElement('strong', {}, 'Username'),
                    renameNote),
                createElement('button', { className: 'pf-button', disabled: me.renameAllowedAt ? '' : null, onClick: window.pfAccount.openUsernameModal }, 'Change username')),
            createElement('div', { className: 'pf-account-row' },
                createElement('div', {},
                    createElement('strong', {}, 'Delete account'),
                    createElement('p', { className: 'pf-fine-print' }, 'Permanently removes your username, progress and leaderboard entry from pathfinding.cloud.')),
                deleteButton));
    }

    // Profiles are private: this page only ever shows the signed-in user's own
    // profile, read from /me. There is no API for anyone else's.
    async function renderProfile(container) {
        const { createElement } = window.pfAccount;
        const me = await window.pfAccount.me();
        const requestedUsername = new URLSearchParams(window.location.search).get('u');

        if (me.kind !== 'user') {
            setChildren(container, createElement('h1', {}, 'Your profile'),
                createElement('p', { className: 'pf-empty' }, 'Profiles are private. Sign in to see your progress and milestones.'),
                window.pfAccount.signInAvailable()
                    ? createElement('button', { className: 'pf-button pf-button-primary', onClick: () => window.pfAccount.openSignIn() }, 'Sign in')
                    : null,
                createElement('p', {}, createElement('a', { href: '/leaderboard/' }, 'View the public leaderboard')));
            return;
        }
        if (!me.username) {
            setChildren(container, createElement('h1', {}, 'Your profile'),
                createElement('p', { className: 'pf-empty' }, 'Choose a username to appear on the leaderboard and share your milestones.'),
                createElement('button', { className: 'pf-button pf-button-primary', onClick: window.pfAccount.openUsernameModal }, 'Choose username'));
            return;
        }
        // An old link to someone else's profile: say so rather than show yours under their name.
        if (requestedUsername && requestedUsername.toLowerCase() !== me.username) {
            setChildren(container, createElement('h1', {}, 'This profile is private'),
                createElement('p', { className: 'pf-empty' }, 'Profiles can only be viewed by their owner.'),
                createElement('p', {}, createElement('a', { href: '/profile/' }, 'Go to your profile'), ' · ', createElement('a', { href: '/leaderboard/' }, 'View the leaderboard')));
            return;
        }

        document.title = `${me.username} - pathfinding.cloud`;
        const percent = me.totalLabCount ? Math.round((me.completedCount / me.totalLabCount) * 100) : 0;
        const ladder = me.milestoneCatalog || [];
        const earnedCount = ladder.filter((milestone) => milestone.achieved).length;

        const labRows = me.completedLabs.slice().sort((left, right) => right.completedAt.localeCompare(left.completedAt)).map((lab) => createElement('tr', {},
            createElement('td', {}, createElement('a', { href: `/labs/${encodeURIComponent(lab.labSlug)}/` }, lab.labSlug)),
            createElement('td', {}, formatDate(lab.completedAt))));

        const progress = createElement('div', { className: 'pf-progress', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' },
            createElement('div', { style: `width: ${percent}%` }));

        setChildren(container,
            createElement('h1', {}, me.username),
            createElement('p', { className: 'pf-subtitle' }, `${me.completedCount} of ${me.totalLabCount} labs completed${me.memberSince ? ` · member since ${formatDate(me.memberSince)}` : ''}`),
            createElement('p', { className: 'pf-fine-print' }, 'Only you can see this page. The leaderboard shows your username and lab count.'),
            progress,
            createElement('div', { className: 'pf-section-heading' },
                createElement('h2', {}, 'Milestones'),
                createElement('span', { className: 'pf-fine-print' }, `${earnedCount} of ${ladder.length} earned`)),
            createElement('p', { className: 'pf-fine-print' }, 'Your first lab, then a new milestone every 10 labs. Share the ones you have earned.'),
            createElement('div', { className: 'pf-milestones' }, ...ladder.map((milestone) => milestoneCard(milestone, me.completedCount, true))),
            createElement('h2', {}, 'Completed labs'),
            labRows.length
                ? createElement('table', { className: 'pf-table' },
                    createElement('thead', {}, createElement('tr', {}, createElement('th', {}, 'Lab'), createElement('th', {}, 'Completed'))),
                    createElement('tbody', {}, ...labRows))
                : createElement('p', { className: 'pf-empty' }, 'No labs completed yet.'),
            accountSection(me));
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
