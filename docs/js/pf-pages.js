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

    const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

    /** "today", "3 days ago", "2 months ago" for a past ISO date. */
    function formatRelativeDate(isoDate) {
        const elapsedDays = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
        if (elapsedDays < 1) return relativeTimeFormat.format(0, 'day');
        if (elapsedDays < 30) return relativeTimeFormat.format(-elapsedDays, 'day');
        if (elapsedDays < 365) return relativeTimeFormat.format(-Math.floor(elapsedDays / 30), 'month');
        return relativeTimeFormat.format(-Math.floor(elapsedDays / 365), 'year');
    }

    /** Stable hue per username so each player keeps the same avatar color. */
    function usernameHue(username) {
        let hash = 0;
        for (const character of username) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
        return hash % 360;
    }

    function avatar(username, sizeClass) {
        const { createElement } = window.pfAccount;
        const hue = usernameHue(username);
        // Only computed numbers go into the style attribute; the initial is set as text.
        return createElement('span', { className: `pf-lb-avatar ${sizeClass || ''}`, 'aria-hidden': 'true',
            style: `--avatar-hue: ${hue}` }, username.charAt(0).toUpperCase());
    }

    function usernameLabel(entry, me) {
        const { createElement } = window.pfAccount;
        const isMe = me.username === entry.username;
        return createElement('span', { className: 'pf-lb-name' },
            isMe ? createElement('a', { href: '/profile/' }, entry.username) : entry.username,
            isMe ? createElement('span', { className: 'pf-lb-you' }, 'You') : null);
    }

    function labCountLabel(count) {
        return `${count} lab${count === 1 ? '' : 's'}`;
    }

    function pointsOf(entry) {
        return entry.totalPoints ?? 0;
    }

    // Top three, laid out 2-1-3 like a podium.
    function podium(topEntries, me) {
        const { createElement } = window.pfAccount;
        const placeNames = { 1: 'gold', 2: 'silver', 3: 'bronze' };
        const order = [topEntries[1], topEntries[0], topEntries[2]].filter(Boolean);
        return createElement('ol', { className: `pf-lb-podium pf-lb-podium-${topEntries.length}`, 'aria-label': 'Top three' },
            ...order.map((entry) => createElement('li', {
                className: `pf-lb-podium-place pf-lb-${placeNames[entry.rank]}${me.username === entry.username ? ' pf-me' : ''}` },
                createElement('span', { className: 'pf-lb-medal', 'aria-label': `Rank ${entry.rank}` }, String(entry.rank)),
                avatar(entry.username, 'pf-lb-avatar-lg'),
                usernameLabel(entry, me),
                createElement('span', { className: 'pf-lb-podium-count' },
                    createElement('strong', {}, String(pointsOf(entry))), ' pts'),
                createElement('span', { className: 'pf-lb-podium-sub' }, labCountLabel(entry.completedCount)),
                createElement('span', { className: 'pf-lb-when', title: formatDate(entry.lastCompletedAt) },
                    `Last completion ${formatRelativeDate(entry.lastCompletedAt)}`),
                createElement('span', { className: 'pf-lb-plinth', 'aria-hidden': 'true' }))));
    }

    // Where the signed-in visitor stands, or how to get on the board.
    function standingCard(entries, me) {
        const { createElement } = window.pfAccount;
        const card = (title, detail, action) => createElement('div', { className: 'pf-lb-standing' },
            createElement('div', {}, createElement('strong', {}, title), createElement('p', {}, detail)), action);

        if (me.kind !== 'user') {
            if (!window.pfAccount.signInAvailable()) return null;
            return card('Want to see your name here?', 'Sign in, pick a username and complete a lab to join the leaderboard.',
                createElement('button', { className: 'pf-button pf-button-primary', onClick: () => window.pfAccount.openSignIn() }, 'Sign in'));
        }
        if (!me.username) {
            return card('You are not on the board yet', 'Choose a public username to appear on the leaderboard.',
                createElement('button', { className: 'pf-button pf-button-primary', onClick: window.pfAccount.openUsernameModal }, 'Choose username'));
        }
        const myEntry = entries.find((entry) => entry.username === me.username);
        if (!myEntry) {
            return card(`@${me.username}, you are almost there`, 'Complete your first lab to claim a spot on the leaderboard.',
                createElement('a', { className: 'pf-button pf-button-primary', href: '/labs/' }, 'Browse labs'));
        }
        if (myEntry.rank === 1) {
            return card(`You are #1, @${me.username}`, `${pointsOf(myEntry)} points from ${labCountLabel(myEntry.completedCount)}. Everyone else is chasing you.`, null);
        }
        const nextEntry = entries[myEntry.rank - 2];
        const pointsBehind = pointsOf(nextEntry) - pointsOf(myEntry);
        // A tie on points is broken by who got there first, so you still need to earn a little more.
        const detail = pointsBehind > 0
            ? `${pointsBehind} point${pointsBehind === 1 ? '' : 's'} behind @${nextEntry.username}.`
            : `Tied with @${nextEntry.username} on points — earn more to pull ahead.`;
        return card(`You are #${myEntry.rank}, @${me.username}`, detail,
            createElement('a', { className: 'pf-button pf-button-primary', href: '/labs/' }, 'Keep climbing'));
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
        const me = await window.pfAccount.me();
        if (entries.length === 0) {
            setChildren(container,
                createElement('div', { className: 'pf-lb-empty' },
                    createElement('strong', {}, 'The board is wide open'),
                    createElement('p', {}, 'Nobody is on the leaderboard yet. Sign in, pick a username and complete a lab to be first.')),
                standingCard(entries, me));
            return;
        }

        const totalPoints = entries.reduce((sum, entry) => sum + pointsOf(entry), 0);
        const leaderPoints = Math.max(1, pointsOf(entries[0]));
        const stats = createElement('div', { className: 'pf-lb-stats' },
            createElement('div', {}, createElement('strong', {}, String(entries.length)), createElement('span', {}, entries.length === 1 ? 'player ranked' : 'players ranked')),
            createElement('div', {}, createElement('strong', {}, String(totalPoints)), createElement('span', {}, 'points earned')),
            createElement('div', {}, createElement('strong', {}, String(pointsOf(entries[0]))), createElement('span', {}, 'top score')));

        // Bars are relative to the leader's points so the chase is visible at a glance.
        const rows = entries.slice(3).map((entry) => {
            const percent = Math.max(4, Math.round((pointsOf(entry) / leaderPoints) * 100));
            return createElement('li', { className: `pf-lb-row${me.username === entry.username ? ' pf-me' : ''}` },
                createElement('span', { className: 'pf-lb-rank' }, String(entry.rank)),
                avatar(entry.username),
                createElement('div', { className: 'pf-lb-row-main' },
                    usernameLabel(entry, me),
                    createElement('div', { className: 'pf-lb-bar', 'aria-hidden': 'true' }, createElement('div', { style: `width: ${percent}%` }))),
                createElement('span', { className: 'pf-lb-when', title: formatDate(entry.lastCompletedAt) }, formatRelativeDate(entry.lastCompletedAt)),
                createElement('span', { className: 'pf-lb-count' },
                    createElement('span', { className: 'pf-lb-count-main' }, createElement('strong', {}, String(pointsOf(entry))), ' pts'),
                    createElement('span', { className: 'pf-lb-count-sub' }, labCountLabel(entry.completedCount))));
        });

        setChildren(container,
            stats,
            standingCard(entries, me),
            podium(entries.slice(0, 3), me),
            rows.length
                ? createElement('ol', { className: 'pf-lb-list', start: '4', 'aria-label': 'Rankings from fourth place' }, ...rows)
                : null);
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
            createElement('p', { className: 'pf-subtitle' }, `${me.totalPoints ?? 0} points · ${me.completedCount} of ${me.totalLabCount} labs completed${me.memberSince ? ` · member since ${formatDate(me.memberSince)}` : ''}`),
            createElement('p', { className: 'pf-fine-print' }, 'Only you can see this page. The leaderboard shows your username, points and lab count.'),
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
