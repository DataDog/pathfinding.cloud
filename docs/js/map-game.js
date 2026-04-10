// ============================================================
// Map Game Mode -- Island-hopping game UI for lab attack paths
// ============================================================
// State machine: start -> playing -> paused -> complete
//
// Layout: two-column split
//   Left (~35%):  HTML detail panel (selectable text, scrollable)
//   Right (~65%): Canvas map with islands, HUD, themed buttons
//
// The canvas handles: map rendering, HUD bars, action buttons,
// start/pause/complete overlay screens.
// The HTML panel handles: node details, mission briefing, commands.

// ---- Labs index / detail / transcript cache (shared across all game instances) ----
let _gameLabsIndexCache = null;
let _gameLabDetailCache = {};
let _gameTranscriptCache = {};

async function fetchLabsIndex() {
    if (_gameLabsIndexCache) return _gameLabsIndexCache;
    const resp = await fetch('/labs.json');
    _gameLabsIndexCache = await resp.json();
    return _gameLabsIndexCache;
}

async function fetchLabDetailForGame(slug) {
    if (_gameLabDetailCache[slug]) return _gameLabDetailCache[slug];
    const resp = await fetch(`/labs/data/${slug}.json`);
    _gameLabDetailCache[slug] = await resp.json();
    return _gameLabDetailCache[slug];
}

// Cloud sprite loader -- loads pixel-art cloud PNGs for the map background
const cloudSprites = {
    images: [],
    loaded: false,
    load() {
        if (this.loaded) return Promise.resolve();
        const ids = [1, 3, 5, 7, 10, 14, 17, 20];
        const promises = ids.map(id => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { this.images.push(img); resolve(); };
            img.onerror = () => resolve(); // skip missing images gracefully
            img.src = `/img/clouds/cloud-${id}.png`;
        }));
        return Promise.all(promises).then(() => { this.loaded = true; });
    },
    // Draw clouds in the upper portion of the canvas, below the top HUD bar
    draw(ctx, w, h, seed) {
        if (!this.images.length) return;
        const rng = mapRng(seed || 99);
        const hudTop = 52;               // generous buffer below top HUD bar
        const cloudMaxY = h * 0.20;      // clouds confined to top ~20%
        const count = Math.max(7, Math.floor(w / 100)); // more clouds
        for (let i = 0; i < count; i++) {
            const img = this.images[Math.floor(rng() * this.images.length)];
            const scale = 2.0 + rng() * 2.0; // 2x-4x native size for prominent clouds
            // Distribute clouds evenly across the full canvas width with random jitter
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const segment = w / count;
            const baseX = (i + 0.5) * segment;
            const jitter = (rng() - 0.5) * segment * 0.6;
            const x = Math.max(drawW / 2, Math.min(w - drawW / 2, baseX + jitter));
            const y = hudTop + 10 + rng() * (cloudMaxY - hudTop - 10);
            ctx.globalAlpha = 0.7 + rng() * 0.3;
            ctx.drawImage(img, x - drawW / 2, y - drawH / 2, drawW, drawH);
        }
        ctx.globalAlpha = 1;
    },
};

// AWS icon sprite loader -- maps node subTypes to official AWS architecture/resource icons
const awsIconSprites = {
    cache: {},  // subType -> Image (or null if failed)
    loading: new Set(),
    onLoadCallbacks: [], // callbacks to invoke when any icon finishes loading
    // Map of subType to icon path (relative to site root)
    iconPaths: {
        'iam-role':              '/img/aws-icons/Resource-Icons_01302026/Res_Security-Identity/Res_AWS-Identity-Access-Management_Role_48.png',
        'iam-user':              '/img/aws-icons/Resource-Icons_01302026/Res_Security-Identity/Res_AWS-Identity-Access-Management_Long-Term-Security-Credential_48.png',
        'iam-policy':            '/img/aws-icons/Resource-Icons_01302026/Res_Security-Identity/Res_AWS-Identity-Access-Management_Permissions_48.png',
        'iam-group':             '/img/aws-icons/Architecture-Service-Icons_01302026/Arch_Security-Identity/48/Arch_AWS-IAM-Identity-Center_48.png',
        'ec2-instance':          '/img/aws-icons/Resource-Icons_01302026/Res_Compute/Res_Amazon-EC2_Instance_48.png',
        'lambda-function':       '/img/aws-icons/Resource-Icons_01302026/Res_Compute/Res_AWS-Lambda_Lambda-Function_48.png',
        'codebuild-project':     '/img/aws-icons/Architecture-Service-Icons_01302026/Arch_Developer-Tools/48/Arch_AWS-CodeBuild_48.png',
        'cloudformation-stack':  '/img/aws-icons/Resource-Icons_01302026/Res_Management-Governance/Res_AWS-CloudFormation_Stack_48.png',
        's3-bucket':             '/img/aws-icons/Resource-Icons_01302026/Res_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.png',
        'sagemaker-notebook':    '/img/aws-icons/Resource-Icons_01302026/Res_Artificial-Intelligence/Res_Amazon-SageMaker-AI_Notebook_48.png',
        'glue-job':              '/img/aws-icons/Architecture-Service-Icons_01302026/Arch_Analytics/48/Arch_AWS-Glue_48.png',
        'ecs-task':              '/img/aws-icons/Resource-Icons_01302026/Res_Containers/Res_Amazon-Elastic-Container-Service_Task_48.png',
        'dynamodb-table':        '/img/aws-icons/Resource-Icons_01302026/Res_Databases/Res_Amazon-DynamoDB_Table_48.png',
        'bedrock-agent':         '/img/aws-icons/Architecture-Service-Icons_01302026/Arch_Artificial-Intelligence/48/Arch_Amazon-Bedrock_48.png',
        'apprunner-service':     '/img/aws-icons/Architecture-Service-Icons_01302026/Arch_Compute/48/Arch_AWS-App-Runner_48.png',
        'mwaa-environment':      '/img/aws-icons/Architecture-Service-Icons_01302026/Arch_Application-Integration/48/Arch_Amazon-Managed-Workflows-for-Apache-Airflow_48.png',
    },
    // Get (or start loading) the icon for a given subType. Returns Image if ready, null otherwise.
    get(subType) {
        if (!subType) return null;
        if (this.cache[subType] !== undefined) return this.cache[subType];
        const path = this.iconPaths[subType];
        if (!path) { this.cache[subType] = null; return null; }
        if (this.loading.has(subType)) return null; // still loading
        this.loading.add(subType);
        const img = new Image();
        img.onload = () => { this.cache[subType] = img; this.loading.delete(subType); this.onLoadCallbacks.forEach(cb => cb()); };
        img.onerror = () => { this.cache[subType] = null; this.loading.delete(subType); };
        img.src = path;
        return null;
    },
    // Preload all icons for a set of nodes (call once at init)
    preload(nodes) {
        if (!nodes) return;
        const subTypes = new Set();
        nodes.forEach(n => { if (n.subType) subTypes.add(n.subType); });
        subTypes.forEach(st => this.get(st));
    },
};

// ---- Canvas UI Primitives ----

function drawRoundedRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function drawThemedButton(ctx, btn, hoveredId, activeId, palette) {
    if (btn.visible === false) return;
    const isHovered = hoveredId === btn.id;
    const isActive = activeId === btn.id;
    const isDisabled = btn.disabled;
    const style = btn.style || 'primary';
    const p = palette;

    ctx.save();
    if (isDisabled) ctx.globalAlpha = 0.35;

    const x = btn.x, y = btn.y, w = btn.w, h = btn.h;
    const r = btn.radius || 10;

    if (style === 'primary') {
        const base = isActive ? p.woodDark : isHovered ? p.woodLight : p.woodMid;
        drawRoundedRect(ctx, x + 1, y + 2, w, h, r);
        ctx.fillStyle = p.woodShadow;
        ctx.fill();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.fillStyle = base;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = p.woodGrain;
        ctx.lineWidth = 0.6;
        for (let ly = y + 5; ly < y + h; ly += 6) {
            ctx.beginPath();
            ctx.moveTo(x + 4, ly + Math.sin(ly * 0.3) * 2);
            ctx.lineTo(x + w - 4, ly + Math.sin(ly * 0.3 + 1) * 2);
            ctx.stroke();
        }
        ctx.restore();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.strokeStyle = p.woodBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = p.woodText;
        ctx.font = `bold ${btn.fontSize || 14}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btn.label, x + w / 2, y + h / 2);
    } else if (style === 'secondary') {
        const base = isActive ? p.parchDark : isHovered ? p.parchLight : p.parchMid;
        drawRoundedRect(ctx, x + 1, y + 2, w, h, r);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fill();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.fillStyle = base;
        ctx.fill();
        ctx.strokeStyle = p.parchBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = p.parchText;
        ctx.font = `600 ${btn.fontSize || 13}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btn.label, x + w / 2, y + h / 2);
    } else {
        if (isHovered || isActive) {
            drawRoundedRect(ctx, x, y, w, h, r);
            ctx.fillStyle = isActive ? p.ghostActive : p.ghostHover;
            ctx.fill();
        }
        ctx.fillStyle = p.ghostText;
        ctx.font = `600 ${btn.fontSize || 13}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btn.label, x + w / 2, y + h / 2);
    }
    ctx.restore();
}

// Distance from point (px,py) to line segment (ax,ay)-(bx,by)
function pointToSegmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitTestButtons(buttons, mx, my) {
    for (let i = buttons.length - 1; i >= 0; i--) {
        const b = buttons[i];
        if (b.visible === false || b.disabled) continue;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
            return b.id;
        }
    }
    return null;
}

function wrapCanvasText(ctx, text, maxWidth, lineHeight) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    return { lines, lineHeight, totalHeight: lines.length * lineHeight };
}

function stripMarkdownForCanvas(text) {
    if (!text) return '';
    return text
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/#{1,6}\s*/g, '');
}

// Parchment background for full-canvas overlay screens
function drawParchmentBackground(ctx, w, h, p) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, p.parchCenter);
    grad.addColorStop(0.7, p.parchEdge);
    grad.addColorStop(1, p.parchCorner);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.04;
    const noiseRng = mapRng(7777);
    for (let i = 0; i < 200; i++) {
        ctx.fillStyle = noiseRng() > 0.5 ? '#000' : '#8a6a3a';
        ctx.beginPath();
        ctx.arc(noiseRng() * w, noiseRng() * h, noiseRng() * 2 + 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
    ctx.save();
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, p.parchVignette);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    const inset = 14;
    ctx.strokeStyle = p.borderDecor;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 8);
    ctx.stroke();
    ctx.strokeStyle = p.borderDecorInner;
    ctx.lineWidth = 0.8;
    drawRoundedRect(ctx, inset + 5, inset + 5, w - (inset + 5) * 2, h - (inset + 5) * 2, 6);
    ctx.stroke();
}

function drawCompassRose(ctx, cx, cy, size, p) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = p.compassRing;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2); ctx.stroke();
    const dirs = [
        { angle: -Math.PI / 2, label: 'N' },
        { angle: Math.PI / 2,  label: 'S' },
        { angle: 0,            label: 'E' },
        { angle: Math.PI,      label: 'W' },
    ];
    dirs.forEach(d => {
        const len = size * 0.75;
        ctx.fillStyle = d.label === 'N' ? p.compassNorth : p.compassPoint;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(d.angle - 0.15) * len * 0.3, Math.sin(d.angle - 0.15) * len * 0.3);
        ctx.lineTo(Math.cos(d.angle) * len, Math.sin(d.angle) * len);
        ctx.lineTo(Math.cos(d.angle + 0.15) * len * 0.3, Math.sin(d.angle + 0.15) * len * 0.3);
        ctx.closePath();
        ctx.fill();
    });
    ctx.fillStyle = p.compassRing;
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}


function getGameUIPalette() {
    const mapPalette = getMapPalette();
    const isLight = document.documentElement.classList.contains('light-theme');
    return Object.assign({}, mapPalette, {
        parchCenter: isLight ? '#f5e6c8' : '#2a2218',
        parchEdge:   isLight ? '#e8d4a8' : '#1e1810',
        parchCorner: isLight ? '#d8c090' : '#14100a',
        parchVignette: isLight ? 'rgba(120, 80, 20, 0.12)' : 'rgba(0, 0, 0, 0.5)',
        borderDecor:      isLight ? 'rgba(120, 80, 20, 0.35)' : 'rgba(180, 140, 60, 0.2)',
        borderDecorInner: isLight ? 'rgba(120, 80, 20, 0.18)' : 'rgba(180, 140, 60, 0.1)',
        compassRing:  isLight ? 'rgba(100, 70, 20, 0.3)' : 'rgba(180, 140, 60, 0.25)',
        compassNorth: isLight ? '#b03020' : '#c04030',
        compassPoint: isLight ? 'rgba(80, 60, 20, 0.45)' : 'rgba(160, 120, 40, 0.35)',
        titleText:     isLight ? '#3a2a10' : '#e8d8b0',
        bodyText:      isLight ? '#5a4a2a' : '#c8b888',
        mutedText:     isLight ? '#8a7a5a' : '#8a7a5a',
        accentText:    isLight ? '#7c3aed' : '#a78bfa',
        woodDark:    isLight ? '#6a4a20' : '#4a3218',
        woodMid:     isLight ? '#8a6a38' : '#5a4228',
        woodLight:   isLight ? '#9a7a48' : '#6a5238',
        woodShadow:  isLight ? 'rgba(40, 20, 0, 0.25)' : 'rgba(0, 0, 0, 0.4)',
        woodGrain:   isLight ? 'rgba(60, 40, 10, 0.12)' : 'rgba(200, 160, 60, 0.08)',
        woodBorder:  isLight ? 'rgba(60, 40, 10, 0.3)' : 'rgba(200, 160, 60, 0.15)',
        woodText:    '#f0e8d0',
        parchMid:    isLight ? '#ede0c0' : '#322818',
        parchLight:  isLight ? '#f5ecd4' : '#3a3020',
        parchDark:   isLight ? '#ddd0b0' : '#2a2010',
        parchBorder: isLight ? 'rgba(120, 90, 30, 0.25)' : 'rgba(180, 140, 60, 0.2)',
        parchText:   isLight ? '#4a3a1a' : '#d0c090',
        ghostHover:  isLight ? 'rgba(120, 80, 20, 0.08)' : 'rgba(200, 160, 60, 0.06)',
        ghostActive: isLight ? 'rgba(120, 80, 20, 0.15)' : 'rgba(200, 160, 60, 0.12)',
        ghostText:   isLight ? '#8a7a5a' : '#8a7a5a',
        hudBg:            isLight ? 'rgba(245, 230, 200, 0.92)' : 'rgba(30, 24, 16, 0.92)',
        hudBorder:        isLight ? 'rgba(120, 90, 30, 0.2)' : 'rgba(180, 140, 60, 0.12)',
        hudText:          isLight ? '#3a2a10' : '#e0d0a8',
        hudTextMuted:     isLight ? '#7a6a4a' : '#8a7a5a',
        hudProgressTrack: isLight ? 'rgba(120, 80, 20, 0.1)' : 'rgba(200, 160, 60, 0.1)',
        hudProgressFill:  isLight ? '#7c3aed' : '#a78bfa',
        categoryBg:   isLight ? 'rgba(124, 58, 237, 0.12)' : 'rgba(124, 58, 237, 0.2)',
        categoryText: isLight ? '#7c3aed' : '#a78bfa',
        tooltipBg:     isLight ? 'rgba(245, 230, 200, 0.95)' : 'rgba(30, 24, 16, 0.95)',
        tooltipBorder: isLight ? 'rgba(120, 90, 30, 0.25)' : 'rgba(180, 140, 60, 0.15)',
        accentGold:  isLight ? '#b07010' : '#f0b040',
        accentGreen: isLight ? '#2a8a3a' : '#60d070',
        separator: isLight ? 'rgba(120, 80, 20, 0.15)' : 'rgba(180, 140, 60, 0.12)',
        overlayBg: isLight ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.7)',
        // Type-specific island tints (drawn as a colored ring around the node)
        typeTintPrincipal: isLight ? '#dc2626' : '#ef4444',
        typeTintResource:  isLight ? '#d97706' : '#f59e0b',
        typeTintTarget:    isLight ? '#7c3aed' : '#a78bfa',
    });
}


// ---- Island label + type-ring overlays (drawn after drawGameMap) ----

function drawGameIslandLabels(ctx, w, h, state) {
    const p = state.palette;
    const { positions, nodes, revealed } = state;
    const lastIdx = nodes.length - 1;

    positions.forEach((pos, i) => {
        const isFirst = i === 0;
        const isLast = i === lastIdx;
        const isRevealed = revealed.has(i);
        const nodeType = nodes[i]?.type?.type || '';

        // Type-colored ring around the island base (only for revealed nodes)
        if (isRevealed && !isFirst && !isLast) {
            let tint = null;
            if (nodeType === 'principal') tint = p.typeTintPrincipal;
            else if (nodeType === 'resource') tint = p.typeTintResource;
            else if (nodeType === 'target') tint = p.typeTintTarget;
            if (tint) {
                ctx.save();
                ctx.globalAlpha = 0.25;
                ctx.strokeStyle = tint;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.ellipse(pos.x, pos.y + 2, 52 * 1.15, 52 * 0.42, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Green ring on the start island when the entry point is public-network or assumed-breach-network
        if (isFirst) {
            const startAccess = nodes[0]?.access;
            if (startAccess?.type === 'public-network' || startAccess?.type === 'assumed-breach-network') {
                const ringColor = startAccess.type === 'public-network' ? '#4ade80' : '#fbbf24';
                ctx.save();
                ctx.globalAlpha = 0.35;
                ctx.strokeStyle = ringColor;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.ellipse(pos.x, pos.y + 2, 52 * 1.15, 52 * 0.42, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Label -- always show all island names
        let label;
        if (isFirst) label = 'Startington';
        else if (isLast) label = 'Targetlandia';
        else {
            const rawLabel = nodes[i]?.label || '';
            label = rawLabel.length > 20 ? rawLabel.substring(0, 18) + '...' : rawLabel;
        }
        if (!label) return;

        // Position label below the island's bottom edge (ellipse Y-radius is ~0.42 * islandRadius)
        const ir = state.islandRadius || 52;
        const labelY = pos.y + ir * 0.42 + 10;
        ctx.save();

        // Check if below-label icon mode applies to this node
        const belowLabelIcon = (state.iconStyle === 'below-label')
            ? awsIconSprites.get(nodes[i]?.subType || '')
            : null;
        const belowIconSize = 32; // prominent icon size for below-label mode

        if (isFirst || isLast) {
            // Extract principal identifier from ARN (e.g., "user/my-user" or "role/my-role")
            const node = nodes[i];
            const arn = node?.arn || '';
            const arnSuffix = arn.includes(':') ? arn.substring(arn.lastIndexOf(':') + 1) : '';

            // For nodes with an access field, show the URL/IP/domain instead of the ARN suffix.
            // Truncate to 24 chars so it fits in the island plate.
            const accessObj = isFirst ? node?.access : null;
            const rawEndpoint = accessObj?.url || accessObj?.ip || accessObj?.domain || '';
            const accessShort = rawEndpoint.length > 24 ? rawEndpoint.substring(0, 22) + '\u2026' : rawEndpoint;
            const subtitleText = accessShort || arnSuffix;

            const nameColor = isFirst ? (p.startFill || '#4ade80') : (p.endFill || '#f59e0b');

            // Measure text widths
            ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
            const tw = ctx.measureText(label).width;
            ctx.font = '500 9px -apple-system, BlinkMacSystemFont, sans-serif';
            const idTw = subtitleText ? ctx.measureText(subtitleText).width : 0;

            // Calculate total content height to center vertically in plate
            const nameH = 13;  // font size
            const iconGap = belowLabelIcon ? 4 : 0;
            const iconH = belowLabelIcon ? belowIconSize : 0;
            const arnGap = subtitleText ? (belowLabelIcon ? 4 : 8) : 0;
            const arnH = subtitleText ? 9 : 0;
            const contentH = nameH + iconGap + iconH + arnGap + arnH;
            const pad = 8; // equal top and bottom padding
            const plateH = contentH + pad * 2;
            const contentW = Math.max(tw + 16, idTw + 12, belowLabelIcon ? belowIconSize + 12 : 0);

            const plateTop = labelY - 2;
            drawRoundedRect(ctx, pos.x - contentW / 2, plateTop, contentW, plateH, 5);
            ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.9)';
            ctx.fill();
            ctx.strokeStyle = p.borderDecor || 'rgba(120, 80, 20, 0.3)';
            ctx.lineWidth = 0.8;
            ctx.stroke();

            // Draw content centered in plate
            let cursorY = plateTop + pad + nameH / 2;

            // Island name
            ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.fillStyle = nameColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, pos.x, cursorY);
            cursorY += nameH / 2;

            // Icon between name and ARN
            if (belowLabelIcon) {
                cursorY += iconGap;
                ctx.drawImage(belowLabelIcon, pos.x - belowIconSize / 2, cursorY, belowIconSize, belowIconSize);
                cursorY += iconH;
            }

            // Subtitle: access URL/IP/domain (preferred) or ARN identifier
            if (subtitleText) {
                cursorY += arnGap + arnH / 2;
                ctx.font = '500 9px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.fillStyle = p.mutedText || 'rgba(180, 160, 120, 0.9)';
                ctx.fillText(subtitleText, pos.x, cursorY);
            }
        } else {
            // Middle islands: label + optional icon below
            ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
            const tw = ctx.measureText(label).width;

            const nameH = 12; // font size
            const iconGap = belowLabelIcon ? 4 : 0;
            const iconH = belowLabelIcon ? belowIconSize : 0;
            const contentH = nameH + iconGap + iconH;
            const pad = 6;
            const plateH = contentH + pad * 2;
            const plateW = Math.max(tw + 14, belowLabelIcon ? belowIconSize + 12 : 0);

            const plateTop = labelY - 2;
            drawRoundedRect(ctx, pos.x - plateW / 2, plateTop, plateW, plateH, 4);
            ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.9)';
            ctx.fill();
            ctx.strokeStyle = p.borderDecor || 'rgba(120, 80, 20, 0.2)';
            ctx.lineWidth = 0.6;
            ctx.stroke();

            let cursorY = plateTop + pad + nameH / 2;
            ctx.fillStyle = p.labelFill || '#e4e4e8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, pos.x, cursorY);
            cursorY += nameH / 2;

            // Icon below label
            if (belowLabelIcon) {
                cursorY += iconGap;
                ctx.drawImage(belowLabelIcon, pos.x - belowIconSize / 2, cursorY, belowIconSize, belowIconSize);
            }
        }
        ctx.restore();
    });
}

// ---- Plane Indicator Styles ----
// Multiple visual styles toggled with P key: 'jet', 'biplane', 'seaplane', 'helicopter'

function drawPlaneJet(ctx, x, y, palette) {
    const p = palette;
    ctx.save();
    ctx.translate(x + 12, y - 36);
    ctx.rotate(-0.30);

    // Fuselage -- sleek tapered body
    ctx.fillStyle = '#e8e8ec';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.quadraticCurveTo(20, -3, 16, -3.5);
    ctx.lineTo(-14, -3);
    ctx.quadraticCurveTo(-18, -1.5, -18, 0);
    ctx.quadraticCurveTo(-18, 1.5, -14, 3);
    ctx.lineTo(16, 3.5);
    ctx.quadraticCurveTo(20, 3, 18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cockpit windshield
    ctx.fillStyle = '#5bc0eb';
    ctx.beginPath();
    ctx.ellipse(14, -0.5, 4, 2.2, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Swept wings (top)
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-2, -3);
    ctx.lineTo(-8, -16);
    ctx.lineTo(6, -12);
    ctx.lineTo(4, -3);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Swept wings (bottom)
    ctx.beginPath();
    ctx.moveTo(-2, 3);
    ctx.lineTo(-8, 16);
    ctx.lineTo(6, 12);
    ctx.lineTo(4, 3);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Tail fin (vertical)
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.beginPath();
    ctx.moveTo(-14, -2);
    ctx.lineTo(-22, -12);
    ctx.lineTo(-16, -10);
    ctx.lineTo(-12, -2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Horizontal stabilizers
    ctx.fillStyle = '#d4d4d8';
    ctx.beginPath();
    ctx.moveTo(-14, -1.5);
    ctx.lineTo(-20, -7);
    ctx.lineTo(-16, -5);
    ctx.lineTo(-12, -1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 1.5);
    ctx.lineTo(-20, 7);
    ctx.lineTo(-16, 5);
    ctx.lineTo(-12, 1);
    ctx.closePath();
    ctx.fill();

    // Engine exhaust glow
    ctx.fillStyle = 'rgba(255, 160, 50, 0.4)';
    ctx.beginPath();
    ctx.ellipse(-19, 0, 4, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawPlaneBiplane(ctx, x, y, palette) {
    const p = palette;
    ctx.save();
    ctx.translate(x + 10, y - 34);
    ctx.rotate(-0.35);

    // Fuselage -- rounder, vintage
    ctx.fillStyle = '#f5e6c8';
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Cockpit (open)
    ctx.fillStyle = '#5bc0eb';
    ctx.beginPath();
    ctx.ellipse(6, -1, 3, 2, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Pilot head
    ctx.fillStyle = '#8B7355';
    ctx.beginPath();
    ctx.arc(6, -3.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Goggles
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.ellipse(7.5, -4, 1.2, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Upper wing
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(-6, -16);
    ctx.lineTo(10, -16);
    ctx.lineTo(8, -5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Lower wing
    ctx.beginPath();
    ctx.moveTo(-8, 4);
    ctx.lineTo(-6, 14);
    ctx.lineTo(10, 14);
    ctx.lineTo(8, 4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Wing struts (connecting upper and lower wings)
    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4, -15); ctx.lineTo(-4, 13);
    ctx.moveTo(5, -15); ctx.lineTo(5, 13);
    ctx.stroke();

    // Tail fin
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-13, -1);
    ctx.lineTo(-19, -9);
    ctx.lineTo(-11, -2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Propeller hub
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(15, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    // Propeller blades (spinning disc)
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(15, -7); ctx.lineTo(15, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, -5); ctx.lineTo(18, 5);
    ctx.stroke();

    ctx.restore();
}

function drawPlaneSeaplane(ctx, x, y, palette) {
    const p = palette;
    ctx.save();
    ctx.translate(x + 10, y - 32);
    ctx.rotate(-0.25);

    // Pontoons (floats)
    ctx.fillStyle = '#a3a3a3';
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 0.6;
    // Left pontoon
    ctx.beginPath();
    ctx.ellipse(-2, 7, 14, 2.5, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Right pontoon (slightly behind due to angle)
    ctx.beginPath();
    ctx.ellipse(-2, -8, 14, 2.5, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Struts connecting pontoons to fuselage
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4, 4.5); ctx.lineTo(-4, 2);
    ctx.moveTo(4, 4.5); ctx.lineTo(4, 2);
    ctx.moveTo(-4, -5.5); ctx.lineTo(-4, -2);
    ctx.moveTo(4, -5.5); ctx.lineTo(4, -2);
    ctx.stroke();

    // Fuselage -- boat-like hull
    ctx.fillStyle = '#e8e8ec';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.quadraticCurveTo(18, -3, 14, -3);
    ctx.lineTo(-12, -3);
    ctx.quadraticCurveTo(-16, 0, -12, 3);
    ctx.lineTo(14, 3);
    ctx.quadraticCurveTo(18, 3, 16, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Cockpit
    ctx.fillStyle = '#5bc0eb';
    ctx.beginPath();
    ctx.ellipse(10, -0.5, 4, 2.2, 0.15, 0, Math.PI * 2);
    ctx.fill();

    // High-mounted wing (single wing above fuselage)
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-6, -3);
    ctx.lineTo(-10, -15);
    ctx.lineTo(10, -15);
    ctx.lineTo(8, -3);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Wing strut
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -3); ctx.lineTo(0, -14);
    ctx.stroke();

    // Tail fin
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-12, -1);
    ctx.lineTo(-18, -9);
    ctx.lineTo(-10, -2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Propeller
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(16, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(16, -6); ctx.lineTo(16, 6);
    ctx.stroke();

    ctx.restore();
}

function drawPlaneHelicopter(ctx, x, y, palette) {
    const p = palette;
    ctx.save();
    ctx.translate(x + 6, y - 30);

    // Tail boom
    ctx.fillStyle = '#d4d4d8';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-4, -1);
    ctx.lineTo(-22, -3);
    ctx.lineTo(-22, 1);
    ctx.lineTo(-4, 2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Tail rotor disc
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.ellipse(-22, -1, 2, 7, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // Main body (cabin)
    ctx.fillStyle = '#e8e8ec';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.8;
    drawRoundedRect(ctx, -8, -6, 20, 12, 5);
    ctx.fill(); ctx.stroke();

    // Cockpit glass
    ctx.fillStyle = '#5bc0eb';
    ctx.beginPath();
    ctx.moveTo(8, -4);
    ctx.quadraticCurveTo(14, -4, 14, 0);
    ctx.quadraticCurveTo(14, 4, 8, 4);
    ctx.lineTo(8, -4);
    ctx.closePath();
    ctx.fill();

    // Accent stripe
    ctx.fillStyle = p.startFill || '#4ade80';
    ctx.fillRect(-7, -1, 15, 2);

    // Landing skids
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.2;
    // Left skid
    ctx.beginPath();
    ctx.moveTo(-6, 6); ctx.lineTo(-6, 10);
    ctx.moveTo(8, 6); ctx.lineTo(8, 10);
    ctx.moveTo(-8, 10); ctx.lineTo(10, 10);
    ctx.stroke();

    // Rotor mast
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(2, -6); ctx.lineTo(2, -14);
    ctx.stroke();

    // Rotor hub
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(2, -14, 2, 0, Math.PI * 2);
    ctx.fill();

    // Main rotor blades (spinning disc)
    ctx.strokeStyle = p.startFill || '#4ade80';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(-20, -14); ctx.lineTo(24, -14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, -18); ctx.lineTo(14, -10);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();
}

// Dispatch table for plane styles
const planeStyleRenderers = {
    jet: drawPlaneJet,
    biplane: drawPlaneBiplane,
    seaplane: drawPlaneSeaplane,
    helicopter: drawPlaneHelicopter,
};

// Draw the plane indicator using the selected style, with glow ring + drop shadow for visibility.
// The plane is offset to the top-right of the island so the shadow doesn't overlap the AWS icon.
// The plane is drawn at 1.5x scale for better visibility.
function drawPlaneIndicator(ctx, x, y, palette, style) {
    const renderer = planeStyleRenderers[style] || drawPlaneJet;
    const accentColor = palette.startFill || '#4ade80';
    const liftY = 25; // vertical pixels to raise the plane above its offset position
    const scale = 1.5;
    // Offset the plane to the top-right corner of the island
    const offsetX = 30;
    const offsetY = -18;
    const baseX = x + offsetX;
    const baseY = y + offsetY;

    // Drop shadow at the offset position on the island surface
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(baseX + 4, baseY - 6, 27, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Glow ring around the lifted plane
    const liftedY = baseY - liftY;
    ctx.save();
    const glowX = baseX + 4;
    const glowY = liftedY - 28 * scale;
    const grad = ctx.createRadialGradient(glowX, glowY, 5, glowX, glowY, 40);
    grad.addColorStop(0, accentColor + 'aa');
    grad.addColorStop(0.5, accentColor + '44');
    grad.addColorStop(1, accentColor + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(glowX, glowY, 40, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw the plane at 1.5x scale at the offset+lifted position
    ctx.save();
    ctx.translate(baseX, liftedY);
    ctx.scale(scale, scale);
    ctx.translate(-baseX, -liftedY);
    renderer(ctx, baseX, liftedY, palette);
    ctx.restore();
}

// Compute the plane's current position based on game state
function getPlanePosition(state) {
    const { positions, edges, companionPositions } = state;

    // Companion selected -> plane on companion island
    if (state.selectedCompanion !== null && state.selectedCompanion !== undefined) {
        const cpos = companionPositions?.[state.selectedCompanion];
        if (cpos && (cpos.x !== 0 || cpos.y !== 0)) return cpos;
    }

    // Edge selected -> plane at midpoint of the edge
    if (state.selectedEdge !== null && state.selectedEdge !== undefined) {
        const edge = edges?.[state.selectedEdge];
        if (edge) {
            const from = positions[edge.fromIdx];
            const to = positions[edge.toIdx];
            if (from && to) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        }
    }

    // Node selected -> plane on that node
    if (state.selectedNode !== null && state.selectedNode !== undefined) {
        const npos = positions[state.selectedNode];
        if (npos) return npos;
    }

    // Fallback: Startington
    return positions[0] || { x: 0, y: 0 };
}

// Draw map suppressing default labels, then add our own + type rings + companions + plane
function drawMapWithGameLabels(ctx, w, h, state) {
    const origLabels = state.nodes.map(n => n.label);
    state.nodes.forEach(n => { n.label = ''; });
    drawGameMap(ctx, w, h, state);
    state.nodes.forEach((n, i) => { n.label = origLabels[i]; });
    drawGameIslandLabels(ctx, w, h, state);
    drawCompanions(ctx, w, h, state);

    // Draw plane at current position (on top of everything)
    if (state.screen === 'playing' || state.screen === 'complete') {
        const planePos = getPlanePosition(state);
        drawPlaneIndicator(ctx, planePos.x, planePos.y, state.palette, state.planeStyle);
    }
}

// ---- Companion Node Drawing ----
// Companions are resource nodes displayed off the main path. Three visual treatments
// are available and can be toggled by the user: 'islet', 'ship', 'note'.

function drawCompanions(ctx, w, h, state) {
    const { companions, companionPositions, edges, revealedEdges, positions } = state;
    if (!companions || !companions.length) return;

    for (let ci = 0; ci < companions.length; ci++) {
        // Find the parent edge for positioning the branch line
        const parentEdge = edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
        if (!parentEdge) continue;

        const pos = companionPositions[ci];
        if (!pos || (pos.x === 0 && pos.y === 0)) continue;

        // Draw branch line from companion to its anchor point on the edge
        const fromPos = positions[parentEdge.fromIdx];
        const toPos = positions[parentEdge.toIdx];
        const siblingIndices = parentEdge.companionIndices || [];
        const siblingPos = siblingIndices.indexOf(ci);
        const siblingCount = siblingIndices.length;
        const t = siblingCount <= 1 ? 0.5 : 0.35 + (siblingPos / (siblingCount - 1)) * 0.3;
        const mx = fromPos.x + (toPos.x - fromPos.x) * t;
        const my = fromPos.y + (toPos.y - fromPos.y) * t;
        drawCompanionBranchLine(ctx, pos.x, pos.y, mx, my, state);

        // Dispatch to visual treatment
        const isSelected = state.selectedCompanion === ci;
        switch (state.companionStyle) {
            case 'ship':
                drawCompanionShip(ctx, pos, companions[ci], isSelected, state);
                break;
            case 'note':
                drawCompanionNote(ctx, pos, companions[ci], isSelected, state);
                break;
            case 'islet':
            default:
                drawCompanionIslet(ctx, pos, companions[ci], isSelected, state, ci);
                break;
        }
    }
}

// Thin dashed branch line from companion to edge midpoint
function drawCompanionBranchLine(ctx, fromX, fromY, toX, toY, state) {
    const p = state.palette;
    ctx.save();
    ctx.strokeStyle = p.typeTintResource || '#f59e0b';
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

// Treatment 1: Ship/Boat -- a simple pixel-art cargo ship silhouette
function drawCompanionShip(ctx, pos, companion, isSelected, state) {
    const p = state.palette;
    const x = pos.x;
    const y = pos.y;

    ctx.save();

    // Selection ring
    if (isSelected) {
        ctx.strokeStyle = p.selectedRing || '#9D4EDD';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(x, y, 32, 16, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Ship hull (simple boat shape)
    const hullW = 40;
    const hullH = 12;
    ctx.fillStyle = '#8B6B3E';
    ctx.beginPath();
    ctx.moveTo(x - hullW / 2, y);
    ctx.lineTo(x - hullW / 2 + 6, y + hullH);
    ctx.lineTo(x + hullW / 2 - 6, y + hullH);
    ctx.lineTo(x + hullW / 2, y);
    ctx.closePath();
    ctx.fill();

    // Hull detail line
    ctx.strokeStyle = '#6A4F2E';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - hullW / 2 + 4, y + 4);
    ctx.lineTo(x + hullW / 2 - 4, y + 4);
    ctx.stroke();

    // Mast
    ctx.strokeStyle = '#5A4020';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 22);
    ctx.stroke();

    // Sail (resource-type tinted)
    const tint = p.typeTintResource || '#f59e0b';
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 20);
    ctx.lineTo(x + 16, y - 10);
    ctx.lineTo(x + 2, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Water ripple under hull
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wx = x - hullW / 2 - 4; wx <= x + hullW / 2 + 4; wx += 2) {
        const wy = y + hullH + 3 + Math.sin(wx * 0.2) * 1.5;
        if (wx === x - hullW / 2 - 4) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
    }
    ctx.stroke();

    ctx.restore();

    // Label below
    drawCompanionLabel(ctx, x, y + hullH + 14, companion, state);
}

// Treatment 2: Rocky Islet -- smaller island with barren rock tones
function drawCompanionIslet(ctx, pos, companion, isSelected, state, nodeIndex) {
    const p = state.palette;
    const x = pos.x;
    const y = pos.y;
    // Scale companion islets proportionally with main islands
    const baseCompanionRadius = 56;
    const companionShrinkSteps = Math.max(0, (state.nodes?.length || 0) - 3);
    const islandRadius = baseCompanionRadius * Math.pow(0.8, companionShrinkSteps);
    const seed = (nodeIndex ?? 0) * 997 + 501;  // stable per-companion seed, independent of position

    ctx.save();

    // Selection ring
    if (isSelected) {
        ctx.strokeStyle = p.selectedRing || '#9D4EDD';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(x, y + 2, islandRadius * 1.3, islandRadius * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Generate shapes at smaller scale
    const shoreShape = generateIslandShape(x, y, islandRadius * 1.2, islandRadius * 0.45, seed + 1, 16);
    const rockShape = generateIslandShape(x, y, islandRadius * 1.0, islandRadius * 0.38, seed + 2, 16);
    const innerShape = generateIslandShape(x, y - 1, islandRadius * 0.7, islandRadius * 0.26, seed + 3, 12);

    // Cliff shadow
    const shadowShape = shoreShape.map(pt => ({ x: pt.x + 2, y: pt.y + 6 }));
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    drawSmoothShape(ctx, shadowShape);
    ctx.fill();

    // Cliff face
    ctx.fillStyle = p.cliffDark || '#2a1a08';
    drawSmoothShape(ctx, shoreShape.map(pt => ({ x: pt.x, y: pt.y + 3 })));
    ctx.fill();

    // Shore ring -- sandy/rocky
    ctx.fillStyle = p.sandDark || '#6a5a32';
    drawSmoothShape(ctx, shoreShape);
    ctx.fill();

    // Rock surface (gray/brown instead of green)
    const isLight = document.documentElement.classList.contains('light-theme');
    ctx.fillStyle = isLight ? '#9a8a78' : '#5a4a3a';
    drawSmoothShape(ctx, rockShape);
    ctx.fill();

    // Inner rock highlight
    ctx.fillStyle = isLight ? '#b8a898' : '#6a5a48';
    drawSmoothShape(ctx, innerShape);
    ctx.fill();

    // AWS icon centered on companion islet (max 50% of islet radius) -- only in 'on-island' mode
    if (state.iconStyle === 'on-island') {
        const companionSubType = companion.subType || '';
        const companionIcon = awsIconSprites.get(companionSubType);
        if (companionIcon) {
            const maxIconSize = islandRadius * 0.5; // 50% of companion island radius = 14px
            const iconSize = Math.min(maxIconSize, companionIcon.width);
            ctx.globalAlpha = 0.85;
            ctx.drawImage(companionIcon, x - iconSize / 2, y - iconSize / 2 - 1, iconSize, iconSize);
            ctx.globalAlpha = 1;
        }
    }

    // Resource-type tint ring
    const tint = p.typeTintResource || '#f59e0b';
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = tint;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, islandRadius * 1.1, islandRadius * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.restore();

    // Label below
    drawCompanionLabel(ctx, x, y + 16, companion, state);
}

// Treatment 3: Parchment Note -- floating annotation card
function drawCompanionNote(ctx, pos, companion, isSelected, state) {
    const p = state.palette;
    const x = pos.x;
    const y = pos.y;

    ctx.save();

    const label = companion.label || '';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    const tw = ctx.measureText(label.length > 18 ? label.substring(0, 16) + '..' : label).width;
    const cardW = Math.max(tw + 28, 70);
    const cardH = 32;
    const cardX = x - cardW / 2;
    const cardY = y - cardH / 2;

    // Card shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    drawRoundedRect(ctx, cardX + 2, cardY + 2, cardW, cardH, 6);
    ctx.fill();

    // Card background (parchment-colored)
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 6);
    ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.95)';
    ctx.fill();

    // Border
    const borderColor = isSelected ? (p.selectedRing || '#9D4EDD') : (p.borderDecor || 'rgba(120, 80, 20, 0.3)');
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Resource type colored dot
    const tint = p.typeTintResource || '#f59e0b';
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(cardX + 12, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Resource name
    const displayLabel = label.length > 18 ? label.substring(0, 16) + '..' : label;
    ctx.fillStyle = p.bodyText || '#5a4a2a';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayLabel, cardX + 22, y);

    ctx.restore();
}

// Shared label drawing for ship and islet treatments
function drawCompanionLabel(ctx, x, y, companion, state) {
    const p = state.palette;
    const label = companion.label || '';
    const displayLabel = label;

    // Check for below-label icon
    const belowIcon = (state.iconStyle === 'below-label')
        ? awsIconSprites.get(companion.subType || '')
        : null;
    const iconSize = 24; // slightly smaller for companions
    const iconRowH = belowIcon ? (iconSize + 4) : 0;

    ctx.save();
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    const tw = ctx.measureText(displayLabel).width;
    const plateW = Math.max(tw + 10, belowIcon ? iconSize + 10 : 0);
    const plateH = 16 + iconRowH;

    drawRoundedRect(ctx, x - plateW / 2, y - 2, plateW, plateH, 3);
    ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.9)';
    ctx.fill();
    ctx.strokeStyle = p.borderDecor || 'rgba(120, 80, 20, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.fillStyle = p.typeTintResource || '#f59e0b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayLabel, x, y + 6);

    // Icon below label text
    if (belowIcon) {
        ctx.drawImage(belowIcon, x - iconSize / 2, y + 14, iconSize, iconSize);
    }

    ctx.restore();
}


// ---- HTML Detail Panel ----

function escapeHtmlGame(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Convert ANSI escape codes in a terminal transcript to safe HTML with CSS class spans.
// Handles SGR codes: bold, dim, and the standard 8 foreground colors.
// Compound codes like "0;32" (reset + green) or "1;33" (bold + yellow) are split
// on ";" and each parameter is processed in sequence, matching real terminal behavior.
function ansiToHtml(text) {
    const PARAM_MAP = {
        '1':  'ansi-bold',
        '2':  'ansi-dim',
        '31': 'ansi-red',
        '32': 'ansi-green',
        '33': 'ansi-yellow',
        '34': 'ansi-blue',
        '35': 'ansi-magenta',
        '36': 'ansi-cyan',
        '37': 'ansi-white',
    };
    // Split on SGR sequences: \x1b[<codes>m — captured group gives us the code string
    const parts = text.split(/\x1b\[([0-9;]*)m/);
    let html = '';
    let openSpans = 0;
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            // Text segment — escape HTML entities
            html += escapeHtmlGame(parts[i]);
        } else {
            // SGR code string — may be compound like "0;32" or "1;33"
            const params = parts[i].split(';');
            for (const param of params) {
                if (param === '0' || param === '') {
                    // Reset — close all open spans
                    html += '</span>'.repeat(openSpans);
                    openSpans = 0;
                } else {
                    const cls = PARAM_MAP[param];
                    if (cls) {
                        html += `<span class="${cls}">`;
                        openSpans++;
                    }
                }
            }
        }
    }
    // Close any spans left open at end of text
    html += '</span>'.repeat(openSpans);
    return html;
}

// Format markdown-ish text to simple HTML (backticks -> <code>)
// Convert markdown-ish text to HTML suitable for the game panel.
// Handles: fenced code blocks, inline code, bold, italic, links, bullet lists, paragraphs.
function markdownToSimpleHtml(text) {
    if (!text) return '';

    // First, extract fenced code blocks (```...```) before escaping
    const codeBlocks = [];
    let processed = text.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(code);
        return `\x00CODEBLOCK${idx}\x00`;
    });

    // Escape HTML (but preserve our placeholders)
    processed = escapeHtmlGame(processed);

    // Restore fenced code blocks as <pre><code>
    processed = processed.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, idx) => {
        return `</p><pre class="mg-cmd-block"><code>${escapeHtmlGame(codeBlocks[parseInt(idx, 10)].trim())}</code></pre><p>`;
    });

    // Inline code
    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Links [text](url)
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Split into lines, convert bullet lists into <ul>/<li>, join non-bullet
    // lines with <br>, and separate paragraphs (double newline) with </p><p>.
    const lines = processed.split('\n');
    const blocks = []; // each block is either a string (paragraph) or {type:'ul', items:[]}
    let currentPara = [];
    let currentList = null;

    function flushPara() {
        if (currentPara.length > 0) {
            blocks.push(currentPara.join('<br>'));
            currentPara = [];
        }
    }
    function flushList() {
        if (currentList) {
            blocks.push({ type: 'ul', items: currentList });
            currentList = null;
        }
    }

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
            // Empty line = paragraph break
            flushList();
            flushPara();
        } else if (trimmed.startsWith('- ')) {
            flushPara();
            if (!currentList) currentList = [];
            currentList.push(trimmed.substring(2));
        } else {
            flushList();
            currentPara.push(trimmed);
        }
    }
    flushList();
    flushPara();

    // Render blocks to HTML
    processed = blocks.map(block => {
        if (typeof block === 'string') return block;
        if (block.type === 'ul') return '<ul>' + block.items.map(li => `<li>${li}</li>`).join('') + '</ul>';
        return '';
    }).join('</p><p>');

    // Clean up empty <p></p> tags and stray wrappers around block elements
    processed = processed.replace(/<p>\s*<\/p>/g, '');
    processed = processed.replace(/<p>\s*(<ul>)/g, '$1');
    processed = processed.replace(/(<\/ul>)\s*<\/p>/g, '$1');
    processed = processed.replace(/<p>\s*(<pre)/g, '$1');
    processed = processed.replace(/(<\/pre>)\s*<\/p>/g, '$1');

    return processed;
}

// Render the mission overview (shown on start and when no node is selected)
function renderGamePanelOverview(panelEl, state) {
    const lab = state.lab;
    const startNode = state.nodes[0];
    const targetNode = state.nodes[state.nodes.length - 1];

    // Detect public/network-start scenarios. Primary signal: access field on the start node.
    // Fallback: parse the "- **Start:**" line from the objective text (older data without access field).
    const startAccess = startNode?.access;
    const overviewText = lab?.readme?.objective || lab?.readme?.overview || lab?.description || '';
    const startLineMatch = overviewText.match(/^-\s*\*\*Start:\*\*\s*`?([^`\n]+)`?/m);
    const startLineValue = startLineMatch?.[1]?.trim() || '';
    const isPublicStart = startAccess?.type === 'public-network'
        || startAccess?.type === 'assumed-breach-network'
        || startLineValue.startsWith('https://')
        || startLineValue.startsWith('http://')
        || startLineValue.toLowerCase().includes('(public');
    // Resolved entry point URL/IP/domain for display
    const accessEndpoint = startAccess?.url || startAccess?.ip || startAccess?.domain || '';

    // Read permissions from v4 per-principal structure, falling back to legacy flat arrays.
    const startingPrincipal = lab?.permissions?.principals?.[0];
    const perms = startingPrincipal?.required ?? lab?.permissions?.required ?? [];
    const permPills = perms.map(pr =>
        `<code class="mg-code-pill">${escapeHtmlGame(pr.permission)}</code>`
    ).join('');
    // Collect helpful permissions across all principals (secondary recon principal may hold them)
    const allPrincipals = lab?.permissions?.principals ?? [];
    const helpfulPerms = allPrincipals.flatMap(p => p.helpful ?? []);
    const helpfulPermsFlat = helpfulPerms.length > 0 ? helpfulPerms : (lab?.permissions?.helpful ?? []);
    const helpfulPills = helpfulPermsFlat.map(pr =>
        `<code class="mg-code-pill">${escapeHtmlGame(pr.permission)}</code>`
    ).join('');

    // Extract short ARN suffix (type/name) from full ARN
    const shortArn = (arn) => {
        if (!arn) return '';
        // arn:aws:iam::{account}:type/name -> type/name
        const parts = arn.split(':');
        return parts.length >= 6 ? parts.slice(5).join(':') : arn;
    };

    // Build inline pills for the header row
    const headerPills = [];
    if (lab?.category) {
        headerPills.push(`<span class="mg-category-badge">${escapeHtmlGame(lab.category)}</span>`);
    }
    if (lab?.pathType) {
        headerPills.push(`<span class="mg-category-badge mg-path-type-badge">${escapeHtmlGame(lab.pathType.replace(/-/g, ' '))}</span>`);
    }

    panelEl.innerHTML = `
        ${headerPills.length ? `
        <div class="mg-panel-section">
            <div class="mg-header-pills">${headerPills.join('')}</div>
        </div>` : ''}
        <div class="mg-panel-section">
            <span class="mg-section-label">OBJECTIVE</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(lab?.description || '')}</p>
        </div>
        ${startNode ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">${isPublicStart ? 'STARTING POINT' : 'STARTING PRINCIPAL'}</span>
            <code class="mg-arn">${escapeHtmlGame(shortArn(startNode.arn) || startNode.label)}</code>
            ${accessEndpoint ? `<code class="mg-access-url">${escapeHtmlGame(accessEndpoint)}</code>` : ''}
            ${isPublicStart ? `<div class="mg-public-access-note">No AWS credentials required</div>` : ''}
        </div>` : ''}
        ${isPublicStart ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">STARTING PERMISSIONS</span>
            <div class="mg-public-access-note">No AWS credentials required — the entry point accepts unauthenticated requests</div>
            ${helpfulPills ? `
            <button class="mg-helpful-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                Helpful IAM permissions (${helpfulPermsFlat.length})
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="mg-perm-pills mg-helpful-collapsible">
                ${helpfulPills}
            </div>` : ''}
        </div>` : permPills ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">STARTING PERMISSIONS</span>
            <div class="mg-perm-pills">${permPills}</div>
            ${helpfulPills ? `
            <button class="mg-helpful-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                Helpful (${helpfulPermsFlat.length})
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="mg-perm-pills mg-helpful-collapsible">
                ${helpfulPills}
            </div>` : ''}
        </div>` : ''}
        ${targetNode ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">TARGET</span>
            <code class="mg-arn">${escapeHtmlGame(shortArn(targetNode.arn) || targetNode.label)}</code>
        </div>` : ''}
    `;
}

// Build a contextual "what to do next" prompt based on current game state
function buildNextPromptHtml(state) {
    const hasCompanionSelected = state.selectedCompanion !== null && state.selectedCompanion !== undefined;
    const allRevealed = state.currentEdge >= state.edges.length - 1
        && !hasCompanionSelected
        && state.selectedNode === state.nodes.length - 1;

    // If navigation complete, prompt to finish
    if (allRevealed) {
        return `<div class="mg-panel-section mg-next-prompt">
            <p class="mg-panel-body">All hops complete. Press <strong>Finish Mission</strong> below to see your results.</p>
        </div>`;
    }

    const nextEdgeIdx = state.currentEdge + 1;
    if (nextEdgeIdx >= state.edges.length) return '';

    const isViewingEdge = state.selectedEdge !== null && state.selectedEdge !== undefined;

    if (isViewingEdge) {
        // Currently viewing an edge -- prompt to complete it
        const edge = state.edges[state.selectedEdge];
        if (edge && !state.revealedEdges.has(state.selectedEdge)) {
            const toNode = state.nodes[edge.toIdx];
            return `<div class="mg-panel-section mg-next-prompt">
                <p class="mg-panel-body">When you are ready, press <strong>Next</strong> below to reveal ${escapeHtmlGame(toNode?.label || 'the next island')}.</p>
            </div>`;
        }
        return '';
    }

    // Viewing a node -- prompt to start the next hop
    if (!state.revealedEdges.has(nextEdgeIdx)) {
        return `<div class="mg-panel-section mg-next-prompt">
            <p class="mg-panel-body">Press <strong>Next</strong> below to continue.</p>
        </div>`;
    }

    return '';
}

// Render node detail (shown when a node is selected during play)
function renderGamePanelNode(panelEl, state) {
    const node = state.nodes[state.selectedNode];
    const isFirst = state.selectedNode === 0;
    const isLast = state.selectedNode === state.nodes.length - 1;

    // Count active hops for display
    const activeHops = state.edges.filter(e => !e.implicit).length;
    let hopNumber = 0;
    for (let i = 0; i < state.edges.length; i++) {
        if (!state.edges[i].implicit) hopNumber++;
        if (state.edges[i].toIdx === state.selectedNode) break;
    }

    const typeLabel = node.type?.label || 'Node';
    const subType = node.subType || '';
    const badgeText = subType ? `${typeLabel} / ${subType}` : typeLabel;

    // -- Primary section: node identity --
    // Build access block for nodes that have an access entry point field
    let accessBlockHtml = '';
    if (isFirst && node.access) {
        const accessTypeLabels = {
            'public-network': 'PUBLIC NETWORK',
            'assumed-breach-network': 'INTERNAL NETWORK',
            'assumed-breach-credentials': 'ASSUMED BREACH',
        };
        const accessTypeLabel = accessTypeLabels[node.access.type] || node.access.type?.toUpperCase() || 'NETWORK ACCESS';
        const accessCssClass = node.access.type === 'public-network' ? 'mg-access-public'
            : node.access.type === 'assumed-breach-network' ? 'mg-access-internal'
            : 'mg-access-credentials';
        const endpoint = node.access.url || node.access.ip || node.access.domain || '';
        accessBlockHtml = `
        <div class="mg-access-block">
            <span class="mg-access-badge ${accessCssClass}">${escapeHtmlGame(accessTypeLabel)}</span>
            ${endpoint ? `<code class="mg-access-endpoint">${escapeHtmlGame(endpoint)}</code>` : ''}
        </div>`;
    }

    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">${isFirst ? 'STARTING POSITION' : isLast ? 'TARGET REACHED' : `HOP ${hopNumber} DESTINATION`}</span>
            <span class="mg-type-badge mg-type-${node.type?.type || 'unknown'}">${escapeHtmlGame(badgeText)}</span>
            <h2 class="mg-panel-title">${escapeHtmlGame(node.label)}</h2>
            ${node.arn ? `<code class="mg-arn">${escapeHtmlGame(node.arn)}</code>` : ''}
            ${accessBlockHtml}
        </div>`;

    // Node description -- about this place
    if (node.description) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">ABOUT THIS ${typeLabel.toUpperCase()}</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(node.description)}</p>
        </div>`;
    }

    // Contextual "what to do next" prompt
    html += buildNextPromptHtml(state);

    panelEl.innerHTML = html;
}

// Render companion resource detail (shown when a companion node is clicked)
function renderGamePanelCompanion(panelEl, state) {
    const ci = state.selectedCompanion;
    const companion = state.companions[ci];
    if (!companion) return;

    // Find which edge this companion belongs to
    const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
    const edgeIdx = parentEdge ? state.edges.indexOf(parentEdge) : -1;

    // Compute hop number for display
    let hopNumber = 0;
    if (edgeIdx >= 0) {
        for (let i = 0; i <= edgeIdx; i++) {
            if (!state.edges[i].implicit) hopNumber++;
        }
    }

    const typeLabel = companion.type?.label || 'Resource';
    const subType = companion.subType || '';
    const badgeText = subType ? `${typeLabel} / ${subType}` : typeLabel;

    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">RESOURCE ON HOP ${hopNumber}</span>
            <span class="mg-type-badge mg-type-${companion.type?.type || 'resource'}">${escapeHtmlGame(badgeText)}</span>
            <h2 class="mg-panel-title">${escapeHtmlGame(companion.label)}</h2>
            ${companion.arn ? `<code class="mg-arn">${escapeHtmlGame(companion.arn)}</code>` : ''}
        </div>`;

    if (companion.description) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">ABOUT THIS RESOURCE</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(companion.description)}</p>
        </div>`;
    }

    // Show the companion edge info (what happens via this resource)
    if (companion.edgeLabel) {
        html += `
        <div class="mg-panel-section mg-via-resource">
            <span class="mg-section-label">VIA RESOURCE</span>
            <code class="mg-edge-label">${escapeHtmlGame(companion.edgeLabel)}</code>
            ${companion.edgeDescription ? `<p class="mg-panel-body" style="margin-top:8px;">${markdownToSimpleHtml(companion.edgeDescription)}</p>` : ''}
        </div>`;
    }

    html += `
        <div class="mg-panel-section mg-next-prompt">
            <p class="mg-panel-body mg-muted">This resource is used as part of Hop ${hopNumber}. Click the path or a principal island to continue.</p>
        </div>`;

    panelEl.innerHTML = html;
}

// Render edge detail (shown when a path/line between islands is clicked)
function renderGamePanelEdge(panelEl, state) {
    const edgeIdx = state.selectedEdge;
    const edge = state.edges[edgeIdx];
    if (!edge) return;
    const fromNode = state.nodes[edge.fromIdx];
    const toNode = state.nodes[edge.toIdx];
    const fromLabel = fromNode ? fromNode.label : '?';
    const toLabel = toNode ? toNode.label : '?';

    // Compute hop number (counting only non-implicit edges)
    let hopNumber = 0;
    for (let i = 0; i <= edgeIdx; i++) {
        if (!state.edges[i].implicit) hopNumber++;
    }
    const hopLabel = edge.implicit ? 'AUTOMATIC STEP' : `HOP ${hopNumber}`;

    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">${escapeHtmlGame(hopLabel)}</span>
            <h2 class="mg-panel-title">${escapeHtmlGame(fromLabel)} &rarr; ${escapeHtmlGame(toLabel)}</h2>
        </div>`;

    // Edge label (permission/action required for traversal)
    if (edge.label) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">ACTION</span>
            <code class="mg-edge-label">${escapeHtmlGame(edge.label)}</code>
        </div>`;
    }

    // For implicit edges, show a brief explanation
    if (edge.implicit) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">WHAT HAPPENS</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(edge.description || 'This step happens automatically -- no attacker action required.')}</p>
            <p class="mg-panel-body mg-muted" style="margin-top:8px;">This is an automatic step. The attacker does not need to take any action here. Click <strong>Next</strong> to continue.</p>
        </div>`;

        // Show verification commands if any, but collapsed
        const commands = edge.commands || [];
        if (commands.length > 0) {
            const isOpen = state.revealedCommands.has(edgeIdx);
            html += `<div class="mg-panel-section">`;
            html += `<div class="mg-commands-toggle" data-edge-idx="${edgeIdx}">
                <span class="mg-section-label" style="cursor:pointer; user-select:none;">VERIFICATION COMMANDS <span class="mg-deploy-arrow">${isOpen ? '&#9660;' : '&#9654;'}</span></span>
            </div>`;
            html += `<div class="mg-commands-content" style="display:${isOpen ? 'block' : 'none'};">`;
            for (const cmd of commands) {
                if (cmd.description) html += `<p class="mg-cmd-desc">${escapeHtmlGame(cmd.description)}</p>`;
                if (cmd.command) html += `<pre class="mg-cmd-block"><code>${escapeHtmlGame(cmd.command)}</code></pre>`;
            }
            html += `</div></div>`;
        }

        html += buildNextPromptHtml(state);
        panelEl.innerHTML = html;
        attachEdgePanelHandlers(panelEl, state);
        return;
    }

    // Edge description (how the traversal works)
    if (edge.description) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">HOW IT WORKS</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(edge.description)}</p>
        </div>`;
    }

    // Pathfinding.cloud cross-link
    const pathId = state.lab?.pathfindingCloudId;
    if (pathId) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">LEARN MORE</span>
            <p class="mg-panel-body"><a href="/paths/${escapeHtmlGame(pathId)}" target="_blank" class="mg-path-link">View ${escapeHtmlGame(pathId)} technique details on pathfinding.cloud</a></p>
        </div>`;
    }

    // Progressive hints
    const hints = edge.hints || [];
    if (hints.length > 0) {
        html += `<div class="mg-panel-section"><span class="mg-section-label">HINTS</span>`;
        if (!state.revealedHints) state.revealedHints = {};
        if (!state.revealedHints[`edge-${edgeIdx}`]) state.revealedHints[`edge-${edgeIdx}`] = new Set();
        const revealedSet = state.revealedHints[`edge-${edgeIdx}`];
        hints.forEach((hint, hIdx) => {
            const isHintRevealed = revealedSet.has(hIdx);
            if (isHintRevealed) {
                html += `<div class="mg-hint mg-hint-revealed"><span class="mg-hint-number">${hIdx + 1}</span> <span>${markdownToSimpleHtml(hint)}</span></div>`;
            } else {
                html += `<div class="mg-hint mg-hint-hidden" data-hint-idx="${hIdx}" data-edge-idx="${edgeIdx}"><span class="mg-hint-number">${hIdx + 1}</span> <span>Click to reveal hint</span></div>`;
            }
        });
        html += `</div>`;
    }

    // Commands (hidden behind toggle)
    const commands = edge.commands || [];
    if (commands.length > 0) {
        const isOpen = state.revealedCommands.has(edgeIdx);
        html += `<div class="mg-panel-section">`;
        html += `<div class="mg-commands-toggle" data-edge-idx="${edgeIdx}">
            <span class="mg-section-label" style="cursor:pointer; user-select:none;">REVEAL EXPLOITATION COMMANDS <span class="mg-deploy-arrow">${isOpen ? '&#9660;' : '&#9654;'}</span></span>
        </div>`;
        html += `<div class="mg-commands-content" style="display:${isOpen ? 'block' : 'none'};">`;
        for (const cmd of commands) {
            if (cmd.description) html += `<p class="mg-cmd-desc">${escapeHtmlGame(cmd.description)}</p>`;
            if (cmd.command) html += `<pre class="mg-cmd-block"><code>${escapeHtmlGame(cmd.command)}</code></pre>`;
        }
        html += `</div></div>`;
    }

    // Contextual "what to do next" prompt
    html += buildNextPromptHtml(state);

    panelEl.innerHTML = html;
    attachEdgePanelHandlers(panelEl, state);
}

// Attach click handlers for hints and command toggles on the edge panel
// Scroll the focused lab item in the labs browser into view.
function scrollLabsBrowserItemIntoView(state) {
    const menuEl = state._menuEl;
    if (!menuEl) return;
    const list = menuEl.querySelector('.mg-labs-list');
    const focused = menuEl.querySelector('.mg-lab-item.mg-menu-focused');
    if (!list || !focused) return;
    const buffer = 40;
    const listRect = list.getBoundingClientRect();
    const itemRect = focused.getBoundingClientRect();
    if (itemRect.bottom + buffer > listRect.bottom) {
        list.scrollTop += itemRect.bottom + buffer - listRect.bottom;
    } else if (itemRect.top - buffer < listRect.top) {
        list.scrollTop -= listRect.top - itemRect.top + buffer;
    }
}

// Scroll the panel so the hint at hintIdx is fully visible, with a small
// buffer below so the user can see there is (or isn't) another hint after it.
function scrollHintIntoView(panelEl, hintIdx) {
    const hintEls = panelEl.querySelectorAll('.mg-hint');
    const hintEl = hintEls[hintIdx];
    if (!hintEl) return;
    const buffer = 48; // px of breathing room below the revealed hint
    const panelRect = panelEl.getBoundingClientRect();
    const hintRect = hintEl.getBoundingClientRect();
    const overflow = hintRect.bottom + buffer - panelRect.bottom;
    if (overflow > 0) {
        panelEl.scrollTop += overflow;
    }
}

function attachEdgePanelHandlers(panelEl, state) {
    // Hint click handlers
    panelEl.querySelectorAll('.mg-hint-hidden').forEach(el => {
        el.addEventListener('click', () => {
            const hIdx = parseInt(el.dataset.hintIdx, 10);
            const eIdx = parseInt(el.dataset.edgeIdx, 10);
            const key = `edge-${eIdx}`;
            if (!state.revealedHints[key]) state.revealedHints[key] = new Set();
            state.revealedHints[key].add(hIdx);
            state.hintsUsed++;
            renderGamePanelEdge(panelEl, state);
            scrollHintIntoView(panelEl, hIdx);
        });
    });

    // Command toggle handler
    panelEl.querySelectorAll('.mg-commands-toggle').forEach(el => {
        el.addEventListener('click', () => {
            const eIdx = parseInt(el.dataset.edgeIdx, 10);
            if (state.revealedCommands.has(eIdx)) {
                state.revealedCommands.delete(eIdx);
            } else {
                state.revealedCommands.add(eIdx);
            }
            renderGamePanelEdge(panelEl, state);
        });
    });
}

// Render the completion summary
function renderGamePanelComplete(panelEl, state) {
    const totalEdges = state.edges.length;

    let html = `
        <div class="mg-panel-section mg-complete-header">
            <span class="mg-section-label">MISSION COMPLETE</span>
            <h2 class="mg-panel-title">${escapeHtmlGame(state.lab?.name || '')}</h2>
        </div>
        <div class="mg-panel-section">
            <div class="mg-stats-grid">
                <div class="mg-stat">
                    <span class="mg-section-label">HOPS</span>
                    <span class="mg-stat-value">${totalEdges} / ${totalEdges}</span>
                </div>
                <div class="mg-stat">
                    <span class="mg-section-label">HINTS</span>
                    <span class="mg-stat-value">${state.hintsUsed}</span>
                </div>
            </div>
        </div>
        <div class="mg-panel-section">
            <p class="mg-panel-body mg-muted">Select any island or hop label on the map to review the attack path, or use the buttons below to explore detection strategies.</p>
        </div>`;

    panelEl.innerHTML = html;
}

// Render CSPM detection info in the panel (triggered by canvas button)
function renderGamePanelCSPM(panelEl, state) {
    const readme = state.lab?.readme;
    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">CSPM DETECTION</span>
            <h2 class="mg-panel-title">How could this have been detected with CSPM?</h2>
        </div>`;

    const cspm = readme?.defend?.cspm || readme?.cspm;
    const cspmDetect = cspm?.whatToDetect;
    if (cspmDetect) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">WHAT CSPM TOOLS SHOULD DETECT</span>
            <div class="mg-panel-body">${markdownToSimpleHtml(cspmDetect)}</div>
        </div>`;
    }

    if (!cspmDetect) {
        html += `<div class="mg-panel-section"><p class="mg-panel-body mg-muted">No CSPM detection data available for this lab.</p></div>`;
    }

    panelEl.innerHTML = html;
}

// Render CloudSIEM detection info in the panel (triggered by canvas button)
function renderGamePanelCloudSIEM(panelEl, state) {
    const readme = state.lab?.readme;
    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">CLOUDSIEM DETECTION</span>
            <h2 class="mg-panel-title">How could this have been detected with CloudSIEM?</h2>
        </div>`;

    const siem = readme?.defend?.cloudSiem || readme?.cloudSiem;
    const cloudTrail = siem?.cloudTrailEvents;
    if (cloudTrail) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">CLOUDTRAIL EVENTS TO MONITOR</span>
            <div class="mg-panel-body">${markdownToSimpleHtml(cloudTrail)}</div>
        </div>`;
    }

    const detonation = siem?.detonationLogs;
    if (detonation) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">DETONATION LOGS</span>
            <div class="mg-panel-body">${markdownToSimpleHtml(detonation)}</div>
        </div>`;
    }

    if (!cloudTrail && !detonation) {
        html += `<div class="mg-panel-section"><p class="mg-panel-body mg-muted">No CloudSIEM detection data available for this lab.</p></div>`;
    }

    panelEl.innerHTML = html;
}

// Render deploy instructions in the panel (triggered by canvas button)
function renderGamePanelDeploy(panelEl, state) {
    const lab = state.lab;
    const scenarioDir = lab?.name || '';
    // Extract the deploy commands from the README's non-interactive section, stripping
    // the markdown code fence (```bash...```) to get the raw command text.
    const deployRaw = lab?.readme?.setup?.deployNonInteractive || '';
    const deployCmd = deployRaw.replace(/^```[a-z]*\n/, '').replace(/\n?```\s*$/, '').trim();

    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">DEPLOY THE SELF-HOSTED LAB</span>
            <h2 class="mg-panel-title">Setup Instructions</h2>
        </div>
        <div class="mg-panel-section">
            <div class="mg-deploy-step">
                <p class="mg-deploy-step-title">1. Install plabs</p>
                <pre class="mg-cmd-block"><code>brew install pathfinding-labs/tap/plabs</code></pre>
                <p class="mg-panel-body mg-muted">Or install from <a href="https://github.com/DataDog/pathfinding-labs" target="_blank" rel="noopener noreferrer">GitHub</a></p>
            </div>
            <div class="mg-deploy-step">
                <p class="mg-deploy-step-title">2. Configure plabs</p>
                <pre class="mg-cmd-block"><code>plabs init</code></pre>
          
            </div>
            ${deployCmd ? `
            <div class="mg-deploy-step">
                <p class="mg-deploy-step-title">3. Deploy this scenario</p>
                <pre class="mg-cmd-block"><code>${escapeHtmlGame(deployCmd)}</code></pre>
            </div>` : ''}
            <div class="mg-deploy-step">
                <p class="mg-deploy-step-title">${deployCmd ? '4' : '3'}. Get starting credentials</p>
                <pre class="mg-cmd-block"><code>plabs credentials ${escapeHtmlGame(scenarioDir)}</code></pre>
            </div>
        </div>`;

    panelEl.innerHTML = html;
}

// Update the HTML panel based on current game state
function updateGamePanel(state) {
    const panelEl = state._panelEl;
    if (!panelEl) return;

    // Node, edge, and companion selection are mutually exclusive
    const hasNode = state.selectedNode !== null && state.selectedNode !== undefined;
    const hasEdge = state.selectedEdge !== null && state.selectedEdge !== undefined;
    const hasCompanion = state.selectedCompanion !== null && state.selectedCompanion !== undefined;

    if (state.screen === 'start' || state.screen === 'paused') {
        if (state.gameViewPhase === 'setup') {
            renderGamePanelDeploy(panelEl, state);
        } else {
            renderGamePanelOverview(panelEl, state);
        }
    } else if (state.screen === 'complete') {
        // Complete screen can show CSPM/CloudSIEM panels via canvas buttons
        if (state.completeView === 'cspm') {
            renderGamePanelCSPM(panelEl, state);
        } else if (state.completeView === 'cloudsiem') {
            renderGamePanelCloudSIEM(panelEl, state);
        } else if (hasCompanion) {
            renderGamePanelCompanion(panelEl, state);
        } else if (hasNode) {
            renderGamePanelNode(panelEl, state);
        } else if (hasEdge) {
            renderGamePanelEdge(panelEl, state);
        } else {
            renderGamePanelComplete(panelEl, state);
        }
    } else if (state.screen === 'playing') {
        // Panel override from Lab Setup / Lab Overview buttons takes priority
        if (state.panelOverride === 'setup') {
            renderGamePanelDeploy(panelEl, state);
        } else if (state.panelOverride === 'overview') {
            renderGamePanelOverview(panelEl, state);
        } else if (state.gameViewPhase === 'setup') {
            renderGamePanelDeploy(panelEl, state);
        } else if (state.gameViewPhase === 'overview') {
            renderGamePanelOverview(panelEl, state);
        } else if (hasCompanion) {
            renderGamePanelCompanion(panelEl, state);
        } else if (hasNode) {
            renderGamePanelNode(panelEl, state);
        } else if (hasEdge) {
            renderGamePanelEdge(panelEl, state);
        } else {
            renderGamePanelOverview(panelEl, state);
        }
    }
}


// ---- Canvas Screen Renderers ----

function renderMapGame(ctx, w, h, state) {
    // Helper: apply pan/zoom transform for world-space map content
    function withViewTransform(fn) {
        ctx.save();
        ctx.translate(state.viewPanX, state.viewPanY);
        ctx.scale(state.viewZoom, state.viewZoom);
        fn();
        ctx.restore();
    }

    switch (state.screen) {
        case 'start':
            drawParchmentBackground(ctx, w, h, state.palette);
            drawCompassRose(ctx, w - 44, 44, 24, state.palette);
            drawStartOverlay(ctx, w, h, state);
            break;
        case 'playing':
            withViewTransform(() => {
                drawMapWithGameLabels(ctx, w, h, state);
                drawEdgeHopLabels(ctx, w, h, state);
            });
            drawPlayingHUD(ctx, w, h, state);  // HUD stays in screen space
            break;
        case 'paused':
            withViewTransform(() => {
                drawMapWithGameLabels(ctx, w, h, state);
            });
            drawPauseOverlay(ctx, w, h, state);
            break;
        case 'complete':
            withViewTransform(() => {
                drawMapWithGameLabels(ctx, w, h, state);
                drawEdgeHopLabels(ctx, w, h, state);
            });
            drawCompleteOverlay(ctx, w, h, state);
            break;
    }
}


// ---- Start Screen (canvas: just the "Begin Mission" button area) ----

function buildStartButtons(w, h, state) {
    const btnW = Math.min(280, w - 40);
    const btnH = 44;
    const sectionGap = 28;  // gap between the two sections
    const hasDeployData = !!(state.lab?.readme?.attackLab || state.lab?.terraform?.variableName);
    const btnX = (w - btnW) / 2;

    // Vertically stacked: deploy button first (if available), then begin mission
    // Text labels are drawn in drawStartOverlay, buttons positioned to sit below them
    const textBlockH = 32;  // height reserved for prompt text above button
    const textBtnGap = 6;   // gap between text and its button

    // Calculate layout starting Y - center the whole block
    const deployBlockH = hasDeployData ? (textBlockH + textBtnGap + btnH + sectionGap) : 0;
    const missionBlockH = textBlockH + textBtnGap + btnH;
    const totalH = deployBlockH + missionBlockH;
    const startY = (h - totalH) / 2;

    const buttons = [];
    let curY = startY;

    if (hasDeployData) {
        // Deploy text block is at curY, button below it
        curY += textBlockH + textBtnGap;
        buttons.push({
            id: 'deploy-lab',
            x: btnX, y: curY,
            w: btnW, h: btnH,
            label: 'Self-hosted Lab Deployment Instructions',
            style: 'primary',
            fontSize: 13,
            radius: 12,
            onClick: () => {
                state.gameViewPhase = state.gameViewPhase === 'setup' ? 'overview' : 'setup';
                state._redraw();
                updateGamePanel(state);
            }
        });
        curY += btnH + sectionGap;
    }

    // Mission text block is at curY, button below it
    curY += textBlockH + textBtnGap;
    buttons.push({
        id: 'start-mission',
        x: btnX, y: curY,
        w: btnW, h: btnH,
        label: 'Begin Mission',
        style: 'primary',
        fontSize: 15,
        radius: 12,
        onClick: () => {
            state.gameViewPhase = 'setup';
            state.screen = 'playing';
            state.selectedNode = null; // start on mission briefing, first Next goes to Startington
            state.selectedEdge = null;
            state.buttons = buildPlayingButtons(w, h, state);
            state._redraw();
            updateGamePanel(state);
        }
    });

    return buttons;
}

function drawStartOverlay(ctx, w, h, state) {
    const p = state.palette;

    ctx.textAlign = 'center';

    // Draw prompt text above each button
    const deployBtn = state.buttons.find(b => b.id === 'deploy-lab');
    const missionBtn = state.buttons.find(b => b.id === 'start-mission');

    if (deployBtn) {
        ctx.fillStyle = p.mutedText;
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Before you begin, install pathfinding-labs, configure your', w / 2, deployBtn.y - 18);
        ctx.fillText('AWS accounts, enable this lab, and deploy it:', w / 2, deployBtn.y - 4);
    }

    if (missionBtn) {
        ctx.fillStyle = p.mutedText;
        ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText('After you have reviewed the mission briefing:', w / 2, missionBtn.y - 4);
    }

    state.buttons.forEach(btn => drawThemedButton(ctx, btn, state.hoveredButton, state.activeButton, p));

    // Keyboard hint below last button
    const lastBtn = state.buttons[state.buttons.length - 1];
    ctx.fillStyle = p.mutedText;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Esc = Pause  |  T = Island style  |  P = Plane style  |  Click island = View details', w / 2, lastBtn.y + lastBtn.h + 24);

    // Highlight deploy button when active
    if (state.gameViewPhase === 'setup' && deployBtn) {
        ctx.strokeStyle = p.hudProgressFill || '#7c3aed';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, deployBtn.x - 2, deployBtn.y - 2, deployBtn.w + 4, deployBtn.h + 4, 14);
        ctx.stroke();
    }
}


// ---- Playing Screen ----

// Advance game state: edge-based progression
// Flow: overview -> start node -> hop 1 (edge) -> companion(s) on hop -> destination node -> hop 2 -> ...
function advanceGameState(w, h, state) {
    state.panelOverride = null; // clear any temporary panel switch
    const nextEdgeIdx = state.currentEdge + 1;

    // Phase transitions: setup -> overview -> navigation
    if (state.gameViewPhase === 'setup') {
        state.gameViewPhase = 'overview';
        state.selectedNode = null;
        state.selectedEdge = null;
        state.selectedCompanion = null;
        state.buttons = buildPlayingButtons(w, h, state);
        state._redraw();
        updateGamePanel(state);
        return;
    }
    if (state.gameViewPhase === 'overview') {
        state.gameViewPhase = 'navigation';
        state.selectedNode = 0;
        state.selectedEdge = null;
        state.selectedCompanion = null;
        state.buttons = buildPlayingButtons(w, h, state);
        state._redraw();
        updateGamePanel(state);
        return;
    }

    // At node 0 with no edges completed -> advance to first edge
    if (state.selectedNode === 0 && state.selectedEdge === null
        && state.selectedCompanion === null && state.currentEdge === -1
        && nextEdgeIdx < state.edges.length) {
        state.selectedNode = null;
        state.selectedCompanion = null;
        state.selectedEdge = nextEdgeIdx;
        state.buttons = buildPlayingButtons(w, h, state);
        state._redraw();
        updateGamePanel(state);
        return;
    }

    // If we're currently viewing a companion, advance to the next companion or destination node
    if (state.selectedCompanion !== null && state.selectedCompanion !== undefined) {
        const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(state.selectedCompanion));
        if (parentEdge) {
            const siblings = parentEdge.companionIndices;
            const pos = siblings.indexOf(state.selectedCompanion);
            if (pos < siblings.length - 1) {
                // More companions on this edge -- show next one
                state.selectedCompanion = siblings[pos + 1];
                state.selectedNode = null;
                state.selectedEdge = null;
            } else {
                // No more companions -- show destination node
                state.selectedCompanion = null;
                state.selectedNode = parentEdge.toIdx;
                state.selectedEdge = null;
            }
        }
        state.buttons = buildPlayingButtons(w, h, state);
        state._redraw();
        updateGamePanel(state);
        return;
    }

    // If we're currently viewing an edge, advance past it to companions or destination
    if (state.selectedEdge !== null && state.selectedEdge !== undefined) {
        const edge = state.edges[state.selectedEdge];
        if (edge) {
            state.currentNode = edge.toIdx;
            state.currentEdge = state.selectedEdge;
            state.selectedEdge = null;

            // Check for companions on this edge
            const companions = edge.companionIndices || [];
            if (companions.length > 0) {
                // Show first companion before the destination node
                state.selectedCompanion = companions[0];
                state.selectedNode = null;
            } else {
                state.selectedCompanion = null;
                state.selectedNode = edge.toIdx;
            }

            // If the next edge after this one is implicit, auto-advance through it
            const nextNext = state.currentEdge + 1;
            if (nextNext < state.edges.length && state.edges[nextNext].implicit) {
                // Show the implicit edge briefly -- user can click Next again to pass through
            }
        }
    } else if (nextEdgeIdx < state.edges.length) {
        // Show the next edge
        state.selectedNode = null;
        state.selectedCompanion = null;
        state.selectedEdge = nextEdgeIdx;
    }

    state.buttons = buildPlayingButtons(w, h, state);
    state._redraw();
    updateGamePanel(state);
}

function retreatGameState(w, h, state) {
    state.panelOverride = null; // clear any temporary panel switch

    // Phase transitions: overview -> setup, navigation at node 0 -> overview
    if (state.gameViewPhase === 'overview') {
        state.gameViewPhase = 'setup';
        state.selectedNode = null;
        state.selectedEdge = null;
        state.selectedCompanion = null;
        state.buttons = buildPlayingButtons(w, h, state);
        state._redraw();
        updateGamePanel(state);
        return;
    }
    if (state.gameViewPhase === 'navigation' && state.selectedNode === 0 && state.currentEdge === -1) {
        state.gameViewPhase = 'overview';
        state.selectedNode = null;
        state.selectedEdge = null;
        state.selectedCompanion = null;
        state.buttons = buildPlayingButtons(w, h, state);
        state._redraw();
        updateGamePanel(state);
        return;
    }

    // If viewing a companion, go back to previous companion or to the edge view
    if (state.selectedCompanion !== null && state.selectedCompanion !== undefined) {
        const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(state.selectedCompanion));
        if (parentEdge) {
            const siblings = parentEdge.companionIndices;
            const pos = siblings.indexOf(state.selectedCompanion);
            if (pos > 0) {
                // Previous companion on this edge
                state.selectedCompanion = siblings[pos - 1];
            } else {
                // Back to edge view
                const edgeIdx = state.edges.indexOf(parentEdge);
                state.selectedCompanion = null;
                state.selectedEdge = edgeIdx;
                state.selectedNode = null;
                state.currentNode = parentEdge.fromIdx;
                state.currentEdge = edgeIdx - 1;
            }
        }
    } else if (state.selectedEdge !== null && state.selectedEdge !== undefined) {
        // Viewing an edge (not yet completed) -- go back to viewing the source node
        const edge = state.edges[state.selectedEdge];
        state.selectedEdge = null;
        state.selectedCompanion = null;
        state.selectedNode = edge ? edge.fromIdx : 0;
    } else if (state.selectedNode !== null && state.currentEdge >= 0) {
        // Currently viewing a destination node -- go back to the last companion of this edge, or to the edge
        const lastEdge = state.edges[state.currentEdge];
        if (lastEdge) {
            const companions = lastEdge.companionIndices || [];
            if (companions.length > 0) {
                // Go to last companion on this edge
                state.selectedCompanion = companions[companions.length - 1];
                state.selectedNode = null;
            } else {
                // No companions -- go back to edge view
                state.selectedEdge = state.currentEdge;
                state.selectedNode = null;
                state.selectedCompanion = null;
                state.currentNode = lastEdge.fromIdx;
                state.currentEdge = state.currentEdge - 1;
            }
        }
    }

    state.buttons = buildPlayingButtons(w, h, state);
    state._redraw();
    updateGamePanel(state);
}

function buildPlayingButtons(w, h, state) {
    const barH = 40;
    const btnH = 32;
    const gap = 8;
    const barY = h - barH - 6;
    const btnY = barY + (barH - btnH) / 2;

    // Navigation complete when we've stepped through everything to the final node
    const hasCompanionSelected = state.selectedCompanion !== null && state.selectedCompanion !== undefined;
    const allRevealed = state.currentEdge >= state.edges.length - 1
        && !hasCompanionSelected
        && state.selectedNode === state.nodes.length - 1;

    // Can go back from current position (not at very first view)
    const canGoBack = state.gameViewPhase !== 'setup';

    // Next is disabled when at the final node with all revealed
    const canGoNext = !allRevealed;

    // --- Top bar buttons (menu + switch mode) ---
    const menuBtn = {
        id: 'menu',
        x: 10, y: 8,
        w: 34, h: 30,
        label: '=',
        style: 'ghost',
        fontSize: 18,
        radius: 6,
        onClick: () => { openGameMenu(state); }
    };

    const switchGuidedW = 185;
    const switchGuidedBtn = {
        id: 'switch-guided',
        x: w - switchGuidedW - 14, y: 7,
        w: switchGuidedW, h: 28,
        label: 'Switch to Single Page Mode',
        style: 'secondary',
        fontSize: 11,
        radius: 6,
        onClick: () => { switchDetailMode('guidedv2', state.lab); }
    };

    // --- Bottom bar: fixed 5-button layout ---
    // [Lab Setup][Lab Overview]          [Back][Next]          [Finish Mission]
    //  ^-- left edge padded              ^-- centered           ^-- right edge padded
    const setupW = 90;
    const overviewW = 110;
    const backW = 70;
    const nextW = 70;
    const finishW = 125;
    const edgePad = 14; // padding from bar edges

    // Center Back/Next in the middle of the bar
    const centerGroupW = backW + gap + nextW;
    const backX = (w - centerGroupW) / 2;
    const nextX = backX + backW + gap;

    // Left group: halfway between edge padding and the center group
    const leftGroupW = setupW + gap + overviewW;
    const leftGroupX = edgePad + (backX - edgePad - leftGroupW) / 2;
    const labSetupX = leftGroupX;
    const labOverviewX = labSetupX + setupW + gap;

    // Right group: halfway between center group and the right edge
    const centerRightEdge = nextX + nextW;
    const rightEdge = w - edgePad;
    const finishX = centerRightEdge + (rightEdge - centerRightEdge - finishW) / 2;

    const buttons = [menuBtn, switchGuidedBtn];

    // Reset View button (only visible when panned or zoomed)
    const viewIsTransformed = state.viewZoom !== 1 || state.viewPanX !== 0 || state.viewPanY !== 0;
    if (viewIsTransformed) {
        buttons.push({
            id: 'reset-view',
            x: 50, y: 8,
            w: 80, h: 30,
            label: 'Reset View',
            style: 'ghost',
            fontSize: 11,
            radius: 6,
            onClick: () => {
                state.viewPanX = 0;
                state.viewPanY = 0;
                state.viewZoom = 1;
                state.buttons = buildPlayingButtons(w, h, state);
                state._redraw();
            }
        });
    }

    // Lab Setup button -- shows deploy instructions panel without changing navigation position
    buttons.push({
        id: 'lab-setup',
        x: labSetupX, y: btnY,
        w: setupW, h: btnH,
        label: 'Lab Setup',
        style: 'secondary',
        fontSize: 12,
        radius: 8,
        onClick: () => {
            state.panelOverride = state.panelOverride === 'setup' ? null : 'setup';
            state.completeView = null;
            state._redraw();
            updateGamePanel(state);
        }
    });

    // Lab Overview button -- shows mission briefing panel without changing navigation position
    buttons.push({
        id: 'lab-overview',
        x: labOverviewX, y: btnY,
        w: overviewW, h: btnH,
        label: 'Lab Overview',
        style: 'secondary',
        fontSize: 12,
        radius: 8,
        onClick: () => {
            state.panelOverride = state.panelOverride === 'overview' ? null : 'overview';
            state.completeView = null;
            state._redraw();
            updateGamePanel(state);
        }
    });

    // Back button (disabled at setup phase)
    buttons.push({
        id: 'back',
        x: backX, y: btnY,
        w: backW, h: btnH,
        label: 'Back',
        style: 'secondary',
        fontSize: 12,
        radius: 8,
        disabled: !canGoBack,
        onClick: () => { retreatGameState(w, h, state); }
    });

    // Next button (disabled at final node)
    buttons.push({
        id: 'next-step',
        x: nextX, y: btnY,
        w: nextW, h: btnH,
        label: 'Next',
        style: 'primary',
        fontSize: 12,
        radius: 8,
        disabled: !canGoNext,
        onClick: () => { advanceGameState(w, h, state); }
    });

    // Finish Mission button (disabled until all revealed)
    buttons.push({
        id: 'finish-mission',
        x: finishX, y: btnY,
        w: finishW, h: btnH,
        label: 'Finish Mission',
        style: 'primary',
        fontSize: 13,
        radius: 8,
        disabled: !allRevealed,
        onClick: () => {
            state.screen = 'complete';
            state.selectedNode = null;
            state.selectedEdge = null;
            state.buttons = buildCompleteButtons(w, h, state);
            state._redraw();
            updateGamePanel(state);
        }
    });

    return buttons;
}

function drawPlayingHUD(ctx, w, h, state) {
    const p = state.palette;
    const totalEdges = state.edges.length;
    const completedEdges = state.revealedEdges.size;

    // -- Top bar --
    const topH = 36;
    drawRoundedRect(ctx, 6, 4, w - 12, topH, 8);
    ctx.fillStyle = p.hudBg;
    ctx.fill();
    ctx.strokeStyle = p.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Top bar buttons (menu left, reset-view, switch-guided right)
    const topBarBtnIds = new Set(['menu', 'reset-view', 'switch-guided']);
    state.buttons.forEach(btn => {
        if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton, state.activeButton, p);
    });

    // "Pathfinding.cloud Labs" label left of hamburger menu (after the menu button)
    const menuBtnRight = 10 + 34 + 6; // menuBtn.x + menuBtn.w + gap
    ctx.fillStyle = p.hudText;
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.9;
    ctx.fillText('Pathfinding.cloud Labs', menuBtnRight, 22);
    ctx.globalAlpha = 1;

    // Scenario name in center of top bar
    const scenarioName = state.lab?.displayName || state.lab?.name || '';
    if (scenarioName) {
        // Measure available center space (between the left label area and right buttons)
        const switchBtn = state.buttons.find(b => b.id === 'switch-guided');
        const rightEdge = switchBtn ? switchBtn.x - 8 : w - 210;
        const leftEdge = menuBtnRight + ctx.measureText('Pathfinding.cloud Labs').width + 16;
        const centerX = (leftEdge + rightEdge) / 2;

        ctx.fillStyle = p.hudText;
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Truncate if too wide
        const maxWidth = rightEdge - leftEdge - 16;
        let label = scenarioName;
        while (label.length > 4 && ctx.measureText(label).width > maxWidth) {
            label = label.slice(0, -1);
        }
        if (label !== scenarioName) label = label.trimEnd() + '…';
        ctx.fillText(label, centerX, 22);
    }

    // (Hop labels are now drawn in world-space inside renderMapGame's transform block)

    // -- Bottom action bar --
    const barH = 40;
    const barY = h - barH - 6;
    drawRoundedRect(ctx, 6, barY, w - 12, barH, 8);
    ctx.fillStyle = p.hudBg;
    ctx.fill();
    ctx.strokeStyle = p.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Bottom bar buttons (everything except top bar buttons)
    state.buttons.forEach(btn => {
        if (!topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton, state.activeButton, p);
    });
}

// Draw "Hop N" labels at the midpoint of each edge on the map
function drawEdgeHopLabels(ctx, w, h, state) {
    const p = state.palette;
    const { positions, edges, revealed, revealedEdges } = state;
    let hopCounter = 0;

    // Store hop label positions for hit-testing
    state._hopLabelRects = [];

    for (let ei = 0; ei < edges.length; ei++) {
        const edge = edges[ei];
        if (!edge.implicit) hopCounter++;

        // Only show label if source node is revealed
        if (!revealed.has(edge.fromIdx)) continue;

        const a = positions[edge.fromIdx];
        const b = positions[edge.toIdx];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;

        const isVisited = ei <= state.currentEdge;
        const isActive = state.selectedEdge === ei;
        const label = edge.implicit ? 'Auto' : `Hop ${hopCounter}`;

        ctx.save();
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
        const tw = ctx.measureText(label).width;
        const pw = tw + 14;
        const ph = 20;
        const px = mx - pw / 2;
        const py = my - ph / 2;

        // Store rect for hit-testing
        state._hopLabelRects.push({ x: px, y: py, w: pw, h: ph, edgeIdx: ei });

        // Background
        drawRoundedRect(ctx, px, py, pw, ph, 5);
        if (isActive) {
            ctx.fillStyle = p.hudProgressFill;
            ctx.fill();
        } else if (isVisited) {
            ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.9)';
            ctx.fill();
            ctx.strokeStyle = p.accentGreen;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else {
            ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.85)';
            ctx.fill();
            ctx.strokeStyle = p.borderDecor || 'rgba(120, 80, 20, 0.3)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }

        // Text
        ctx.fillStyle = isActive ? '#fff' : isVisited ? p.accentGreen : (p.bodyText || '#5a4a2a');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, my);
        ctx.restore();
    }
}


// ---- Pause Overlay ----

// ---- HTML Game Menu (shown over canvas when paused) ----

function getMenuItems(state) {
    if (state.menuView === 'keybindings') {
        return [{ id: 'back', label: 'Back to Menu', style: 'secondary' }];
    }
    return [
        { id: 'resume',      label: 'Resume Mission',      style: 'primary' },
        { separator: true },
        { id: 'demo',        label: 'Run Simulated Demo',  style: 'secondary', stub: !state?.lab?.hasDemoTranscript },
        { id: 'all-labs',    label: 'View All Labs',       style: 'secondary' },
        { id: 'keybindings', label: 'Show Keybindings',    style: 'secondary' },
        { separator: true },
        { id: 'restart',     label: 'Restart',             style: 'secondary' },
        { id: 'exit',        label: 'Exit to Lab List',    style: 'danger' },
    ];
}

// Returns the filtered lab list for the browser based on current search string.
function getFilteredBrowserLabs(state) {
    const q = (state.labsBrowserFilter || '').trim().toLowerCase();
    const labs = state.labsBrowserLabs || [];
    if (!q) return labs;
    return labs.filter(l =>
        (l.displayName || l.name || '').toLowerCase().includes(q) ||
        (l.category || '').toLowerCase().includes(q)
    );
}

function getFocusableMenuItems(state) {
    if (state.menuView === 'labs-browser') {
        const labs = getFilteredBrowserLabs(state);
        return [
            { id: 'back' },
            ...labs.map(l => ({ id: `lab-${l.slug}`, slug: l.slug })),
        ];
    }
    return getMenuItems(state).filter(item => !item.separator && !item.stub);
}

// Start loading the labs index and show the labs-browser menu view.
function loadLabsBrowser(state) {
    state.menuView = 'labs-browser';
    state.menuFocusIdx = 0;
    state.labsBrowserFilter = '';
    renderGameMenu(state);
    if (state.labsBrowserLabs !== null) return; // already loaded
    fetchLabsIndex()
        .then(allLabs => {
            // Only show labs that have an attack map (i.e. can be played)
            state.labsBrowserLabs = allLabs.filter(l => l.hasAttackMap);
            if (state.menuView === 'labs-browser') {
                state.menuFocusIdx = 0;
                renderGameMenu(state);
            }
        })
        .catch(() => {
            if (state.menuView === 'labs-browser') {
                state.labsBrowserLabs = [];
                renderGameMenu(state);
            }
        });
}

// Switch the current game container to a different lab.
async function switchToLab(slug, state) {
    const menuEl = state._menuEl;
    const container = state._container;

    // Show a loading indicator while we fetch
    if (menuEl) {
        const dialog = menuEl.querySelector('.mg-menu-dialog');
        if (dialog) dialog.innerHTML = '<div class="mg-labs-switching">Loading lab\u2026</div>';
    }

    try {
        const fullLab = await fetchLabDetailForGame(slug);

        // Remove the old game's document-level event listeners before wiping the DOM
        const oldCanvas = container?.querySelector('canvas.mg-canvas');
        if (oldCanvas?._mapGameCleanup) oldCanvas._mapGameCleanup();

        // Update the browser URL
        history.pushState(null, '', `/labs/${slug}`);

        // Re-render the game container with the new lab — this wipes the old
        // canvas (and menu overlay) and sets up a fresh game after a short delay.
        renderLabDetailContentMapGame(fullLab, container);
    } catch (_err) {
        // On failure, return to the labs browser so the user can try again
        if (state._menuEl) {
            state.menuView = 'labs-browser';
            renderGameMenu(state);
        }
    }
}

// Load and display the demo transcript overlay for the current lab.
async function loadDemoTranscript(state) {
    const slug = state.lab?.slug;
    if (!slug) return;
    state.menuView = 'demo-transcript';
    state.transcriptText = null; // null = loading
    renderGameMenu(state);

    if (_gameTranscriptCache[slug] === undefined) {
        try {
            const resp = await fetch(`/labs/demos/${slug}.txt`);
            if (!resp.ok) throw new Error('not found');
            _gameTranscriptCache[slug] = await resp.text();
        } catch (_) {
            _gameTranscriptCache[slug] = '\x1b[0;31mTranscript not available for this lab.\x1b[0m\n';
        }
    }
    state.transcriptText = _gameTranscriptCache[slug];
    if (state.menuView === 'demo-transcript') {
        renderGameMenu(state);
    }
}

function renderGameMenu(state) {
    const menuEl = state._menuEl;
    if (!menuEl) return;

    let html = '';

    if (state.menuView === 'labs-browser') {
        // ----- Labs browser view -----
        const focusable = getFocusableMenuItems(state); // [{id:'back'}, {id:'lab-slug', slug}...]
        const focusedId = focusable[state.menuFocusIdx]?.id;
        const filteredLabs = getFilteredBrowserLabs(state);

        html = '<div class="mg-menu-dialog mg-labs-dialog">';
        html += '<div class="mg-menu-brand">Pathfinding.cloud Labs</div>';
        html += '<div class="mg-menu-title">All Labs</div>';
        html += '<div class="mg-menu-separator" style="margin-top:0;margin-bottom:8px;"></div>';

        // Search input
        html += '<div class="mg-labs-search-wrap">';
        html += `<input type="text" class="mg-labs-search-input" placeholder="Filter labs\u2026" value="${escapeHtmlGame(state.labsBrowserFilter || '')}" autocomplete="off" spellcheck="false">`;
        html += '</div>';

        // Labs list
        html += '<div class="mg-labs-list">';
        if (state.labsBrowserLabs === null) {
            html += '<div class="mg-labs-loading">Loading\u2026</div>';
        } else if (filteredLabs.length === 0) {
            html += '<div class="mg-labs-empty">No labs found</div>';
        } else {
            for (const lab of filteredLabs) {
                const itemId = `lab-${lab.slug}`;
                const focused = itemId === focusedId ? 'mg-menu-focused' : '';
                const labLabel = escapeHtmlGame(lab.displayName || lab.name || lab.slug);
                const catLabel = escapeHtmlGame(lab.category || '');
                html += `<div class="mg-lab-item ${focused}" data-slug="${escapeHtmlGame(lab.slug)}">`;
                html += `<div class="mg-lab-item-name">${labLabel}</div>`;
                if (catLabel) html += `<div class="mg-lab-item-meta"><span class="mg-lab-category-badge">${catLabel}</span></div>`;
                html += '</div>';
            }
        }
        html += '</div>'; // mg-labs-list

        html += '<div class="mg-menu-separator" style="margin-bottom:6px;"></div>';
        html += '<div class="mg-menu-items">';
        const backFocused = focusedId === 'back' ? 'mg-menu-focused' : '';
        html += `<button class="mg-menu-item ${backFocused}" data-menu-id="back">Back to Menu</button>`;
        html += '</div>';
        html += '</div>'; // mg-labs-dialog

    } else if (state.menuView === 'demo-transcript') {
        // ----- Demo transcript viewer -----
        const transcriptHtml = state.transcriptText !== null
            ? ansiToHtml(state.transcriptText)
            : '<span class="ansi-dim">Loading\u2026</span>';

        html = '<div class="mg-menu-dialog mg-transcript-dialog" style="background:#000!important;border-color:rgba(255,255,255,0.15);">';
        html += '<div class="mg-transcript-header" style="background:#111;border-bottom:1px solid rgba(255,255,255,0.12);color:#fff;">';
        html += `<span style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#f0b040;">${escapeHtmlGame(state.lab?.name || 'Demo Transcript')}</span>`;
        html += '<button class="mg-transcript-close" aria-label="Close" style="color:rgba(255,255,255,0.5);">&times;</button>';
        html += '</div>';
        html += `<pre class="mg-transcript-pre" style="background:#000;color:#e0e0e0;">${transcriptHtml}</pre>`;
        html += '<div class="mg-transcript-footer" style="background:#111;border-top:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.45);">';
        html += '<span class="mg-key-badge">&uarr;&darr;</span> Scroll &nbsp;';
        html += '<span class="mg-key-badge">&larr;&rarr;</span> Side-scroll &nbsp;';
        html += '<span class="mg-key-badge">Esc</span> Close';
        html += '</div>';
        html += '</div>'; // mg-transcript-dialog

    } else {
        // ----- Main menu + keybindings views -----
        const items = getMenuItems(state);
        const focusableItems = items.filter(item => !item.separator && !item.stub);
        const focusedId = focusableItems[state.menuFocusIdx]?.id;

        html = '<div class="mg-menu-dialog">';

        if (state.menuView === 'keybindings') {
            html += '<div class="mg-menu-title">Keybindings</div>';
            html += '<div class="mg-menu-separator" style="margin-top:0;margin-bottom:10px;"></div>';
            html += '<div class="mg-keybindings-section">';
            const groups = [
                {
                    label: 'Gameplay',
                    rows: [
                        { keys: ['&#8592; &#8594;'], desc: 'Back / Next step' },
                        { keys: ['A'],               desc: 'Reveal next hint' },
                        { keys: ['D'],               desc: 'View simulated demo (&#8592;&#8594; side-scroll)' },
                    ],
                },
                {
                    label: 'Visuals',
                    rows: [
                        { keys: ['V'], desc: 'Cycle companion style' },
                        { keys: ['I'], desc: 'Cycle icon style' },
                        { keys: ['T'], desc: 'Cycle island style' },
                        { keys: ['P'], desc: 'Cycle plane style' },
                        { keys: ['R'], desc: 'Reset view' },
                    ],
                },
                {
                    label: 'Menu',
                    rows: [
                        { keys: ['Esc'],             desc: 'Open / close menu' },
                        { keys: ['&#8593; &#8595;'], desc: 'Navigate items' },
                        { keys: ['A', 'Enter'],      desc: 'Select item' },
                        { keys: ['&#8592;', 'Esc'],  desc: 'Back / close' },
                    ],
                },
            ];
            for (const group of groups) {
                html += `<div class="mg-keybindings-group-label">${group.label}</div>`;
                for (const row of group.rows) {
                    const keyBadges = row.keys.map(k => `<span class="mg-key-badge">${k}</span>`).join(' ');
                    html += `<div class="mg-keybindings-row"><span class="mg-keybindings-keys">${keyBadges}</span><span>${row.desc}</span></div>`;
                }
            }
            html += '</div>';
        } else {
            const labName = state.lab?.name || '';
            html += '<div class="mg-menu-brand">Pathfinding.cloud Labs</div>';
            if (labName) html += `<div class="mg-menu-lab-name">${escapeHtmlGame(labName)}</div>`;
            html += '<div class="mg-menu-separator" style="margin-top:0;margin-bottom:10px;"></div>';
        }

        html += '<div class="mg-menu-items">';
        for (const item of items) {
            if (item.separator) { html += '<div class="mg-menu-separator"></div>'; continue; }
            const focusedClass = item.id === focusedId ? 'mg-menu-focused' : '';
            const styleClass   = item.style === 'primary' ? 'mg-menu-primary'
                               : item.style === 'danger'  ? 'mg-menu-danger' : '';
            const disabledAttr = item.stub ? 'disabled' : '';
            html += `<button class="mg-menu-item ${styleClass} ${focusedClass}" data-menu-id="${item.id}" ${disabledAttr}>${escapeHtmlGame(item.label)}</button>`;
        }
        html += '</div></div>';
    }

    menuEl.innerHTML = html;

    // Attach click handlers for regular menu buttons
    menuEl.querySelectorAll('.mg-menu-item:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => activateMenuItem(btn.dataset.menuId, state));
    });

    // Demo transcript: close button
    if (state.menuView === 'demo-transcript') {
        menuEl.querySelector('.mg-transcript-close')?.addEventListener('click', () => closeGameMenu(state));
    }

    // Labs browser: lab item click handlers + search input handler
    if (state.menuView === 'labs-browser') {
        menuEl.querySelectorAll('.mg-lab-item[data-slug]').forEach(el => {
            el.addEventListener('click', () => switchToLab(el.dataset.slug, state));
        });
        const searchInput = menuEl.querySelector('.mg-labs-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                state.labsBrowserFilter = searchInput.value;
                state.menuFocusIdx = 0;
                renderGameMenu(state);
                // Re-focus and restore cursor after the full re-render
                const newInput = state._menuEl?.querySelector('.mg-labs-search-input');
                if (newInput) { newInput.focus(); const l = newInput.value.length; newInput.setSelectionRange(l, l); }
            });
        }
    }
}

function activateMenuItem(itemId, state) {
    const w = state._w;
    const h = state._h;
    switch (itemId) {
        case 'resume':
            closeGameMenu(state);
            break;
        case 'back':
            state.menuView = 'main';
            state.menuFocusIdx = 0;
            renderGameMenu(state);
            break;
        case 'demo':
            loadDemoTranscript(state);
            break;
        case 'all-labs':
            loadLabsBrowser(state);
            break;
        case 'keybindings':
            state.menuView = 'keybindings';
            state.menuFocusIdx = 0;
            renderGameMenu(state);
            break;
        case 'restart':
            closeGameMenu(state);
            state.revealed = new Set(state.nodes.map((_, i) => i));
            state.currentNode = 0;
            state.currentEdge = -1;
            state.revealedEdges = new Set(state.edges.map((_, i) => i));
            state.revealedCommands = new Set();
            state.selectedNode = null;
            state.selectedEdge = null;
            state.completeView = null;
            state.gameViewPhase = 'setup';
            state.panelOverride = null;
            state.hintsUsed = 0;
            state.revealedHints = {};
            state._redraw();
            updateGamePanel(state);
            break;
        case 'exit':
            navigateToList();
            break;
    }
}

function openGameMenu(state) {
    state.screen = 'paused';
    state.menuView = 'main';
    state.menuFocusIdx = 0;
    state.buttons = [];
    // Push the game palette into the menu overlay as CSS custom properties so
    // the menu dialog matches the canvas HUD colors (parchment / dark) instead
    // of the site's generic --card-background (which is white in light mode).
    if (state._menuEl) {
        const p = state.palette;
        const el = state._menuEl;
        el.style.setProperty('--game-hud-bg',         p.hudBg);
        el.style.setProperty('--game-hud-border',      p.hudBorder);
        el.style.setProperty('--game-hud-text',        p.hudText);
        el.style.setProperty('--game-hud-text-muted',  p.hudTextMuted);
        el.style.setProperty('--game-accent',          p.accentGold);
        el.style.setProperty('--game-accent-focus',    p.hudProgressFill);
        el.style.setProperty('--game-separator',       p.separator);
        el.style.setProperty('--game-danger',          p.typeTintPrincipal);
    }
    renderGameMenu(state);
    if (state._menuEl) state._menuEl.classList.add('visible');
    state._redraw();
    updateGamePanel(state);
}

function closeGameMenu(state) {
    const w = state._w;
    const h = state._h;
    state.screen = 'playing';
    if (state._menuEl) state._menuEl.classList.remove('visible');
    state.buttons = buildPlayingButtons(w, h, state);
    state._redraw();
    updateGamePanel(state);
}

function buildPauseButtons(w, h, state) {
    // Pause menu is now rendered as HTML via renderGameMenu(); no canvas buttons needed.
    return [];
}

function drawPauseOverlay(ctx, w, h, state) {
    // Dim the map behind the HTML menu overlay.
    const p = state.palette;
    ctx.fillStyle = p.overlayBg;
    ctx.fillRect(0, 0, w, h);
}


// ---- Complete Overlay ----

function buildCompleteButtons(w, h, state) {
    const btnW = Math.min(240, w - 40);
    const smallBtnW = Math.min(220, w - 40);
    const btnH = 42;
    const smallBtnH = 38;
    const gap = 16;

    // Layout: vertically stacked, centered
    const baseY = h * 0.48;
    const btnX = (w - btnW) / 2;
    const smallBtnX = (w - smallBtnW) / 2;

    const cspm = state.lab?.readme?.defend?.cspm || state.lab?.readme?.cspm;
    const cloudSiem = state.lab?.readme?.defend?.cloudSiem || state.lab?.readme?.cloudSiem;
    const hasCSPM = !!cspm?.whatToDetect;
    const hasCloudSIEM = !!(cloudSiem?.cloudTrailEvents);

    const buttons = [
        {
            id: 'play-again', x: btnX, y: baseY,
            w: btnW, h: btnH, label: 'Play Again',
            style: 'primary', fontSize: 15, radius: 12,
            onClick: () => {
                state.revealed = new Set(state.nodes.map((_, i) => i));
                state.currentNode = 0;
                state.currentEdge = -1;
                state.revealedEdges = new Set(state.edges.map((_, i) => i));
                state.revealedCommands = new Set();
                state.selectedNode = null;
                state.selectedEdge = null;
                state.completeView = null;
                state.gameViewPhase = 'setup';
                state.panelOverride = null;
                state.hintsUsed = 0;
                state.revealedHints = {};
                state.screen = 'playing';
                state.buttons = buildPlayingButtons(w, h, state);
                state._redraw();
                updateGamePanel(state);
            }
        },
    ];

    let nextY = baseY + btnH + gap;

    if (hasCSPM) {
        buttons.push({
            id: 'show-cspm', x: smallBtnX, y: nextY,
            w: smallBtnW, h: smallBtnH, label: 'Detected with CSPM?',
            style: 'secondary', fontSize: 12, radius: 10,
            onClick: () => {
                state.selectedNode = null;
                state.selectedEdge = null;
                state.completeView = state.completeView === 'cspm' ? null : 'cspm';
                state._redraw();
                updateGamePanel(state);
            }
        });
        nextY += smallBtnH + gap;
    }

    if (hasCloudSIEM) {
        buttons.push({
            id: 'show-cloudsiem', x: smallBtnX, y: nextY,
            w: smallBtnW, h: smallBtnH, label: 'Detected with CloudSIEM?',
            style: 'secondary', fontSize: 12, radius: 10,
            onClick: () => {
                state.selectedNode = null;
                state.selectedEdge = null;
                state.completeView = state.completeView === 'cloudsiem' ? null : 'cloudsiem';
                state._redraw();
                updateGamePanel(state);
            }
        });
        nextY += smallBtnH + gap;
    }

    // Share row 1: Download + LinkedIn (primary share target)
    const shareRowGap = 10;
    const shareBtnW = Math.floor((smallBtnW - shareRowGap) / 2);
    buttons.push({
        id: 'download-map', x: smallBtnX, y: nextY,
        w: shareBtnW, h: smallBtnH, label: 'Download Map',
        style: 'secondary', fontSize: 11, radius: 10,
        onClick: () => {
            const offscreen = buildCleanMapCanvas(w, h, state);
            if (offscreen) labShareAction('download', offscreen, state.lab);
        }
    });
    buttons.push({
        id: 'share-linkedin', x: smallBtnX + shareBtnW + shareRowGap, y: nextY,
        w: shareBtnW, h: smallBtnH, label: 'Share on LinkedIn',
        style: 'secondary', fontSize: 11, radius: 10,
        onClick: () => {
            const offscreen = buildCleanMapCanvas(w, h, state);
            labShareAction('linkedin', offscreen, state.lab);
        }
    });
    nextY += smallBtnH + gap;

    // Share row 2: X, Bluesky, Mastodon
    const socialGap = 6;
    const socialBtnW = Math.floor((smallBtnW - socialGap * 2) / 3);
    buttons.push({
        id: 'share-twitter', x: smallBtnX, y: nextY,
        w: socialBtnW, h: smallBtnH, label: 'X',
        style: 'secondary', fontSize: 11, radius: 10,
        onClick: () => {
            const offscreen = buildCleanMapCanvas(w, h, state);
            labShareAction('twitter', offscreen, state.lab);
        }
    });
    buttons.push({
        id: 'share-bluesky', x: smallBtnX + socialBtnW + socialGap, y: nextY,
        w: socialBtnW, h: smallBtnH, label: 'Bluesky',
        style: 'secondary', fontSize: 11, radius: 10,
        onClick: () => {
            const offscreen = buildCleanMapCanvas(w, h, state);
            labShareAction('bluesky', offscreen, state.lab);
        }
    });
    buttons.push({
        id: 'share-mastodon', x: smallBtnX + (socialBtnW + socialGap) * 2, y: nextY,
        w: socialBtnW, h: smallBtnH, label: 'Mastodon',
        style: 'secondary', fontSize: 11, radius: 10,
        onClick: () => {
            const offscreen = buildCleanMapCanvas(w, h, state);
            labShareAction('mastodon', offscreen, state.lab);
        }
    });
    nextY += smallBtnH + gap;

    buttons.push({
        id: 'no-gamification', x: smallBtnX, y: nextY,
        w: smallBtnW, h: smallBtnH, label: 'View as Single Page',
        style: 'secondary', fontSize: 12, radius: 10,
        onClick: () => { switchDetailMode('guidedv2', state.lab); }
    });

    return buttons;
}

function drawCompleteOverlay(ctx, w, h, state) {
    const p = state.palette;
    // Subtle dark overlay so map is dimmed
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = p.accentGold;
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MISSION COMPLETE', w / 2, h * 0.15);

    // Lab name
    ctx.fillStyle = p.hudText;
    ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(state.lab?.name || '', w / 2, h * 0.23);

    // Stats row
    const totalEdges = state.edges.length;
    const stats = [
        { label: 'HOPS', value: `${totalEdges}/${totalEdges}` },
        { label: 'HINTS', value: String(state.hintsUsed) },
    ];
    const statW = 90;
    const totalStatW = stats.length * statW;
    const statStartX = (w - totalStatW) / 2;
    const statY = h * 0.34;

    stats.forEach((stat, i) => {
        const sx = statStartX + i * statW + statW / 2;
        ctx.fillStyle = p.hudTextMuted;
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(stat.label, sx, statY);
        ctx.fillStyle = p.hudText;
        ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(stat.value, sx, statY + 26);
        if (i < stats.length - 1) {
            ctx.strokeStyle = p.separator;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(sx + statW / 2, statY - 6);
            ctx.lineTo(sx + statW / 2, statY + 36);
            ctx.stroke();
        }
    });

    state.buttons.forEach(btn => drawThemedButton(ctx, btn, state.hoveredButton, state.activeButton, p));

    // Highlight the active detection button
    const activeId = state.completeView === 'cspm' ? 'show-cspm' : state.completeView === 'cloudsiem' ? 'show-cloudsiem' : null;
    if (activeId) {
        const activeBtn = state.buttons.find(b => b.id === activeId);
        if (activeBtn) {
            ctx.strokeStyle = p.hudProgressFill || '#7c3aed';
            ctx.lineWidth = 2;
            drawRoundedRect(ctx, activeBtn.x - 2, activeBtn.y - 2, activeBtn.w + 4, activeBtn.h + 4, 12);
            ctx.stroke();
        }
    }
}


// ---- Entry Points ----

function parseAttackMapToGameNodes(attackMap) {
    if (!attackMap?.nodes?.length || !attackMap?.edges?.length) return { nodes: [], edges: [], companions: [] };
    const typeMap = {
        'principal': { type: 'principal', label: 'Principal', cssClass: 'ov-type-principal' },
        'resource':  { type: 'resource',  label: 'Resource',  cssClass: 'ov-type-resource' },
        'target':    { type: 'target',    label: 'Target',    cssClass: 'ov-type-target' },
        'payload':   { type: 'payload',   label: 'Payload',   cssClass: 'ov-type-payload' },
        'outcome':   { type: 'outcome',   label: 'Outcome',   cssClass: 'ov-type-outcome' },
    };
    const nodeById = new Map(attackMap.nodes.map(n => [n.id, n]));
    const incomingCount = {};
    attackMap.nodes.forEach(n => { incomingCount[n.id] = 0; });
    attackMap.edges.forEach(e => { incomingCount[e.to] = (incomingCount[e.to] || 0) + 1; });
    let rootId = attackMap.nodes.find(n => incomingCount[n.id] === 0)?.id;
    if (!rootId) rootId = attackMap.nodes[0].id;

    // First pass: walk the linear chain to get ordered raw nodes and edges
    const rawChain = []; // { nodeData, outEdge }
    const visited = new Set();
    let currentId = rootId;
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const nodeData = nodeById.get(currentId);
        if (!nodeData) break;
        const outEdge = attackMap.edges.find(e => e.from === currentId && !visited.has(e.to));
        rawChain.push({ nodeData, outEdge });
        currentId = outEdge ? outEdge.to : null;
    }

    // Second pass: collapse principal -> resource -> principal into companion nodes.
    // Walk chain entries: if a node is a resource sandwiched between two principals,
    // collapse it into a companion attached to the merged edge.
    const orderedNodes = [];
    const gameEdges = [];
    const companions = [];

    function makeGameNode(nd) {
        return {
            label: nd.label || nd.id,
            type: typeMap[nd.type] || { type: nd.type || 'unknown', label: nd.type || 'Node', cssClass: 'ov-type-unknown' },
            description: (nd.description || '').trim(),
            hints: nd.hints || [],
            arn: nd.arn || '',
            subType: nd.subType || '',
            access: nd.access || null,
        };
    }

    // Helper: create a companion object from a raw node and its outgoing edge
    function makeCompanion(nd, outEdge) {
        return {
            label: nd.label || nd.id,
            type: typeMap[nd.type] || { type: 'resource', label: 'Resource', cssClass: 'ov-type-resource' },
            description: (nd.description || '').trim(),
            arn: nd.arn || '',
            subType: nd.subType || '',
            edgeLabel: outEdge?.label || '',
            edgeDescription: (outEdge?.description || '').trim(),
        };
    }

    let i = 0;
    while (i < rawChain.length) {
        const { nodeData, outEdge } = rawChain[i];

        // Check for principal -> resource(s) -> principal pattern
        // Collapse one or two resource nodes between principals into companions
        if (outEdge && i + 2 < rawChain.length) {
            const nextEntry = rawChain[i + 1];
            const nextIsResource = nextEntry.nodeData.type === 'resource';

            if (nextIsResource) {
                // Check for principal -> resource -> resource -> principal (two resources)
                if (i + 3 < rawChain.length) {
                    const nextNextEntry = rawChain[i + 2];
                    const nextNextNextEntry = rawChain[i + 3];
                    if (nextNextEntry.nodeData.type === 'resource' && nextNextNextEntry.nodeData.type === 'principal') {
                        // Collapse both resources into companions
                        if (orderedNodes.length === 0) {
                            orderedNodes.push(makeGameNode(nodeData));
                        }

                        const companionIndices = [];
                        // First resource companion
                        companionIndices.push(companions.length);
                        companions.push(makeCompanion(nextEntry.nodeData, nextEntry.outEdge));
                        // Second resource companion
                        companionIndices.push(companions.length);
                        companions.push(makeCompanion(nextNextEntry.nodeData, nextNextEntry.outEdge));

                        // Add destination principal
                        orderedNodes.push(makeGameNode(nextNextNextEntry.nodeData));

                        // Merge all edges into one compound edge
                        const edge1 = outEdge;
                        const edge2 = nextEntry.outEdge;
                        const edge3 = nextNextEntry.outEdge;
                        gameEdges.push({
                            fromIdx: orderedNodes.length - 2,
                            toIdx: orderedNodes.length - 1,
                            label: edge1?.label || '',
                            description: (edge1?.description || '').trim(),
                            commands: (edge1?.commands || []).concat(edge2?.commands || [], edge3?.commands || []),
                            hints: (edge1?.hints || []).concat(edge2?.hints || [], edge3?.hints || []),
                            implicit: false,
                            companionIndices,
                        });

                        i += 3;
                        continue;
                    }
                }

                // Check for principal -> resource -> principal (one resource)
                const nextNextEntry = rawChain[i + 2];
                if (nextNextEntry.nodeData.type === 'principal') {
                    if (orderedNodes.length === 0) {
                        orderedNodes.push(makeGameNode(nodeData));
                    }

                    const companionIndices = [companions.length];
                    companions.push(makeCompanion(nextEntry.nodeData, nextEntry.outEdge));

                    // Add destination principal
                    orderedNodes.push(makeGameNode(nextNextEntry.nodeData));

                    // Merge the two edges into one compound edge
                    const edge1 = outEdge;
                    const edge2 = nextEntry.outEdge;
                    gameEdges.push({
                        fromIdx: orderedNodes.length - 2,
                        toIdx: orderedNodes.length - 1,
                        label: edge1?.label || '',
                        description: (edge1?.description || '').trim(),
                        commands: (edge1?.commands || []).concat(edge2?.commands || []),
                        hints: (edge1?.hints || []).concat(edge2?.hints || []),
                        implicit: false,
                        companionIndices,
                    });

                    i += 2;
                    continue;
                }
            }
        }

        // Non-collapsible node: add as a main path node
        if (orderedNodes.length === 0) {
            orderedNodes.push(makeGameNode(nodeData));
        }

        if (outEdge) {
            gameEdges.push({
                fromIdx: orderedNodes.length - 1,
                toIdx: orderedNodes.length, // next node will be at this index
                label: outEdge.label || '',
                description: (outEdge.description || '').trim(),
                commands: outEdge.commands || [],
                hints: outEdge.hints || [],
                implicit: false,
                companionIndices: [],
            });
        }

        i++;

        // If the next node hasn't been added yet and we just pushed an edge to it,
        // add it on the next iteration (the loop will handle it)
        if (i < rawChain.length && gameEdges.length > 0 && gameEdges[gameEdges.length - 1].toIdx === orderedNodes.length) {
            orderedNodes.push(makeGameNode(rawChain[i].nodeData));
        }
    }

    return { nodes: orderedNodes, edges: gameEdges, companions: companions };
}

// ---- Map Layout & Drawing Helpers ----
// These functions provide the core map rendering: palette, layout, decorations, island shapes, and full map draw.

function getMapPalette() {
    const isLight = document.documentElement.classList.contains('light-theme');
    if (isLight) {
        return {
            oceanA: '#5a9ac0', oceanB: '#78b8d8', oceanDeep: '#4888b0',
            gridLine: 'rgba(0, 40, 80, 0.04)',
            waveLine: 'rgba(0, 60, 120, 0.08)',
            shorelineOuter: 'rgba(120, 200, 220, 0.35)',
            shorelineInner: 'rgba(160, 220, 230, 0.25)',
            sandLight: '#e8d8a0', sandDark: '#c8b878',
            islandGreenA: '#5a9a42', islandGreenB: '#4a8a36', islandGreenC: '#3a7a2a',
            islandDark: '#3a6a2a', islandShadow: '#2a4a1a',
            grassHighlight: 'rgba(120, 200, 80, 0.25)', grassDark: 'rgba(30, 80, 20, 0.15)',
            cliffFace: '#9a8a6a', cliffDark: '#7a6a4a', cliffHighlight: '#b8a880',
            pathGlow: 'rgba(180, 130, 40, 0.25)', pathStroke: '#9a7220', pathDim: 'rgba(120, 90, 40, 0.3)',
            treeCanopyA: '#4a9a32', treeCanopyB: '#3a8a28', treeCanopyC: '#2a7a1e',
            treeShadow: 'rgba(20, 60, 10, 0.2)', treeTrunk: '#6a5030', treeTrunkLight: '#8a6a40',
            mountainA: '#8a8a9a', mountainB: '#6a6a7a', mountainSnow: '#e0e0e8',
            cloudWhite: 'rgba(255, 255, 255, 0.6)', cloudGray: 'rgba(220, 230, 240, 0.4)',
            cloudShadow: 'rgba(150, 170, 200, 0.2)',
            labelFill: '#1d1d3f', labelStroke: 'rgba(255,255,255,0.7)',
            nodeLockedFill: '#a8a8b8', nodeLockedBorder: '#888898', nodeLockedQ: '#686878',
            startFill: '#22a853', startGlow: 'rgba(34, 168, 83, 0.35)',
            endFill: '#d97706', endGlow: 'rgba(217, 119, 6, 0.35)',
            revealedFill: '#7c3aed', revealedGlow: 'rgba(124, 58, 237, 0.3)',
            selectedRing: '#1A3A52',
            flagPole: '#5a4030', flagColor: '#dc2626',
            typeTintPrincipal: '#ef4444', typeTintResource: '#f59e0b', typeTintTarget: '#a78bfa',
        };
    }
    return {
        oceanA: '#060c18', oceanB: '#0e1826', oceanDeep: '#040810',
        gridLine: 'rgba(80, 120, 200, 0.03)',
        waveLine: 'rgba(80, 140, 240, 0.04)',
        shorelineOuter: 'rgba(40, 100, 140, 0.2)',
        shorelineInner: 'rgba(50, 120, 160, 0.12)',
        sandLight: '#8a7a4a', sandDark: '#6a5a32',
        islandGreenA: '#2e6a2e', islandGreenB: '#246024', islandGreenC: '#1a501a',
        islandDark: '#143814', islandShadow: '#060a04',
        grassHighlight: 'rgba(80, 160, 50, 0.2)', grassDark: 'rgba(10, 40, 5, 0.3)',
        cliffFace: '#4a3a20', cliffDark: '#2a1a08', cliffHighlight: '#6a5a38',
        pathGlow: 'rgba(200, 160, 60, 0.15)', pathStroke: '#b8862a', pathDim: 'rgba(100, 80, 40, 0.2)',
        treeCanopyA: '#2a6a2a', treeCanopyB: '#1e5a1e', treeCanopyC: '#144a14',
        treeShadow: 'rgba(0, 0, 0, 0.25)', treeTrunk: '#4a3520', treeTrunkLight: '#5a4530',
        mountainA: '#3a3a4a', mountainB: '#2a2a3a', mountainSnow: '#8a8a9a',
        cloudWhite: 'rgba(180, 200, 240, 0.07)', cloudGray: 'rgba(140, 160, 200, 0.04)',
        cloudShadow: 'rgba(60, 80, 120, 0.04)',
        labelFill: '#e4e4e8', labelStroke: 'rgba(0,0,0,0.5)',
        nodeLockedFill: '#3a3a4a', nodeLockedBorder: '#5a5a6a', nodeLockedQ: '#7a7a8a',
        startFill: '#4ade80', startGlow: 'rgba(74, 222, 128, 0.3)',
        endFill: '#f59e0b', endGlow: 'rgba(245, 158, 11, 0.3)',
        revealedFill: '#a78bfa', revealedGlow: 'rgba(167, 139, 250, 0.25)',
        selectedRing: '#9D4EDD',
        flagPole: '#8a7a6a', flagColor: '#ef4444',
        typeTintPrincipal: '#ef4444', typeTintResource: '#f59e0b', typeTintTarget: '#a78bfa',
    };
}

// Deterministic pseudo-random number generator for stable decoration placement
function mapRng(seed) {
    let s = Math.abs(seed * 2654435761 | 0) || 1;
    return function() {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        return (s >>> 0) / 4294967296;
    };
}

// Compute island positions: spread equidistantly left-to-right across the island zone.
// First island is leftmost, last island is rightmost. Y positions vary freely
// with a zig-zag pattern and jitter so the layout feels organic, not linear.
// Islands live in the bottom 80% of the canvas, leaving top 20% for clouds.
function computeMapLayout(count, w, h) {
    const positions = [];
    if (count === 0) return positions;

    const hudTop = 48;          // below top HUD bar
    const hudBottom = 80;       // above bottom action bar + label space
    const cloudBottom = h * 0.22; // clouds end here -- islands start BELOW this
    const padX = w * 0.15;     // 15% margin each side so islands stay central

    // Island zone: entirely below cloud bottom, above bottom HUD
    const minY = cloudBottom + 20;
    const maxY = h - hudBottom - 30;
    const centerY = (minY + maxY) / 2;
    const rangeY = (maxY - minY) / 2;

    const rng = mapRng(count * 31);

    for (let i = 0; i < count; i++) {
        // Evenly spaced left-to-right
        const t = count === 1 ? 0.5 : i / (count - 1);
        const x = padX + t * (w - padX * 2);

        // Zig-zag Y: alternate above/below center, amplitude scales with zone height
        // First and last islands get moderate offsets; middle islands get full amplitude
        const zigzagSign = (i % 2 === 0) ? 1 : -1;
        const amplitude = rangeY * 0.6;
        let baseY = centerY + zigzagSign * amplitude;

        // Jitter for organic feel
        const jitterX = (rng() - 0.5) * 30;
        const jitterY = (rng() - 0.5) * 40;

        const clampedX = Math.max(padX, Math.min(w - padX, x + jitterX));
        const clampedY = Math.max(minY, Math.min(maxY, baseY + jitterY));
        positions.push({ x: clampedX, y: clampedY });
    }
    return positions;
}

// Compute companion positions offset from their parent edge midpoints
function computeCompanionPositions(companions, edges, positions) {
    if (!companions || !companions.length) return [];
    const companionPositions = [];
    for (let ci = 0; ci < companions.length; ci++) {
        const parentEdge = edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
        if (!parentEdge) {
            companionPositions.push({ x: 0, y: 0 });
            continue;
        }
        const fromPos = positions[parentEdge.fromIdx];
        const toPos = positions[parentEdge.toIdx];
        if (!fromPos || !toPos) {
            companionPositions.push({ x: 0, y: 0 });
            continue;
        }
        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / len;
        const perpY = dx / len;

        // When multiple companions share an edge, spread them along the edge
        // and offset perpendicular to avoid overlapping the path line
        const siblingIndices = parentEdge.companionIndices || [];
        const siblingPos = siblingIndices.indexOf(ci);
        const siblingCount = siblingIndices.length;
        // Position along edge: single companion at 0.5, two at 0.35 and 0.65
        const t = siblingCount <= 1 ? 0.5 : 0.35 + (siblingPos / (siblingCount - 1)) * 0.3;
        const anchorX = fromPos.x + dx * t;
        const anchorY = fromPos.y + dy * t;
        const perpOffset = 60;
        companionPositions.push({
            x: anchorX + perpX * perpOffset,
            y: anchorY + perpY * perpOffset,
        });
    }
    return companionPositions;
}

// Generate decorative elements avoiding island positions and HUD bars.
// Clouds are handled separately by cloudSprites, so this only generates trees.
function generateMapDecorations(positions, w, h) {
    const decorations = [];
    const rng = mapRng(42);
    const isNear = (x, y, minDist) => positions.some(p => Math.hypot(p.x - x, p.y - y) < minDist);
    const hudTop = 48;
    const hudBottom = 56;

    // A few small trees scattered on the island zone (bottom 2/3)
    const treeCount = Math.floor(w * h / 18000);
    for (let i = 0; i < treeCount; i++) {
        const x = rng() * w;
        const y = hudTop + 20 + rng() * (h - hudTop - hudBottom - 30);
        if (!isNear(x, y, 80)) {
            decorations.push({ type: 'tree', x, y, size: 5 + rng() * 6, variant: Math.floor(rng() * 3) });
        }
    }
    return decorations;
}

// Generate an irregular island shape using polar offsets
function generateIslandShape(cx, cy, radiusX, radiusY, seed, segments) {
    const points = [];
    const rng = mapRng(seed);
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const jitter = 0.75 + rng() * 0.5; // 0.75 to 1.25
        const rx = radiusX * jitter;
        const ry = radiusY * jitter;
        points.push({
            x: cx + Math.cos(angle) * rx,
            y: cy + Math.sin(angle) * ry,
        });
    }
    return points;
}

// Draw a smooth closed shape through points using bezier curves
function drawSmoothShape(ctx, points) {
    if (points.length < 3) return;
    ctx.beginPath();
    const n = points.length;
    // Start at midpoint between last and first
    const startX = (points[n - 1].x + points[0].x) / 2;
    const startY = (points[n - 1].y + points[0].y) / 2;
    ctx.moveTo(startX, startY);
    for (let i = 0; i < n; i++) {
        const curr = points[i];
        const next = points[(i + 1) % n];
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    ctx.closePath();
}

// ---- Island style renderers ----
// Each takes (ctx, pos, islandRadius, seed, p, isFirst, isLast) and draws the terrain layers only.

function drawIslandClassic(ctx, pos, islandRadius, seed, p, isFirst, isLast) {
    const shore = generateIslandShape(pos.x, pos.y, islandRadius * 1.1, islandRadius * 0.42, seed, 20);
    const rock = generateIslandShape(pos.x, pos.y, islandRadius * 0.9, islandRadius * 0.35, seed + 1, 20);
    const inner = generateIslandShape(pos.x, pos.y - 1, islandRadius * 0.65, islandRadius * 0.24, seed + 2, 16);

    // Cliff shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 3, y: pt.y + 8 })));
    ctx.fill();
    // Cliff face
    ctx.fillStyle = p.cliffDark;
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x, y: pt.y + 4 })));
    ctx.fill();
    // Shore ring
    ctx.fillStyle = p.sandLight;
    drawSmoothShape(ctx, shore);
    ctx.fill();
    // Green layer
    ctx.fillStyle = isFirst ? p.islandGreenA : isLast ? p.islandGreenC : p.islandGreenB;
    drawSmoothShape(ctx, rock);
    ctx.fill();
    // Inner highlight
    ctx.fillStyle = p.grassHighlight;
    drawSmoothShape(ctx, inner);
    ctx.fill();
}

function drawIslandWooded(ctx, pos, islandRadius, seed, p, isFirst, isLast) {
    // Recreates the old look: thicker cliff for depth, scattered round trees with shadows
    const shore = generateIslandShape(pos.x, pos.y, islandRadius * 1.12, islandRadius * 0.44, seed, 22);
    const rock = generateIslandShape(pos.x, pos.y, islandRadius * 0.92, islandRadius * 0.36, seed + 1, 22);
    const inner = generateIslandShape(pos.x, pos.y - 1, islandRadius * 0.68, islandRadius * 0.26, seed + 2, 18);

    // Deep shadow for pronounced 3D depth
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 4, y: pt.y + 11 })));
    ctx.fill();
    // Thick cliff face -- two layers for more depth
    ctx.fillStyle = '#5a4a30';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 1, y: pt.y + 7 })));
    ctx.fill();
    ctx.fillStyle = p.cliffDark;
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x, y: pt.y + 4 })));
    ctx.fill();
    // Shore ring
    ctx.fillStyle = p.sandLight;
    drawSmoothShape(ctx, shore);
    ctx.fill();
    // Dark green edge for depth
    ctx.fillStyle = isFirst ? '#3a7a2a' : isLast ? '#2a6a1a' : '#327226';
    drawSmoothShape(ctx, rock);
    ctx.fill();
    // Lighter green center
    ctx.fillStyle = isFirst ? p.islandGreenA : isLast ? p.islandGreenC : p.islandGreenB;
    drawSmoothShape(ctx, inner);
    ctx.fill();
    // Inner grass highlight
    const highlight = generateIslandShape(pos.x, pos.y - 2, islandRadius * 0.45, islandRadius * 0.16, seed + 3, 14);
    ctx.fillStyle = p.grassHighlight;
    drawSmoothShape(ctx, highlight);
    ctx.fill();

    // Scattered round trees -- each island gets a unique arrangement from seed
    // Trees avoid the center zone so AWS icons and the plane remain visible
    const rng = mapRng(seed + 50);
    const treeCount = 4 + Math.floor(rng() * 4); // 4-7 trees
    ctx.save();
    for (let t = 0; t < treeCount; t++) {
        // Place trees in an outer ring (70-95% from center), keeping the middle clear
        const angle = rng() * Math.PI * 2;
        const dist = 0.7 + rng() * 0.25; // 70-95% of the way from center to edge
        const tx = pos.x + Math.cos(angle) * islandRadius * 0.7 * dist;
        const ty = pos.y + Math.sin(angle) * islandRadius * 0.28 * dist;
        const treeSize = 4 + rng() * 5; // 4-9px radius

        // Tree shadow
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#1a3a10';
        ctx.beginPath();
        ctx.ellipse(tx + 1, ty + 2, treeSize * 1.1, treeSize * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tree canopy -- darker outer ring
        ctx.globalAlpha = 0.9;
        const treeGreen = rng() > 0.5 ? '#2e7a22' : '#3a8a2e';
        ctx.fillStyle = treeGreen;
        ctx.beginPath();
        ctx.ellipse(tx, ty - 1, treeSize, treeSize * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tree canopy highlight (lighter center blob)
        ctx.fillStyle = rng() > 0.5 ? '#5aaa42' : '#4a9a38';
        ctx.beginPath();
        ctx.ellipse(tx - 1, ty - 2, treeSize * 0.6, treeSize * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawIslandTropical(ctx, pos, islandRadius, seed, p, isFirst, isLast) {
    // Tropical style: sandy patches, palm trees with visible trunks and fan canopies
    const shore = generateIslandShape(pos.x, pos.y, islandRadius * 1.1, islandRadius * 0.42, seed, 20);
    const rock = generateIslandShape(pos.x, pos.y, islandRadius * 0.9, islandRadius * 0.35, seed + 1, 20);
    const inner = generateIslandShape(pos.x, pos.y - 1, islandRadius * 0.65, islandRadius * 0.24, seed + 2, 16);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 3, y: pt.y + 10 })));
    ctx.fill();
    // Cliff -- warm brown tone
    ctx.fillStyle = '#6a5038';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 1, y: pt.y + 6 })));
    ctx.fill();
    ctx.fillStyle = '#7a6048';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x, y: pt.y + 3 })));
    ctx.fill();
    // Wide sandy shore
    ctx.fillStyle = '#f0e0a0';
    drawSmoothShape(ctx, shore);
    ctx.fill();
    // Green interior
    ctx.fillStyle = isFirst ? '#48a038' : isLast ? '#38902a' : '#409830';
    drawSmoothShape(ctx, rock);
    ctx.fill();
    // Lighter green center
    ctx.fillStyle = isFirst ? '#60b850' : isLast ? '#50a840' : '#58b048';
    drawSmoothShape(ctx, inner);
    ctx.fill();

    // Sandy beach patches along the shore
    const rng = mapRng(seed + 60);
    ctx.save();
    for (let b = 0; b < 3; b++) {
        const angle = rng() * Math.PI * 2;
        const bx = pos.x + Math.cos(angle) * islandRadius * 0.85;
        const by = pos.y + Math.sin(angle) * islandRadius * 0.33;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#f0dca0';
        ctx.beginPath();
        ctx.ellipse(bx, by, 6 + rng() * 4, 3 + rng() * 2, angle, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Palm trees with trunks -- placed in outer ring to keep center clear for icons and plane
    const palmCount = 2 + Math.floor(rng() * 3); // 2-4 palms
    ctx.save();
    for (let t = 0; t < palmCount; t++) {
        const angle = rng() * Math.PI * 2;
        const dist = 0.7 + rng() * 0.25; // 70-95% from center
        const tx = pos.x + Math.cos(angle) * islandRadius * 0.65 * dist;
        const ty = pos.y + Math.sin(angle) * islandRadius * 0.25 * dist;
        const trunkHeight = 12 + rng() * 10; // 12-22px tall
        const lean = (rng() - 0.5) * 8; // trunk leans left or right

        // Trunk shadow
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = '#1a2a10';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx + 2, ty + 2);
        ctx.quadraticCurveTo(tx + lean * 0.5 + 2, ty - trunkHeight * 0.5 + 2, tx + lean + 2, ty - trunkHeight + 2);
        ctx.stroke();

        // Trunk -- brown, slightly curved
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#6a5030';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + lean * 0.5, ty - trunkHeight * 0.5, tx + lean, ty - trunkHeight);
        ctx.stroke();
        // Trunk highlight
        ctx.strokeStyle = '#8a6a40';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx - 0.5, ty);
        ctx.quadraticCurveTo(tx + lean * 0.5 - 0.5, ty - trunkHeight * 0.5, tx + lean - 0.5, ty - trunkHeight);
        ctx.stroke();

        // Palm fronds -- 4-5 drooping leaf shapes radiating from trunk top
        const crownX = tx + lean;
        const crownY = ty - trunkHeight;
        const frondCount = 4 + Math.floor(rng() * 2);
        for (let f = 0; f < frondCount; f++) {
            const frondAngle = (f / frondCount) * Math.PI * 2 + rng() * 0.4;
            const frondLen = 8 + rng() * 6;
            const endX = crownX + Math.cos(frondAngle) * frondLen;
            const endY = crownY + Math.sin(frondAngle) * frondLen * 0.5 + 3; // droop down
            const cpX = crownX + Math.cos(frondAngle) * frondLen * 0.6;
            const cpY = crownY + Math.sin(frondAngle) * frondLen * 0.2 - 2;

            // Frond shadow
            ctx.globalAlpha = 0.12;
            ctx.strokeStyle = '#1a3a10';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(crownX + 1, crownY + 1);
            ctx.quadraticCurveTo(cpX + 1, cpY + 1, endX + 1, endY + 1);
            ctx.stroke();

            // Frond
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = rng() > 0.5 ? '#2a8a1e' : '#35951e';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(crownX, crownY);
            ctx.quadraticCurveTo(cpX, cpY, endX, endY);
            ctx.stroke();
        }
        // Coconut cluster at crown
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#8a6a30';
        for (let c = 0; c < 2; c++) {
            ctx.beginPath();
            ctx.arc(crownX + (rng() - 0.5) * 3, crownY + rng() * 2, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawIslandRuins(ctx, pos, islandRadius, seed, p, isFirst, isLast) {
    // Ancient stone ruins: weathered stone platform with broken pillars and moss
    const shore = generateIslandShape(pos.x, pos.y, islandRadius * 1.1, islandRadius * 0.42, seed, 20);
    const stoneBase = generateIslandShape(pos.x, pos.y, islandRadius * 0.92, islandRadius * 0.36, seed + 1, 20);
    const innerMoss = generateIslandShape(pos.x, pos.y - 1, islandRadius * 0.6, islandRadius * 0.22, seed + 2, 16);

    // Shadow -- heavier for stone structures
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 4, y: pt.y + 10 })));
    ctx.fill();
    // Stone cliff face
    ctx.fillStyle = '#4a4a50';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x + 1, y: pt.y + 7 })));
    ctx.fill();
    ctx.fillStyle = '#5a5a62';
    drawSmoothShape(ctx, shore.map(pt => ({ x: pt.x, y: pt.y + 4 })));
    ctx.fill();
    // Weathered stone shore
    ctx.fillStyle = '#a0a098';
    drawSmoothShape(ctx, shore);
    ctx.fill();
    // Stone platform -- slightly different shade per island position
    ctx.fillStyle = isFirst ? '#8a8a82' : isLast ? '#7a7a72' : '#82827a';
    drawSmoothShape(ctx, stoneBase);
    ctx.fill();
    // Moss/vegetation patches growing through cracks
    ctx.fillStyle = 'rgba(70, 130, 50, 0.4)';
    drawSmoothShape(ctx, innerMoss);
    ctx.fill();

    // Stone tile pattern on the platform surface
    const rng = mapRng(seed + 40);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 0.8;
    for (let line = 0; line < 4; line++) {
        const ly = pos.y - 6 + line * 4 + rng() * 2;
        ctx.beginPath();
        ctx.moveTo(pos.x - islandRadius * 0.5, ly);
        ctx.lineTo(pos.x + islandRadius * 0.5, ly);
        ctx.stroke();
    }
    ctx.restore();

    // Broken stone pillars scattered on the island
    const pillarCount = 3 + Math.floor(rng() * 3); // 3-5 pillars
    ctx.save();
    for (let pi = 0; pi < pillarCount; pi++) {
        const angle = rng() * Math.PI * 2;
        const dist = 0.15 + rng() * 0.55;
        const px = pos.x + Math.cos(angle) * islandRadius * 0.65 * dist;
        const py = pos.y + Math.sin(angle) * islandRadius * 0.25 * dist;
        const pillarHeight = 8 + rng() * 14; // 8-22px -- varied heights for "broken" look
        const pillarWidth = 3 + rng() * 2.5;
        const isBroken = rng() > 0.4; // 60% are broken/shorter

        const actualHeight = isBroken ? pillarHeight * (0.3 + rng() * 0.4) : pillarHeight;

        // Pillar shadow
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(px - pillarWidth / 2 + 2, py - actualHeight + 2, pillarWidth, actualHeight);

        // Pillar body -- stone gray
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#b0a898';
        ctx.fillRect(px - pillarWidth / 2, py - actualHeight, pillarWidth, actualHeight);

        // Pillar highlight (left edge)
        ctx.fillStyle = '#c8c0b8';
        ctx.fillRect(px - pillarWidth / 2, py - actualHeight, 1.5, actualHeight);

        // Pillar dark edge (right)
        ctx.fillStyle = '#8a8278';
        ctx.fillRect(px + pillarWidth / 2 - 1, py - actualHeight, 1, actualHeight);

        // Broken top -- jagged edge for broken pillars
        if (isBroken) {
            const topY = py - actualHeight;
            ctx.fillStyle = '#9a928a';
            ctx.beginPath();
            ctx.moveTo(px - pillarWidth / 2, topY);
            ctx.lineTo(px - pillarWidth / 4, topY - 2 - rng() * 2);
            ctx.lineTo(px + pillarWidth / 4, topY - 1);
            ctx.lineTo(px + pillarWidth / 2, topY - rng() * 2);
            ctx.lineTo(px + pillarWidth / 2, topY + 2);
            ctx.lineTo(px - pillarWidth / 2, topY + 2);
            ctx.closePath();
            ctx.fill();
        } else {
            // Intact pillar gets a small capital (top piece)
            const topY = py - actualHeight;
            ctx.fillStyle = '#c0b8a8';
            ctx.fillRect(px - pillarWidth / 2 - 1.5, topY - 2, pillarWidth + 3, 3);
        }

        // Moss growing on some pillars
        if (rng() > 0.4) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#4a8a30';
            const mossY = py - actualHeight * rng() * 0.5;
            ctx.beginPath();
            ctx.ellipse(px + (rng() - 0.5) * pillarWidth, mossY, 2 + rng() * 2, 1.5 + rng(), 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    // Scattered small moss/vine patches on ground
    ctx.save();
    for (let m = 0; m < 5; m++) {
        const mx = pos.x + (rng() - 0.5) * islandRadius * 1.2;
        const my = pos.y + (rng() - 0.5) * islandRadius * 0.4;
        ctx.globalAlpha = 0.3 + rng() * 0.2;
        ctx.fillStyle = rng() > 0.5 ? '#4a9a32' : '#3a7a28';
        ctx.beginPath();
        ctx.ellipse(mx, my, 2 + rng() * 3, 1 + rng() * 1.5, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

const islandStyleRenderers = {
    classic: drawIslandClassic,
    wooded: drawIslandWooded,
    tropical: drawIslandTropical,
    ruins: drawIslandRuins,
};

// Draw the full base map: ocean/sky, clouds, paths between islands, and islands
function drawGameMap(ctx, w, h, state) {
    const p = state.palette;
    const { positions, nodes, edges, decorations } = state;
    const rng = mapRng(123);
    const lastIdx = nodes.length - 1;

    // Compute visible world-space bounds (accounts for pan/zoom so background covers all exposed area)
    const zoom = state.viewZoom || 1;
    const panX = state.viewPanX || 0;
    const panY = state.viewPanY || 0;
    const bgX = -panX / zoom;
    const bgY = -panY / zoom;
    const bgW = w / zoom;
    const bgH = h / zoom;
    // Padded bounds to ensure full coverage
    const fillX = Math.min(0, bgX) - 50;
    const fillY = Math.min(0, bgY) - 50;
    const fillR = Math.max(w, bgX + bgW) + 50;
    const fillB = Math.max(h, bgY + bgH) + 50;
    const fillW = fillR - fillX;
    const fillH = fillB - fillY;

    // Ocean/sky gradient background
    const oceanGrad = ctx.createLinearGradient(fillX, fillY, fillX, fillB);
    oceanGrad.addColorStop(0, p.oceanA);
    oceanGrad.addColorStop(0.6, p.oceanB);
    oceanGrad.addColorStop(1, p.oceanDeep);
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(fillX, fillY, fillW, fillH);

    // Subtle wave lines (extended to cover visible area)
    ctx.save();
    ctx.strokeStyle = p.waveLine;
    ctx.lineWidth = 0.8;
    const waveRng = mapRng(555);
    for (let wy = fillY + 30; wy < fillB; wy += 35 + waveRng() * 20) {
        ctx.beginPath();
        for (let wx = fillX; wx <= fillR; wx += 4) {
            const yOff = Math.sin(wx * 0.015 + wy * 0.1) * 3;
            if (wx === fillX) ctx.moveTo(wx, wy + yOff);
            else ctx.lineTo(wx, wy + yOff);
        }
        ctx.stroke();
    }
    ctx.restore();

    // Cloud sprites (pixel-art PNGs)
    ctx.save();
    cloudSprites.draw(ctx, w, h, 99);
    ctx.restore();

    // Paths (edges) between islands -- always draw all paths visibly
    if (edges) {
        for (const edge of edges) {
            if (edge.implicit) continue;
            const from = positions[edge.fromIdx];
            const to = positions[edge.toIdx];
            if (!from || !to) continue;

            // Path glow
            ctx.save();
            ctx.strokeStyle = p.pathGlow;
            ctx.lineWidth = 6;
            ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
            ctx.restore();

            // Dashed path line
            ctx.save();
            ctx.strokeStyle = p.pathStroke;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    // Islands -- always draw all islands fully (no fog/locked state)
    // Shrink islands by 20% for each main island beyond 3 to avoid crowding
    const baseIslandRadius = 104;
    const shrinkSteps = Math.max(0, nodes.length - 3);
    const islandRadius = baseIslandRadius * Math.pow(0.8, shrinkSteps);
    state.islandRadius = islandRadius; // store for label positioning
    positions.forEach((pos, i) => {
        const isFirst = i === 0;
        const isLast = i === lastIdx;
        const isSelected = state.selectedNode === i;
        const seed = i * 997 + 1;  // stable per-island seed, independent of position

        ctx.save();

        // Selection ring (dashed circle around selected island) -- skip on first/last
        // Startington has its own plane indicator; Targetlandia has its flag
        if (isSelected && !isFirst && !isLast) {
            ctx.strokeStyle = p.selectedRing || '#9D4EDD';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.ellipse(pos.x, pos.y + 2, islandRadius * 1.2, islandRadius * 0.45, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Island terrain layers -- dispatched by style
        const drawIslandTerrain = islandStyleRenderers[state.islandStyle] || drawIslandClassic;
        drawIslandTerrain(ctx, pos, islandRadius, seed, p, isFirst, isLast);

        // AWS icon centered on the island (max 50% of island diameter) -- only in 'on-island' mode
        if (state.iconStyle === 'on-island') {
            const nodeSubType = nodes[i]?.subType || '';
            const iconImg = awsIconSprites.get(nodeSubType);
            if (iconImg) {
                const maxIconSize = islandRadius * 0.5; // 50% of island radius = 26px
                const iconSize = Math.min(maxIconSize, iconImg.width);
                ctx.save();
                ctx.globalAlpha = 0.85;
                ctx.drawImage(iconImg, pos.x - iconSize / 2, pos.y - iconSize / 2 - 2, iconSize, iconSize);
                ctx.restore();
            }
        }

        // Start island glow + small plane graphic
        if (isFirst) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = p.startGlow;
            ctx.beginPath();
            ctx.ellipse(pos.x, pos.y, islandRadius * 0.8, islandRadius * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // (Plane indicator is drawn separately after all islands/companions)
        }

        // Targetlandia flag -- centered on the island, taller pole with waving pennant
        if (isLast) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = p.endGlow;
            ctx.beginPath();
            ctx.ellipse(pos.x, pos.y, islandRadius * 0.8, islandRadius * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Flag pole centered on island
            const poleX = pos.x;
            const poleBase = pos.y - 4;
            const poleTop = pos.y - 36;
            // Pole shadow
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(poleX + 1, poleBase + 1); ctx.lineTo(poleX + 1, poleTop + 1); ctx.stroke();
            // Pole
            ctx.strokeStyle = p.flagPole;
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(poleX, poleBase); ctx.lineTo(poleX, poleTop); ctx.stroke();
            // Pole cap (gold ball)
            ctx.fillStyle = p.endFill || '#f59e0b';
            ctx.beginPath(); ctx.arc(poleX, poleTop - 1, 3, 0, Math.PI * 2); ctx.fill();
            // Triangular pennant with subtle wave
            ctx.fillStyle = p.flagColor;
            ctx.beginPath();
            ctx.moveTo(poleX + 1, poleTop);
            ctx.quadraticCurveTo(poleX + 12, poleTop + 2, poleX + 18, poleTop + 7);
            ctx.lineTo(poleX + 1, poleTop + 14);
            ctx.closePath();
            ctx.fill();
            // Pennant highlight stripe
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.beginPath();
            ctx.moveTo(poleX + 1, poleTop + 2);
            ctx.lineTo(poleX + 10, poleTop + 5);
            ctx.lineTo(poleX + 1, poleTop + 6);
            ctx.closePath();
            ctx.fill();
        }

        // Label -- positioned below the island bottom edge
        const label = nodes[i]?.label || '';
        if (label) {
            const displayLabel = label.length > 20 ? label.substring(0, 18) + '..' : label;
            const labelOffsetY = islandRadius * 0.42 + 10;
            ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.fillStyle = p.labelFill;
            ctx.strokeStyle = p.labelStroke;
            ctx.lineWidth = 3;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeText(displayLabel, pos.x, pos.y + labelOffsetY);
            ctx.fillText(displayLabel, pos.x, pos.y + labelOffsetY);
        }

        ctx.restore();
    });
}

function renderLabDetailContentMapGame(lab, container) {
    const mapId = `mapgame-${lab.slug || 'default'}`;

    // Prefer attackMap over mermaid
    let mapNodes = [];
    let mapEdges = [];
    let mapCompanions = [];
    if (lab.attackMap?.nodes?.length) {
        const parsed = parseAttackMapToGameNodes(lab.attackMap);
        mapNodes = parsed.nodes;
        mapEdges = parsed.edges;
        mapCompanions = parsed.companions || [];
    }
    if (mapNodes.length === 0) {
        const readme = lab.readme;
        const mermaidData = parseMermaidToSteps(readme?.attackDiagram);
        const attackSteps = parseAttackStepsToCards(readme?.attackSteps);
        if (mermaidData.steps.length > 0) {
            mapNodes.push({
                label: mermaidData.steps[0].fromNode.label,
                type: getNodeTypeFromColor(mermaidData.steps[0].fromNode.color),
            });
            mermaidData.steps.forEach((step, i) => {
                mapNodes.push({
                    label: step.toNode.label,
                    type: getNodeTypeFromColor(step.toNode.color),
                });
                // Build edge from mermaid step data
                mapEdges.push({
                    fromIdx: mapNodes.length - 2,
                    toIdx: mapNodes.length - 1,
                    label: step.edgeLabel || '',
                    description: (attackSteps[i]?.desc || '').trim(),
                    commands: attackSteps[i]?.commands || [],
                    hints: [],
                    implicit: false,
                });
            });
        }
    }

    if (mapNodes.length === 0) {
        container.innerHTML = '<div class="lab-tab-prose"><p>No map data available for this lab.</p></div>';
        return;
    }

    // Two-column layout: HTML detail panel (left) + canvas map (right)
    // The mg-canvas-wrap is position:relative so the menu overlay can sit on top.
    container.innerHTML = `
        <div class="mg-layout" id="${mapId}">
            <div class="mg-detail-panel" id="${mapId}-panel"></div>
            <div class="mg-canvas-wrap">
                <canvas id="${mapId}-canvas" class="mg-canvas"></canvas>
                <div class="mg-menu-overlay" id="${mapId}-menu"></div>
            </div>
        </div>`;

    setTimeout(() => initMapGame(mapId, mapNodes, mapEdges, mapCompanions, lab), 60);
}

function initMapGame(mapId, nodes, edges, companions, lab) {
    const canvas = document.getElementById(`${mapId}-canvas`);
    const panelEl = document.getElementById(`${mapId}-panel`);
    const menuEl = document.getElementById(`${mapId}-menu`);
    if (!canvas || !panelEl) return;

    const wrap = canvas.parentElement;
    let w = wrap.clientWidth;
    // Use 65% of the viewport height, clamped between 480px and 85vh.
    // This gives large screens a taller map while keeping it usable on small ones.
    const maxH = Math.floor(window.innerHeight * 0.85);
    let h = Math.max(480, Math.min(maxH, Math.round(window.innerHeight * 0.65)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Set canvas background so exposed areas during pan/zoom match the ocean
    canvas.style.backgroundColor = '#0a1628';

    // Preload AWS icons for all nodes so they're ready when we draw
    awsIconSprites.preload(nodes);
    if (companions) awsIconSprites.preload(companions);

    const positions = computeMapLayout(nodes.length, w, h);
    // Compute companion positions offset from their parent edge midpoints
    const companionPositions = computeCompanionPositions(companions, edges, positions);
    // Filter out mountains from decorations for game mode
    const allDecorations = generateMapDecorations(positions, w, h);
    const decorations = allDecorations.filter(d => d.type !== 'mountain');
    const palette = getGameUIPalette();

    const state = {
        screen: 'playing',       // skip start screen, go directly to map
        revealed: new Set(nodes.map((_, i) => i)),
        currentNode: 0,
        currentEdge: -1,         // index of the last completed edge (-1 = none)
        revealedEdges: new Set(edges.map((_, i) => i)), // all edges visible from start
        revealedCommands: new Set(), // edges whose commands have been toggled open
        selectedNode: null,       // null = show overview/mission briefing
        selectedEdge: null,
        selectedCompanion: null, // index into companions[] or null
        completeView: null,      // 'cspm' | 'cloudsiem' | null -- which defense panel to show
        gameViewPhase: 'setup',  // 'setup' | 'overview' | 'navigation' -- controls initial flow
        panelOverride: null,     // 'setup' | 'overview' | null -- temporary panel switch via buttons
        positions,
        companionPositions,
        companions: companions || [],
        companionStyle: 'islet', // 'ship' | 'islet' | 'note'
        iconStyle: 'below-label',  // 'on-island' | 'below-label' | 'off' -- toggled with I key
        islandStyle: 'wooded', // 'classic' | 'wooded' | 'tropical' | 'ruins' -- toggled with T key
        planeStyle: 'helicopter',    // 'jet' | 'biplane' | 'seaplane' | 'helicopter' -- toggled with P key
        nodes,
        edges: edges || [],
        decorations,
        hintsUsed: 0,
        revealedHints: {},
        hoveredButton: null,
        activeButton: null,
        hoveredHop: null,        // hop label hover state
        buttons: [],
        lab,
        palette,
        // -- View transform state (pan/zoom) --
        viewPanX: 0,
        viewPanY: 0,
        viewZoom: 1,
        _isPanning: false,
        _panStartPointer: null,  // {x, y} screen coords at drag start
        _panStartView: null,     // {panX, panY} at drag start
        _suppressClick: false,   // true after a pan drag to prevent click
        _redraw: null,
        _panelEl: panelEl,
        _menuEl: menuEl,
        _container: wrap.parentElement.parentElement, // scrollableContent that holds mg-layout
        _w: w,
        _h: h,
        menuFocusIdx: 0,
        menuView: 'main',        // 'main' | 'keybindings' | 'labs-browser'
        labsBrowserLabs: null,   // null = not yet loaded, Array = loaded
        labsBrowserFilter: '',
    };

    function redraw() {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        renderMapGame(ctx, w, h, state);
        ctx.restore();
    }
    state._redraw = redraw;
    state.buttons = buildPlayingButtons(w, h, state);

    cloudSprites.load().then(() => redraw());
    // Redraw when AWS icons finish loading so they appear on islands
    awsIconSprites.onLoadCallbacks.push(() => redraw());
    redraw();
    updateGamePanel(state);

    // Returns screen-space (sx/sy) for HUD/button hit testing
    // and world-space (x/y) for island/edge/companion hit testing
    function canvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (w / rect.width);
        const sy = (e.clientY - rect.top) * (h / rect.height);
        return {
            sx, sy,
            x: (sx - state.viewPanX) / state.viewZoom,
            y: (sy - state.viewPanY) / state.viewZoom,
        };
    }

    function onPointerMove(e) {
        const { sx, sy, x, y } = canvasCoords(e);

        // Handle active pan drag
        if (state._isPanning) {
            state.viewPanX = state._panStartView.panX + (sx - state._panStartPointer.x);
            state.viewPanY = state._panStartView.panY + (sy - state._panStartPointer.y);
            canvas.style.cursor = 'grabbing';
            redraw();
            return;
        }

        // Check if we should start panning (pointer is down + moved > 5px)
        if (state._panStartPointer && !state._isPanning) {
            const dx = sx - state._panStartPointer.x;
            const dy = sy - state._panStartPointer.y;
            if (Math.hypot(dx, dy) > 5) {
                state._isPanning = true;
                state.activeButton = null;
                canvas.style.cursor = 'grabbing';
                return;
            }
        }

        // Buttons use screen-space coords
        const hit = hitTestButtons(state.buttons, sx, sy);
        if (hit !== state.hoveredButton) {
            state.hoveredButton = hit;
            if (hit) {
                canvas.style.cursor = 'pointer';
            } else if (state.screen === 'playing' || state.screen === 'complete') {
                // Check hop labels first
                let overHop = false;
                const hopRects = state._hopLabelRects || [];
                for (const r of hopRects) {
                    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { overHop = true; break; }
                }
                if (overHop) {
                    canvas.style.cursor = 'pointer';
                } else {
                    // Check if hovering over an island or edge
                    let overIsland = false;
                    for (const pos of state.positions) {
                        if (Math.hypot(pos.x - x, pos.y - y) < 42) { overIsland = true; break; }
                    }
                    if (overIsland) {
                        canvas.style.cursor = 'pointer';
                    } else {
                        // Check companions
                        let overCompanion = false;
                        const cHitR = state.companionStyle === 'note' ? 40 : 28;
                        for (let ci = 0; ci < state.companions.length; ci++) {
                            const cPos = state.companionPositions[ci];
                            if (!cPos || (cPos.x === 0 && cPos.y === 0)) continue;
                            const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
                            if (!parentEdge) continue;
                            const edgeIdx = state.edges.indexOf(parentEdge);
                            if (!state.revealedEdges.has(edgeIdx) && state.screen !== 'complete') continue;
                            if (Math.hypot(cPos.x - x, cPos.y - y) < cHitR) { overCompanion = true; break; }
                        }
                        if (overCompanion) {
                            canvas.style.cursor = 'pointer';
                        } else {
                            // Check edges (clickable if source is revealed)
                            let overEdge = false;
                            for (const edge of state.edges) {
                                if (!state.revealed.has(edge.fromIdx)) continue;
                                const a = state.positions[edge.fromIdx], b = state.positions[edge.toIdx];
                                if (pointToSegmentDist(x, y, a.x, a.y, b.x, b.y) < 18) { overEdge = true; break; }
                            }
                            canvas.style.cursor = overEdge ? 'pointer' : 'grab';
                        }
                    }
                }
            } else {
                canvas.style.cursor = 'default';
            }
            redraw();
        }
    }

    function onPointerDown(e) {
        const { sx, sy } = canvasCoords(e);
        const hit = hitTestButtons(state.buttons, sx, sy);
        if (hit) {
            state.activeButton = hit;
            redraw();
        }

        // Start tracking for potential pan drag (playing/complete screens only)
        if ((state.screen === 'playing' || state.screen === 'complete') && !hit) {
            state._panStartPointer = { x: sx, y: sy };
            state._panStartView = { panX: state.viewPanX, panY: state.viewPanY };
        }
    }

    function onPointerUp(e) {
        if (state._isPanning) {
            state._suppressClick = true;
            state._isPanning = false;
            canvas.style.cursor = 'grab';
            // Rebuild buttons so reset-view button appears
            if (state.screen === 'playing') {
                state.buttons = buildPlayingButtons(w, h, state);
                redraw();
            }
        }
        state._panStartPointer = null;
        state._panStartView = null;
    }

    function onClick(e) {
        // Suppress click after a pan drag
        if (state._suppressClick) {
            state._suppressClick = false;
            return;
        }
        const { sx, sy, x, y } = canvasCoords(e);
        // Buttons use screen-space coords
        const buttonHit = hitTestButtons(state.buttons, sx, sy);
        if (buttonHit && state.activeButton === buttonHit) {
            const btn = state.buttons.find(b => b.id === buttonHit);
            state.activeButton = null;
            if (btn?.onClick) btn.onClick();
            return;
        }
        state.activeButton = null;

        if (state.screen === 'playing' || state.screen === 'complete') {
            // Hit-test hop labels first (highest priority -- they sit on top of edges)
            const hopRects = state._hopLabelRects || [];
            let hopHit = -1;
            for (let i = hopRects.length - 1; i >= 0; i--) {
                const r = hopRects[i];
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    hopHit = r.edgeIdx;
                    break;
                }
            }
            if (hopHit >= 0) {
                state.selectedNode = null;
                state.selectedEdge = hopHit;
                state.selectedCompanion = null;
                state.completeView = null;
                state.panelOverride = null;
                redraw();
                updateGamePanel(state);
                return;
            }

            // Hit-test islands (main principal nodes)
            let closest = -1, closestDist = Infinity;
            state.positions.forEach((pos, i) => {
                const d = Math.hypot(pos.x - x, pos.y - y);
                if (d < 42 && d < closestDist) { closest = i; closestDist = d; }
            });
            if (closest >= 0) {
                state.selectedNode = closest;
                state.selectedEdge = null;
                state.selectedCompanion = null;
                state.completeView = null;
                state.panelOverride = null;
                // Sync navigation position: find the edge that leads TO this node
                if (state.screen === 'playing') {
                    const edgeLeadingHere = state.edges.findIndex(e => e.toIdx === closest);
                    if (edgeLeadingHere >= 0 && state.revealedEdges.has(edgeLeadingHere)) {
                        state.currentEdge = edgeLeadingHere;
                        state.currentNode = closest;
                    } else if (closest === 0) {
                        // Clicked start node -- reset to beginning
                        state.currentEdge = -1;
                        state.currentNode = 0;
                    }
                }
            } else {
                // Hit-test companion nodes (between islands and edges in priority)
                // Companions are always clickable if their parent edge is revealed
                let companionHit = -1;
                const companionHitRadius = state.companionStyle === 'note' ? 40 : 28;
                for (let ci = 0; ci < state.companions.length; ci++) {
                    const cPos = state.companionPositions[ci];
                    if (!cPos || (cPos.x === 0 && cPos.y === 0)) continue;
                    const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
                    if (!parentEdge) continue;
                    const edgeIdx = state.edges.indexOf(parentEdge);
                    // Clickable if edge is revealed, selected, or on complete screen
                    if (!state.revealedEdges.has(edgeIdx) && state.selectedEdge !== edgeIdx && state.screen !== 'complete') continue;
                    const d = Math.hypot(cPos.x - x, cPos.y - y);
                    if (d < companionHitRadius) { companionHit = ci; break; }
                }

                if (companionHit >= 0) {
                    state.selectedNode = null;
                    state.selectedEdge = null;
                    state.selectedCompanion = companionHit;
                    state.completeView = null;
                    state.panelOverride = null;
                    // Sync navigation position to this companion's edge
                    if (state.screen === 'playing') {
                        const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(companionHit));
                        if (parentEdge) {
                            const edgeIdx = state.edges.indexOf(parentEdge);
                            state.currentEdge = edgeIdx;
                            state.currentNode = parentEdge.toIdx;
                        }
                    }
                } else {
                    // Hit-test edges (point-to-line-segment distance)
                    // Edges are clickable if source node is revealed (destination may still be hidden)
                    let bestEdge = -1, bestEdgeDist = Infinity;
                    for (let ei = 0; ei < state.edges.length; ei++) {
                        const edge = state.edges[ei];
                        if (!state.revealed.has(edge.fromIdx)) continue;
                        const a = state.positions[edge.fromIdx];
                        const b = state.positions[edge.toIdx];
                        const d = pointToSegmentDist(x, y, a.x, a.y, b.x, b.y);
                        if (d < 18 && d < bestEdgeDist) { bestEdge = ei; bestEdgeDist = d; }
                    }
                    if (bestEdge >= 0) {
                        state.selectedNode = null;
                        state.selectedEdge = bestEdge;
                        state.selectedCompanion = null;
                        state.completeView = null;
                        state.panelOverride = null;
                    } else {
                        // Empty canvas click -- do nothing, keep current selection
                        return;
                    }
                }
            }
            if (state.screen === 'playing') {
                state.buttons = buildPlayingButtons(w, h, state);
            }
            redraw();
            updateGamePanel(state);
        }
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            if (state.screen === 'playing') {
                openGameMenu(state);
            } else if (state.screen === 'paused') {
                if (state.menuView === 'keybindings' || state.menuView === 'demo-transcript') {
                    state.menuView = 'main';
                    state.menuFocusIdx = 0;
                    renderGameMenu(state);
                } else {
                    closeGameMenu(state);
                }
            }
        }
        // Menu navigation (when paused)
        if (state.screen === 'paused') {
            const focusableItems = getFocusableMenuItems(state);

            // Demo transcript: arrow keys scroll, Esc closes
            if (state.menuView === 'demo-transcript') {
                if (e.key === 'Escape') {
                    // Escape already handled above (goes back to main menu)
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const pre = menuEl?.querySelector('.mg-transcript-pre');
                    if (pre) pre.scrollTop = Math.max(0, pre.scrollTop - 60);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const pre = menuEl?.querySelector('.mg-transcript-pre');
                    if (pre) pre.scrollTop += 60;
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const pre = menuEl?.querySelector('.mg-transcript-pre');
                    if (pre) pre.scrollLeft = Math.max(0, pre.scrollLeft - 60);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    const pre = menuEl?.querySelector('.mg-transcript-pre');
                    if (pre) pre.scrollLeft += 60;
                }
                return;
            }

            if (state.menuView === 'labs-browser') {
                // Esc/Left: clear search first, then go back to main menu
                if (e.key === 'Escape' || e.key === 'ArrowLeft') {
                    if (state.labsBrowserFilter) {
                        state.labsBrowserFilter = '';
                        state.menuFocusIdx = 0;
                        renderGameMenu(state);
                    } else {
                        state.menuView = 'main';
                        state.menuFocusIdx = 0;
                        renderGameMenu(state);
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    state.menuFocusIdx = Math.max(0, state.menuFocusIdx - 1);
                    renderGameMenu(state);
                    scrollLabsBrowserItemIntoView(state);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    state.menuFocusIdx = Math.min(focusableItems.length - 1, state.menuFocusIdx + 1);
                    renderGameMenu(state);
                    scrollLabsBrowserItemIntoView(state);
                } else if (e.key === 'Enter') {
                    const focused = focusableItems[state.menuFocusIdx];
                    if (focused?.id === 'back') {
                        state.menuView = 'main'; state.menuFocusIdx = 0; renderGameMenu(state);
                    } else if (focused?.slug) {
                        switchToLab(focused.slug, state);
                    }
                } else if (e.key === 'a' || e.key === 'A') {
                    // Only intercept A when the search input is not focused
                    const searchInput = state._menuEl?.querySelector('.mg-labs-search-input');
                    if (document.activeElement !== searchInput) {
                        const focused = focusableItems[state.menuFocusIdx];
                        if (focused?.id === 'back') {
                            state.menuView = 'main'; state.menuFocusIdx = 0; renderGameMenu(state);
                        } else if (focused?.slug) {
                            switchToLab(focused.slug, state);
                        }
                    }
                }
                // All other keys (typing into search) fall through to the input naturally
                return;
            }

            // Main menu / keybindings navigation
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.menuFocusIdx = (state.menuFocusIdx - 1 + focusableItems.length) % focusableItems.length;
                renderGameMenu(state);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.menuFocusIdx = (state.menuFocusIdx + 1) % focusableItems.length;
                renderGameMenu(state);
            } else if (e.key === 'ArrowLeft') {
                if (state.menuView === 'keybindings') {
                    state.menuView = 'main';
                    state.menuFocusIdx = 0;
                    renderGameMenu(state);
                } else {
                    closeGameMenu(state);
                }
            } else if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') {
                const focused = focusableItems[state.menuFocusIdx];
                if (focused) activateMenuItem(focused.id, state);
            }
            return; // consume all keys while menu is open
        }
        // V key toggles companion visual style (ship -> islet -> note -> ship)
        if ((e.key === 'v' || e.key === 'V') && (state.screen === 'playing' || state.screen === 'complete')) {
            const styles = ['islet', 'ship', 'note'];
            const currentIdx = styles.indexOf(state.companionStyle);
            state.companionStyle = styles[(currentIdx + 1) % styles.length];
            redraw();
        }
        // I key toggles AWS icon display style (on-island -> below-label -> off)
        if ((e.key === 'i' || e.key === 'I') && (state.screen === 'playing' || state.screen === 'complete')) {
            const iconStyles = ['on-island', 'below-label', 'off'];
            const currentIdx = iconStyles.indexOf(state.iconStyle);
            state.iconStyle = iconStyles[(currentIdx + 1) % iconStyles.length];
            redraw();
        }
        // T key toggles island visual style (classic -> wooded -> tropical -> ruins)
        if ((e.key === 't' || e.key === 'T') && (state.screen === 'playing' || state.screen === 'complete')) {
            const islandStyles = ['classic', 'wooded', 'tropical', 'ruins'];
            const currentIdx = islandStyles.indexOf(state.islandStyle);
            state.islandStyle = islandStyles[(currentIdx + 1) % islandStyles.length];
            redraw();
        }
        // P key toggles plane visual style (jet -> biplane -> seaplane -> helicopter)
        if ((e.key === 'p' || e.key === 'P') && (state.screen === 'playing' || state.screen === 'complete')) {
            const planeStyles = ['jet', 'biplane', 'seaplane', 'helicopter'];
            const currentIdx = planeStyles.indexOf(state.planeStyle);
            state.planeStyle = planeStyles[(currentIdx + 1) % planeStyles.length];
            redraw();
        }
        // R key resets the view (pan/zoom) to default
        if ((e.key === 'r' || e.key === 'R') && (state.screen === 'playing' || state.screen === 'complete')) {
            if (state.viewZoom !== 1 || state.viewPanX !== 0 || state.viewPanY !== 0) {
                state.viewPanX = 0;
                state.viewPanY = 0;
                state.viewZoom = 1;
                if (state.screen === 'playing') {
                    state.buttons = buildPlayingButtons(w, h, state);
                }
                redraw();
            }
        }
        // D key: open simulated demo transcript (if available)
        if ((e.key === 'd' || e.key === 'D') && state.screen === 'playing') {
            if (state.lab?.hasDemoTranscript) {
                openGameMenu(state);
                loadDemoTranscript(state);
            }
        }
        // Left arrow: same as Back button
        if (e.key === 'ArrowLeft' && state.screen === 'playing') {
            retreatGameState(w, h, state);
        }
        // Right arrow: same as Next button
        if (e.key === 'ArrowRight' && state.screen === 'playing') {
            advanceGameState(w, h, state);
        }
        // A key: progressively reveal the next hidden hint on the current edge panel
        if ((e.key === 'a' || e.key === 'A') && state.screen === 'playing') {
            const panelEl = state._panelEl;
            const edgeIdx = state.selectedEdge;
            const isShowingEdge = edgeIdx !== null && edgeIdx !== undefined
                && state.selectedNode === null
                && state.selectedCompanion === null;
            if (isShowingEdge && panelEl) {
                const edge = state.edges[edgeIdx];
                const hints = edge ? (edge.hints || []) : [];
                if (hints.length > 0) {
                    const key = `edge-${edgeIdx}`;
                    if (!state.revealedHints[key]) state.revealedHints[key] = new Set();
                    const revealedSet = state.revealedHints[key];
                    // Find the lowest-indexed hint not yet revealed
                    const nextHintIdx = hints.findIndex((_, i) => !revealedSet.has(i));
                    if (nextHintIdx !== -1) {
                        revealedSet.add(nextHintIdx);
                        state.hintsUsed++;
                        renderGamePanelEdge(panelEl, state);
                        scrollHintIntoView(panelEl, nextHintIdx);
                    }
                }
            }
        }
    }

    function onWheel(e) {
        if (state.screen !== 'playing' && state.screen !== 'complete') return;
        e.preventDefault();
        const { sx, sy } = canvasCoords(e);
        const oldZoom = state.viewZoom;
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.4, Math.min(3.0, oldZoom * zoomFactor));

        // Adjust pan so the point under cursor stays fixed
        state.viewPanX = sx - (sx - state.viewPanX) * (newZoom / oldZoom);
        state.viewPanY = sy - (sy - state.viewPanY) * (newZoom / oldZoom);
        state.viewZoom = newZoom;

        // Rebuild buttons so reset-view button appears/disappears
        if (state.screen === 'playing') {
            state.buttons = buildPlayingButtons(w, h, state);
        }
        redraw();
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);

    // ResizeObserver: recompute layout when container is resized
    const resizeObserver = new ResizeObserver(() => {
        const newW = wrap.clientWidth;
        const newH = wrap.clientHeight;
        if (newW === w && newH === h) return;
        if (newW < 1 || newH < 1) return; // guard against collapse

        w = newW;
        h = newH;
        state._w = w;
        state._h = h;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Recompute layout for new dimensions
        state.positions = computeMapLayout(state.nodes.length, w, h);
        state.companionPositions = computeCompanionPositions(state.companions, state.edges, state.positions);
        const allDeco = generateMapDecorations(state.positions, w, h);
        state.decorations = allDeco.filter(d => d.type !== 'mountain');

        // Reset view transform since positions are recalculated for the new size
        state.viewPanX = 0;
        state.viewPanY = 0;
        state.viewZoom = 1;

        // Rebuild buttons for current screen
        if (state.screen === 'playing') {
            state.buttons = buildPlayingButtons(w, h, state);
        } else if (state.screen === 'paused') {
            // Menu is HTML-based; canvas buttons stay empty
        } else if (state.screen === 'complete') {
            state.buttons = buildCompleteButtons(w, h, state);
        }
        redraw();
    });
    resizeObserver.observe(wrap);

    canvas._mapGameCleanup = () => {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('click', onClick);
        canvas.removeEventListener('wheel', onWheel);
        document.removeEventListener('keydown', onKeyDown);
        resizeObserver.disconnect();
    };
}


// ---- Static Map Preview (for Single Page Mode) ----

function renderStaticMapPreview(containerEl, lab) {
    // Parse attack map data (same logic as renderLabDetailContentMapGame)
    let mapNodes = [];
    let mapEdges = [];
    let mapCompanions = [];
    if (lab.attackMap?.nodes?.length) {
        const parsed = parseAttackMapToGameNodes(lab.attackMap);
        mapNodes = parsed.nodes;
        mapEdges = parsed.edges;
        mapCompanions = parsed.companions || [];
    }
    if (mapNodes.length === 0) {
        const readme = lab.readme;
        const mermaidData = parseMermaidToSteps(readme?.attackDiagram);
        const attackSteps = parseAttackStepsToCards(readme?.attackSteps);
        if (mermaidData.steps.length > 0) {
            mapNodes.push({
                label: mermaidData.steps[0].fromNode.label,
                type: getNodeTypeFromColor(mermaidData.steps[0].fromNode.color),
            });
            mermaidData.steps.forEach((step, i) => {
                mapNodes.push({
                    label: step.toNode.label,
                    type: getNodeTypeFromColor(step.toNode.color),
                });
                mapEdges.push({
                    fromIdx: mapNodes.length - 2,
                    toIdx: mapNodes.length - 1,
                    label: step.edgeLabel || '',
                    description: (attackSteps[i]?.desc || '').trim(),
                    commands: attackSteps[i]?.commands || [],
                    hints: [],
                    implicit: false,
                });
            });
        }
    }
    if (mapNodes.length === 0) return;

    const canvas = document.createElement('canvas');
    containerEl.appendChild(canvas);

    const w = containerEl.clientWidth;
    const h = 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const positions = computeMapLayout(mapNodes.length, w, h);
    const companionPositions = computeCompanionPositions(mapCompanions, mapEdges, positions);
    const allDecorations = generateMapDecorations(positions, w, h);
    const decorations = allDecorations.filter(d => d.type !== 'mountain');
    const palette = getGameUIPalette();

    // Build a minimal state object for the drawing functions
    // Use 'playing' screen so the map with islands is drawn (not the start overlay)
    const state = {
        screen: 'playing',
        revealed: new Set(mapNodes.map((_, i) => i)),
        currentNode: 0,
        currentEdge: -1,
        revealedEdges: new Set(mapEdges.map((_, i) => i)),
        revealedCommands: new Set(),
        selectedNode: null,
        selectedEdge: null,
        selectedCompanion: null,
        completeView: null,
        gameViewPhase: 'navigation',
        panelOverride: null,
        positions,
        companionPositions,
        companions: mapCompanions,
        companionStyle: 'islet',
        iconStyle: 'on-island',
        islandStyle: 'wooded',
        planeStyle: 'helicopter',
        nodes: mapNodes,
        edges: mapEdges,
        decorations,
        hintsUsed: 0,
        revealedHints: {},
        hoveredButton: null,
        activeButton: null,
        hoveredHop: null,
        buttons: [],
        lab,
        palette,
        _redraw: null,
        _panelEl: null,
    };

    function draw() {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Draw the map with islands and paths (no HUD or overlays)
        drawMapWithGameLabels(ctx, w, h, state);
        ctx.restore();
    }

    awsIconSprites.preload(mapNodes);
    if (mapCompanions) awsIconSprites.preload(mapCompanions);
    cloudSprites.load().then(() => draw());
    awsIconSprites.onLoadCallbacks.push(() => draw());
    draw();
}


// Render a clean map with top HUD (no bottom bar or overlays) to an offscreen canvas for download/share
function buildCleanMapCanvas(w, h, state) {
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const p = state.palette;

    // Temporarily switch to playing screen so drawMapWithGameLabels renders cleanly
    const origScreen = state.screen;
    state.screen = 'playing';
    drawMapWithGameLabels(ctx, w, h, state);
    drawEdgeHopLabels(ctx, w, h, state);
    state.screen = origScreen;

    // Draw top HUD bar with title and lab name
    const topH = 36;
    drawRoundedRect(ctx, 6, 4, w - 12, topH, 8);
    ctx.fillStyle = p.hudBg;
    ctx.fill();
    ctx.strokeStyle = p.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.hudText;
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const title = state.lab?.name
        ? `Pathfinding.cloud Labs  -  ${state.lab.name}`
        : 'Pathfinding.cloud Labs';
    ctx.fillText(title, w / 2, 22);

    return canvas;
}

// ---- Share / Download Utilities ----

// Download a canvas as a PNG file
function downloadCanvasAsImage(canvas, filename) {
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}

function labShareAction(action, canvas, lab) {
    const labSlug = lab.slug || lab.id || 'lab';
    const labUrl = `https://pathfinding.cloud/labs/${labSlug}`;
    const filename = `${labSlug}-attack-map.png`;

    // Share message: informative, not "I completed" -- just spreading awareness
    const shareText = `${lab.name} -- a free, hands-on AWS attack path lab. Deploy it, exploit it, and learn to detect it.`;

    // For social platforms: download the map image first so the user can attach it,
    // then open the share dialog with pre-populated text and link.
    // navigator.share() is used when available since it supports attaching files directly.
    switch (action) {
        case 'download':
            downloadCanvasAsImage(canvas, filename);
            break;

        case 'linkedin':
            if (canvas) downloadCanvasAsImage(canvas, filename);
            window.open(
                `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(labUrl)}`,
                '_blank'
            );
            break;

        case 'twitter':
            if (canvas) downloadCanvasAsImage(canvas, filename);
            window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(labUrl)}`,
                '_blank'
            );
            break;

        case 'bluesky':
            if (canvas) downloadCanvasAsImage(canvas, filename);
            window.open(
                `https://bsky.app/intent/compose?text=${encodeURIComponent(shareText + '\n\n' + labUrl)}`,
                '_blank'
            );
            break;

        case 'mastodon':
            if (canvas) downloadCanvasAsImage(canvas, filename);
            window.open(
                `https://mastodonshare.com/?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(labUrl)}`,
                '_blank'
            );
            break;

        case 'copy-link': {
            navigator.clipboard.writeText(labUrl).then(() => {
                // Feedback handled by caller if needed
            });
            break;
        }

        case 'native-share':
            if (canvas) {
                canvas.toBlob(async (blob) => {
                    try {
                        const file = new File([blob], filename, { type: 'image/png' });
                        await navigator.share({ title: lab.name, text: shareText, url: labUrl, files: [file] });
                    } catch (_) {
                        try { await navigator.share({ title: lab.name, text: shareText, url: labUrl }); } catch (_) {}
                    }
                }, 'image/png');
            } else {
                navigator.share({ title: lab.name, text: shareText, url: labUrl }).catch(() => {});
            }
            break;
    }
}
