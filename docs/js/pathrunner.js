/*
 * Pathrunner reference SPA.
 *
 * Mirrors the labs section: loads a lightweight index (/pathrunner.json) once to
 * drive the landing page, sidebar section counts, and client-side search, then
 * lazy-loads per-entry detail from /pathrunner/data/{kind}/{id}.json on
 * navigation. Routing uses the History API and honors the GitHub-Pages 404->SPA
 * redirect (sessionStorage.redirectPath), exactly like docs/js/labs.js.
 */

// ── Global state ──────────────────────────────────────────────────────────
let prIndex = null;                 // the /pathrunner.json index
const detailCache = {};             // `${kind}/${id}` -> detail object
let guideMarkdown = null;           // cached getting-started.md source
let currentRoute = { view: 'landing' };

// ── Theme (shared pattern with labs.js) ───────────────────────────────────
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

// ── Mobile menu (shared pattern with labs.js) ─────────────────────────────
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

// ── Small HTML helpers ────────────────────────────────────────────────────
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Render plain text defensively: escape everything, then turn `code` spans into
// <code>, blank lines into paragraph breaks, and single newlines into <br>.
function renderText(value) {
    if (!value) return '';
    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    const paragraphs = html.split(/\n\s*\n/).map((p) => p.replace(/\n/g, '<br>'));
    return paragraphs.map((p) => `<p>${p}</p>`).join('');
}

function titleCase(value) {
    if (!value) return '';
    return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Data loading ──────────────────────────────────────────────────────────
async function loadPathrunner() {
    const landing = document.getElementById('pr-landing');
    try {
        const response = await fetch('/pathrunner.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        prIndex = await response.json();
    } catch (err) {
        landing.innerHTML = `<div class="pr-empty" style="padding:40px;">
            Could not load the Pathrunner reference data (${escapeHtml(err.message)}).</div>`;
        return;
    }
    renderLanding();
    setupSearch();
    initRouter();
}

async function fetchDetail(kind, id) {
    const key = `${kind}/${id}`;
    if (detailCache[key]) return detailCache[key];
    const response = await fetch(`/pathrunner/data/${kind}/${encodeURIComponent(id)}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    detailCache[key] = data;
    return data;
}

// ── Router ────────────────────────────────────────────────────────────────
function initRouter() {
    const redirectPath = sessionStorage.getItem('redirectPath');
    if (redirectPath) {
        sessionStorage.removeItem('redirectPath');
        history.replaceState(null, '', redirectPath);
    }
    routeFromURL();
    window.addEventListener('popstate', routeFromURL);
}

function routeFromURL() {
    const path = window.location.pathname.replace(/\/+$/, ''); // strip trailing slash
    // /pathrunner/{kind}/{id}
    const detailMatch = path.match(/^\/pathrunner\/(commands|modules|payloads)\/(.+)$/);
    const sectionMatch = path.match(/^\/pathrunner\/(commands|modules|payloads)$/);

    if (path === '/pathrunner' || path === '') {
        showLanding();
    } else if (path === '/pathrunner/getting-started') {
        showGettingStarted();
    } else if (detailMatch) {
        showDetail(detailMatch[1], decodeURIComponent(detailMatch[2]));
    } else if (sectionMatch) {
        showSection(sectionMatch[1]);
    } else {
        // Unknown pathrunner route -> fall back to the landing page.
        navigate('/pathrunner/');
        return;
    }
    if (window.sidebarMarkActive) window.sidebarMarkActive();
}

function navigate(url, e) {
    if (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let the browser open a new tab
        e.preventDefault();
    }
    history.pushState(null, '', url);
    routeFromURL();
    window.scrollTo(0, 0);
}
window.prNavigate = navigate;

// ── View switching ────────────────────────────────────────────────────────
function showListView() {
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('list-view').style.display = '';
}

function showDetailView(html) {
    document.getElementById('list-view').style.display = 'none';
    const detailView = document.getElementById('detail-view');
    detailView.style.display = '';
    document.getElementById('detail-content').innerHTML = html;
}

function setSearchValue(value) {
    const input = document.getElementById('pr-search');
    if (input) input.value = value;
}

// ── Landing ───────────────────────────────────────────────────────────────
function renderLanding() {
    const counts = prIndex.counts || {};
    const gen = prIndex.generator || {};
    const landing = document.getElementById('pr-landing');

    const cards = [
        {
            href: '/pathrunner/getting-started', title: 'Getting Started',
            count: null, desc: 'Install Pathrunner, run your first exploit, and learn the core concepts: identities, payloads, workspaces, and the audit-log report.',
            icon: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'
        },
        {
            href: '/pathrunner/modules', title: 'Exploit Modules',
            count: counts.modules, desc: 'The catalog of AWS privilege escalation modules, each tied to a pathfinding.cloud path and validated against a lab.',
            icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
        },
        {
            href: '/pathrunner/payloads', title: 'Payloads',
            count: counts.payloads, desc: 'Interchangeable payloads a module can run - credential and HTTPS exfiltration, backdoor role/user/policy creation, reverse shells.',
            icon: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'
        },
        {
            href: '/pathrunner/commands', title: 'Commands',
            count: counts.commands, desc: 'Every top-level command and subcommand in the REPL and the 1:1 CLI, with usage and flags.',
            icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'
        }
    ];

    const cardsHtml = cards.map((c) => `
        <a href="${c.href}" class="pr-card" onclick="prNavigate('${c.href}', event)">
            <div class="pr-card-head">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
                <span class="pr-card-title">${escapeHtml(c.title)}</span>
                ${c.count != null ? `<span class="pr-card-count">${escapeHtml(c.count)}</span>` : ''}
            </div>
            <div class="pr-card-desc">${escapeHtml(c.desc)}</div>
        </a>`).join('');

    landing.innerHTML = `
        <div class="pr-hero">
            <h1>Pathrunner</h1>
            <div class="pr-tagline">A modular AWS privilege escalation exploitation framework - a Metasploit-style REPL, a scriptable CLI, interchangeable payloads, and built-in attacker infrastructure. This is the command, module, and payload reference, generated directly from the Pathrunner source.</div>
            <div class="pr-stat-row">
                <div class="pr-stat"><span class="pr-stat-num">${escapeHtml(counts.modules ?? '-')}</span><span class="pr-stat-label">Modules</span></div>
                <div class="pr-stat"><span class="pr-stat-num">${escapeHtml(counts.payloads ?? '-')}</span><span class="pr-stat-label">Payloads</span></div>
                <div class="pr-stat"><span class="pr-stat-num">${escapeHtml(counts.services ?? '-')}</span><span class="pr-stat-label">AWS Services</span></div>
                <div class="pr-stat"><span class="pr-stat-num">${escapeHtml(counts.commands ?? '-')}</span><span class="pr-stat-label">Commands</span></div>
            </div>
        </div>
        <div class="pr-search-bar">
            <input type="text" id="pr-search" placeholder="Search modules, payloads, and commands..." autocomplete="off">
        </div>
        <div id="pr-cards-wrap"><div class="pr-cards">${cardsHtml}</div></div>`;
}

function showLanding() {
    currentRoute = { view: 'landing' };
    document.title = 'pathfinding.cloud - Pathrunner';
    showListView();
    setSearchValue('');
    const cards = document.getElementById('pr-cards-wrap');
    if (cards) cards.style.display = '';
    document.getElementById('pr-results').innerHTML = '';
}

// ── Search ────────────────────────────────────────────────────────────────
function setupSearch() {
    // The search input is (re)created inside #pr-landing; use event delegation
    // so a single listener survives landing re-renders.
    document.getElementById('list-view').addEventListener('input', (e) => {
        if (e.target && e.target.id === 'pr-search') runSearch(e.target.value);
    });
}

function runSearch(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    const cards = document.getElementById('pr-cards-wrap');
    const results = document.getElementById('pr-results');

    if (!query) {
        if (cards) cards.style.display = '';
        results.innerHTML = '';
        return;
    }
    if (cards) cards.style.display = 'none';

    const matchModules = (prIndex.modules || []).filter((m) =>
        (m.id || '').toLowerCase().includes(query) ||
        (m.name || '').toLowerCase().includes(query) ||
        (m.category || '').toLowerCase().includes(query) ||
        (m.services || []).some((s) => s.toLowerCase().includes(query))
    );
    const matchPayloads = (prIndex.payloads || []).filter((p) =>
        (p.name || '').toLowerCase().includes(query) ||
        (p.qualifiedName || '').toLowerCase().includes(query) ||
        (p.service || '').toLowerCase().includes(query) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(query))
    );
    const matchCommands = (prIndex.commands || []).filter((c) =>
        (c.name || '').toLowerCase().includes(query) ||
        (c.short || '').toLowerCase().includes(query)
    );

    const total = matchModules.length + matchPayloads.length + matchCommands.length;
    let html = `<div class="pr-section-sub">${total} result${total === 1 ? '' : 's'} for "${escapeHtml(rawQuery.trim())}"</div>`;

    if (matchModules.length) {
        html += `<div class="pr-group-heading">Modules (${matchModules.length})</div>`;
        html += renderItemList(matchModules.map(moduleListItem));
    }
    if (matchPayloads.length) {
        html += `<div class="pr-group-heading">Payloads (${matchPayloads.length})</div>`;
        html += renderItemList(matchPayloads.map(payloadListItem));
    }
    if (matchCommands.length) {
        html += `<div class="pr-group-heading">Commands (${matchCommands.length})</div>`;
        html += renderItemList(matchCommands.map(commandListItem));
    }
    if (!total) html = `<div class="pr-empty" style="padding:30px 0;">No results for "${escapeHtml(rawQuery.trim())}".</div>`;

    results.innerHTML = html;
}

// ── Section listings ──────────────────────────────────────────────────────
function moduleListItem(m) {
    return {
        href: `/pathrunner/modules/${m.id}`,
        name: m.id,
        sub: `${escapeHtml(m.name || '')}${m.category ? ` &middot; ${escapeHtml(m.category)}` : ''}`,
        group: m.primaryService || 'other'
    };
}
function payloadListItem(p) {
    return {
        href: `/pathrunner/payloads/${p.slug}`,
        name: p.qualifiedName || p.name,
        sub: (p.tags || []).map((t) => `<span class="pr-badge">${escapeHtml(t)}</span>`).join(''),
        group: p.service || 'other'
    };
}
function commandListItem(c) {
    return {
        href: `/pathrunner/commands/${c.name}`,
        name: c.name,
        sub: escapeHtml(c.short || ''),
        group: c.group || 'other'
    };
}

function renderItemList(items) {
    const cells = items.map((it) => {
        const inner = `
            <div class="pr-list-item-name">${escapeHtml(it.name)}</div>
            ${it.sub ? `<div class="pr-list-item-sub">${it.sub}</div>` : ''}`;
        // Non-linkable items (e.g. a compatible payload with no resolved page)
        // render as a plain, non-clickable card.
        if (!it.href) return `<div class="pr-list-item pr-list-item-static">${inner}</div>`;
        return `<a href="${it.href}" class="pr-list-item" onclick="prNavigate('${it.href}', event)">${inner}</a>`;
    }).join('');
    return `<div class="pr-list">${cells}</div>`;
}

function renderGrouped(items, groupLabelFn) {
    const groups = {};
    items.forEach((it) => {
        const g = it.group || 'other';
        (groups[g] = groups[g] || []).push(it);
    });
    return Object.keys(groups).sort().map((g) => `
        <div class="pr-group-heading">${escapeHtml(groupLabelFn ? groupLabelFn(g) : g)} (${groups[g].length})</div>
        ${renderItemList(groups[g])}`).join('');
}

function showSection(kind) {
    currentRoute = { view: 'section', kind };
    showListView();
    const cards = document.getElementById('pr-cards-wrap');
    if (cards) cards.style.display = 'none';
    setSearchValue('');
    const results = document.getElementById('pr-results');

    let title, sub, body;
    if (kind === 'modules') {
        document.title = 'Pathrunner Modules - pathfinding.cloud';
        title = 'Exploit Modules';
        sub = `${(prIndex.modules || []).length} modules, grouped by primary AWS service.`;
        body = renderGrouped((prIndex.modules || []).map(moduleListItem), (g) => g.toUpperCase());
    } else if (kind === 'payloads') {
        document.title = 'Pathrunner Payloads - pathfinding.cloud';
        title = 'Payloads';
        sub = `${(prIndex.payloads || []).length} payloads, grouped by AWS service.`;
        body = renderGrouped((prIndex.payloads || []).map(payloadListItem), (g) => g.toUpperCase());
    } else {
        document.title = 'Pathrunner Commands - pathfinding.cloud';
        title = 'Commands';
        sub = `${(prIndex.commands || []).length} top-level commands. Subcommands are documented within each command page.`;
        const groupLabels = { core: 'Core Commands', module: 'Module Commands', other: 'Other' };
        body = renderGrouped((prIndex.commands || []).map(commandListItem), (g) => groupLabels[g] || titleCase(g));
    }

    results.innerHTML = `
        <div class="pr-breadcrumb"><a href="/pathrunner/" onclick="prNavigate('/pathrunner/', event)">Pathrunner</a> / ${escapeHtml(title)}</div>
        <h2 class="pr-section-title">${escapeHtml(title)}</h2>
        <div class="pr-section-sub">${sub}</div>
        ${body}`;
}

// ── Detail rendering ──────────────────────────────────────────────────────
function breadcrumb(sectionHref, sectionLabel, leaf) {
    return `<div class="pr-breadcrumb">
        <a href="/pathrunner/" onclick="prNavigate('/pathrunner/', event)">Pathrunner</a> /
        <a href="${sectionHref}" onclick="prNavigate('${sectionHref}', event)">${escapeHtml(sectionLabel)}</a> /
        ${escapeHtml(leaf)}</div>`;
}

async function showDetail(kind, id) {
    showDetailView('<div class="loading">Loading...</div>');
    let data;
    try {
        data = await fetchDetail(kind, id);
    } catch (err) {
        showDetailView(`${breadcrumb(`/pathrunner/${kind}`, titleCase(kind), id)}
            <div class="pr-empty" style="padding:30px 0;">Could not load ${escapeHtml(kind)} "${escapeHtml(id)}" (${escapeHtml(err.message)}).</div>`);
        return;
    }
    if (kind === 'modules') showDetailView(renderModuleDetail(data));
    else if (kind === 'payloads') showDetailView(renderPayloadDetail(data));
    else showDetailView(renderCommandDetail(data));
    window.scrollTo(0, 0);
}

// A single GIF with a Replay control. The GIFs are re-encoded to play once (no
// loop); clicking Replay reloads the image with a cache-busting query so it runs
// through a single time again.
function gifFigure(stem) {
    const src = `/pathrunner/gifs/${encodeURIComponent(stem)}.gif`;
    return `<figure class="pr-gif-wrap">
        <img class="pr-gif" src="${src}" data-gif-src="${src}" alt="${escapeHtml(stem)} demo" loading="lazy">
        <button type="button" class="pr-gif-replay" onclick="prReplayGif(this)">&#8635; Replay</button>
    </figure>`;
}

// Render a single demo media item. Module demos arrive as {name, ext} objects:
// WebM becomes a <video> with native controls (autoplay+muted+loop makes it feel
// like a GIF on load, but the viewer can pause, scrub, and seek). Anything else —
// or a bare stem string (command GIFs) — falls back to the play-once <img>.
function mediaFigure(item) {
    const name = (typeof item === 'string') ? item : (item && item.name) || '';
    const ext = (typeof item === 'string') ? 'gif' : ((item && item.ext) || 'gif');
    if (!name) return '';
    if (ext === 'webm' || ext === 'mp4') {
        const src = `/pathrunner/gifs/${encodeURIComponent(name)}.${encodeURIComponent(ext)}`;
        const type = ext === 'webm' ? 'video/webm' : 'video/mp4';
        return `<figure class="pr-gif-wrap">
            <video class="pr-video" controls loop autoplay muted playsinline preload="metadata" aria-label="${escapeHtml(name)} demo">
                <source src="${src}" type="${type}">
            </video>
        </figure>`;
    }
    return gifFigure(name);
}

function gifsBlock(data) {
    if (!data.gifs || !data.gifs.length) return '';
    return data.gifs.map(mediaFigure).join('');
}

// Reload a play-once GIF so it animates again.
function prReplayGif(button) {
    const img = button.parentElement.querySelector('img.pr-gif');
    if (!img) return;
    const base = img.getAttribute('data-gif-src');
    img.src = `${base}?t=${Date.now()}`;
}
window.prReplayGif = prReplayGif;

// Derive a GIF stem from a command/subcommand node's invocation path, matching
// how the generator names GIF files (e.g. "pathrunner attacker identity show" ->
// "attacker-identity-show").
function nodeGifStem(node) {
    const invocation = node.path || node.name || '';
    return invocation
        .replace(/^pathrunner\s+/, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

// If a GIF exists for this node, render it inline (right under the node's content).
function nodeGif(node, gifSet) {
    const stem = nodeGifStem(node);
    return gifSet.has(stem) ? gifFigure(stem) : '';
}

function flagsTable(flags) {
    if (!flags || !flags.length) return '';
    const rows = flags.map((f) => `
        <tr>
            <td><span class="pr-mono">--${escapeHtml(f.name)}${f.shorthand ? `, -${escapeHtml(f.shorthand)}` : ''}</span></td>
            <td>${escapeHtml(f.type || '')}</td>
            <td>${escapeHtml(f.usage || '')}</td>
            <td>${f.default ? `<span class="pr-mono">${escapeHtml(f.default)}</span>` : ''}</td>
        </tr>`).join('');
    return `<table class="pr-opt-table">
        <thead><tr><th>Flag</th><th>Type</th><th>Description</th><th>Default</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function renderSubcommands(subcommands, depth, gifSet) {
    if (!subcommands || !subcommands.length) return '';
    return subcommands.map((sc) => `
            <div class="pr-subcmd">
                <h3>${escapeHtml(sc.path || sc.name)}</h3>
                ${sc.short ? `<p>${escapeHtml(sc.short)}</p>` : ''}
                ${sc.usage ? `<pre><code>${escapeHtml(sc.usage)}</code></pre>` : ''}
                ${flagsTable(sc.flags)}
                ${nodeGif(sc, gifSet)}
                ${renderSubcommands(sc.subcommands, depth + 1, gifSet)}
            </div>`).join('');
}

function renderCommandDetail(cmd) {
    const name = cmd.name || '';
    const gifSet = new Set(cmd.gifs || []);
    let html = breadcrumb('/pathrunner/commands', 'Commands', name);
    html += '<div class="pr-detail">';

    // Overview panel: invocation, summary, aliases, long description.
    let overview = `<h1 class="pr-module-id">${escapeHtml(cmd.path || name)}</h1>`;
    if (cmd.short) overview += `<div class="pr-module-name">${escapeHtml(cmd.short)}</div>`;
    if (cmd.aliases && cmd.aliases.length) {
        overview += `<div class="pr-section-sub" style="margin-top:12px;">Aliases: ${cmd.aliases.map((a) => `<span class="pr-mono">${escapeHtml(a)}</span>`).join(', ')}</div>`;
    }
    if (cmd.long && cmd.long !== cmd.short) overview += renderText(cmd.long);
    html += `<section class="pr-panel">${overview}</section>`;

    if (cmd.usage) html += panel('Usage', `<pre><code>${escapeHtml(cmd.usage)}</code></pre>`);
    // GIF for the top-level command itself (e.g. `search`, `payloads`).
    const topGif = nodeGif(cmd, gifSet);
    if (topGif) html += panel('Demo', topGif);
    if (cmd.flags && cmd.flags.length) html += panel('Flags', flagsTable(cmd.flags));
    if (cmd.subcommands && cmd.subcommands.length) html += panel('Subcommands', renderSubcommands(cmd.subcommands, 1, gifSet));

    html += '</div>';
    return html;
}

function optionsTable(options) {
    if (!options || !options.length) return '';
    const rows = options.map((o) => `
        <tr>
            <td><span class="pr-mono">${escapeHtml(o.name || '')}</span></td>
            <td>${o.required ? 'Yes' : 'No'}</td>
            <td>${escapeHtml(o.description || '')}</td>
            <td>${o.default ? `<span class="pr-mono">${escapeHtml(o.default)}</span>` : ''}</td>
        </tr>`).join('');
    return `<table class="pr-opt-table">
        <thead><tr><th>Option</th><th>Required</th><th>Description</th><th>Default</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// A module's compatible payload as a card (same component as the /payloads page).
// Resolved payloads (with a slug) link to their payload page; unresolved ones
// render as a static card showing the payload's description.
function moduleCompatPayloadItem(p) {
    if (p.slug) {
        return {
            href: `/pathrunner/payloads/${p.slug}`,
            name: p.qualifiedName || p.name,
            sub: (p.tags || []).map((t) => `<span class="pr-badge">${escapeHtml(t)}</span>`).join(''),
        };
    }
    return { href: null, name: p.name, sub: escapeHtml(p.description || '') };
}

// Wrap a section's content in a labs-style card so nothing sits bare on the page
// background. An optional title renders as the panel heading.
function panel(title, bodyHtml) {
    return `<section class="pr-panel">${title ? `<h2 class="pr-panel-title">${escapeHtml(title)}</h2>` : ''}${bodyHtml}</section>`;
}

// Highlight the argument portion of a pathrunner command (everything after the
// verb). Shared by the CLI and REPL step renderers so both colour `set NAME value`
// and plain args identically.
function prCommandRestHtml(verb, rest) {
    if (verb === 'set' && rest.length) {
        // "set NAME value..." — colour the option name distinctly from its value.
        const optName = rest[0];
        const optValue = rest.slice(1).join(' ');
        let html = `<span class="pr-cli-opt">${escapeHtml(optName)}</span>`;
        if (optValue) html += ` <span class="pr-cli-val">${escapeHtml(optValue)}</span>`;
        return html;
    }
    if (rest.length) {
        return `<span class="pr-cli-arg">${escapeHtml(rest.join(' '))}</span>`;
    }
    return '';
}

// Render one cliStep (e.g. "pathrunner set ROLE_ARN arn:aws:...") as a single
// syntax-highlighted terminal line. The leading "$" prompt is presentational
// only — it is never part of the copied text. Highlighting is intentionally
// simple: de-emphasize the invariant `pathrunner` binary so the verb, option
// names, and values the reader actually cares about stand out.
function cliStepLine(step) {
    const tokens = String(step).trim().split(/\s+/);
    const bin = tokens[0] || '';          // "pathrunner"
    const verb = tokens[1] || '';         // use | show | set | exploit
    const rest = tokens.slice(2);
    const restHtml = prCommandRestHtml(verb, rest);
    const isExploit = verb === 'exploit';
    const verbHtml = verb ? ` <span class="pr-cli-verb">${escapeHtml(verb)}</span>` : '';
    return `<span class="pr-cli-line${isExploit ? ' pr-cli-fire' : ''}">` +
        `<span class="pr-cli-prompt">$</span> ` +
        `<span class="pr-cli-bin">${escapeHtml(bin)}</span>${verbHtml}` +
        (restHtml ? ` ${restHtml}` : '') +
        (isExploit ? ` <span class="pr-cli-comment"># runs the attack</span>` : '') +
        `</span>`;
}

// Render one REPL command (e.g. "set ROLE_ARN arn:aws:...") as it is typed inside
// the interactive pathrunner REPL — no "pathrunner" binary prefix, with a ">"
// prompt. The prompt is presentational and never part of the copied text.
function replStepLine(step) {
    const tokens = String(step).trim().split(/\s+/);
    const verb = tokens[0] || '';         // use | show | set | exploit
    const rest = tokens.slice(1);
    const restHtml = prCommandRestHtml(verb, rest);
    const isExploit = verb === 'exploit';
    const verbHtml = verb ? `<span class="pr-cli-verb">${escapeHtml(verb)}</span>` : '';
    return `<span class="pr-cli-line${isExploit ? ' pr-cli-fire' : ''}">` +
        `<span class="pr-cli-prompt">&gt;</span> ` +
        verbHtml +
        (restHtml ? ` ${restHtml}` : '') +
        (isExploit ? ` <span class="pr-cli-comment"># runs the attack</span>` : '') +
        `</span>`;
}

// Build the copy-pastable REPL workflow block from a module's cliSteps: the same
// commands as the CLI block, but as typed inside the interactive REPL (launch
// `pathrunner`, then the bare commands with the "pathrunner" prefix stripped).
// This mirrors how the demo recording is produced. Copy yields the bare REPL
// commands — the launch line is presentational, like the prompts.
function replWorkflowBlock(mod) {
    const steps = mod.cliSteps || [];
    if (!steps.length) return '';
    const replSteps = steps.map((s) => String(s).replace(/^pathrunner\s+/, ''));
    const launchHtml = `<span class="pr-cli-line">` +
        `<span class="pr-cli-prompt">$</span> ` +
        `<span class="pr-cli-bin">pathrunner</span> ` +
        `<span class="pr-cli-comment"># launch the interactive REPL</span></span>`;
    // Join with no separator: each line is a display:block span, so a literal
    // newline between them inside <pre> would render as an extra blank line.
    const linesHtml = launchHtml + replSteps.map(replStepLine).join('');
    const raw = replSteps.join('\n');
    return `<div class="pr-cli">
        <button type="button" class="pr-cli-copy" data-cli="${escapeHtml(raw)}" onclick="prCopyCli(this)">Copy</button>
        <pre class="pr-cli-body"><code>${linesHtml}</code></pre>
        <p class="pr-cli-note">Run <span class="pr-mono">pathrunner</span> to enter the REPL, then type these commands. Mock values are placeholders — swap in your target's real ARNs.</p>
    </div>`;
}

// Build the copy-pastable CLI workflow block from a module's cliSteps: the exact
// one-shot commands (with mock values filled in and a payload pre-selected) that
// reproduce the module end-to-end, ending in `pathrunner exploit`. The in-page
// demo GIF stops one step short of exploit, so this block is the authoritative
// "and then actually run it" reference.
function cliWorkflowBlock(mod) {
    const steps = mod.cliSteps || [];
    if (!steps.length) return '';
    // Join with no separator: each line is a display:block span, so a literal
    // newline between them inside <pre> would render as an extra blank line.
    const linesHtml = steps.map(cliStepLine).join('');
    const raw = steps.join('\n');
    return `<div class="pr-cli">
        <button type="button" class="pr-cli-copy" data-cli="${escapeHtml(raw)}" onclick="prCopyCli(this)">Copy</button>
        <pre class="pr-cli-body"><code>${linesHtml}</code></pre>
        <p class="pr-cli-note">Mock values are placeholders — swap in your target's real ARNs. The demo below stops before <span class="pr-mono">pathrunner exploit</span>.</p>
    </div>`;
}

// Copy a CLI block's raw commands (newline-joined, no "$" prompts) to the
// clipboard, with a textarea fallback for browsers without the async API.
function prCopyCli(button) {
    const text = button.getAttribute('data-cli') || '';
    const flash = () => {
        const original = button.textContent;
        button.textContent = 'Copied';
        button.classList.add('pr-cli-copied');
        setTimeout(() => {
            button.textContent = original;
            button.classList.remove('pr-cli-copied');
        }, 1500);
    };
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash(); } catch (_) { /* no-op */ }
        document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(flash).catch(fallback);
    } else {
        fallback();
    }
}
window.prCopyCli = prCopyCli;

function renderModuleDetail(mod) {
    const id = mod.id || '';
    let html = breadcrumb('/pathrunner/modules', 'Modules', id);
    html += '<div class="pr-detail">';

    // ── Overview panel: identity, metadata, and the cross-reference links ──
    // (grouped and well-spaced so the links are never crowded by a table).
    const pathHref = mod.pathfindingCloudUrl || `/paths/${id}`;
    let xrefs = `<a class="pr-xref" href="${escapeHtml(pathHref)}">Path definition &rarr; /paths/${escapeHtml(id)}</a>`;
    if (mod.labSlug) {
        xrefs += `<a class="pr-xref" href="/labs/${escapeHtml(mod.labSlug)}">Practice lab &rarr; /labs/${escapeHtml(mod.labSlug)}</a>`;
    }

    const services = (mod.services || []).join(', ');
    const aliases = (mod.aliases || []).map((a) => `<span class="pr-mono">${escapeHtml(a)}</span>`).join(', ');
    const metaItem = (label, value) => value ? `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>` : '';
    const metaGrid = `<dl class="pr-meta-grid">
        ${metaItem('Category', escapeHtml(mod.category || ''))}
        ${metaItem('Services', escapeHtml(services))}
        ${metaItem('Author', escapeHtml(mod.author || ''))}
        ${metaItem('Aliases', aliases)}
    </dl>`;

    const overviewBody = `<h1 class="pr-module-id">${escapeHtml(id)}</h1>
        ${mod.name ? `<div class="pr-module-name pr-mono">${escapeHtml(mod.name)}</div>` : ''}
        ${metaGrid}
        <div class="pr-xref-row">${xrefs}</div>`;
    html += `<section class="pr-panel">${overviewBody}</section>`;

    // ── REPL mode workflow: the commands as typed inside the interactive REPL
    // (launch `pathrunner`, then the bare commands), derived from cliSteps. ──
    const repl = replWorkflowBlock(mod);
    if (repl) html += panel('REPL mode workflow', repl);

    // ── CLI mode workflow: the copy-pastable one-shot commands (mock values
    // filled in, payload pre-selected) that reproduce this module end-to-end. ──
    const cli = cliWorkflowBlock(mod);
    if (cli) html += panel('CLI mode workflow', cli);

    // ── Demo: the per-module VHS recording (use module + show options + show
    // payloads), keyed by module id. Rendered when the recording has been
    // produced; it visually walks through the REPL workflow above. ──
    const gifs = gifsBlock(mod);
    if (gifs) html += panel('Demo', gifs);

    // ── Options ──
    html += panel('Options',
        (mod.options && mod.options.length) ? optionsTable(mod.options) : '<p class="pr-empty">No options.</p>');

    // ── Compatible payloads (same cards as the /payloads page), linking to each. ──
    html += panel('Compatible payloads',
        (mod.payloads && mod.payloads.length)
            ? renderItemList(mod.payloads.map(moduleCompatPayloadItem))
            : '<p class="pr-empty">No payloads.</p>');

    // ── Module commands: the REPL commands available once this module is loaded. ──
    const moduleCommands = (prIndex.commands || []).filter((c) => c.group === 'module');
    if (moduleCommands.length) {
        html += panel('Module commands',
            `<div class="pr-section-sub" style="margin-bottom:14px;">Available in the REPL once this module is loaded (<span class="pr-mono">use ${escapeHtml(id)}</span>).</div>`
            + renderItemList(moduleCommands.map(commandListItem)));
    }

    html += '</div>';
    return html;
}

function renderPayloadDetail(p) {
    const title = p.qualifiedName || p.name || '';
    let html = breadcrumb('/pathrunner/payloads', 'Payloads', title);
    html += '<div class="pr-detail">';

    // Overview panel: qualified name, metadata, tags.
    const metaItem = (label, value) => value ? `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>` : '';
    let overview = `<h1 class="pr-module-id">${escapeHtml(title)}</h1>`;
    overview += `<dl class="pr-meta-grid">
        ${metaItem('Name', `<span class="pr-mono">${escapeHtml(p.name || '')}</span>`)}
        ${metaItem('Service', escapeHtml(p.service || ''))}
    </dl>`;
    if (p.tags && p.tags.length) {
        overview += '<div style="margin-top:16px;">' + p.tags.map((t) => `<span class="pr-tag-strong">${escapeHtml(t)}</span>`).join('') + '</div>';
    }
    html += `<section class="pr-panel">${overview}</section>`;

    if (p.description) html += panel('Description', renderText(p.description));
    if (p.options && p.options.length) html += panel('Options', optionsTable(p.options));
    html += '</div>';
    return html;
}

// ── Getting Started (authored as /pathrunner/getting-started.md, PR-editable) ──
async function showGettingStarted() {
    currentRoute = { view: 'getting-started' };
    document.title = 'Pathrunner Getting Started - pathfinding.cloud';
    showDetailView('<div class="loading">Loading...</div>');
    let markdown;
    try {
        if (guideMarkdown === null) {
            const response = await fetch('/pathrunner/getting-started.md');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            guideMarkdown = await response.text();
        }
        markdown = guideMarkdown;
    } catch (err) {
        showDetailView(`${breadcrumb('/pathrunner/', 'Pathrunner', 'Getting Started')}
            <div class="pr-empty" style="padding:30px 0;">Could not load the guide (${escapeHtml(err.message)}).</div>`);
        return;
    }
    showDetailView(renderGuide(markdown));
    window.scrollTo(0, 0);
    if (window.sidebarMarkActive) window.sidebarMarkActive();
}

// Render the guide: the leading `# Title` + intro become a hero panel, and each
// `## Section` becomes its own panel -- consistent with the rest of the section.
function renderGuide(md) {
    const normalized = md.replace(/\r\n/g, '\n');
    const parts = normalized.split(/\n(?=## )/);
    const intro = parts.shift() || '';

    let html = breadcrumb('/pathrunner/', 'Pathrunner', 'Getting Started');
    html += '<div class="pr-detail pr-guide">';

    const titleMatch = intro.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : 'Getting Started';
    const introBody = intro.replace(/^#\s+.+$/m, '').trim();
    html += `<section class="pr-panel"><h1>${escapeHtml(title)}</h1>${introBody ? renderMarkdownBlocks(introBody) : ''}</section>`;

    for (const part of parts) {
        const match = part.match(/^##\s+(.+)\n?([\s\S]*)$/);
        const heading = match ? match[1] : '';
        const body = match ? match[2] : part;
        html += `<section class="pr-panel"><h2 class="pr-panel-title">${escapeHtml(heading)}</h2>${renderMarkdownBlocks(body)}</section>`;
    }

    html += '</div>';
    return html;
}

// Compact block-level Markdown renderer: fenced code, h3/h4, ordered/unordered
// lists, horizontal rules, and paragraphs. Inline formatting via renderInlineMd.
function renderMarkdownBlocks(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let list = null; // { type: 'ul' | 'ol', items: [] }
    const flushList = () => {
        if (!list) return;
        html += `<${list.type}>` + list.items.map((it) => `<li>${renderInlineMd(it)}</li>`).join('') + `</${list.type}>`;
        list = null;
    };

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*```/.test(line)) {                       // fenced code block
            flushList();
            i++;
            const code = [];
            while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
            i++; // consume closing fence
            html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
            continue;
        }

        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) { flushList(); const level = heading[1].length; html += `<h${level}>${renderInlineMd(heading[2])}</h${level}>`; i++; continue; }

        if (/^\s*---+\s*$/.test(line)) { flushList(); html += '<hr>'; i++; continue; }

        const ul = line.match(/^\s*[-*]\s+(.*)$/);
        if (ul) { if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(ul[1]); i++; continue; }

        const ol = line.match(/^\s*\d+\.\s+(.*)$/);
        if (ol) { if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(ol[1]); i++; continue; }

        if (line.trim() === '') { flushList(); i++; continue; }

        // Paragraph: gather consecutive lines until a blank line or block start.
        flushList();
        const para = [line];
        i++;
        while (i < lines.length && lines[i].trim() !== '' &&
               !/^(#{1,4}\s|\s*```|\s*[-*]\s|\s*\d+\.\s|\s*---+\s*$)/.test(lines[i])) {
            para.push(lines[i]); i++;
        }
        html += `<p>${renderInlineMd(para.join(' '))}</p>`;
    }
    flushList();
    return html;
}

// Inline Markdown: `code`, [text](url) (internal links route via the SPA), **bold**,
// and *italic*. Everything is HTML-escaped first.
function renderInlineMd(text) {
    let t = escapeHtml(text);
    t = t.replace(/`([^`]+)`/g, (m, code) => `<code>${code}</code>`);
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
        const isExternal = /^https?:\/\//.test(url);
        const safeUrl = url.replace(/"/g, '&quot;');
        if (isExternal) return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        return `<a href="${safeUrl}" onclick="prNavigate('${safeUrl}', event)">${label}</a>`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
    return t;
}

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileMenu();
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    loadPathrunner();
});
