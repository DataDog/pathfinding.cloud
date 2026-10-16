// ============================================================
// pathfinding.cloud accounts: API client, sign-in, username, sharing
// ============================================================
// Talks to pathfinding-backend (api.pathfinding.cloud). The session lives in an
// HttpOnly cookie on the API's domain, so this script never sees a token; it
// only calls the API with credentials included.
//
// Exposes window.pfAccount for other scripts (map-game.js, leaderboard and
// profile pages). All user-controlled text is written with textContent.

(function () {
    'use strict';

    const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const API_BASE_URL = isLocalDevelopment ? 'http://localhost:8787' : 'https://api.pathfinding.cloud';

    // ---- API client ----

    class PfApiError extends Error {
        constructor(status, body) {
            super((body && body.message) || `Request failed (${status})`);
            this.status = status;
            this.code = body && body.code;
            this.body = body || {};
        }
    }

    async function api(method, path, body) {
        const init = { method, credentials: 'include', headers: {} };
        if (body !== undefined) {
            init.headers['content-type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const response = await fetch(API_BASE_URL + path, init);
        let parsed = null;
        try { parsed = await response.json(); } catch (_) { parsed = null; }
        if (!response.ok) throw new PfApiError(response.status, parsed);
        return parsed;
    }

    // ---- Session state ----

    let currentMe = { kind: 'anonymous' };
    let mePromise = null;
    const changeListeners = [];

    function loadMe() {
        mePromise = api('GET', '/me')
            .then((me) => { currentMe = me; return me; })
            // The site works without the API; treat failures as signed out.
            .catch(() => { currentMe = { kind: 'anonymous', unavailable: true }; return currentMe; })
            .then((me) => { changeListeners.forEach((listener) => listener(me)); renderAccountControl(); return me; });
        return mePromise;
    }

    // Which labs can be played online right now, as a Set of lab slugs. The
    // backend derives it from Cybr's catalog (labs with a browser terminal), so
    // labs appear as Cybr enables them. Fetched once per page; an unreachable
    // API means no lab is shown as online.
    let onlineLabSlugsPromise = null;
    function onlineLabSlugs() {
        onlineLabSlugsPromise ??= api('GET', '/labs/online')
            .then((result) => new Set(Array.isArray(result && result.labs) ? result.labs : []))
            .catch(() => new Set());
        return onlineLabSlugsPromise;
    }

    // Reports commands typed in a live lab's terminal (never its output) for
    // learner analytics. Best effort: keepalive lets a
    // batch sent while the page unloads still arrive, and failures are dropped.
    function sendTerminalCommands(labSlug, commands) {
        if (!commands.length) return Promise.resolve();
        return fetch(`${API_BASE_URL}/labs/${encodeURIComponent(labSlug)}/terminal-commands`, {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ commands })
        }).then(() => {}, () => {});
    }

    // Single-flight: concurrent callers (two panels, a double click) share one
    // request, so a browser never mints two guest sessions at once.
    let guestSessionPromise = null;
    async function ensureGuestSession() {
        const me = await (mePromise || loadMe());
        if (me.kind !== 'anonymous' || me.unavailable) return me;
        guestSessionPromise ??= api('POST', '/session/guest')
            .then(() => loadMe())
            .finally(() => { guestSessionPromise = null; });
        return guestSessionPromise;
    }

    function signInUrl(provider) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash;
        return `${API_BASE_URL}/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
    }

    // ---- Small DOM helpers ----

    function createElement(tagName, attributes, ...children) {
        const element = document.createElement(tagName);
        for (const [name, value] of Object.entries(attributes || {})) {
            if (value === null || value === undefined) continue;
            if (name === 'className') element.className = value;
            else if (name.startsWith('on')) element.addEventListener(name.slice(2).toLowerCase(), value);
            else element.setAttribute(name, value);
        }
        for (const child of children) {
            if (child === null || child === undefined) continue;
            element.append(typeof child === 'string' ? document.createTextNode(child) : child);
        }
        return element;
    }

    function openModal(title, ...content) {
        closeModal();
        const dialog = createElement('div', { className: 'pf-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
            createElement('div', { className: 'pf-modal-header' },
                createElement('h2', {}, title),
                createElement('button', { className: 'pf-modal-close', 'aria-label': 'Close', onClick: closeModal }, '×')),
            createElement('div', { className: 'pf-modal-body' }, ...content));
        const overlay = createElement('div', { className: 'pf-modal-overlay', id: 'pf-modal-overlay',
            onClick: (event) => { if (event.target === overlay) closeModal(); } }, dialog);
        document.body.append(overlay);
        document.addEventListener('keydown', closeOnEscape);
        return dialog;
    }

    function closeModal() {
        document.getElementById('pf-modal-overlay')?.remove();
        document.removeEventListener('keydown', closeOnEscape);
    }

    function closeOnEscape(event) { if (event.key === 'Escape') closeModal(); }

    function showToast(message, kind) {
        const toast = createElement('div', { className: `pf-toast ${kind || ''}`, role: 'status' }, message);
        document.body.append(toast);
        setTimeout(() => toast.remove(), 6000);
    }

    // ---- Sign-in modal ----

    const PROVIDER_LABELS = { github: 'Continue with GitHub', google: 'Continue with Google' };

    // Static, trusted SVG markup (no user data), inserted with innerHTML.
    const PROVIDER_ICONS = {
        github: '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
        google: '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'
    };

    const SIGN_IN_BENEFITS = [
        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
            text: 'Save your lab progress across devices' },
        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
            text: 'Climb the public labs leaderboard' },
        { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
            text: 'Unlock shareable milestone cards' }
    ];

    const SHIELD_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

    /** createElement() for a wrapper holding static, trusted SVG markup. */
    function iconElement(className, svgMarkup) {
        const wrapper = createElement('span', { className });
        wrapper.innerHTML = svgMarkup; // static markup, no user data
        return wrapper;
    }

    /** Sign-in providers the backend has enabled (it reports them on /me), GitHub first. */
    function enabledProviders() {
        if (!Array.isArray(currentMe.signInProviders)) return [];
        return Object.keys(PROVIDER_LABELS).filter((name) => currentMe.signInProviders.includes(name));
    }

    function signInAvailable() {
        return currentMe.kind === 'user' || enabledProviders().length > 0;
    }

    function openSignIn(reason) {
        if (enabledProviders().length === 0) {
            if (reason) showToast(reason);
            else if (currentMe.unavailable) showToast('Sign-in is unavailable right now. Try again in a little while.', 'error');
            else showToast('Sign-in is not available yet. You can still play every lab as a guest.');
            return;
        }
        const providerButtons = enabledProviders().map((providerName) => {
            const button = createElement('a', { className: `pf-signin-button pf-signin-${providerName}`, href: signInUrl(providerName) });
            button.append(iconElement('pf-signin-button-icon', PROVIDER_ICONS[providerName]),
                createElement('span', {}, PROVIDER_LABELS[providerName]));
            return button;
        });
        const benefitList = createElement('ul', { className: 'pf-signin-benefits' },
            ...SIGN_IN_BENEFITS.map((benefit) => createElement('li', {},
                iconElement('pf-signin-benefit-icon', benefit.icon), benefit.text)));

        const dialog = openModal('Sign in to pathfinding.cloud',
            createElement('div', { className: 'pf-signin-hero' },
                createElement('img', { className: 'pf-signin-logo', src: '/images/brand/pathfinding-cloud-logo.png', alt: '', width: '76', height: '76' }),
                createElement('h2', { className: 'pf-signin-title' }, 'Sign in to ', createElement('span', {}, 'pathfinding.cloud')),
                createElement('p', { className: 'pf-signin-subtitle' }, 'Track your progress through hands-on AWS IAM privilege escalation labs.')),
            reason ? createElement('p', { className: 'pf-signin-reason' }, reason) : null,
            createElement('div', { className: 'pf-signin-buttons' }, ...providerButtons),
            benefitList,
            createElement('div', { className: 'pf-signin-privacy' },
                iconElement('pf-signin-privacy-icon', SHIELD_ICON),
                createElement('p', {}, 'We never receive your email address or name. GitHub and Google only tell us an anonymous account ID, and you choose a public username.')),
            createElement('button', { className: 'pf-signin-guest', type: 'button', onClick: closeModal }, 'Not now, keep playing as a guest'));
        dialog.classList.add('pf-modal-signin');
        providerButtons[0].focus();
    }

    // ---- Username modal ----

    function openUsernameModal() {
        const input = createElement('input', { type: 'text', id: 'pf-username-input', maxlength: '20', autocomplete: 'off',
            spellcheck: 'false', placeholder: 'e.g. cloud_hopper', 'aria-describedby': 'pf-username-help' });
        if (currentMe.username) input.value = currentMe.username;
        const errorLine = createElement('p', { className: 'pf-form-error', role: 'alert' });
        const form = createElement('form', { className: 'pf-username-form', onSubmit: async (event) => {
            event.preventDefault();
            errorLine.textContent = '';
            try {
                const result = await api('POST', '/me/username', { username: input.value });
                closeModal();
                showToast(`You are now @${result.username}.`, 'success');
                await loadMe();
                if (window.location.pathname.startsWith('/profile')) window.location.reload();
            } catch (error) {
                errorLine.textContent = error.message;
            }
        } },
            createElement('label', { for: 'pf-username-input' }, 'Username'),
            input,
            createElement('p', { id: 'pf-username-help', className: 'pf-fine-print' },
                '3-20 characters: lowercase letters, digits, "_" or "-". Shown publicly on the leaderboard and your profile. You can change it once every 30 days.'),
            errorLine,
            createElement('button', { type: 'submit', className: 'pf-button pf-button-primary' }, 'Save username'));
        openModal(currentMe.username ? 'Change your username' : 'Choose a username', form);
        input.focus();
    }

    // ---- Share modal ----

    /** Milestone name from the ladder the backend returns, e.g. "Role Hopper". */
    function milestoneName(milestone) {
        const entry = (currentMe.milestoneCatalog || []).find((item) => item.id === milestone);
        return entry ? entry.name : milestone;
    }

    function milestoneText(milestone) {
        if (milestone === 'all') return 'completed every lab';
        return milestone === '1' ? 'completed my first lab' : `completed ${milestone} labs`;
    }

    // Profiles are private, so cards are reachable only through a link the
    // backend issues to the signed-in owner.
    async function shareMilestone(milestone) {
        const username = currentMe.username;
        if (!username) { openUsernameModal(); return; }
        const name = milestoneName(milestone);
        let shareUrl, imageUrl;
        try {
            ({ shareUrl, imageUrl } = await api('POST', '/me/share-links', { milestone }));
        } catch (error) {
            showToast(error.message, 'error');
            return;
        }
        const text = `I just earned "${name}" on pathfinding.cloud: ${milestoneText(milestone)} of hands-on AWS IAM privilege escalation labs.`;
        const copyButton = createElement('button', { className: 'pf-button', onClick: async () => {
            try { await navigator.clipboard.writeText(shareUrl); copyButton.textContent = 'Copied'; } catch (_) { copyButton.textContent = shareUrl; }
        } }, 'Copy link');
        openModal(`Share "${name}"`,
            createElement('img', { className: 'pf-share-preview', src: imageUrl, alt: `Share card: ${username} earned ${name}`, width: '600', height: '315' }),
            createElement('div', { className: 'pf-share-buttons' },
                createElement('a', { className: 'pf-button', target: '_blank', rel: 'noopener noreferrer',
                    href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}` }, 'LinkedIn'),
                createElement('a', { className: 'pf-button', target: '_blank', rel: 'noopener noreferrer',
                    href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}` }, 'X'),
                createElement('a', { className: 'pf-button', target: '_blank', rel: 'noopener noreferrer',
                    href: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${shareUrl}`)}` }, 'Bluesky'),
                copyButton));
    }

    // ---- Header: Leaderboard link and account pill (far right, on every page) ----

    const TROPHY_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';

    function renderAccountControl() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;
        document.getElementById('pf-header-account')?.remove();

        const onLeaderboard = window.location.pathname.startsWith('/leaderboard');
        const leaderboardLink = createElement('a', { href: '/leaderboard/', className: `pf-leaderboard-link${onLeaderboard ? ' active' : ''}`,
            ...(onLeaderboard ? { 'aria-current': 'page' } : {}) });
        leaderboardLink.innerHTML = TROPHY_ICON; // static markup, no user data
        leaderboardLink.append(createElement('span', {}, 'Labs Leaderboard'));

        let accountControl;
        if (currentMe.kind === 'user') {
            const menu = createElement('div', { className: 'pf-account-menu', hidden: '' },
                currentMe.username
                    ? createElement('a', { href: '/profile/' }, 'My profile')
                    : createElement('button', { onClick: openUsernameModal }, 'Choose username'),
                createElement('button', { onClick: signOut }, 'Sign out'));
            const toggle = createElement('button', { className: 'pf-account-pill', 'aria-haspopup': 'true', 'aria-expanded': 'false', onClick: (event) => {
                event.stopPropagation();
                menu.hidden = !menu.hidden;
                toggle.setAttribute('aria-expanded', String(!menu.hidden));
            } },
                createElement('span', { className: 'pf-account-name' }, currentMe.username ? `@${currentMe.username}` : 'Choose username'),
                createElement('span', { className: 'pf-account-count', title: 'Labs completed' }, String(currentMe.completedCount || 0)));
            accountControl = createElement('div', { className: 'pf-account' }, toggle, menu);
        } else {
            accountControl = createElement('div', { className: 'pf-account' },
                createElement('button', { className: 'pf-account-pill', onClick: () => openSignIn() }, 'Sign in'));
        }

        // Appended last so it sits after the Datadog, theme and GitHub links.
        headerRight.append(createElement('div', { id: 'pf-header-account', className: 'pf-header-account' }, leaderboardLink, accountControl));
    }

    async function signOut() {
        try { await api('POST', '/auth/logout'); } catch (_) { /* session may already be gone */ }
        showToast('Signed out.');
        loadMe();
    }

    async function deleteAccount() {
        const confirmed = window.confirm('Delete your pathfinding.cloud account? Your username, progress and leaderboard entry are removed permanently.');
        if (!confirmed) return false;
        try {
            await api('DELETE', '/me');
            showToast('Your account was deleted.');
            await loadMe();
            return true;
        } catch (error) {
            showToast(error.message, 'error');
            return false;
        }
    }

    // ---- Handle redirects back from sign-in ----

    function consumeSignInRedirectParameters() {
        const url = new URL(window.location.href);
        const claimUsername = url.searchParams.get('claim_username') === '1';
        const signedIn = url.searchParams.get('signed_in') === '1';
        const authError = url.searchParams.get('auth_error');
        if (!claimUsername && !signedIn && !authError) return;
        ['claim_username', 'signed_in', 'auth_error'].forEach((name) => url.searchParams.delete(name));
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);

        if (authError === 'provider_unavailable') showToast('That sign-in option is not available right now.', 'error');
        else if (authError) showToast('Sign-in did not complete. Please try again.', 'error');
        mePromise.then((me) => {
            if (me.kind !== 'user') return;
            if (claimUsername || me.needsUsername) openUsernameModal();
            else showToast('Signed in.', 'success');
        });
    }

    window.pfAccount = {
        apiBaseUrl: API_BASE_URL,
        api,
        PfApiError,
        me: () => mePromise || loadMe(),
        current: () => currentMe,
        refresh: loadMe,
        onChange: (listener) => changeListeners.push(listener),
        openSignIn,
        signInAvailable,
        ensureGuestSession,
        onlineLabSlugs,
        sendTerminalCommands,
        deleteAccount,
        openUsernameModal,
        shareMilestone,
        showToast,
        createElement
    };

    function start() {
        // One listener closes the account menu on any outside click.
        document.addEventListener('click', () => {
            document.querySelectorAll('.pf-account-menu').forEach((menu) => { menu.hidden = true; });
        });
        loadMe();
        consumeSignInRedirectParameters();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}());
