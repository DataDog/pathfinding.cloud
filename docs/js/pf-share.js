// Public share page (/share/): shows one shared milestone card to anyone who
// follows a share link.
//
// The link people post is the backend's /s page, which carries the card's Open
// Graph tags for LinkedIn and X and then sends people here with the same query
// (u, m, t). The backend's /share-card checks the token and returns what the
// card shows. Unlike the leaderboard and profile pages, this one works for
// every visitor, regardless of the accounts launch switch in pf-account.js:
// anyone can follow a shared link.
(function () {
    'use strict';

    // Same rule as pf-account.js.
    const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const API_BASE_URL = isLocalDevelopment ? 'http://localhost:8787' : 'https://api.pathfinding.cloud';

    function createElement(tagName, attributes, ...children) {
        const element = document.createElement(tagName);
        for (const [name, value] of Object.entries(attributes || {})) {
            if (name === 'className') element.className = value;
            else element.setAttribute(name, value);
        }
        // Text is always set as text nodes, never as markup, since the username comes from the link.
        for (const child of children) {
            if (child !== null && child !== undefined) element.append(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return element;
    }

    /** "@kmoore just completed Level 3", in the same voice as the card. */
    function headline(details) {
        const handle = `@${details.username}`;
        if (details.milestone === 'all') return `${handle} just completed every lab`;
        if (details.milestone === '1') return `${handle} just completed their first lab`;
        return details.level ? `${handle} just completed Level ${details.level}` : `${handle} just earned ${details.name}`;
    }

    function playButtons() {
        return createElement('div', { className: 'pf-share-actions' },
            createElement('a', { className: 'pf-button pf-button-primary', href: '/labs/' }, 'Play the free labs'),
            createElement('a', { className: 'pf-button', href: '/labs/getting-started/' }, 'How it works'));
    }

    function renderShare(container, details) {
        const title = headline(details);
        document.title = `${title} - Pathfinding Labs`;
        // Nothing visible above the card: it already carries the handle and the level.
        container.replaceChildren(
            createElement('h1', { className: 'pf-visually-hidden' }, `${title}: ${details.name}`),
            createElement('img', { className: 'pf-share-card', src: details.imageUrl, width: '1200', height: '630',
                alt: `${title}: ${details.name}. Share card from Pathfinding Labs.` }),
            createElement('p', { className: 'pf-share-pitch' },
                'Pathfinding Labs is a free online cloud privilege escalation playground. Each lab drops you into a real cloud account with a starting identity and a target. Find the path and capture the flag, right in your browser.'),
            playButtons());
    }

    function renderInvalid(container) {
        container.replaceChildren(
            createElement('h1', {}, 'This share link is not available'),
            createElement('p', { className: 'pf-subtitle' }, 'It may have been mistyped, or the player renamed or deleted their account.'),
            createElement('p', { className: 'pf-share-pitch' }, 'Pathfinding Labs is a free online cloud privilege escalation playground.'),
            playButtons());
    }

    async function init() {
        const container = document.getElementById('pf-share-content');
        if (!container) return;
        const params = new URLSearchParams(window.location.search);
        const query = new URLSearchParams();
        for (const key of ['u', 'm', 't']) {
            const value = params.get(key);
            if (!value) { renderInvalid(container); return; }
            query.set(key, value);
        }
        try {
            const response = await fetch(`${API_BASE_URL}/share-card?${query}`);
            if (!response.ok) { renderInvalid(container); return; }
            renderShare(container, await response.json());
        } catch (_) {
            renderInvalid(container);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
