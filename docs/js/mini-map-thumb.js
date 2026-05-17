/**
 * mini-map-thumb.js
 *
 * Compact 172×88px SVG thumbnail renderer for attackMap data.
 * Designed for small card thumbnails — no labels, icon-only nodes.
 * Fetches lab JSON from /labs/data/{file}.json and renders inline SVG.
 *
 * Usage:
 *   <div class="mini-thumb" data-file="iam-008"></div>
 *   renderAllMiniThumbs();          // or renderMiniThumb(el)
 *   Call renderAllMiniThumbs() again on theme toggle.
 */

const miniThumbCache = {};

async function fetchMiniThumbData(file) {
    if (miniThumbCache[file]) return miniThumbCache[file];
    const resp = await fetch(`/labs/data/${encodeURIComponent(file)}.json`);
    if (!resp.ok) return null;
    const data = await resp.json();
    miniThumbCache[file] = data;
    return data;
}

function renderMiniMap(attackMap, container) {
    const { nodes, edges } = attackMap;
    const W = 172, H = 88;

    // BFS level assignment — ignore self-loops for layout
    const realEdges = edges.filter(e => e.from !== e.to);
    const inDegree = {};
    nodes.forEach(n => { inDegree[n.id] = 0; });
    realEdges.forEach(e => { inDegree[e.to] = (inDegree[e.to] || 0) + 1; });

    const nodeLevel = {};
    const queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
    let lv = 0;
    const visited = new Set();
    while (queue.length) {
        const next = [];
        queue.forEach(id => {
            if (visited.has(id)) return;
            visited.add(id);
            nodeLevel[id] = lv;
            realEdges.forEach(e => {
                if (e.from === id && !visited.has(e.to)) next.push(e.to);
            });
        });
        lv++;
        queue.length = 0;
        queue.push(...next);
    }
    nodes.forEach(n => { if (nodeLevel[n.id] === undefined) nodeLevel[n.id] = 0; });

    const maxLevel = Math.max(...Object.values(nodeLevel), 0);

    const PADDING = 20;
    const positions = {};
    nodes.forEach(n => {
        const level = nodeLevel[n.id];
        const nodesAtLevel = nodes.filter(x => nodeLevel[x.id] === level);
        const idx = nodesAtLevel.indexOf(n);
        const x = maxLevel === 0
            ? W / 2
            : PADDING + (level / maxLevel) * (W - PADDING * 2);
        const y = nodesAtLevel.length === 1
            ? H / 2
            : PADDING + (idx / (nodesAtLevel.length - 1)) * (H - PADDING * 2);
        positions[n.id] = { x, y };
    });

    const isLight = document.documentElement.classList.contains('light-theme');
    const principalFill = '#9D4EDD';
    const resourceFill  = isLight ? '#9B9BA7' : '#55556A';
    const edgeStroke    = isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)';
    const targetRing    = '#FFB800';
    const startingGlow  = isLight ? 'rgba(157,78,221,0.15)' : 'rgba(157,78,221,0.25)';
    const markerColor   = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)';

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${markerColor}"/></marker></defs>`;

    // Edges
    realEdges.forEach(e => {
        const from = positions[e.from], to = positions[e.to];
        if (!from || !to) return;
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const R = 9;
        svg += `<line x1="${(from.x + (dx/len)*R).toFixed(1)}" y1="${(from.y + (dy/len)*R).toFixed(1)}" x2="${(to.x - (dx/len)*(R+4)).toFixed(1)}" y2="${(to.y - (dy/len)*(R+4)).toFixed(1)}" stroke="${edgeStroke}" stroke-width="1.5" marker-end="url(#arr)"/>`;
    });

    // Self-loop arc
    const selfEdge = edges.find(e => e.from === e.to);
    if (selfEdge && positions[selfEdge.from]) {
        const { x, y } = positions[selfEdge.from];
        svg += `<path d="M${x-6},${y-8} Q${x},${y-22} ${x+6},${y-8}" fill="none" stroke="${edgeStroke}" stroke-width="1.5"/>`;
    }

    // Nodes
    nodes.forEach(n => {
        const pos = positions[n.id];
        if (!pos) return;
        const { x, y } = pos;
        const isTarget    = n.isTarget;
        const isStart     = n.id === 'starting-principal' || n.id === 'starting-user';
        const isPrincipal = n.type === 'principal';

        if (isTarget)  svg += `<circle cx="${x}" cy="${y}" r="14" fill="none" stroke="${targetRing}" stroke-width="1.5" opacity="0.7"/>`;
        if (isStart)   svg += `<circle cx="${x}" cy="${y}" r="13" fill="${startingGlow}"/>`;

        if (isPrincipal) {
            svg += `<circle cx="${x}" cy="${y}" r="9" fill="${principalFill}" fill-opacity="${isStart ? '1' : '0.75'}"/>`;
            svg += `<circle cx="${x}" cy="${y-3.5}" r="2.5" fill="white" fill-opacity="0.85"/>`;
            svg += `<path d="M${x-3},${y+4} Q${x},${y+1} ${x+3},${y+4}" fill="none" stroke="white" stroke-width="1.5" opacity="0.85"/>`;
        } else {
            const subType = n.subType || '';
            svg += `<rect x="${x-8}" y="${y-6}" width="16" height="12" rx="2.5" fill="${resourceFill}" fill-opacity="0.85"/>`;
            if (subType === 's3-bucket') {
                svg += `<rect x="${x-4}" y="${y-3}" width="8" height="6" rx="1" fill="none" stroke="white" stroke-width="1" opacity="0.8"/>`;
                svg += `<line x1="${x-4}" y1="${y-1}" x2="${x+4}" y2="${y-1}" stroke="white" stroke-width="0.8" opacity="0.8"/>`;
            } else if (subType === 'lambda-function') {
                svg += `<text x="${x}" y="${y+2.5}" text-anchor="middle" font-size="8" fill="white" opacity="0.9" font-family="monospace">λ</text>`;
            } else if (subType === 'ec2-instance') {
                svg += `<rect x="${x-4}" y="${y-3}" width="8" height="3" rx="0.5" fill="none" stroke="white" stroke-width="0.8" opacity="0.8"/>`;
                svg += `<rect x="${x-4}" y="${y+1}" width="8" height="3" rx="0.5" fill="none" stroke="white" stroke-width="0.8" opacity="0.8"/>`;
            } else if (subType === 'ecs-task') {
                svg += `<rect x="${x-4}" y="${y-3}" width="4" height="4" rx="0.5" fill="white" fill-opacity="0.6"/>`;
                svg += `<rect x="${x+1}" y="${y-1}" width="3" height="3" rx="0.5" fill="white" fill-opacity="0.6"/>`;
            } else {
                svg += `<circle cx="${x}" cy="${y}" r="${isTarget ? 2.5 : 2}" fill="${isTarget ? targetRing : 'white'}" opacity="${isTarget ? '0.9' : '0.6'}"/>`;
            }
        }
    });

    svg += '</svg>';
    container.innerHTML = svg;
}

async function renderMiniThumb(container) {
    const file = container.dataset.file;
    const data = await fetchMiniThumbData(file);
    if (!data || !data.attackMap) return;
    renderMiniMap(data.attackMap, container);
}

function renderAllMiniThumbs() {
    document.querySelectorAll('.mini-thumb').forEach(renderMiniThumb);
}
