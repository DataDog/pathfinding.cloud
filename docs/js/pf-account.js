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

    const PROVIDER_LABELS = { google: 'Continue with Google', github: 'Continue with GitHub' };

    /** Sign-in providers the backend has enabled (it reports them on /me). */
    function enabledProviders() {
        return Array.isArray(currentMe.signInProviders) ? currentMe.signInProviders.filter((name) => PROVIDER_LABELS[name]) : [];
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
        openModal('Sign in to pathfinding.cloud',
            reason ? createElement('p', { className: 'pf-modal-lead' }, reason) : null,
            createElement('p', {}, 'Signing in saves your lab progress, puts you on the leaderboard, and unlocks shareable milestone cards. You can play every lab without signing in.'),
            createElement('div', { className: 'pf-signin-buttons' },
                ...enabledProviders().map((providerName) =>
                    createElement('a', { className: `pf-button pf-signin-${providerName}`, href: signInUrl(providerName) }, PROVIDER_LABELS[providerName]))),
            createElement('p', { className: 'pf-fine-print' },
                'We never receive your email address or name. Google and GitHub only tell us an anonymous account ID, and you choose a public username. ',
                createElement('a', { href: '/privacy/' }, 'Privacy details')));
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
