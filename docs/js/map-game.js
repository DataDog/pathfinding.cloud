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

// ---- Play Online: flip to true when the API Gateway / Lambda backend is deployed ----
// When false, all labs show "Coming Soon" tease. When true, labs with
// supportsOnlineMode: true in their YAML will open a live terminal session.
const PLAY_ONLINE_GLOBALLY_ENABLED = false;

// ---- Demo/dev mode: when true, the terminal uses mock responses instead of a real API ----
// Set PLAY_ONLINE_GLOBALLY_ENABLED = true and this = true to test the terminal UI locally.
// Flip both to false (and set per-lab supportsOnlineMode: true) when the real backend is ready.
const PLAY_ONLINE_MOCK_MODE = false;

// ---- Preload pixel font for arcade start overlay ----
(function () {
    if (!document.getElementById('arcade-font-link')) {
        const link = document.createElement('link');
        link.id = 'arcade-font-link';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
        document.head.appendChild(link);
    }
}());

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
        const ids = [2, 4, 5, 6, 7, 10, 14, 17, 20];
        const promises = ids.map(id => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { this.images.push(img); resolve(); };
            img.onerror = () => resolve(); // skip missing images gracefully
            img.src = `/img/clouds/cloud-${id}.png`;
        }));
        return Promise.all(promises).then(() => { this.loaded = true; });
    },
    // Draw clouds in the upper portion of the canvas, below the top HUD bar.
    // hudTopOverride moves the top boundary (can be negative so clouds drift
    // above y=0 — useful when the caller draws the map inside a translated
    // zone and wants clouds to extend up into the header band above it).
    // bottomOverride replaces the default cloudMaxY = h * 0.20 so callers can
    // widen or narrow the cloud band without having to fake the `h` argument.
    // countOverride lets callers pack more clouds into a wide cloud band
    // (e.g. the hero generator with no title, which needs the top third to
    // read as a dense cloud layer rather than sparse dots).
    draw(ctx, w, h, seed, hudTopOverride, bottomOverride, countOverride, scaleRange) {
        if (!this.images.length) return;
        const rng = mapRng(seed || 99);
        const hudTop = hudTopOverride ?? 52;  // generous buffer below top HUD bar
        const cloudMaxY = bottomOverride ?? (h * 0.20);  // default: top ~20% of the map zone
        const count = countOverride ?? Math.max(7, Math.floor(w / 100)); // more clouds
        const scaleMin = scaleRange?.min ?? 2.0;
        const scaleMax = scaleRange?.max ?? 4.0;
        for (let i = 0; i < count; i++) {
            const img = this.images[Math.floor(rng() * this.images.length)];
            const scale = scaleMin + rng() * (scaleMax - scaleMin);
            // Distribute clouds evenly across the full canvas width with random jitter
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const segment = w / count;
            const baseX = (i + 0.5) * segment;
            const jitter = (rng() - 0.5) * segment * 0.6;
            const x = Math.max(drawW / 2, Math.min(w - drawW / 2, baseX + jitter));
            // Position so the cloud's bottom edge doesn't exceed cloudMaxY
            const maxCenterY = cloudMaxY - drawH / 2;
            const minCenterY = hudTop + drawH / 2;
            const rawY = hudTop + 10 + rng() * Math.max(0, cloudMaxY - hudTop - 10);
            const y = Math.max(minCenterY, Math.min(maxCenterY, rawY));
            ctx.globalAlpha = 0.7 + rng() * 0.3;
            ctx.drawImage(img, x - drawW / 2, y - drawH / 2, drawW, drawH);
        }
        ctx.globalAlpha = 1;
    },
};

// Helicopter sprite loader -- pixel-art PNG replaces the procedural helicopter drawing.
// Falls back to the procedural renderer if the image hasn't loaded yet.
const helicopterSprite = {
    img: null,
    loaded: false,
    onLoadCallbacks: [],
    load() {
        if (this.loaded) return Promise.resolve();
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.img = img;
                this.loaded = true;
                this.onLoadCallbacks.forEach(cb => { try { cb(); } catch (_) {} });
                resolve();
            };
            img.onerror = () => { this.loaded = true; resolve(); };
            img.src = '/img/helicopter.png';
        });
    },
};

// Floating-island sprite loader -- hand-drawn pixel-art replacements for the
// procedural wooded principal island, the flag-shape target island, and the
// rocky companion islet. Loaded async; renderers fall back to the procedural
// shapes if a sprite fails to load or the first frame paints before the load
// completes. Callers should push onto onLoadCallbacks to redraw once sprites
// arrive (mirrors the awsIconSprites pattern).
const islandSprites = {
    images: { principal: null, target: null, resource: null },
    loaded: false,
    onLoadCallbacks: [],
    load() {
        if (this.loaded) return Promise.resolve();
        const sources = [
            { key: 'principal', src: '/img/islands/principal-island.png' },
            { key: 'target',    src: '/img/islands/target-island.png' },
            { key: 'resource',  src: '/img/islands/resource-island.png' },
        ];
        const promises = sources.map(({ key, src }) => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { this.images[key] = img; resolve(); };
            img.onerror = () => resolve();  // fall back to procedural if the file is missing
            img.src = src;
        }));
        return Promise.all(promises).then(() => {
            this.loaded = true;
            this.onLoadCallbacks.forEach(cb => { try { cb(); } catch (_) { /* swallow */ } });
        });
    },
    get(key) { return this.images[key] || null; },
};

// Draw a floating-island sprite centered horizontally at pos.x, with the
// grass-top surface anchored near pos.y so AWS icons / banners overlay onto
// the grass the same way they do on the procedural islands.
//
// `footprintWidth` matches the procedural island's outer-shore width so the
// sprite occupies the same visual footprint:
//
//   wooded principal shore = islandRadius * 2.24  -> use ~2.4 * islandRadius
//   companion islet shore  = islandRadius * 2.4
//
// `grassCenterFromTop` (0..1) is the fractional vertical position of the
// grass center within the PNG. The principal and resource sprites have grass
// near the top of the PNG (no upward-protruding decorations), but the target
// sprite has a flag pole that sticks up to the top of the PNG, pushing the
// grass surface down to about the middle of the PNG. Per-sprite anchors keep
// every island's grass surface visually aligned at pos.y.
//
// Returns true if the sprite was drawn, false if it isn't loaded yet so the
// caller can fall back to the procedural renderer.
const ISLAND_SPRITE_GRASS_CENTER = {
    principal: 0.40,
    target:    0.50,   // flag pole occupies the top of the PNG
    resource:  0.40,
};

// Per-sprite footprint multiplier (sprite display width = islandRadius * scale).
// Principal islands are bumped 25% over the procedural shore footprint (which
// the target/resource sprites still match) so the principals read as the
// dominant nodes on the path; target/resource islands stay at the procedural
// scale to preserve the visual hierarchy.
const ISLAND_SPRITE_FOOTPRINT_SCALE = {
    principal: 2.7,
    target:    3.0,
    resource:  3.0,
};
function drawIslandSpriteFor(ctx, img, pos, footprintWidth, grassCenterFromTop = 0.40) {
    if (!img || !img.naturalWidth) return false;
    const aspect = img.naturalHeight / img.naturalWidth;
    const w = footprintWidth;
    const h = w * aspect;
    const x = pos.x - w / 2;
    const y = pos.y - h * grassCenterFromTop;
    ctx.drawImage(img, x, y, w, h);
    return true;
}

// Compute the y-coordinate of the visual bottom of the island sprite for a
// given island, falling back to the procedural ellipse-shore bottom if the
// sprite isn't loaded. Used to position labels just below the full island
// silhouette instead of at the (much shallower) procedural shoreline.
function getIslandBottomY(pos, islandRadius, spriteKey, footprintWidth) {
    const img = islandSprites.get(spriteKey);
    if (img && img.naturalWidth) {
        const scale = ISLAND_SPRITE_FOOTPRINT_SCALE[spriteKey] ?? 2.4;
        const w = footprintWidth ?? (islandRadius * scale);
        const h = w * (img.naturalHeight / img.naturalWidth);
        const grassCenterFromTop = ISLAND_SPRITE_GRASS_CENTER[spriteKey] ?? 0.40;
        return pos.y + h * (1 - grassCenterFromTop);
    }
    // Procedural shore-bottom: ellipse y-radius (0.42 for principal, 0.45 for
    // companion). Caller can pass islandRadius * 0.45 for companion sites.
    return pos.y + islandRadius * 0.42;
}

// Pick the sprite that drawGameMap renders for a given node, so the label
// code can compute the matching bottom-edge offset. Returns null when the
// node would render via the procedural fallback (e.g. islandStyle other than
// wooded, or fortress target style).
function pickIslandSpriteKey(state, nodeIdx) {
    const node = state.nodes?.[nodeIdx];
    const isTarget = !!node?.isTarget;
    const targetStyle = state.targetStyle || 'flag-shape';
    if (isTarget && targetStyle === 'flag-shape') return 'target';
    if (isTarget && targetStyle === 'fortress') return null;  // own renderer, no sprite
    if (state.islandStyle === 'wooded') return 'principal';
    return null;
}

// Adding a new resource type? Add an entry in BOTH awsIconSprites.iconPaths below
// AND SUBTYPE_DISPLAY so the icon renders AND the human-readable label shows up
// in the objective/guided-challenge pills. Keep the keys identical.

// Human-readable display labels for subTypes. Consumed by labs.js (single-page view)
// and any other view that wants to pill-ify the subType field.
const SUBTYPE_DISPLAY = {
    'iam-role':              'IAM Role',
    'iam-user':              'IAM User',
    'iam-policy':            'IAM Policy',
    'iam-group':             'IAM Group',
    'ec2-instance':          'EC2 Instance',
    'lambda-function':       'Lambda Function',
    'codebuild-project':     'CodeBuild Project',
    'cloudformation-stack':  'CloudFormation Stack',
    's3-bucket':             'S3 Bucket',
    'sagemaker-notebook':    'SageMaker Notebook',
    'glue-job':              'Glue Job',
    'ecs-task':              'ECS Task',
    'dynamodb-table':        'DynamoDB Table',
    'bedrock-agent':         'Bedrock AgentCore',
    'apprunner-service':     'App Runner Service',
    'mwaa-environment':      'MWAA Environment',
    'ssm-parameter':         'SSM Parameter',
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
        'ssm-parameter':         '/img/aws-icons/Resource-Icons_01302026/Res_Management-Governance/Res_AWS-Systems-Manager_Parameter-Store_48.png',
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
    const isActive = activeId === btn.id || !!btn.forceActive;
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
    } else if (style === 'terminal') {
        // Option A: hacker-terminal look — black bg, Matrix green text, monospace, scanlines
        const bgColor = isActive ? '#001a00' : isHovered ? '#001f00' : '#0a0a0a';
        const borderColor = isActive ? '#00ff41' : isHovered ? '#00cc33' : '#007a1f';
        const textColor = isActive ? '#ffffff' : '#00ff41';
        // Shadow
        drawRoundedRect(ctx, x + 1, y + 2, w, h, r);
        ctx.fillStyle = 'rgba(0, 255, 65, 0.08)';
        ctx.fill();
        // Body
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.fillStyle = bgColor;
        ctx.fill();
        // Scanlines
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(0, 255, 65, 0.04)';
        ctx.lineWidth = 1;
        for (let ly = y + 2; ly < y + h; ly += 3) {
            ctx.beginPath();
            ctx.moveTo(x, ly);
            ctx.lineTo(x + w, ly);
            ctx.stroke();
        }
        ctx.restore();
        // Border
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isHovered ? 2 : 1.5;
        ctx.stroke();
        // Glow on hover
        if (isHovered || isActive) {
            ctx.save();
            ctx.shadowColor = '#00ff41';
            ctx.shadowBlur = 8;
            drawRoundedRect(ctx, x, y, w, h, r);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }
        // Label with prompt prefix
        ctx.fillStyle = textColor;
        ctx.font = `bold ${btn.fontSize || 12}px 'Courier New', Courier, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btn.label, x + w / 2, y + h / 2);
    } else if (style === 'danger') {
        // Option B: danger-parchment — warm parchment silhouette with crimson/amber warning tint
        const base = isActive ? '#5a1a1a' : isHovered ? '#7a2020' : '#4a1515';
        drawRoundedRect(ctx, x + 1, y + 2, w, h, r);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fill();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.fillStyle = base;
        ctx.fill();
        // Worn texture lines
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(220,60,60,0.08)';
        ctx.lineWidth = 0.6;
        for (let ly = y + 5; ly < y + h; ly += 6) {
            ctx.beginPath();
            ctx.moveTo(x + 4, ly + Math.sin(ly * 0.3) * 2);
            ctx.lineTo(x + w - 4, ly + Math.sin(ly * 0.3 + 1) * 2);
            ctx.stroke();
        }
        ctx.restore();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.strokeStyle = isHovered ? '#f59e0b' : '#c0392b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = isHovered ? '#fde68a' : '#fca5a5';
        ctx.font = `bold ${btn.fontSize || 13}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u2620 ' + btn.label, x + w / 2, y + h / 2);
    } else if (style === 'void') {
        // Option C: void/purple — dark bg with purple glow border, on-theme but clearly special
        const bgColor = isActive ? '#1e0a3c' : isHovered ? '#2d1257' : '#160830';
        const borderColor = isActive ? '#a78bfa' : isHovered ? '#7c3aed' : '#4c1d95';
        drawRoundedRect(ctx, x + 1, y + 2, w, h, r);
        ctx.fillStyle = 'rgba(124, 58, 237, 0.1)';
        ctx.fill();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.fillStyle = bgColor;
        ctx.fill();
        drawRoundedRect(ctx, x, y, w, h, r);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isHovered ? 2 : 1.5;
        ctx.stroke();
        if (isHovered || isActive) {
            ctx.save();
            ctx.shadowColor = '#7c3aed';
            ctx.shadowBlur = 10;
            drawRoundedRect(ctx, x, y, w, h, r);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }
        ctx.fillStyle = isHovered ? '#ede9fe' : '#c4b5fd';
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

    // Draw "SOON" badge in top-right corner for coming-soon buttons
    if (btn.comingSoon) {
        const badgeW = 32;
        const badgeH = 13;
        const badgeX = x + w - badgeW + 5;
        const badgeY = y - 5;
        const badgeR = 3;
        ctx.save();
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeR);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 7px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SOON', badgeX + badgeW / 2, badgeY + badgeH / 2);
        ctx.restore();
    }
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
    const { positions, nodes } = state;
    const lastIdx = nodes.length - 1;
    const ir = state.islandRadius || 52;
    const n = nodes.length;

    // ---- 1. Font scale ---------------------------------------------------
    // Shrink label fonts on narrow canvases so plates don't crowd each other.
    // Effective per-island X budget (matches padX = w*0.15 in computeMapLayout).
    const xSpacing = n > 1 ? (w * 0.70) / (n - 1) : w;
    // "Startington" at bold 13px is ~110px wide — use that as the full-size budget.
    const S = Math.max(0.68, Math.min(1.0, xSpacing / 110));

    // Pre-computed scaled sizes so both passes share one definition.
    const fz = {
        name: Math.round(13 * S),
        sub:  Math.max(7,  Math.round(9  * S)),
        mid:  Math.round(12 * S),
        icon: Math.round(32 * S),
        padE: Math.round(Math.max(4, 8 * S)),
        padM: Math.round(Math.max(3, 6 * S)),
        gapI: Math.round(Math.max(2, 4 * S)),
        gapA: Math.round(Math.max(4, 8 * S)),
        margE: Math.round(Math.max(10, 16 * S)),
        margS: Math.round(Math.max(8,  12 * S)),
        margM: Math.round(Math.max(8,  14 * S)),
        margI: Math.round(Math.max(8,  12 * S)),
    };

    // ---- 2. Measurement pass: compute plate geometry for every island ----
    // Returns all the sizing info needed for both collision detection and drawing.
    function measureNode(i) {
        const pos = positions[i];
        const isFirst = i === 0, isLast = i === lastIdx;
        const node = nodes[i];

        let label = node?.displayLabel || '';
        if (!label) label = isFirst ? 'Startington' : isLast ? 'Targetville' : (node?.label || '');
        if (label.length > 20) label = label.substring(0, 18) + '...';
        if (!label) return null;

        const resolvedIconStyle = state.effectiveIconStyle || state.iconStyle;
        const blIcon = resolvedIconStyle === 'below-label'
            ? awsIconSprites.get(node?.subType || '') : null;

        const spriteKey = pickIslandSpriteKey(state, i);
        const labelY   = getIslandBottomY(pos, ir, spriteKey) - 20;
        const plateTop = labelY - 2;

        let plateW, plateH, subtitleText = '';
        if (isFirst || isLast) {
            const arn = node?.arn || '';
            const arnSuffix = arn.includes(':') ? arn.substring(arn.lastIndexOf(':') + 1) : '';
            const accessObj = isFirst ? node?.access : null;
            const rawEndpoint = accessObj?.url || accessObj?.ip || accessObj?.domain || '';
            // Suppress the resource name subtitle on narrow viewports to avoid label crowding.
            const suppressSubtitle = window.innerWidth < 1600;
            subtitleText = suppressSubtitle ? '' : (node?.displaySubtitle !== undefined
                ? node.displaySubtitle
                : (rawEndpoint || arnSuffix));

            ctx.font = `bold ${fz.name}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const tw   = ctx.measureText(label).width;
            ctx.font = `500 ${fz.sub}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const idTw = subtitleText ? ctx.measureText(subtitleText).width : 0;

            const iconH  = blIcon ? fz.icon : 0;
            const iconGp = blIcon ? fz.gapI : 0;
            const arnH   = subtitleText ? fz.sub : 0;
            const arnGp  = subtitleText ? (blIcon ? fz.gapI : fz.gapA) : 0;
            const contentH = fz.name + iconGp + iconH + arnGp + arnH;
            plateH = contentH + fz.padE * 2;
            plateW = Math.max(tw + fz.margE, idTw + fz.margS, blIcon ? fz.icon + fz.margI : 0);
        } else {
            ctx.font = `600 ${fz.mid}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const tw   = ctx.measureText(label).width;
            const iconH  = blIcon ? fz.icon : 0;
            const iconGp = blIcon ? fz.gapI : 0;
            const contentH = fz.mid + iconGp + iconH;
            plateH = contentH + fz.padM * 2;
            plateW = Math.max(tw + fz.margM, blIcon ? fz.icon + fz.margI : 0);
        }

        // Unconstrained center X (will be adjusted by xAdj in step 3, then clamped)
        const nominalX = pos.x;
        return { i, pos, label, isFirst, isLast, node, subtitleText,
                 blIcon, plateTop, plateH, plateW, nominalX };
    }

    const infos = positions.map((_, i) => measureNode(i));

    // ---- 3. Collision detection + iterative horizontal push --------------
    // Check label plates against each other AND against island bodies.
    // Push overlapping pairs apart horizontally until stable.

    const xAdj = new Float32Array(n); // X adjustment per label (added to nominalX before clamping)

    // Island body AABB (axis-aligned bounding box) used as a fixed obstacle.
    // Sprite body spans ir*2.7 wide, centered on pos.x; vertically pos.y ± ~ir*1.35.
    function islandBodyRect(pos) {
        const hw = ir * 1.35, hh = ir * 1.35;
        return { x: pos.x - hw, y: pos.y - hh, w: hw * 2, h: hh * 2 };
    }

    function effectiveLabelRect(info, adj) {
        const cx = Math.max(info.plateW / 2 + 4, Math.min(w - info.plateW / 2 - 4, info.nominalX + adj));
        return { x: cx - info.plateW / 2, y: info.plateTop, w: info.plateW, h: info.plateH, cx };
    }

    function rectsOverlap(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x
            && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    for (let pass = 0; pass < 6; pass++) {
        let moved = false;

        // Label–label overlaps: push apart
        for (let i = 0; i < n; i++) {
            if (!infos[i]) continue;
            for (let j = i + 1; j < n; j++) {
                if (!infos[j]) continue;
                const ra = effectiveLabelRect(infos[i], xAdj[i]);
                const rb = effectiveLabelRect(infos[j], xAdj[j]);
                if (!rectsOverlap(ra, rb)) continue;
                const xOverlap = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
                const push = xOverlap / 2 + 1;
                if (ra.cx <= rb.cx) { xAdj[i] -= push; xAdj[j] += push; }
                else                { xAdj[i] += push; xAdj[j] -= push; }
                moved = true;
            }
        }

        // Label–island-body overlaps: push label away from the obstructing island
        for (let i = 0; i < n; i++) {
            if (!infos[i]) continue;
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const rl = effectiveLabelRect(infos[i], xAdj[i]);
                const rb = islandBodyRect(positions[j]);
                if (!rectsOverlap(rl, rb)) continue;
                const xOverlap = Math.min(rl.x + rl.w, rb.x + rb.w) - Math.max(rl.x, rb.x);
                // Push label away from island center
                const dir = rl.cx < positions[j].x ? -1 : 1;
                xAdj[i] += dir * (xOverlap + 1);
                moved = true;
            }
        }

        if (!moved) break;
    }

    // Final clamp: keep every plate inside canvas bounds
    for (let i = 0; i < n; i++) {
        if (!infos[i]) continue;
        const pw = infos[i].plateW;
        const adjCx = infos[i].nominalX + xAdj[i];
        const clampedCx = Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, adjCx));
        xAdj[i] = clampedCx - infos[i].nominalX;
    }

    // ---- 4. Draw pass ----------------------------------------------------
    infos.forEach(info => {
        if (!info) return;
        const { i, pos, label, isFirst, isLast, node, subtitleText,
                blIcon, plateTop, plateH, plateW } = info;

        // Final clamped center X after overlap resolution
        const drawX = Math.max(plateW / 2 + 4,
                        Math.min(w - plateW / 2 - 4, info.nominalX + xAdj[i]));

        const isActiveNode = state.selectedNode === i;

        ctx.save();
        if (!isHeliRevealed(state, `node:${i}`)) ctx.globalAlpha = 0.25;
        if (isFirst || isLast) {
            const defaultNameColor = isFirst ? (p.startFill || '#4ade80') : (p.endFill || '#f59e0b');
            const nameColor = isActiveNode ? '#fff' : defaultNameColor;

            // Re-measure with the same scaled fonts for accurate text centering
            ctx.font = `bold ${fz.name}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const tw   = ctx.measureText(label).width;
            ctx.font = `500 ${fz.sub}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const idTw = subtitleText ? ctx.measureText(subtitleText).width : 0;

            const iconH  = blIcon ? fz.icon : 0;
            const iconGp = blIcon ? fz.gapI : 0;
            const arnH   = subtitleText ? fz.sub : 0;
            const arnGp  = subtitleText ? (blIcon ? fz.gapI : fz.gapA) : 0;
            const contentH = fz.name + iconGp + iconH + arnGp + arnH;
            const contentW = Math.max(tw + fz.margE, idTw + fz.margS,
                                      blIcon ? fz.icon + fz.margI : 0);

            drawRoundedRect(ctx, drawX - contentW / 2, plateTop, contentW, plateH, 5);
            if (isActiveNode) {
                ctx.fillStyle = p.hudProgressFill || '#7c3aed';
            } else {
                ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.9)';
            }
            ctx.fill();
            ctx.strokeStyle = isActiveNode ? (p.hudProgressFill || '#7c3aed') : (p.borderDecor || 'rgba(120, 80, 20, 0.3)');
            ctx.lineWidth = 0.8;
            ctx.stroke();

            let cursorY = plateTop + fz.padE + fz.name / 2;
            ctx.font = `bold ${fz.name}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.fillStyle = nameColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, drawX, cursorY);
            cursorY += fz.name / 2;

            if (blIcon) {
                cursorY += iconGp;
                ctx.drawImage(blIcon, drawX - fz.icon / 2, cursorY, fz.icon, fz.icon);
                cursorY += iconH;
            }
            if (subtitleText) {
                cursorY += arnGp + arnH / 2;
                ctx.font = `500 ${fz.sub}px -apple-system, BlinkMacSystemFont, sans-serif`;
                ctx.fillStyle = isActiveNode ? 'rgba(255,255,255,0.75)' : (p.mutedText || 'rgba(180, 160, 120, 0.9)');
                ctx.fillText(subtitleText, drawX, cursorY);
            }
        } else {
            ctx.font = `600 ${fz.mid}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const tw = ctx.measureText(label).width;

            const iconH  = blIcon ? fz.icon : 0;
            const iconGp = blIcon ? fz.gapI : 0;
            const contentH = fz.mid + iconGp + iconH;
            const computedPlateH = contentH + fz.padM * 2;
            const plateWM = Math.max(tw + fz.margM, blIcon ? fz.icon + fz.margI : 0);

            drawRoundedRect(ctx, drawX - plateWM / 2, plateTop, plateWM, computedPlateH, 4);
            if (isActiveNode) {
                ctx.fillStyle = p.hudProgressFill || '#7c3aed';
            } else {
                ctx.fillStyle = p.parchCenter || 'rgba(245, 230, 200, 0.9)';
            }
            ctx.fill();
            ctx.strokeStyle = isActiveNode ? (p.hudProgressFill || '#7c3aed') : (p.borderDecor || 'rgba(120, 80, 20, 0.2)');
            ctx.lineWidth = 0.6;
            ctx.stroke();

            let cursorY = plateTop + fz.padM + fz.mid / 2;
            ctx.fillStyle = isActiveNode ? '#fff' : (p.labelFill || '#e4e4e8');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, drawX, cursorY);
            cursorY += fz.mid / 2;

            if (blIcon) {
                cursorY += iconGp;
                ctx.drawImage(blIcon, drawX - fz.icon / 2, cursorY, fz.icon, fz.icon);
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
    const img = helicopterSprite.img;
    if (img && img.naturalWidth) {
        // Sprite: draw at 52px wide, vertically centered so the body sits above the island surface.
        // The sprite faces right and has a transparent background, so no extra compositing needed.
        const displayW = 65;
        const displayH = displayW * (img.naturalHeight / img.naturalWidth);
        // Center the sprite on (x+4, y-28) so it aligns with the glow ring in drawPlaneIndicator.
        ctx.drawImage(img, x - displayW / 2 + 4, y - displayH / 2 - 28, displayW, displayH);
        return;
    }

    // Procedural fallback while sprite loads
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
// The plane is drawn at 1.5x scale for better visibility.
function drawPlaneIndicator(ctx, x, y, palette, style) {
    const renderer = planeStyleRenderers[style] || drawPlaneJet;
    const scale = 1.8;
    // Offset the plane to the top-right corner of the island
    const offsetX = 14;
    const offsetY = -10;
    const baseX = x + offsetX;
    const baseY = y + offsetY;

    // Draw the plane at 1.5x scale at the offset position
    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.scale(scale, scale);
    ctx.translate(-baseX, -baseY);
    renderer(ctx, baseX, baseY, palette);
    ctx.restore();
}

// Compute the plane's current position based on game state
function getPlanePosition(state) {
    // Free-flight mode: helicopter moves independently of selected node
    if (state.heliPos) return state.heliPos;

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

        const companionAlpha = isHeliRevealed(state, `companion:${ci}`) ? 1 : 0.25;

        // Draw branch line from companion to its anchor point on the edge
        const fromPos = positions[parentEdge.fromIdx];
        const toPos = positions[parentEdge.toIdx];
        const siblingIndices = parentEdge.companionIndices || [];
        const siblingPos = siblingIndices.indexOf(ci);
        const siblingCount = siblingIndices.length;
        const t = siblingCount <= 1 ? 0.5 : 0.35 + (siblingPos / (siblingCount - 1)) * 0.3;
        const mx = fromPos.x + (toPos.x - fromPos.x) * t;
        const my = fromPos.y + (toPos.y - fromPos.y) * t;
        ctx.save();
        ctx.globalAlpha = companionAlpha;
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
        ctx.restore();
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
    drawCompanionLabel(ctx, x, y + hullH + 14, companion, isSelected, state);
}

// Treatment 2: Rocky Islet -- smaller island with barren rock tones
function drawCompanionIslet(ctx, pos, companion, isSelected, state, nodeIndex) {
    const p = state.palette;
    const x = pos.x;
    const y = pos.y;
    // Scale companion islets proportionally with main islands
    const baseCompanionRadius = 56;
    const companionShrinkSteps = Math.max(0, (state.nodes?.length || 0) - 3);
    let islandRadius = baseCompanionRadius * Math.pow(0.8, companionShrinkSteps);
    if (state._thumbnailMode) islandRadius *= 0.25;
    const seed = (nodeIndex ?? 0) * 997 + 501;  // stable per-companion seed, independent of position

    ctx.save();

    // (Selection ring removed -- the prior purple/blue ellipse around a
    // selected companion read as a stray UI artifact on top of the resource
    // sprite. The plane indicator already lands on the selected companion,
    // so selection is still visible without an extra ring.)

    // Sprite path: hand-drawn rocky islet PNG. Footprint matches the
    // procedural shore (islandRadius * 1.2 * 2 = 2.4 * islandRadius).
    const drewSprite = drawIslandSpriteFor(
        ctx,
        islandSprites.get('resource'),
        pos,
        islandRadius * ISLAND_SPRITE_FOOTPRINT_SCALE.resource,
        ISLAND_SPRITE_GRASS_CENTER.resource,
    );

    if (!drewSprite) {
        // Procedural fallback -- generate shapes at smaller scale
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
    }

    if (!state._thumbnailMode) {
        // AWS icon centered on companion islet (max 50% of islet radius) -- any
        // "on-the-island" style (on-island, building, banner, crest) draws a plain
        // centered icon here: structure variants would be microscopic on a 28px
        // islet, so we fall back to the simple treatment.
        const _companionStyle = state.effectiveIconStyle || state.iconStyle;
        if (_companionStyle === 'crest') {
            // Draw the same shield/crest badge used on principal/target islands,
            // upscaled so it reads at companion-island size. The crest renderer
            // pulls the icon from the node's subType, so pass the companion node.
            drawIconCrest(ctx, pos, islandRadius * 1.5, companion, p);
        } else if (ISLAND_MOUNTED_ICON_STYLES.has(_companionStyle)) {
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


    }

    ctx.restore();

    if (!state._thumbnailMode) {
        // Place label just below the rendered island bottom -- sprite path
        // extends much further below `y` than the procedural shore ellipse.
        const labelTopY = drewSprite
            ? getIslandBottomY(pos, islandRadius, 'resource') - 20
            : y + 16;
        drawCompanionLabel(ctx, x, labelTopY, companion, isSelected, state);
    }
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

    // Card background
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 6);
    ctx.fillStyle = isSelected ? (p.hudProgressFill || '#7c3aed') : (p.parchCenter || 'rgba(245, 230, 200, 0.95)');
    ctx.fill();

    // Border
    ctx.strokeStyle = isSelected ? (p.hudProgressFill || '#7c3aed') : (p.borderDecor || 'rgba(120, 80, 20, 0.3)');
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Resource type colored dot (hidden when selected — purple fill is enough)
    if (!isSelected) {
        const tint = p.typeTintResource || '#f59e0b';
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(cardX + 12, y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // Resource name
    const displayLabel = label.length > 18 ? label.substring(0, 16) + '..' : label;
    ctx.fillStyle = isSelected ? '#fff' : (p.bodyText || '#5a4a2a');
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = isSelected ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayLabel, isSelected ? x : cardX + 22, y);

    ctx.restore();
}

// Shared label drawing for ship and islet treatments
function drawCompanionLabel(ctx, x, y, companion, isSelected, state) {
    const p = state.palette;
    const label = companion.label || '';
    const displayLabel = label;

    // Check for below-label icon
    const belowIcon = ((state.effectiveIconStyle || state.iconStyle) === 'below-label')
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
    ctx.fillStyle = isSelected ? (p.hudProgressFill || '#7c3aed') : (p.parchCenter || 'rgba(245, 230, 200, 0.9)');
    ctx.fill();
    ctx.strokeStyle = isSelected ? (p.hudProgressFill || '#7c3aed') : (p.borderDecor || 'rgba(120, 80, 20, 0.2)');
    ctx.lineWidth = 0.5;
    ctx.stroke();

    ctx.fillStyle = isSelected ? '#fff' : (p.typeTintResource || '#f59e0b');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayLabel, x, y + 6);

    // Icon below label text
    if (belowIcon) {
        ctx.drawImage(belowIcon, x - iconSize / 2, y + 14, iconSize, iconSize);
    }

    ctx.restore();
}

// ---- On-Island Icon Structures ----
// The 'I' key cycles through icon styles. Three of those styles mount the AWS
// logo on a decorative structure (building/banner/crest) that sits on the
// island surface, so the logo reads as a badge on a placed object rather than
// a flat overlay on the terrain. These structures take up less horizontal
// space than the below-label layout but keep the logo prominent.

// Membership check: "is this style an on-island variant that draws a node
// icon somewhere on the island body?" Used by the companion islet renderer
// (which treats all these styles the same — a small centered icon) and by
// the auto-compact threshold logic.
const ISLAND_MOUNTED_ICON_STYLES = new Set(['on-island', 'building', 'banner', 'crest']);

// Plain logo centered on the island surface (no structure). This is the
// original 'on-island' treatment factored out so the main render loop can
// dispatch cleanly to one of four on-island variants.
function drawIconOnIsland(ctx, pos, islandRadius, node) {
    const iconImg = awsIconSprites.get(node?.subType || '');
    if (!iconImg) return;
    const maxIconSize = islandRadius * 0.5; // 50% of island radius = 26px at default
    const iconSize = Math.min(maxIconSize, iconImg.width);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(iconImg, pos.x - iconSize / 2, pos.y - iconSize / 2 - 2, iconSize, iconSize);
    ctx.restore();
}

// Modern high-rise tower: tall, narrow, flat-roofed body in concrete/steel
// gray with a dark cornice ledge and a small rooftop access box. A solid
// parchment-colored square sits dead-center of the facade holding the AWS
// logo -- windows continue in a grid above and below that panel so the
// building still reads as a real tower, but the brand badge is unmistakable.
function drawIconBuilding(ctx, pos, islandRadius, node, palette) {
    const iconImg = awsIconSprites.get(node?.subType || '');
    if (!iconImg) return;

    // Vertically rectangular tower. Anchoring the base slightly below
    // island center pushes the ground shadow onto the island surface and
    // leaves the tall body standing cleanly above the terrain.
    //
    // Dimensions tuned so the logo panel reads at a glance: ~50% wider and
    // ~25% taller than the previous iteration so the window grid can carry
    // more floors and more columns without shrinking each pane.
    const bodyW    = islandRadius * 0.72;
    const bodyH    = islandRadius * 1.25;
    const cx       = pos.x;
    const bodyBase = pos.y + islandRadius * 0.22;
    const bodyTop  = bodyBase - bodyH;
    const x0       = cx - bodyW / 2;

    const isLight = document.documentElement.classList.contains('light-theme');

    // Gray/black concrete-and-steel palette so the tower reads as a real
    // building regardless of the island style beneath it. The center logo
    // panel is the one bright element and carries the service identity.
    const wallColor    = isLight ? '#6b7178' : '#4a5058';
    const wallShadow   = 'rgba(0, 0, 0, 0.22)';
    const frameColor   = isLight ? 'rgba(15, 18, 22, 0.9)' : 'rgba(0, 0, 0, 0.85)';
    const corniceColor = isLight ? '#2a2d31' : '#16181c';
    const windowFrame  = 'rgba(12, 15, 20, 0.85)';
    const windowLit    = 'rgba(255, 220, 130, 0.92)';
    const windowDark   = 'rgba(35, 48, 72, 0.88)';

    ctx.save();

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.beginPath();
    ctx.ellipse(cx + 2, bodyBase + 3, bodyW * 0.62, bodyW * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main body (gray concrete walls)
    drawRoundedRect(ctx, x0, bodyTop, bodyW, bodyH, 1.5);
    ctx.fillStyle = wallColor;
    ctx.fill();
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Right-side depth shadow (hints at 3D massing without a full perspective)
    ctx.fillStyle = wallShadow;
    ctx.fillRect(x0 + bodyW - 3, bodyTop + 1, 3, bodyH - 2);

    // Flat roof cornice: a darker, slightly wider ledge that reads as a
    // squared-off urban rooftop -- matches the flat tops in the inspiration.
    const corniceH        = 3.5;
    const corniceOverhang = 2;
    drawRoundedRect(
        ctx,
        x0 - corniceOverhang,
        bodyTop - corniceH + 1,
        bodyW + corniceOverhang * 2,
        corniceH,
        0.5,
    );
    ctx.fillStyle = corniceColor;
    ctx.fill();

    // Small rooftop HVAC/access box (echoes the equipment silhouettes on top
    // of the high-rise in the reference photo; small flourish for realism).
    const rtBoxW = bodyW * 0.22;
    const rtBoxH = 3;
    drawRoundedRect(
        ctx,
        cx - rtBoxW / 2,
        bodyTop - corniceH - rtBoxH + 1,
        rtBoxW,
        rtBoxH,
        0.5,
    );
    ctx.fillStyle = corniceColor;
    ctx.fill();

    // Central logo panel: a solid parchment-colored square dead-center on
    // the facade. Sized proportionally so the logo reads clearly at all
    // island sizes; the dark gray walls around it provide maximum contrast.
    const logoBoxSide = Math.min(bodyW * 0.80, bodyH * 0.30);
    const logoBoxX    = cx - logoBoxSide / 2;
    const logoBoxY    = bodyTop + (bodyH - logoBoxSide) / 2;

    // Deterministic lit/unlit window pattern per-node so the same building
    // always looks identical across redraws (pan, zoom, selection changes).
    const seedStr = (node?.subType || node?.label || '');
    let windowSeed = 0;
    for (let i = 0; i < seedStr.length; i++) {
        windowSeed = (windowSeed + seedStr.charCodeAt(i)) & 0xffff;
    }

    // Window grid parameters -- columns scale with building width, row count
    // is computed per-region from available vertical space so small islands
    // shrink gracefully. Thresholds raised one column compared to the
    // narrower previous iteration: with 50% more width, we get a denser
    // ribbon-window grid at each size bucket.
    const cols   = islandRadius >= 70 ? 5 : 4;
    const colGap = 1.2;
    const rowGap = 1.2;
    const winW   = (bodyW - 4 - colGap * (cols - 1)) / cols;
    // Slightly-squat windows (winH < winW) so more floors fit per region,
    // matching the dense ribbon-window look of modern office towers.
    const targetWinH = winW * 0.9;

    // Fill both window regions: above the logo panel and below it.
    const padAroundLogo = 2;
    const regions = [
        { top: bodyTop + 3,                              bottom: logoBoxY - padAroundLogo },
        { top: logoBoxY + logoBoxSide + padAroundLogo,  bottom: bodyBase - 3 },
    ];
    for (const region of regions) {
        const regionH = region.bottom - region.top;
        if (regionH < 4) continue;
        const rows     = Math.max(1, Math.floor((regionH + rowGap) / (targetWinH + rowGap)));
        const winH     = (regionH - rowGap * (rows - 1)) / rows;
        const gridLeft = x0 + 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const wx = gridLeft + c * (winW + colGap);
                const wy = region.top + r * (winH + rowGap);

                // Dark window frame
                ctx.fillStyle = windowFrame;
                ctx.fillRect(wx, wy, winW, winH);

                // Pane: most lit (warm yellow), ~1 in 5 dark for variety.
                const isLit = ((r * 7) + (c * 3) + windowSeed) % 5 !== 0;
                ctx.fillStyle = isLit ? windowLit : windowDark;
                const inset = 0.5;
                ctx.fillRect(wx + inset, wy + inset, winW - inset * 2, winH - inset * 2);
            }
        }
    }

    // Logo panel drawn LAST so it cleanly covers any window edge that might
    // otherwise bleed into the center region at odd aspect ratios.
    drawRoundedRect(ctx, logoBoxX, logoBoxY, logoBoxSide, logoBoxSide, 1.5);
    ctx.fillStyle = palette.parchCenter || 'rgba(245, 230, 200, 0.98)';
    ctx.fill();
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // AWS logo centered in the panel at 84% of the box side
    const logoSize = logoBoxSide * 0.84;
    ctx.drawImage(
        iconImg,
        cx - logoSize / 2,
        logoBoxY + logoBoxSide / 2 - logoSize / 2,
        logoSize,
        logoSize,
    );

    ctx.restore();
}

// A rectangular banner stretched between two wooden posts planted on the
// island, with the AWS logo centered on the banner face. Reads as a heraldic
// standard announcing the island's service.
function drawIconBanner(ctx, pos, islandRadius, node, palette) {
    const iconImg = awsIconSprites.get(node?.subType || '');
    if (!iconImg) return;

    // Banner and supporting structure scaled ~1.5x the initial pass so the
    // logo reads as clearly as the building/crest variants at the same
    // distance. Positions are shifted upward to keep the bigger structure
    // fitting on the island without crowding the label plate below.
    const bannerW = islandRadius * 1.05;
    const bannerH = islandRadius * 0.60;
    const cx = pos.x;

    const bannerTop    = pos.y - islandRadius * 0.40;
    const bannerBottom = bannerTop + bannerH;

    // Posts frame the banner with a small margin + extend above and below.
    const leftPoleX  = cx - bannerW / 2 - 4;
    const rightPoleX = cx + bannerW / 2 + 4;
    const poleBaseY  = pos.y + islandRadius * 0.25;
    const poleTopY   = bannerTop - 7;

    ctx.save();

    // Pole shadows
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(leftPoleX + 1, poleBaseY + 1);  ctx.lineTo(leftPoleX + 1, poleTopY + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rightPoleX + 1, poleBaseY + 1); ctx.lineTo(rightPoleX + 1, poleTopY + 1); ctx.stroke();

    // Poles
    ctx.strokeStyle = palette.flagPole || '#6d3c12';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(leftPoleX, poleBaseY);  ctx.lineTo(leftPoleX, poleTopY);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rightPoleX, poleBaseY); ctx.lineTo(rightPoleX, poleTopY); ctx.stroke();

    // Gold ball caps on pole tops (match the Targetville pennant style)
    ctx.fillStyle = palette.endFill || '#f59e0b';
    ctx.beginPath(); ctx.arc(leftPoleX,  poleTopY - 1.5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(rightPoleX, poleTopY - 1.5, 3, 0, Math.PI * 2); ctx.fill();

    // Rope/string sagging between pole tops (visual connector above banner)
    ctx.strokeStyle = 'rgba(60, 35, 10, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftPoleX, poleTopY);
    ctx.quadraticCurveTo(cx, bannerTop - 2, rightPoleX, poleTopY);
    ctx.stroke();

    // Banner body -- flat top edge, shallow scalloped (sagging) bottom so it
    // reads as a hanging cloth banner rather than a flat sign.
    const bannerX = cx - bannerW / 2;
    ctx.beginPath();
    ctx.moveTo(bannerX, bannerTop);
    ctx.lineTo(bannerX + bannerW, bannerTop);
    ctx.lineTo(bannerX + bannerW, bannerBottom);
    ctx.quadraticCurveTo(cx, bannerBottom + 6, bannerX, bannerBottom);
    ctx.closePath();
    ctx.fillStyle = palette.parchCenter || 'rgba(245, 230, 200, 0.96)';
    ctx.fill();
    ctx.strokeStyle = palette.borderDecor || 'rgba(90, 60, 20, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Accent stripe just inside the banner border (heraldic flourish)
    ctx.strokeStyle = palette.flagColor || 'rgba(140, 60, 40, 0.4)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(bannerX + 3, bannerTop + 3, bannerW - 6, bannerH - 6);

    // AWS logo centered on the banner (~1.5x the previous pass -- insets
    // scaled proportionally so the logo actually grows with the banner).
    const iconSize = Math.min(bannerW - 15, bannerH - 9);
    ctx.drawImage(iconImg, cx - iconSize / 2, (bannerTop + bannerBottom) / 2 - iconSize / 2 - 1, iconSize, iconSize);

    ctx.restore();
}

// Heraldic crest: a rounded shield shape mounted on a short stand/pedestal,
// with the AWS logo as the shield's charge. RPG-ish and compact vertically
// so it works well on smaller (5-6 node) islands.
function drawIconCrest(ctx, pos, islandRadius, node, palette) {
    const iconImg = awsIconSprites.get(node?.subType || '');
    if (!iconImg) return;

    const shieldW = islandRadius * 0.52;
    const shieldH = islandRadius * 0.56;
    const cx = pos.x;
    // Shield centered slightly above island center so the stand base falls on
    // the island surface without encroaching on the bottom label zone.
    const shieldCy = pos.y - islandRadius * 0.08;
    const shieldTop = shieldCy - shieldH / 2;
    const shieldBottom = shieldCy + shieldH / 2;

    ctx.save();

    // Ground shadow beneath the stand
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(cx + 2, shieldBottom + 4, shieldW * 0.55, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Small stand beneath the shield (two short wooden legs + horizontal slab)
    const standW = shieldW * 0.75;
    const standH = 4;
    const standY = shieldBottom - 1;
    drawRoundedRect(ctx, cx - standW / 2, standY, standW, standH, 1);
    ctx.fillStyle = palette.flagPole || '#6d3c12';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 15, 0, 0.6)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Shield path: flat top with rounded corners tapering to a point at bottom.
    // Traced as: top-left corner -> top-right corner -> taper down to the tip.
    const r = Math.min(4, shieldW * 0.18);
    const tipY = shieldBottom;
    const sideY = shieldTop + shieldH * 0.62;  // where the sides start curving inward
    const leftX  = cx - shieldW / 2;
    const rightX = cx + shieldW / 2;

    ctx.beginPath();
    ctx.moveTo(leftX + r, shieldTop);
    ctx.lineTo(rightX - r, shieldTop);
    ctx.arcTo(rightX, shieldTop, rightX, shieldTop + r, r);
    ctx.lineTo(rightX, sideY);
    ctx.quadraticCurveTo(rightX, tipY - 2, cx, tipY);
    ctx.quadraticCurveTo(leftX, tipY - 2, leftX, sideY);
    ctx.lineTo(leftX, shieldTop + r);
    ctx.arcTo(leftX, shieldTop, leftX + r, shieldTop, r);
    ctx.closePath();

    // Shield face (parchment/bone colored so the logo reads on any island)
    ctx.fillStyle = palette.parchCenter || 'rgba(245, 230, 200, 0.96)';
    ctx.fill();
    ctx.strokeStyle = palette.borderDecor || 'rgba(90, 60, 20, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Inner border (heraldic double-stroke)
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = palette.flagColor || '#8b3a22';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    const ir2 = r * 0.7;
    ctx.moveTo(leftX + 3 + ir2, shieldTop + 3);
    ctx.lineTo(rightX - 3 - ir2, shieldTop + 3);
    ctx.arcTo(rightX - 3, shieldTop + 3, rightX - 3, shieldTop + 3 + ir2, ir2);
    ctx.lineTo(rightX - 3, sideY - 1);
    ctx.quadraticCurveTo(rightX - 3, tipY - 5, cx, tipY - 3);
    ctx.quadraticCurveTo(leftX + 3, tipY - 5, leftX + 3, sideY - 1);
    ctx.lineTo(leftX + 3, shieldTop + 3 + ir2);
    ctx.arcTo(leftX + 3, shieldTop + 3, leftX + 3 + ir2, shieldTop + 3, ir2);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // AWS logo centered on the upper portion of the shield face (above the
    // tapering point so it doesn't get visually squeezed by the tip curve).
    const logoCenterY = shieldTop + shieldH * 0.42;
    const iconSize = Math.min(shieldW * 0.72, shieldH * 0.55);
    ctx.drawImage(iconImg, cx - iconSize / 2, logoCenterY - iconSize / 2, iconSize, iconSize);

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

// Extract short ARN suffix (type/name) from a full ARN.
// arn:aws:iam::{account}:type/name -> type/name. Returns the input unchanged
// if it doesn't look like an ARN (e.g., a URL or IP).
function shortArn(arn) {
    if (!arn) return '';
    const parts = arn.split(':');
    return parts.length >= 6 ? parts.slice(5).join(':') : arn;
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

    // Build KV-style double pills matching the single-page view.
    // categoryConfig, pathTypeLabels, pathTypeColors, targetColors are defined in labs.js
    // which loads before map-game.js on the same page.
    const kvPill = (key, valueClass, valueText, fieldPath = '') =>
        `<span class="lab-kv-pill">` +
        `<span class="lab-kv-pill-key">${key}</span>` +
        `<span class="lab-badge ${valueClass} lab-kv-pill-value">${escapeHtmlGame(valueText)}</span>` +
        (typeof debugTag === 'function' ? debugTag(fieldPath) : '') +
        `</span>`;

    const catConfig = (typeof categoryConfig !== 'undefined' && categoryConfig?.[lab?.category])
        || { label: lab?.category || '', cssClass: '' };
    const ptLabel = (typeof pathTypeLabels !== 'undefined' && pathTypeLabels?.[lab?.pathType])
        || (lab?.pathType || '').replace(/-/g, ' ');
    const ptClass = (typeof pathTypeColors !== 'undefined' && pathTypeColors?.[lab?.pathType])
        || 'lab-badge-pathtype';
    const costIsFree = lab?.costEstimate === 'free' || lab?.costEstimate === '$0/mo';
    const tgtLabel = lab?.target === 'to-admin' ? 'Admin'
        : lab?.target === 'to-bucket' ? 'Bucket'
        : (lab?.target || '');
    const tgtClass = (typeof targetColors !== 'undefined' && targetColors?.[lab?.target])
        || 'lab-badge-target';

    const headerKVPills = [
        lab?.category ? kvPill('Category', catConfig.cssClass, catConfig.label, 'category ← README: **Category:**') : '',
        lab?.pathType ? kvPill('Path Type', ptClass, ptLabel, 'pathType ← README: **Path Type:**') : '',
        tgtLabel ? kvPill('Target', tgtClass, tgtLabel, 'target ← README: **Target:**') : '',
        lab?.costEstimate ? kvPill('Est. AWS Cost', costIsFree ? 'lab-cost-free' : 'lab-cost-paid', costIsFree ? 'Free' : lab.costEstimate, 'costEstimate ← README: **Cost Estimate:**') : '',
        ...(lab?.environments || []).map(env => kvPill('Env', 'lab-badge-env', env, 'environments[] ← README: **Environments:** (comma list)')),
    ].filter(Boolean);

    const _dbg = typeof debugTag === 'function' ? debugTag : () => '';

    // Friendly labels for subType / access.type. Helpers live in labs.js (always
    // loaded before map-game.js on pages that render this panel). Fall back to
    // raw values if the helper isn't present so the panel degrades gracefully.
    const _displaySubType = typeof displaySubType === 'function'
        ? displaySubType
        : (s) => s || '';
    const _displayAccessType = typeof displayAccessType === 'function'
        ? displayAccessType
        : (t) => t || '';

    // Short or endpoint value for the "From" pill (matches single-page logic).
    const startFromValue = isPublicStart && accessEndpoint
        ? accessEndpoint
        : (shortArn(startNode?.arn) || startNode?.label || '');
    const startFromDebug = isPublicStart && accessEndpoint
        ? 'attackMap.nodes[start].access.{url|ip|domain}'
        : 'attackMap.nodes[start].arn';
    const startTypeLabel = _displaySubType(startNode?.subType);
    const startAccessTypeLabel = startAccess?.type ? _displayAccessType(startAccess.type) : '';

    const targetFromValue = shortArn(targetNode?.arn) || targetNode?.label || '';
    const targetTypeLabel = _displaySubType(targetNode?.subType);

    // Wrap a pill in a full-width row so it stretches across the narrow game
    // panel. Mirrors the single-page objective-flow card layout.
    const _fullRow = (pillHtml) =>
        pillHtml ? `<div class="lab-kv-pill-row-full">${pillHtml}</div>` : '';

    panelEl.innerHTML = `
        <div class="mg-panel-section">
            <span class="mg-section-label">LAB OVERVIEW</span>
            ${headerKVPills.length ? `<div class="mg-header-pills" style="margin:10px 0 6px;">${headerKVPills.join('')}</div>` : ''}
        </div>
        <div class="mg-panel-section">
            <span class="mg-section-label">OBJECTIVE</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(lab?.description || '')}${_dbg('description ← README: **Technique:**')}</p>
        </div>
        ${startNode ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">STARTING POINT</span>
            <div class="lab-kv-pill-stack mg-pill-stack">
                ${_fullRow(startFromValue
                    ? labKvPill('From', 'lab-kv-pill-value-lead', startFromValue, startFromDebug, startNode?.arn || startFromValue)
                    : '')}
                ${_fullRow(startTypeLabel
                    ? labKvPill('Type', 'lab-kv-pill-node', startTypeLabel, 'attackMap.nodes[start].subType → displaySubType()')
                    : '')}
                ${_fullRow(startNode?.label
                    ? labKvPill('Name', 'lab-kv-pill-node', startNode.label, 'attackMap.nodes[start].label')
                    : '')}
                ${_fullRow(startAccessTypeLabel
                    ? labKvPill('Initial Access Type', 'lab-kv-pill-node-access', startAccessTypeLabel, 'attackMap.nodes[start].access.type → displayAccessType()')
                    : '')}
            </div>
        </div>` : ''}
        ${isPublicStart ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">STARTING PERMISSIONS</span>
            <div class="mg-public-access-note">No AWS credentials required — the entry point accepts unauthenticated requests</div>
            ${helpfulPills ? `
            <button class="mg-helpful-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                Helpful IAM permissions (${helpfulPermsFlat.length})${_dbg('permissions.principals[0].helpful[].permission')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="mg-perm-pills mg-helpful-collapsible">
                ${helpfulPills}
            </div>` : ''}
        </div>` : permPills ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">STARTING PERMISSIONS${_dbg('permissions.principals[0].required[].permission')}</span>
            <div class="mg-perm-pills">${permPills}</div>
            ${helpfulPills ? `
            <button class="mg-helpful-toggle" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open');">
                Helpful (${helpfulPermsFlat.length})${_dbg('permissions.principals[0].helpful[].permission')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="mg-perm-pills mg-helpful-collapsible">
                ${helpfulPills}
            </div>` : ''}
        </div>` : ''}
        ${targetNode ? `
        <div class="mg-panel-section">
            <span class="mg-section-label">TARGET</span>
            <div class="lab-kv-pill-stack mg-pill-stack">
                ${_fullRow(targetFromValue
                    ? labKvPill('To', 'lab-kv-pill-value-lead', targetFromValue, 'attackMap.nodes[last].arn', targetNode?.arn || targetFromValue)
                    : '')}
                ${_fullRow(targetTypeLabel
                    ? labKvPill('Type', 'lab-kv-pill-node', targetTypeLabel, 'attackMap.nodes[last].subType → displaySubType()')
                    : '')}
                ${_fullRow(targetNode?.label
                    ? labKvPill('Name', 'lab-kv-pill-node', targetNode.label, 'attackMap.nodes[last].label')
                    : '')}
                ${targetNode?.isTarget && targetNode?.arn
                    ? _fullRow(labKvPill('Flag Location', 'lab-kv-pill-node-access', shortArn(targetNode.arn), 'attackMap.nodes[last].arn → shortArn()'))
                    : ''}
            </div>
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
    const _displaySubTypeNode = typeof displaySubType === 'function'
        ? displaySubType
        : (s) => s || '';
    const _displayAccessTypeNode = typeof displayAccessType === 'function'
        ? displayAccessType
        : (t) => t || '';
    const subTypeLabel = _displaySubTypeNode(subType);

    // Section label: Node N / Target Node -- matches the single-page guided
    // challenge numbering. Node 1 is the start; the N-th non-implicit hop
    // destination is Node N+1. isTarget flips the label on the final node.
    const nodePositionLabel = isFirst
        ? 'NODE 1'
        : (isLast && node.isTarget)
            ? 'TARGET NODE'
            : `NODE ${hopNumber + 1}`;

    // Lead pill key: directional. First node = From, last target = To,
    // intermediate = At. Value is the network endpoint if this node is an
    // access entry point, otherwise the short ARN.
    const leadKey = isFirst ? 'From' : (isLast && node.isTarget) ? 'To' : 'At';
    const accessEndpoint = node.access?.url || node.access?.ip || node.access?.domain || '';
    const leadValue = (isFirst && accessEndpoint)
        ? accessEndpoint
        : (shortArn(node.arn) || node.label || '');
    const leadDebug = (isFirst && accessEndpoint)
        ? 'attackMap.nodes[n].access.{url|ip|domain}'
        : 'attackMap.nodes[n].arn → shortArn()';

    const initialAccessLabel = (isFirst && node.access?.type)
        ? _displayAccessTypeNode(node.access.type)
        : '';

    const _dbgN = typeof debugTag === 'function' ? debugTag : () => '';
    const _fullRowN = (pillHtml) =>
        pillHtml ? `<div class="lab-kv-pill-row-full">${pillHtml}</div>` : '';

    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">${escapeHtmlGame(nodePositionLabel)}${_dbgN('attackMap.nodes[n] position')}</span>
            <div class="lab-kv-pill-stack mg-pill-stack">
                ${_fullRowN(leadValue
                    ? labKvPill(leadKey, 'lab-kv-pill-value-lead', leadValue, leadDebug, node.arn || leadValue)
                    : '')}
                ${_fullRowN(subTypeLabel
                    ? labKvPill('Type', 'lab-kv-pill-node', subTypeLabel, 'attackMap.nodes[n].subType → displaySubType()')
                    : '')}
                ${_fullRowN(node.label
                    ? labKvPill('Name', 'lab-kv-pill-node', node.label, 'attackMap.nodes[n].label')
                    : '')}
                ${initialAccessLabel
                    ? _fullRowN(labKvPill('Initial Access Type', 'lab-kv-pill-node-access', initialAccessLabel, 'attackMap.nodes[n].access.type → displayAccessType()'))
                    : ''}
                ${(isLast && node.isTarget && node.arn)
                    ? _fullRowN(labKvPill('Flag Location', 'lab-kv-pill-node-access', shortArn(node.arn), 'attackMap.nodes[last].arn → shortArn()'))
                    : ''}
            </div>
        </div>`;

    // Node description -- about this place
    if (node.description) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">ABOUT THIS ${typeLabel.toUpperCase()}${_dbgN('attackMap.nodes[n].description')}</span>
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

    const subType = companion.subType || '';
    const _displaySubTypeCompanion = typeof displaySubType === 'function'
        ? displaySubType
        : (s) => s || '';
    const subTypeLabel = _displaySubTypeCompanion(subType);

    // Lead pill value mirrors the principal-node panel: prefer the shortened
    // ARN so the ARN is the most prominent identifier, fall back to the label.
    const leadValue = shortArn(companion.arn) || companion.label || '';

    const _dbgC = typeof debugTag === 'function' ? debugTag : () => '';
    const _fullRowC = (pillHtml) =>
        pillHtml ? `<div class="lab-kv-pill-row-full">${pillHtml}</div>` : '';

    // Header pill stack matches the principal-node and hop panels so all
    // three panel kinds read as parts of one visual system. The Action(s)
    // pill folds in what used to be the standalone "VIA RESOURCE" section:
    // the edge label now sits inline with the rest of the identifying pills,
    // which removes the most confusing part of the old layout (a code-block
    // that looked like a command but was actually just an IAM action name).
    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">RESOURCE ON HOP ${hopNumber}</span>
            <div class="lab-kv-pill-stack mg-pill-stack">
                ${_fullRowC(leadValue
                    ? labKvPill('Resource', 'lab-kv-pill-value-lead', leadValue, 'attackMap.nodes[n].arn → shortArn()', companion.arn || leadValue)
                    : '')}
                ${_fullRowC(subTypeLabel
                    ? labKvPill('Type', 'lab-kv-pill-node', subTypeLabel, 'attackMap.nodes[n].subType → displaySubType()')
                    : '')}
                ${_fullRowC(companion.label
                    ? labKvPill('Name', 'lab-kv-pill-node', companion.label, 'attackMap.nodes[n].label')
                    : '')}
                ${_fullRowC(companion.edgeLabel
                    ? labKvPill('Action(s)', 'lab-kv-pill-hop', companion.edgeLabel, 'attackMap.edges[n].label (companion)')
                    : '')}
            </div>
        </div>`;

    if (companion.description) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">ABOUT THIS RESOURCE${_dbgC('attackMap.nodes[n].description')}</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(companion.description)}</p>
        </div>`;
    }

    // Edge description -- the "how it works" narrative for the action on
    // this resource. The action itself is already shown as a pill above, so
    // this section focuses purely on explaining what that action does here.
    if (companion.edgeDescription) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">HOW IT'S USED ON HOP ${hopNumber}${_dbgC('attackMap.edges[n].description (companion)')}</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(companion.edgeDescription)}</p>
        </div>`;
    }

    html += `
        <div class="mg-panel-section mg-next-prompt">
            <p class="mg-panel-body mg-muted">Click the path or a principal island to continue.</p>
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

    const _dbgE = typeof debugTag === 'function' ? debugTag : () => '';
    const _fullRowE = (pillHtml) =>
        pillHtml ? `<div class="lab-kv-pill-row-full">${pillHtml}</div>` : '';

    // Hop header: same pill-stack layout as the node panels so the two kinds
    // of panels read as parts of a single visual system. From/To anchor the
    // hop to the adjacent nodes; Action(s) is the lead pill (violet).
    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">${escapeHtmlGame(hopLabel)}</span>
            <div class="lab-kv-pill-stack mg-pill-stack">
                ${_fullRowE(fromLabel && fromLabel !== '?'
                    ? labKvPill('From Node', 'lab-kv-pill-node', fromLabel, 'attackMap.edges[n].from → nodes[].label')
                    : '')}
                ${_fullRowE(toLabel && toLabel !== '?'
                    ? labKvPill('To Node', 'lab-kv-pill-node', toLabel, 'attackMap.edges[n].to → nodes[].label')
                    : '')}
                ${_fullRowE(edge.label
                    ? labKvPill('Action(s)', 'lab-kv-pill-value-lead', edge.label, 'attackMap.edges[n].label')
                    : '')}
            </div>
        </div>`;

    // For implicit edges, show a brief explanation
    if (edge.implicit) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">WHAT HAPPENS${_dbgE('attackMap.edges[n].description')}</span>
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
            <span class="mg-section-label">HOW IT WORKS${_dbgE('attackMap.edges[n].description')}</span>
            <p class="mg-panel-body">${markdownToSimpleHtml(edge.description)}</p>
        </div>`;
    }

    // Pathfinding.cloud cross-link
    const pathId = state.lab?.pathfindingCloudId;
    if (pathId) {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">LEARN MORE${_dbgE('pathfindingCloudId ← README: **Pathfinding.cloud ID:**')}</span>
            <p class="mg-panel-body"><a href="/paths/${escapeHtmlGame(pathId)}" target="_blank" class="mg-path-link">View ${escapeHtmlGame(pathId)} technique details on pathfinding.cloud</a></p>
        </div>`;
    }

    // Progressive hints
    const hints = edge.hints || [];
    if (hints.length > 0) {
        html += `<div class="mg-panel-section"><span class="mg-section-label">HINTS${_dbgE('attackMap.edges[n].hints[]')}</span>`;
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
            <span class="mg-section-label" style="cursor:pointer; user-select:none;">REVEAL EXPLOITATION COMMANDS${_dbgE('attackMap.edges[n].commands[].{description, command}')} <span class="mg-deploy-arrow">${isOpen ? '&#9660;' : '&#9654;'}</span></span>
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
    // Always pin the focused item to the top of the visible list area.
    const listRect = list.getBoundingClientRect();
    const itemRect = focused.getBoundingClientRect();
    list.scrollTop += itemRect.top - listRect.top - 4;
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

// Render the completion summary with teardown and detection content
function renderGamePanelComplete(panelEl, state) {
    const lab = state.lab;
    const slug = lab?.name || '';

    let html = `
        <div class="mg-panel-section mg-complete-header">
            <span class="mg-section-label">MISSION COMPLETE</span>
        </div>`;

    // Teardown
    const teardownData = typeof getTeardown === 'function' ? getTeardown(lab) : {};
    if (teardownData.nonInteractive || teardownData.tui) {
        const teardownHtml = typeof renderInnerTabSection === 'function'
            ? renderInnerTabSection(`mc-teardown-${slug}`, [
                { id: 'cli', label: 'Non-Interactive', show: !!teardownData.nonInteractive, content: teardownData.nonInteractive },
                { id: 'tui', label: 'TUI', show: !!teardownData.tui, content: teardownData.tui },
            ]) : '';
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">TEARDOWN</span>
            ${teardownHtml}
        </div>`;
    }

    // Detection: CSPM + CloudSIEM tabs
    const cspmData = typeof getDefendCspm === 'function' ? getDefendCspm(lab) : (lab?.readme?.defend?.cspm || lab?.readme?.cspm);
    const siemData = typeof getDefendSiem === 'function' ? getDefendSiem(lab) : (lab?.readme?.defend?.cloudSiem || lab?.readme?.cloudSiem);
    const detectTabs = [];
    if (cspmData?.whatToDetect) {
        detectTabs.push({ id: 'cspm', label: 'What CSPM Tools Should Detect', show: true,
            rawHtml: `<div class="lab-tab-prose">${typeof renderLabMarkdown === 'function' ? renderLabMarkdown(cspmData.whatToDetect) : markdownToSimpleHtml(cspmData.whatToDetect)}</div>` });
    }
    if (siemData?.cloudTrailEvents) {
        detectTabs.push({ id: 'cloudtrail', label: 'CloudTrail Events to Monitor', show: true,
            rawHtml: `<div class="lab-tab-prose">${typeof renderLabMarkdown === 'function' ? renderLabMarkdown(siemData.cloudTrailEvents) : markdownToSimpleHtml(siemData.cloudTrailEvents)}</div>` });
    }
    if (siemData?.detonationLogs) {
        detectTabs.push({ id: 'logs', label: 'Detonation Logs', show: true,
            rawHtml: `<div class="lab-tab-prose">${typeof renderLabMarkdown === 'function' ? renderLabMarkdown(siemData.detonationLogs) : markdownToSimpleHtml(siemData.detonationLogs)}</div>` });
    }
    if (detectTabs.length > 0 && typeof renderInnerTabSection === 'function') {
        html += `
        <div class="mg-panel-section">
            <span class="mg-section-label">DETECTION</span>
            ${renderInnerTabSection(`mc-detect-${slug}`, detectTabs)}
        </div>`;
    }

    if (!teardownData.nonInteractive && !teardownData.tui && detectTabs.length === 0) {
        html += `<div class="mg-panel-section"><p class="mg-panel-body mg-muted">Select any island or hop label on the map to review the attack path.</p></div>`;
    }

    panelEl.innerHTML = html;

    // Wire up tab click handlers for any inner tabs rendered
    if (typeof setupTabListeners === 'function') setupTabListeners();
}


// Render deploy instructions in the panel (triggered by canvas button)
function renderGamePanelDeploy(panelEl, state) {
    const lab = state.lab;
    const scenarioDir = lab?.name || '';
    // Extract the deploy commands from the README's non-interactive section, stripping
    // the markdown code fence (```bash...```) to get the raw command text.
    const deployRaw = lab?.readme?.setup?.deployNonInteractive || '';
    const deployCmd = deployRaw.replace(/^```[a-z]*\n/, '').replace(/\n?```\s*$/, '').trim();

    // KV-style double pills (same as objective page and single-page view)
    const _dbgD = typeof debugTag === 'function' ? debugTag : () => '';
    const kvPillDeploy = (key, valueClass, valueText, fieldPath = '') =>
        `<span class="lab-kv-pill">` +
        `<span class="lab-kv-pill-key">${key}</span>` +
        `<span class="lab-badge ${valueClass} lab-kv-pill-value">${escapeHtmlGame(valueText)}</span>` +
        _dbgD(fieldPath) +
        `</span>`;

    const deployCatConfig = (typeof categoryConfig !== 'undefined' && categoryConfig?.[lab?.category])
        || { label: lab?.category || '', cssClass: '' };
    const deployPtLabel = (typeof pathTypeLabels !== 'undefined' && pathTypeLabels?.[lab?.pathType])
        || (lab?.pathType || '').replace(/-/g, ' ');
    const deployPtClass = (typeof pathTypeColors !== 'undefined' && pathTypeColors?.[lab?.pathType])
        || 'lab-badge-pathtype';
    const deployCostIsFree = lab?.costEstimate === 'free' || lab?.costEstimate === '$0/mo';
    const deployTgtLabel = lab?.target === 'to-admin' ? 'Admin'
        : lab?.target === 'to-bucket' ? 'Bucket'
        : (lab?.target || '');
    const deployTgtClass = (typeof targetColors !== 'undefined' && targetColors?.[lab?.target])
        || 'lab-badge-target';

    const deployKVPills = [
        lab?.category ? kvPillDeploy('Category', deployCatConfig.cssClass, deployCatConfig.label, 'category ← README: **Category:**') : '',
        lab?.pathType ? kvPillDeploy('Path Type', deployPtClass, deployPtLabel, 'pathType ← README: **Path Type:**') : '',
        deployTgtLabel ? kvPillDeploy('Target', deployTgtClass, deployTgtLabel, 'target ← README: **Target:**') : '',
        lab?.costEstimate ? kvPillDeploy('Est. AWS Cost', deployCostIsFree ? 'lab-cost-free' : 'lab-cost-paid', deployCostIsFree ? 'Free' : lab.costEstimate, 'costEstimate ← README: **Cost Estimate:**') : '',
        ...(lab?.environments || []).map(env => kvPillDeploy('Env', 'lab-badge-env', env, 'environments[] ← README: **Environments:** (comma list)')),
    ].filter(Boolean);

    let html = `
        <div class="mg-panel-section">
            <span class="mg-section-label">DEPLOY THE SELF-HOSTED LAB</span>
            ${deployKVPills.length ? `<div class="mg-header-pills" style="margin:10px 0 6px;">${deployKVPills.join('')}</div>` : ''}
            <h2 class="mg-panel-title">Setup Instructions</h2>
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
                <p class="mg-deploy-step-title">3. Deploy this scenario${_dbgD('readme.setup.deployNonInteractive')}</p>
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
        if (hasCompanion) {
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


// ---- Helicopter Reveal Mechanic ----

// Builds the ordered sequence of hitKeys the helicopter must visit to progressively
// reveal the map. Order mirrors advanceGameState: node0 → edge0 → companions → node1 → ...
function buildRevealSequence(edges) {
    // Sequence starts with HUD buttons before the first island
    const seq = ['hud:lab-setup', 'hud:lab-overview', 'node:0'];
    for (let ei = 0; ei < edges.length; ei++) {
        const edge = edges[ei];
        seq.push(`edge:${ei}`);
        for (const ci of (edge.companionIndices || [])) {
            seq.push(`companion:${ci}`);
        }
        seq.push(`node:${edge.toIdx}`);
    }
    return seq;
}

// Auto-reveals implicit (automatic) edges so the player never has to manually
// hover them — they become bright as soon as the surrounding nodes are revealed.
function advanceRevealImplicit(state) {
    const seq = state._heliRevealSeq;
    while (state._heliRevealNextIdx < seq.length) {
        const next = seq[state._heliRevealNextIdx];
        if (next.startsWith('edge:')) {
            const ei = parseInt(next.split(':')[1], 10);
            if (state.edges[ei]?.implicit) {
                state._heliRevealed.add(next);
                state._heliRevealNextIdx++;
                continue;
            }
        }
        break;
    }
}

// Returns true if the given element (hitKey) should render at full opacity.
// When the reveal mechanic is not active (_heliRevealSeq is null), everything is visible.
function isHeliRevealed(state, key) {
    if (!state._heliRevealSeq) return true;
    return state._heliRevealed?.has(key) ?? true;
}

// Moves the helicopter to the position of a given hitKey element.
function moveHeliToElement(state, hitKey) {
    if (!state.heliPos || !hitKey) return;
    const [type, idxStr] = hitKey.split(':');
    const idx = parseInt(idxStr, 10);
    let pos = null;
    if (type === 'node') {
        pos = state.positions?.[idx];
    } else if (type === 'companion') {
        pos = state.companionPositions?.[idx];
        if (pos && pos.x === 0 && pos.y === 0) pos = null;
    } else if (type === 'edge') {
        const edge = state.edges?.[idx];
        const from = edge && state.positions[edge.fromIdx];
        const to   = edge && state.positions[edge.toIdx];
        if (from && to) pos = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    } else if (type === 'hud') {
        // idxStr is the button ID; convert screen-space button center → world space
        const btn = state.buttons?.find(b => b.id === idxStr);
        if (btn) {
            const zoom = state.viewZoom || 1;
            const panX = state.viewPanX || 0;
            const panY = state.viewPanY || 0;
            const btnCx = btn.x + btn.w / 2;
            // Place visual center (heliPos+21, heliPos-60) 40px above button top
            const targetScreenX = btnCx;
            const targetScreenY = btn.y - 40;
            pos = {
                x: (targetScreenX - panX) / zoom - 21,
                y: (targetScreenY - panY) / zoom + 60,
            };
        }
    }
    if (pos) { state.heliPos.x = pos.x; state.heliPos.y = pos.y; }
}

// Called after advanceGameState / retreatGameState to keep the reveal mechanic and
// helicopter position in sync with wherever the navigation just moved to.
function syncRevealToNavigation(state) {
    if (!state._heliRevealSeq) return;

    // Determine which hitKey the navigation just landed on
    let currentKey = null;
    if (state.selectedNode !== null && state.selectedNode !== undefined) {
        currentKey = `node:${state.selectedNode}`;
    } else if (state.selectedEdge !== null && state.selectedEdge !== undefined) {
        currentKey = `edge:${state.selectedEdge}`;
    } else if (state.selectedCompanion !== null && state.selectedCompanion !== undefined) {
        currentKey = `companion:${state.selectedCompanion}`;
    }
    // Map HUD view phases to their reveal keys when no island/edge is selected
    if (!currentKey && state._heliRevealSeq?.includes('hud:lab-setup')) {
        if (state.gameViewPhase === 'setup') currentKey = 'hud:lab-setup';
        else if (state.gameViewPhase === 'overview') currentKey = 'hud:lab-overview';
    }
    if (!currentKey) return;

    // Reveal everything in sequence up to and including this element
    const seq = state._heliRevealSeq;
    const targetIdx = seq.indexOf(currentKey);
    if (targetIdx !== -1) {
        for (let i = 0; i <= targetIdx; i++) state._heliRevealed.add(seq[i]);
        state._heliRevealNextIdx = Math.max(state._heliRevealNextIdx, targetIdx + 1);
        advanceRevealImplicit(state);
        state._heliLastRevealTime = Date.now();
    }

    // Teleport helicopter to the element
    moveHeliToElement(state, currentKey);
}

// Draw a Capcom-gold arrow pointing to the next element in the reveal sequence.
// Shows immediately (no delay) for the initial HUD intro; after 30 s idle for all others.
// Drawn in screen space so size stays constant regardless of zoom.
function drawIdleHintArrow(ctx, w, h, state) {
    if (state.arcadeStartShown) return; // don't show while arcade start overlay is up
    if (!state._heliRevealSeq) return;
    if (state._heliRevealNextIdx >= state._heliRevealSeq.length) return;
    if (!state._heliLastRevealTime) return;

    const targetKey = state._heliRevealSeq[state._heliRevealNextIdx];
    const isInitialIntro = targetKey === 'hud:lab-overview';

    // Initial intro arrow shows immediately; all others require 30 s of idle
    if (!isInitialIntro && Date.now() - state._heliLastRevealTime < 30000) return;

    const colonIdx = targetKey.indexOf(':');
    const type   = targetKey.slice(0, colonIdx);
    const idxStr = targetKey.slice(colonIdx + 1);
    const idx = parseInt(idxStr, 10);

    // Resolve screen-space anchor
    let sx = null, sy = null;
    if (type === 'hud') {
        const btn = state.buttons?.find(b => b.id === idxStr);
        if (!btn) return;
        sx = btn.x + btn.w / 2;
        sy = btn.y;
    } else {
        let worldPos = null;
        if (type === 'node') {
            worldPos = state.positions?.[idx];
        } else if (type === 'companion') {
            const p = state.companionPositions?.[idx];
            if (p && !(p.x === 0 && p.y === 0)) worldPos = p;
        } else if (type === 'edge') {
            const edge = state.edges?.[idx];
            const from = edge && state.positions[edge.fromIdx];
            const to = edge && state.positions[edge.toIdx];
            if (from && to) worldPos = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        }
        if (!worldPos) return;
        const zoom = state.viewZoom || 1;
        sx = worldPos.x * zoom + (state.viewPanX || 0);
        sy = worldPos.y * zoom + (state.viewPanY || 0);
    }

    // All arrows bounce at 1 Hz
    const bounce = Math.sin(performance.now() / 1000 * Math.PI * 2) * 10;
    const arrowSize = 34;
    const arrowX = sx;
    const arrowBaseY = type === 'hud' ? sy - 55 : sy - 95;
    const arrowY = arrowBaseY + bounce;

    ctx.save();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Arrow glyph — hard drop shadow then gold gradient fill
    ctx.font = `900 ${arrowSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = 'normal';

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText('▼', arrowX + 2, arrowY + 3);

    const grad = ctx.createLinearGradient(arrowX, arrowY, arrowX, arrowY + arrowSize);
    grad.addColorStop(0,    '#fff8c0');
    grad.addColorStop(0.45, '#f0b030');
    grad.addColorStop(1,    '#c06010');
    ctx.fillStyle = grad;
    ctx.fillText('▼', arrowX, arrowY);

    ctx.restore();
}

// ---- Arcade Start Overlay (NES/Capcom style) ----

// Pixel font helpers — use "Press Start 2P" if loaded, fallback to monospace
const PIXEL_FONT = '"Press Start 2P", "Courier New", Courier, monospace';

function drawArcadeStartOverlay(ctx, w, h, state) {
    ctx.save();

    // No background dimming — game world shows through fully behind the box.

    // "Press Start 2P" is a pixel font — it renders taller than its em size.
    // All font sizes here are tuned for the pixel font; fallback Courier is close enough.
    const P = 8;    // base pixel unit (1 "pixel" in 8-bit terms)
    const boxPadX = 20;

    // Row heights per font size
    const titleH    = P * 2 + 10;  // large title + gap
    const subtitleH = P + 10;      // small subtext + gap
    const secHeadH  = P + 8;       // section label row
    const ctrlRowH  = P + 10;      // control key row
    const divH      = 18;          // total height of a section divider
    const pressKeyH = P * 2 + 14; // blinking CTA

    // Sum up total box height
    const boxH =
        20 +                   // top pad
        titleH +
        subtitleH +
        divH +
        secHeadH +
        3 * ctrlRowH +         // 3 control rows
        divH +
        secHeadH +
        ctrlRowH +             // objective desc line
        ctrlRowH +             // objective step flow (one line)
        divH +
        pressKeyH +
        16;                    // bottom pad

    const boxW = Math.min(Math.max(w * 0.70, 340), 500);
    const boxX = Math.round((w - boxW) / 2);
    const boxY = Math.round((h - boxH) / 2);

    // Box background — deep arcade dark, slightly blue-tinted
    ctx.fillStyle = '#0a0c14';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // Outer border: bright arcade gold, 3 px
    ctx.strokeStyle = '#e8a800';
    ctx.lineWidth = 3;
    ctx.strokeRect(boxX + 1.5, boxY + 1.5, boxW - 3, boxH - 3);

    // Inner border: muted gold, 1 px, 7 px inset
    ctx.strokeStyle = '#7a5200';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 7.5, boxY + 7.5, boxW - 15, boxH - 15);

    // Corner pixel accents — 4×4 bright gold squares at the inner border corners
    ctx.fillStyle = '#e8a800';
    [[boxX + 6, boxY + 6], [boxX + boxW - 10, boxY + 6],
     [boxX + 6, boxY + boxH - 10], [boxX + boxW - 10, boxY + boxH - 10]]
        .forEach(([cx, cy]) => ctx.fillRect(cx, cy, 4, 4));

    let curY   = boxY + 20;
    const midX = w / 2;
    const leftX = boxX + boxPadX;

    ctx.textBaseline = 'top';

    // Section divider helper
    function divider() {
        curY += 5;
        ctx.strokeStyle = '#2a2000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(boxX + 12, curY);
        ctx.lineTo(boxX + boxW - 12, curY);
        ctx.stroke();
        curY += divH - 5;
    }

    // ---- TITLE ----
    ctx.textAlign   = 'center';
    ctx.font        = `${P * 2}px ${PIXEL_FONT}`;
    ctx.fillStyle   = '#e8a800';
    ctx.shadowColor = 'rgba(232,168,0,0.6)';
    ctx.shadowBlur  = 8;
    ctx.fillText('PATHFINDING LABS', midX, curY);
    ctx.shadowBlur  = 0;
    curY += titleH;

    ctx.font      = `${P}px ${PIXEL_FONT}`;
    ctx.fillStyle = '#8a7040';
    ctx.fillText('LEARN TO HOP AROUND IN THE CLOUDS', midX, curY);
    curY += subtitleH;

    divider();

    // ---- CONTROLS ----
    ctx.textAlign = 'left';
    ctx.font      = `${P}px ${PIXEL_FONT}`;
    ctx.fillStyle = '#e8a800';
    ctx.fillText('CONTROLS', leftX, curY);
    curY += secHeadH;

    // Press Start 2P only covers ASCII — use text labels for arrow keys so all
    // four directions render in the pixel font instead of falling back to system glyphs.
    const controls = [
        ['ARROW KEYS', 'FLY HELICOPTER'],
        ['HOVER',  'REVEAL PATH NODES'],
        ['ESC',    'OPEN MENU'],
    ];
    const valX = leftX + Math.round(boxW * 0.34);
    controls.forEach(([key, val]) => {
        ctx.fillStyle = '#e8a800';
        ctx.fillText(key, leftX, curY);
        ctx.fillStyle = '#a08848';
        ctx.fillText(val, valX, curY);
        curY += ctrlRowH;
    });

    divider();

    // ---- OBJECTIVE ----
    ctx.textAlign = 'left';
    ctx.font      = `${P}px ${PIXEL_FONT}`;
    ctx.fillStyle = '#e8a800';
    ctx.fillText('OBJECTIVE', leftX, curY);
    curY += secHeadH;

    ctx.fillStyle = '#8a7040';
    ctx.fillText('FLY TO EACH ISLAND IN ORDER:', leftX, curY);
    curY += ctrlRowH;

    // Single-line step flow — no bullets, just text with ASCII arrows
    ctx.fillStyle = '#f0e0a0';
    ctx.fillText('LAB SETUP -> LAB OVERVIEW -> STARTINGTON -> ...', leftX, curY);
    curY += ctrlRowH;

    divider();

    // ---- PRESS ANY KEY (blinking at ~0.8 Hz) ----
    const blink = Math.floor(performance.now() / 620) % 2 === 0;
    ctx.textAlign = 'center';
    ctx.font      = `${P}px ${PIXEL_FONT}`;
    if (blink) {
        ctx.fillStyle   = '#e8a800';
        ctx.shadowColor = 'rgba(232,168,0,0.9)';
        ctx.shadowBlur  = 14;
    } else {
        ctx.fillStyle   = '#ffffff';
        ctx.shadowColor = 'rgba(255,255,255,0.5)';
        ctx.shadowBlur  = 6;
    }
    ctx.fillText('- PRESS ANY KEY TO START -', midX, curY + 6);
    ctx.shadowBlur = 0;

    ctx.restore();
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
            drawIdleHintArrow(ctx, w, h, state); // screen space, above HUD
            // Helicopter drawn last so it always renders above the HUD
            withViewTransform(() => {
                const planePos = getPlanePosition(state);
                drawPlaneIndicator(ctx, planePos.x, planePos.y, state.palette, state.planeStyle);
            });
            // Arcade start overlay sits on top of everything until dismissed
            if (state.arcadeStartShown) {
                drawArcadeStartOverlay(ctx, w, h, state);
            }
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
            drawPlayingHUD(ctx, w, h, state);
            drawCompleteOverlay(ctx, w, h, state);
            // Helicopter drawn last so it always renders above the overlay
            withViewTransform(() => {
                const planePos = getPlanePosition(state);
                drawPlaneIndicator(ctx, planePos.x, planePos.y, state.palette, state.planeStyle);
            });
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

    state.buttons.forEach(btn => drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p));

    // Keyboard hint below last button
    const lastBtn = state.buttons[state.buttons.length - 1];
    ctx.fillStyle = p.mutedText;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Esc = Pause  |  T = Island style  |  G = Target style  |  P = Plane style  |  Click island = View details', w / 2, lastBtn.y + lastBtn.h + 24);

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
        // Currently viewing a destination node -- go back to the edge view directly.
        // Companions are skipped on backward navigation (they remain accessible by
        // clicking the companion island on the map). This keeps Back predictable:
        // each Back undoes exactly one edge crossing (destination → hop → source node).
        const lastEdge = state.edges[state.currentEdge];
        if (lastEdge) {
            state.selectedEdge = state.currentEdge;
            state.selectedNode = null;
            state.selectedCompanion = null;
            state.currentNode = lastEdge.fromIdx;
            state.currentEdge = state.currentEdge - 1;
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

    // --- Top bar buttons ---
    const variant = state.hudVariant || 0;

    // In V5 (capcom top-left, the default) the hamburger sits at the top-right corner
    // so it doesn't compete with the left-anchored capcom title text.
    const menuX = variant === 5 ? w - 66 : 10;
    const menuBtn = {
        id: 'menu',
        x: menuX, y: 6,
        w: 56, h: 44,
        label: '☰',
        style: 'ghost',
        fontSize: 36,
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

    // --- Bottom bar layout ---
    // [Play Online] [Lab Setup][Lab Overview]   [Back][Next]   [Finish Mission][Demo]
    //  ^-- left edge                            ^-- centered    ^-- right edge

    const backW = 70;
    const nextW = 70;
    const edgePad = 14; // padding from bar edges

    // Center Back/Next in the middle of the bar
    const centerGroupW = backW + gap + nextW;
    const backX = (w - centerGroupW) / 2;
    const nextX = backX + backW + gap;
    const centerRightEdge = nextX + nextW;
    const rightEdge = w - edgePad;

    // Responsive labels: switch to short versions when groups would touch Back/Next.
    // Left group full widths: Play Online(110) + Lab Setup(90) + Lab Overview(110) + gaps/padding = 340
    const leftGroupRightFull = edgePad + 110 + gap + 90 + gap + 110; // 340
    const useShortLeft = leftGroupRightFull > backX - gap;
    const playOnlineW   = useShortLeft ? 55  : 110;
    const setupW        = useShortLeft ? 65  : 90;
    const overviewW     = useShortLeft ? 82  : 110;
    const playOnlineLabel = useShortLeft ? 'Play'     : 'Play Online';
    const setupLabel      = useShortLeft ? 'Setup'    : 'Lab Setup';
    const overviewLabel   = useShortLeft ? 'Overview' : 'Lab Overview';

    // Right group check — full widths: Finish Mission(125) + Exploitation Demo(140) = 273 + gap
    const rightGroupWFull = 125 + gap + 140; // 273
    const useShortRight = (rightEdge - centerRightEdge - rightGroupWFull) < gap;
    const finishW    = useShortRight ? 65  : 125;
    const demoW      = useShortRight ? 100 : 140;
    const finishLabel    = useShortRight ? 'Finish'       : 'Finish Mission';
    const demoLabel      = useShortRight ? 'Demo' : 'Exploitation Demo';

    const playOnlineX  = edgePad;
    const labSetupX    = edgePad + playOnlineW + gap;
    const labOverviewX = labSetupX + setupW + gap;

    // Right group flush against the right edge
    const rightGroupW = finishW + gap + demoW;
    const rightGroupX = rightEdge - rightGroupW;
    const finishX = rightGroupX;
    const demoX   = rightGroupX + finishW + gap;

    // V0: top bar has menu + switch-to-single; V1-5: top bar has only the hamburger
    const buttons = variant === 0
        ? [menuBtn, switchGuidedBtn]
        : [menuBtn];

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

    // Play Online button — always in the bottom bar (bottom-left)
    const labOnlineEnabled = PLAY_ONLINE_GLOBALLY_ENABLED && (PLAY_ONLINE_MOCK_MODE || !!state.lab?.supportsOnlineMode);
    buttons.push({
        id: 'play-online',
        x: playOnlineX, y: btnY,
        w: playOnlineW, h: btnH,
        label: (state.terminalOpen && labOnlineEnabled) ? 'Close Terminal' : playOnlineLabel,
        style: 'terminal',
        fontSize: 12,
        radius: 8,
        forceActive: !!state.terminalOpen,
        comingSoon: !labOnlineEnabled,
        onClick: () => {
            if (!labOnlineEnabled) {
                toggleComingSoonTerminal(state);
            } else {
                togglePlayOnlineTerminal(state);
            }
        }
    });

    // Lab Setup / Lab Overview — always visible; labels shorten responsively
    buttons.push({
        id: 'lab-setup',
        x: labSetupX, y: btnY,
        w: setupW, h: btnH,
        label: setupLabel,
        style: state.gameViewPhase === 'setup' ? 'primary' : 'secondary',
        fontSize: 12,
        radius: 8,
        forceActive: state.gameViewPhase === 'setup',
        onClick: () => {
            state.panelOverride = state.panelOverride === 'setup' ? null : 'setup';
            state.completeView = null;
            state._redraw();
            updateGamePanel(state);
        }
    });

    buttons.push({
        id: 'lab-overview',
        x: labOverviewX, y: btnY,
        w: overviewW, h: btnH,
        label: overviewLabel,
        style: state.gameViewPhase === 'overview' ? 'primary' : 'secondary',
        fontSize: 12,
        radius: 8,
        forceActive: state.gameViewPhase === 'overview',
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
        onClick: () => { retreatGameState(w, h, state); syncRevealToNavigation(state); state._redraw(); }
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
        forceActive: state.gameViewPhase === 'navigation' && !allRevealed,
        onClick: () => { advanceGameState(w, h, state); syncRevealToNavigation(state); state._redraw(); }
    });

    // Finish Mission button (disabled until all revealed)
    buttons.push({
        id: 'finish-mission',
        x: finishX, y: btnY,
        w: finishW, h: btnH,
        label: finishLabel,
        style: 'primary',
        fontSize: 13,
        radius: 8,
        disabled: !allRevealed,
        forceActive: allRevealed,
        onClick: () => {
            state.screen = 'complete';
            state.selectedNode = null;
            state.selectedEdge = null;
            state.buttons = buildCompleteButtons(w, h, state);
            state._redraw();
            updateGamePanel(state);
        }
    });

    // Demo button — rightmost; disabled when no transcript is available
    // demoButtonStyle cycles through 'terminal' | 'danger' | 'void' via T key
    const demoStyles = ['terminal', 'danger', 'void'];
    const demoStyle = demoStyles[(state._demoButtonStyleIdx || 0) % demoStyles.length];
    buttons.push({
        id: 'demo',
        x: demoX, y: btnY,
        w: demoW, h: btnH,
        label: demoLabel,
        style: demoStyle,
        fontSize: 12,
        radius: 8,
        disabled: !state.lab?.hasDemoTranscript,
        onClick: () => { openGameMenu(state); loadDemoTranscript(state); }
    });

    return buttons;
}

// Draw the capcom-style header (brand + shimmer rule + gold gradient lab name) in canvas,
// matching the .map-preview-title-overlay CSS used in single page mode exactly.
// zoneTopY is the top of the 80px header zone (usually 0).
//
// opts (optional, all have sensible defaults so existing callers are unchanged):
//   brandText: override the small top line (default 'PATHFINDING.CLOUD — LABS')
//   zoneH:     header zone height in px (default 80)
//   scale:     multiplies font sizes, gaps, and rule width (default 1).
//              Used by the hero generator to render the exact same style at
//              larger sizes.
function drawCapcomHeader(ctx, w, zoneTopY, title, opts) {
    const o = opts || {};
    const BRAND_TEXT = (o.brandText != null ? o.brandText : 'PATHFINDING.CLOUD — LABS');
    const labName = (title || '').toUpperCase();
    const scale = o.scale || 1;

    // CSS layout: flex column, centered in zone, gap=0
    // brand (13px) + 5px margin + rule (2px) + 6px margin + lab name (26px) = 52px total
    const ZONE_H = o.zoneH || 80;
    const BRAND_SIZE = Math.round(13 * scale);
    const RULE_H = Math.max(2, Math.round(2 * scale));
    const LAB_SIZE = Math.round(26 * scale);
    const BRAND_GAP = Math.round(5 * scale);   // margin-bottom on brand
    const RULE_GAP = Math.round(6 * scale);    // margin-bottom on rule
    const ruleW = Math.round(320 * scale);

    const totalH = BRAND_SIZE + BRAND_GAP + RULE_H + RULE_GAP + LAB_SIZE;
    const contentTop = zoneTopY + Math.round((ZONE_H - totalH) / 2);
    const brandY   = contentTop;
    const ruleY    = brandY + BRAND_SIZE + BRAND_GAP;
    const labNameY = ruleY + RULE_H + RULE_GAP;

    // Brand line: font-weight:700 letter-spacing:0.22em color:rgba(255,220,100,0.9) text-shadow:0 0 10px rgba(240,180,40,0.5)
    ctx.save();
    ctx.font = `700 ${BRAND_SIZE}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.letterSpacing = '0.22em';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 10 * scale;
    ctx.shadowColor = 'rgba(240, 180, 40, 0.5)';
    ctx.fillText(BRAND_TEXT, w / 2, brandY);
    ctx.letterSpacing = 'normal';
    ctx.restore();

    // Shimmer rule: gradient(90deg,transparent,rgba(240,180,40,0.8),#fff8c0,...) box-shadow:0 0 8px rgba(240,180,40,0.4)
    const ruleX = (w - ruleW) / 2;
    const ruleGrad = ctx.createLinearGradient(ruleX, 0, ruleX + ruleW, 0);
    ruleGrad.addColorStop(0,    'transparent');
    ruleGrad.addColorStop(0.25, 'rgba(240,180,40,0.8)');
    ruleGrad.addColorStop(0.5,  '#fff8c0');
    ruleGrad.addColorStop(0.75, 'rgba(240,180,40,0.8)');
    ruleGrad.addColorStop(1,    'transparent');
    ctx.save();
    ctx.fillStyle = ruleGrad;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = 8 * scale;
    ctx.shadowColor = 'rgba(240, 180, 40, 0.4)';
    ctx.fillRect(ruleX, ruleY, ruleW, RULE_H);
    ctx.restore();

    // Lab name: font-weight:900 letter-spacing:0.04em
    //           gradient(180deg,#fff8c0 0%,#f0b030 45%,#c06010 100%)
    //           filter:drop-shadow(2px 3px 0 rgba(0,0,0,0.8))
    const nameGrad = ctx.createLinearGradient(0, labNameY, 0, labNameY + LAB_SIZE);
    nameGrad.addColorStop(0,    '#fff8c0');
    nameGrad.addColorStop(0.45, '#f0b030');
    nameGrad.addColorStop(1,    '#c06010');
    ctx.save();
    ctx.font = `900 ${LAB_SIZE}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.letterSpacing = '0.04em';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = nameGrad;
    ctx.shadowOffsetX = 2 * scale;
    ctx.shadowOffsetY = 3 * scale;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.fillText(labName, w / 2, labNameY);
    ctx.letterSpacing = 'normal';
    ctx.restore();
}

function drawPlayingHUD(ctx, w, h, state) {
    const p = state.palette;
    const variant = state.hudVariant || 0;
    const isLight = document.documentElement.classList.contains('light-theme');
    const labTitle = state.lab?.displayName || state.lab?.name || '';

    // Which button IDs live in the top bar vs bottom bar.
    // V5 excludes 'menu' so we can draw it manually with capcom gold styling.
    const topBarBtnIds = variant === 0
        ? new Set(['menu', 'reset-view', 'switch-guided'])
        : variant === 5
        ? new Set(['reset-view'])
        : new Set(['menu', 'reset-view']);

    // ---- Top area: variant-specific rendering ----

    if (variant === 0) {
        // V0 (current): rounded rect bar with branding text + switch-mode button
        const topH = 36;
        drawRoundedRect(ctx, 6, 4, w - 12, topH, 8);
        ctx.fillStyle = p.hudBg;
        ctx.fill();
        ctx.strokeStyle = p.hudBorder;
        ctx.lineWidth = 1;
        ctx.stroke();

        state.buttons.forEach(btn => {
            if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
        });

        const menuBtnRight = 10 + 34 + 6;
        ctx.fillStyle = p.hudText;
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.9;
        ctx.fillText('Pathfinding.cloud Labs', menuBtnRight, 22);
        ctx.globalAlpha = 1;

        const scenarioName = state.lab?.displayName || state.lab?.name || '';
        if (scenarioName) {
            const switchBtn = state.buttons.find(b => b.id === 'switch-guided');
            const rightEdge = switchBtn ? switchBtn.x - 8 : w - 210;
            const leftEdge = menuBtnRight + ctx.measureText('Pathfinding.cloud Labs').width + 16;
            const centerX = (leftEdge + rightEdge) / 2;
            ctx.fillStyle = p.hudText;
            ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const maxWidth = rightEdge - leftEdge - 16;
            let label = scenarioName;
            while (label.length > 4 && ctx.measureText(label).width > maxWidth) label = label.slice(0, -1);
            if (label !== scenarioName) label = label.trimEnd() + '…';
            ctx.fillText(label, centerX, 22);
        }

    } else if (variant === 1) {
        // V1 — Capcom header bar: solid sky strip + capcom title centered, hamburger TL, Play Online TR
        ctx.fillStyle = isLight ? '#5a9ac0' : '#060c18';
        ctx.fillRect(0, 0, w, 80);
        drawCapcomHeader(ctx, w, 0, labTitle);
        state.buttons.forEach(btn => {
            if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
        });

    } else if (variant === 2) {
        // V2 — Floating controls: capcom title over full-bleed sky, no bar background
        // Draw a subtle gradient scrim so the title reads on any sky
        const scrim = ctx.createLinearGradient(0, 0, 0, 90);
        scrim.addColorStop(0, isLight ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.45)');
        scrim.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, w, 90);
        drawCapcomHeader(ctx, w, 0, labTitle);
        state.buttons.forEach(btn => {
            if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
        });

    } else if (variant === 3) {
        // V3 — Thin strip: 28px semi-transparent bar, hamburger TL, plain small lab name centered, Play Online TR
        const stripH = 28;
        ctx.fillStyle = isLight ? 'rgba(242,226,196,0.93)' : 'rgba(10,14,24,0.88)';
        ctx.fillRect(0, 0, w, stripH);
        ctx.strokeStyle = isLight ? 'rgba(120,90,30,0.2)' : 'rgba(200,150,50,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, stripH); ctx.lineTo(w, stripH); ctx.stroke();
        state.buttons.forEach(btn => {
            if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
        });
        // Small lab name in center
        if (labTitle) {
            const playOnlineBtn = state.buttons.find(b => b.id === 'play-online');
            const leftBound = 10 + 34 + 8;
            const rightBound = playOnlineBtn ? playOnlineBtn.x - 8 : w - 130;
            ctx.save();
            ctx.font = '500 12px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = p.hudText;
            ctx.globalAlpha = 0.8;
            const centerX = (leftBound + rightBound) / 2;
            let label = labTitle;
            const maxW = rightBound - leftBound - 8;
            while (label.length > 4 && ctx.measureText(label).width > maxW) label = label.slice(0, -1);
            if (label !== labTitle) label = label.trimEnd() + '…';
            ctx.fillText(label, centerX, stripH / 2);
            ctx.restore();
        }

    } else if (variant === 4) {
        // V4 — Capcom bottom-left: no top bar, capcom title anchored above bottom bar.
        // SCRIM_H4 defines the forbidden zone — must match hudBottom in the backtick handler exactly.
        // Forbidden zone from canvas bottom = SCRIM_H4 + bottom bar height (46px).
        state.buttons.forEach(btn => {
            if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
        });
        const barY4   = h - 40 - 6;   // top of bottom action bar
        const SCRIM_H4 = 180;          // gradient height — matches layout margin in backtick handler
        const scrim4 = ctx.createLinearGradient(0, barY4 - SCRIM_H4, 0, barY4);
        scrim4.addColorStop(0, 'rgba(0,0,0,0)');
        scrim4.addColorStop(1, isLight ? 'rgba(10,5,0,0.90)' : 'rgba(0,0,0,0.90)');
        ctx.fillStyle = scrim4;
        ctx.fillRect(0, barY4 - SCRIM_H4, w, SCRIM_H4);
        // Capcom title: brand → rule → lab name, left-aligned, bottom-anchored
        const BRAND_SIZE4 = 13; const RULE_H4 = 2; const LAB_SIZE4 = 34;
        const leftPad4       = 20;
        const labBaseline4   = barY4 - 28;           // lab name bottom edge
        const ruleBottom4    = labBaseline4 - LAB_SIZE4 - 8;
        const ruleTop4       = ruleBottom4 - RULE_H4;
        const brandBaseline4 = ruleTop4 - 6;
        ctx.save();
        ctx.font = `700 ${BRAND_SIZE4}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.letterSpacing = '0.22em'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(240,180,40,0.5)';
        ctx.fillText('PATHFINDING.CLOUD — LABS', leftPad4, brandBaseline4);
        ctx.letterSpacing = 'normal'; ctx.restore();
        const rg4 = ctx.createLinearGradient(leftPad4, 0, leftPad4 + 300, 0);
        rg4.addColorStop(0, 'rgba(240,180,40,0.85)'); rg4.addColorStop(0.5, '#fff8c0'); rg4.addColorStop(1, 'transparent');
        ctx.save(); ctx.fillStyle = rg4;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(240,180,40,0.4)';
        ctx.fillRect(leftPad4, ruleTop4, 300, RULE_H4); ctx.restore();
        const ng4 = ctx.createLinearGradient(0, labBaseline4 - LAB_SIZE4, 0, labBaseline4);
        ng4.addColorStop(0, '#fff8c0'); ng4.addColorStop(0.45, '#f0b030'); ng4.addColorStop(1, '#c06010');
        ctx.save();
        ctx.font = `900 ${LAB_SIZE4}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.letterSpacing = '0.04em'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = ng4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
        ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.fillText(labTitle.toUpperCase(), leftPad4, labBaseline4);
        ctx.letterSpacing = 'normal'; ctx.restore();

    } else if (variant === 5) {
        // V5 (default) — Capcom top-left: dark gradient scrim at top, brand → rule → lab name left-aligned.
        // SCRIM_H5 defines the forbidden zone — must match hudTop in the backtick handler exactly.
        // Clouds and islands are pushed below SCRIM_H5 when this variant is active.
        state.buttons.forEach(btn => {
            if (topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
        });
        // Draw hamburger at top-right in capcom gold style (matches brand text color + glow).
        const menuBtn5 = state.buttons.find(b => b.id === 'menu');
        if (menuBtn5) {
            ctx.save();
            ctx.font = '700 34px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.letterSpacing = '0.12em';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
            ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
            ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(240,180,40,0.5)';
            ctx.fillText('☰', menuBtn5.x + menuBtn5.w / 2, menuBtn5.y + menuBtn5.h / 2);
            ctx.letterSpacing = 'normal';
            ctx.restore();
        }
        const SCRIM_H5 = 150;          // gradient height — matches layout margin in backtick handler
        const scrim5 = ctx.createLinearGradient(0, 0, 0, SCRIM_H5);
        scrim5.addColorStop(0,    isLight ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.92)');
        scrim5.addColorStop(0.6,  isLight ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.50)');
        scrim5.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = scrim5;
        ctx.fillRect(0, 0, w, SCRIM_H5);
        // Capcom title: brand → rule → lab name, left-aligned, top-anchored
        const BRAND_SIZE5 = 17; const RULE_H5 = 2; const LAB_SIZE5 = 46;
        const leftPad5  = 20; const topPad5 = 14;
        const brandTop5   = topPad5;
        const ruleTop5    = brandTop5 + BRAND_SIZE5 + 7;
        const labNameTop5 = ruleTop5 + RULE_H5 + 9;
        ctx.save();
        ctx.font = `700 ${BRAND_SIZE5}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.letterSpacing = '0.22em'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(240,180,40,0.5)';
        ctx.fillText('PATHFINDING.CLOUD — LABS', leftPad5, brandTop5);
        ctx.letterSpacing = 'normal'; ctx.restore();
        const rg5 = ctx.createLinearGradient(leftPad5, 0, leftPad5 + 300, 0);
        rg5.addColorStop(0, 'rgba(240,180,40,0.85)'); rg5.addColorStop(0.5, '#fff8c0'); rg5.addColorStop(1, 'transparent');
        ctx.save(); ctx.fillStyle = rg5;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(240,180,40,0.4)';
        ctx.fillRect(leftPad5, ruleTop5, 300, RULE_H5); ctx.restore();
        // Shrink the lab name font until it fits between the left pad and the hamburger button.
        // Right edge: hamburger sits at w-66, leave 14px breathing room → w-80.
        const labMaxWidth5 = w - leftPad5 - 80;
        let labFontSize5 = LAB_SIZE5;
        ctx.save();
        ctx.letterSpacing = '0.04em';
        while (labFontSize5 > 14) {
            ctx.font = `900 ${labFontSize5}px -apple-system, BlinkMacSystemFont, sans-serif`;
            if (ctx.measureText(labTitle.toUpperCase()).width <= labMaxWidth5) break;
            labFontSize5--;
        }
        ctx.restore();
        const ng5 = ctx.createLinearGradient(0, labNameTop5, 0, labNameTop5 + labFontSize5);
        ng5.addColorStop(0, '#fff8c0'); ng5.addColorStop(0.45, '#f0b030'); ng5.addColorStop(1, '#c06010');
        ctx.save();
        ctx.font = `900 ${labFontSize5}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.letterSpacing = '0.04em'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = ng5; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
        ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.fillText(labTitle.toUpperCase(), leftPad5, labNameTop5);
        ctx.letterSpacing = 'normal'; ctx.restore();
    }

    // ---- Bottom action bar (same across all variants) ----
    const barH = 40;
    const barY = h - barH - 6;
    drawRoundedRect(ctx, 6, barY, w - 12, barH, 8);
    ctx.fillStyle = p.hudBg;
    ctx.fill();
    ctx.strokeStyle = p.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Bottom bar buttons (everything not in the top bar set)
    state.buttons.forEach(btn => {
        if (!topBarBtnIds.has(btn.id)) drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p);
    });

    // ---- HUD variant flash indicator (shown briefly after cycling with backtick) ----
    const flashAge = Date.now() - (state._hudVariantFlashAt || 0);
    if (flashAge < 2000) {
        const alpha = flashAge < 1400 ? 1 : 1 - (flashAge - 1400) / 600;
        const label = `HUD ${variant + 1} / 6`;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const pillW = ctx.measureText(label).width + 22;
        const pillH = 22;
        const pillX = (w - pillW) / 2;
        const pillY = h / 2 - pillH / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, w / 2, pillY + pillH / 2);
        ctx.restore();
        // Schedule one more redraw for the fade-out
        if (alpha > 0 && state._redraw) requestAnimationFrame(() => {
            if (Date.now() - (state._hudVariantFlashAt || 0) < 2000) state._redraw();
        });
    }
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
        // Allow callers (e.g. the hero generator) to override the default
        // "Hop N" label by setting edge.displayLabel. Implicit edges always
        // show "Auto".
        const label = edge.implicit ? 'Auto' : (edge.displayLabel || `Hop ${hopCounter}`);

        ctx.save();
        if (!isHeliRevealed(state, `edge:${ei}`)) ctx.globalAlpha = 0.25;
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
            ...labs.map(l => ({ id: `lab-${l.slug}`, slug: l.slug })),
            { id: 'back' },
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

        // Update breadcrumb text and page title so the sticky header reflects the new lab.
        // _container is .detail-scrollable-content; its parent is #detail-content which
        // holds the sticky header as a sibling.
        const labName = fullLab.displayName || fullLab.name || slug;
        document.title = `${labName} - Labs - pathfinding.cloud`;
        const breadcrumbCurrent = container?.parentElement?.querySelector('.breadcrumb-current');
        if (breadcrumbCurrent) breadcrumbCurrent.textContent = labName;

        // Update the global lab reference so "Switch to Single Page Mode" loads this lab.
        window._currentLabDetail = fullLab;

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
            const resp = await fetch(`/labs/demo-transcripts/${slug}.txt`);
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
        const kbStyle = 'display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);border-radius:4px;padding:1px 6px;font-family:monospace;';
        html += '<div class="mg-transcript-footer" style="background:#111;border-top:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.65);">';
        html += `<span style="${kbStyle}">&uarr;&darr;</span> Scroll &nbsp;`;
        html += `<span style="${kbStyle}">&larr;&rarr;</span> Side-scroll &nbsp;`;
        html += `<span style="${kbStyle}">Esc</span> Close`;
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
                        { keys: ['G'], desc: 'Cycle target island style' },
                        { keys: ['P'], desc: 'Cycle plane style' },
                        { keys: ['W'], desc: 'Cycle sky (sky / sunset / dusk)' },
                        { keys: ['R'], desc: 'Reset view' },
                        { keys: ['F'], desc: 'Toggle fullscreen' },
                        { keys: ['Scroll'],      desc: 'Resize islands' },
                        { keys: ['Ctrl+Scroll'], desc: 'Zoom in / out' },
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
                html += '<div class="mg-keybindings-group">';
                html += `<div class="mg-keybindings-group-label">${group.label}</div>`;
                for (const row of group.rows) {
                    const keyBadges = row.keys.map(k => `<span class="mg-key-badge">${k}</span>`).join(' ');
                    html += `<div class="mg-keybindings-row"><span class="mg-keybindings-keys">${keyBadges}</span><span>${row.desc}</span></div>`;
                }
                html += '</div>';
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

    // If the dialog is tall enough to touch the top or bottom of the overlay,
    // switch to a two-column layout so everything fits without scrolling.
    if (state.menuView !== 'labs-browser' && state.menuView !== 'demo-transcript') {
        const dialog = menuEl.querySelector('.mg-menu-dialog');
        if (dialog && menuEl.offsetHeight > 0 && dialog.scrollHeight >= menuEl.offsetHeight - 48) {
            dialog.classList.add('mg-menu-cols-2');
        }
    }

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

    // Layout: vertically stacked, centered below the title/lab name
    const baseY = h * 0.38;
    const btnX = (w - btnW) / 2;
    const smallBtnX = (w - smallBtnW) / 2;

    const variant = state.hudVariant || 0;
    const menuX = variant === 5 ? w - 66 : 10;

    const buttons = [
        {
            id: 'menu',
            x: menuX, y: 6,
            w: 56, h: 44,
            label: '☰',
            style: 'ghost',
            fontSize: 36,
            radius: 6,
            onClick: () => { openGameMenu(state); }
        },
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
        {
            id: 'download-map', x: smallBtnX, y: baseY + btnH + gap,
            w: smallBtnW, h: smallBtnH, label: 'Download Map',
            style: 'secondary', fontSize: 12, radius: 10,
            onClick: () => {
                const offscreen = buildCleanMapCanvas(w, h, state);
                if (offscreen) labShareAction('download', offscreen, state.lab);
            }
        },
    ];

    return buttons;
}

function drawCompleteOverlay(ctx, w, h, state) {
    const p = state.palette;
    state.buttons.forEach(btn => drawThemedButton(ctx, btn, state.hoveredButton || state._heliHoveredButton, state.activeButton, p));
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

    // First pass: walk the linear chain to get ordered raw nodes and edges.
    // Self-referential edges (e.g. iam:PutRolePolicy on itself) are expanded into
    // two entries: one for the escalation step, one for the post-escalation state.
    const rawChain = []; // { nodeData, outEdge }
    const visited = new Set();
    let currentId = rootId;
    while (currentId) {
        const nodeData = nodeById.get(currentId);
        if (!nodeData) break;
        // Self-referential edge: the node acts on itself (e.g. iam:PutRolePolicy → same role)
        const selfEdge = attackMap.edges.find(e => e.from === currentId && e.to === currentId);
        // Forward edge: to a different node not yet visited
        const outEdge = attackMap.edges.find(e => e.from === currentId && e.to !== currentId && !visited.has(e.to));
        if (selfEdge) {
            // Expand into two entries: "before escalation" (self-edge) then "after escalation" (forward edge or terminal).
            // The "before" copy never has isAdmin (the principal hasn't escalated yet).
            // The "after" copy inherits isAdmin from the node OR from grantsAdmin on the self-loop edge.
            rawChain.push({ nodeData: { ...nodeData, isAdmin: false }, outEdge: selfEdge });
            rawChain.push({ nodeData: { ...nodeData, isAdmin: nodeData.isAdmin || !!selfEdge.grantsAdmin }, outEdge });
            visited.add(currentId);
            currentId = outEdge ? outEdge.to : null;
        } else {
            if (visited.has(currentId)) break;
            visited.add(currentId);
            rawChain.push({ nodeData, outEdge });
            currentId = outEdge ? outEdge.to : null;
        }
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
            isTarget: !!nd.isTarget,
            isAdmin: !!nd.isAdmin,
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

// Sky-style variants for the canvas-wide sky/ocean gradient. Returned values
// are top / middle / bottom gradient stops in the SAME shape as oceanA/B/Deep
// in the base palette, so callers can spread the result over the palette to
// override only those three colors. 'sky' returns null which means "leave the
// palette alone" (current default look). 'sunset' and 'dusk' rewrite the
// gradient to evoke a warm horizon or a soft purple twilight.
//
// New variants can be added here -- both drawGameMap (interactive game) and
// renderStaticMapPreview (single-page attack map) read state.skyStyle and
// apply the result before painting, so any variant added here shows up in
// both places automatically.
const SKY_STYLE_LIST = ['sky', 'sunset', 'dusk'];
function getSkyVariantColors(skyStyle) {
    switch (skyStyle) {
        case 'sunset':
            return { oceanA: '#1a1432', oceanB: '#e8628c', oceanDeep: '#ffb070' };
        case 'dusk':
            return { oceanA: '#101030', oceanB: '#583e7a', oceanDeep: '#c89ab0' };
        case 'sky':
        default:
            return null;
    }
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
function computeMapLayout(count, w, h, hudTopOverride, hudBottomOverride) {
    const positions = [];
    if (count === 0) return positions;

    const hudTop    = hudTopOverride    ?? 48;   // below top HUD bar
    let   hudBottom = hudBottomOverride ?? 110;  // above bottom action bar + label plate space

    // Always reserve extra bottom space for sprite-backed islands.
    // The sprite bottom + label plate sits ~1.62*r below pos.y; callers
    // that pass an explicit hudBottomOverride already account for this, but
    // the default path (no override) gets a conservative bump so the band
    // doesn't collapse on tight canvases.
    {
        const baseRadius = 73;
        const shrinkSteps = Math.max(0, count - 3);
        const estimatedRadius = baseRadius * Math.pow(0.8, shrinkSteps);
        const scale = ISLAND_SPRITE_FOOTPRINT_SCALE.principal;
        hudBottom += Math.round(estimatedRadius * Math.min(0.7, scale * 0.25));
    }
    const cloudBottom = h * 0.22; // clouds end here -- islands start BELOW this
    const padX = w * 0.15;     // 15% margin each side so islands stay central

    // Island zone: entirely below the cloud bottom AND the caller-supplied
    // top margin (hudTop). Taking the max of both lets callers (e.g. the
    // hero generator with no title) demand islands start well below the
    // default cloud band when they've widened the cloud zone themselves.
    const minY = Math.max(cloudBottom + 20, hudTop);
    const maxY = h - hudBottom - 30;
    const centerY = (minY + maxY) / 2;
    const rangeY = (maxY - minY) / 2;

    const rng = mapRng(count * 31);

    // With only 2 islands the full zig-zag amplitude looks very diagonal.
    // Spread them wider than the default (use less padding) while keeping the
    // reduced vertical offset so the pair reads as nearly side-by-side.
    const effectivePadX = count === 2 ? w * 0.20 : padX;

    for (let i = 0; i < count; i++) {
        // Evenly spaced left-to-right
        const t = count === 1 ? 0.5 : i / (count - 1);
        const x = effectivePadX + t * (w - effectivePadX * 2);

        // Zig-zag Y: alternate above/below center, amplitude scales with zone height.
        // For 2-island layouts use a much smaller amplitude so they sit near the
        // horizontal midline instead of forming a steep diagonal.
        const zigzagSign = (i % 2 === 0) ? 1 : -1;
        const amplitude = rangeY * (count === 2 ? 0.18 : 0.6);
        let baseY = centerY + zigzagSign * amplitude;

        // Jitter for organic feel -- scale down with node count so the zig-zag
        // separation is preserved when islands are small and space is tight.
        // At 3 nodes scale=1.0, at 5 nodes scale=0.76, at 7 nodes scale=0.52, etc.
        const jitterScale = Math.max(0.25, 1 - Math.max(0, count - 3) * 0.12);
        const jitterX = (rng() - 0.5) * 30 * jitterScale;
        const jitterY = (rng() - 0.5) * 40 * jitterScale;

        const clampedX = Math.max(effectivePadX, Math.min(w - effectivePadX, x + jitterX));
        const clampedY = Math.max(minY, Math.min(maxY, baseY + jitterY));
        positions.push({ x: clampedX, y: clampedY });
    }
    return positions;
}

// Compute companion positions offset from their parent edge midpoints.
// islandRadius is used to define a minimum safe clearance from main island centers.
// offsetScale shrinks the perpendicular offset candidates (use 0.5 for thumbnails).
// forcePureHorizontal: when true, companion offsets are purely ±X (no vertical component).
//   Use this for vertical mobile layouts where the natural perpendicular has a Y component
//   that would push companions into node labels above or below.
function computeCompanionPositions(companions, edges, positions, islandRadius, offsetScale, forcePureHorizontal) {
    if (!companions || !companions.length) return [];
    // Companions must stay this far from every main island center
    const safeDistance = (islandRadius || 70) * 1.7;
    const tooClose = (cx, cy) => positions.some(p => Math.hypot(p.x - cx, p.y - cy) < safeDistance);

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
        // In vertical mobile layouts the natural perpendicular (-dy/len, dx/len) has a
        // Y component (because edges are slightly diagonal due to zigzag), which pushes
        // companions up/down into node labels. forcePureHorizontal clamps it to ±X only.
        const perpX = forcePureHorizontal ? 1 : -dy / len;
        const perpY = forcePureHorizontal ? 0 : dx / len;

        // When multiple companions share an edge, spread them along the edge
        // and offset perpendicular to avoid overlapping the path line
        const siblingIndices = parentEdge.companionIndices || [];
        const siblingPos = siblingIndices.indexOf(ci);
        const siblingCount = siblingIndices.length;
        // Position along edge: in horizontal layouts, center at 0.5.
        // In vertical mobile layouts (forcePureHorizontal), push toward the destination
        // node so companions don't visually crowd the previous node's label below.
        const t = forcePureHorizontal
            ? (siblingCount <= 1 ? 0.72 : 0.60 + (siblingPos / (siblingCount - 1)) * 0.24)
            : (siblingCount <= 1 ? 0.50 : 0.35 + (siblingPos / (siblingCount - 1)) * 0.30);
        const anchorX = fromPos.x + dx * t;
        const anchorY = fromPos.y + dy * t;

        // Try increasing offsets on each side until we find a position that doesn't
        // land on a main island. Candidates: +60, -60, +90, -90, +120, -120,
        // scaled down by offsetScale when rendering in a compact space (e.g. thumbnails).
        const s = offsetScale ?? 1;
        const offsets = [60 * s, -60 * s, 90 * s, -90 * s, 120 * s, -120 * s];
        let chosen = null;
        for (const off of offsets) {
            const cx = anchorX + perpX * off;
            const cy = anchorY + perpY * off;
            if (!tooClose(cx, cy)) {
                chosen = { x: cx, y: cy };
                break;
            }
        }
        // Fallback: use the candidate that maximises distance from its nearest island
        if (!chosen) {
            const best = offsets.map(off => {
                const cx = anchorX + perpX * off;
                const cy = anchorY + perpY * off;
                const minD = Math.min(...positions.map(p => Math.hypot(p.x - cx, p.y - cy)));
                return { x: cx, y: cy, minD };
            }).reduce((a, b) => (b.minD > a.minD ? b : a));
            chosen = { x: best.x, y: best.y };
        }
        companionPositions.push(chosen);
    }
    return companionPositions;
}

// Generate decorative elements avoiding island positions and HUD bars.
// Clouds are handled separately by cloudSprites, so this only generates trees.
function generateMapDecorations(positions, w, h, hudTopOverride, hudBottomOverride) {
    const decorations = [];
    const rng = mapRng(42);
    const isNear = (x, y, minDist) => positions.some(p => Math.hypot(p.x - x, p.y - y) < minDist);
    const hudTop    = hudTopOverride    ?? 48;
    const hudBottom = hudBottomOverride ?? 56;

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
    // Sprite path: draw the hand-drawn principal-island PNG when loaded.
    // Principal sprites use a 25%-larger footprint than the procedural shore
    // so they read as the dominant nodes on the path. Falls back below.
    if (drawIslandSpriteFor(
            ctx,
            islandSprites.get('principal'),
            pos,
            islandRadius * ISLAND_SPRITE_FOOTPRINT_SCALE.principal,
            ISLAND_SPRITE_GRASS_CENTER.principal,
        )) return;

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

// ---- Target Island Renderers ----
// Applied only to nodes that have `isTarget: true` in the attack map YAML.
// Three variants are provided so the user can compare visual treatments
// via the G keyboard shortcut. Each variant MUST preserve enough island
// surface for the AWS resource/principal icon to remain readable.

// Golden grass colors -- applied to every target island variant so they
// stand out from green principal islands and small companion islets.
const TARGET_GOLD_GRASS = '#d9a842';
const TARGET_GOLD_GRASS_HIGHLIGHT = 'rgba(255, 220, 120, 0.4)';
const TARGET_GOLD_GRASS_DARK = '#a87820';

// Gold-tint overlay for classic-plus and fortress variants, where the
// underlying terrain is drawn in green first. A soft radial gold wash
// converts the grass to gold while keeping trees/ruins details visible
// underneath. ellipseScaleX lets the fortress variant widen the tint to
// match its wider island body.
function drawTargetGoldGrassTint(ctx, pos, islandRadius, ellipseScaleX = 1) {
    ctx.save();
    const rx = islandRadius * 0.82 * ellipseScaleX;
    const ry = islandRadius * 0.30;
    const grad = ctx.createRadialGradient(pos.x, pos.y - 2, 0, pos.x, pos.y, rx);
    grad.addColorStop(0,   'rgba(255, 215, 95, 0.72)');
    grad.addColorStop(0.55, 'rgba(217, 168, 66, 0.62)');
    grad.addColorStop(1,   'rgba(168, 120, 32, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Variant A: classic-plus -- the natural island terrain (whatever the T-key
// island style is set to) with extra prominence: a gold shoreline halo,
// a stone plinth at the flagpole base, and a tall rectangular CTF-style
// flag. The caller has already drawn the standard terrain for this island.
function drawTargetOverlayClassicPlus(ctx, pos, islandRadius, p) {
    const gold = p.endFill || '#f59e0b';

    // Gold shoreline halo -- a faint double ring just outside the sand
    ctx.save();
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, islandRadius * 1.18, islandRadius * 0.46, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Stone plinth at the base of the flagpole
    const plinthCx = pos.x;
    const plinthCy = pos.y - 1;
    const plinthW = 14;
    const plinthH = 7;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(plinthCx - plinthW / 2 + 1, plinthCy + 1, plinthW, plinthH);
    ctx.fillStyle = '#8a8070';
    ctx.fillRect(plinthCx - plinthW / 2, plinthCy, plinthW, plinthH);
    ctx.fillStyle = '#aaa090';
    ctx.fillRect(plinthCx - plinthW / 2, plinthCy, plinthW, 2);
    ctx.fillStyle = '#6a6050';
    ctx.fillRect(plinthCx - plinthW / 2, plinthCy + plinthH - 1, plinthW, 1);
    ctx.restore();

    // Tall flagpole with rectangular CTF-style banner
    const poleX = pos.x;
    const poleBase = plinthCy - 1;
    const poleTop = pos.y - 66;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(poleX + 1, poleBase + 1); ctx.lineTo(poleX + 1, poleTop + 1); ctx.stroke();
    ctx.strokeStyle = p.flagPole || '#5a4030';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(poleX, poleBase); ctx.lineTo(poleX, poleTop); ctx.stroke();
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.arc(poleX, poleTop - 1, 3.5, 0, Math.PI * 2); ctx.fill();

    const flagW = 22;
    const flagH = 16;
    const flagY = poleTop + 2;
    ctx.fillStyle = p.flagColor || '#dc2626';
    ctx.beginPath();
    ctx.moveTo(poleX + 1, flagY);
    ctx.quadraticCurveTo(poleX + flagW * 0.55, flagY + 2.5, poleX + flagW, flagY + 4);
    ctx.lineTo(poleX + flagW - 2, flagY + flagH);
    ctx.quadraticCurveTo(poleX + flagW * 0.45, flagY + flagH - 2, poleX + 1, flagY + flagH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(poleX, flagY, 1.5, flagH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', poleX + flagW * 0.55, flagY + flagH * 0.55);
    ctx.restore();
}

// Variant B: flag-shape -- replaces the natural island silhouette with a
// rectangle-plus-triangular-notch that reads as "a flag laid flat". The
// caller must NOT draw standard terrain first; this function draws its own
// full island body using the same palette layers.
// Dimensions: roughly square-ish (a little wider than tall) so the shape
// still reads as a flag without being an awkward thin ribbon.
// Grass is gold so target islands read as distinct from principal islands.
function drawTargetIslandFlagShape(ctx, pos, islandRadius, seed, p) {
    // Sprite path: the target-island PNG is a normal-sized floating island with
    // the CTF flag drawn into the sprite, so we size it the same as principal
    // islands (2.4 * islandRadius wide). drawGameMap detects this and drops the
    // 0.60 icon-shrink that compensated for the smaller flag silhouette below.
    // Use the target-specific grass-center anchor (~0.50) because the flag pole
    // pushes the grass surface to the middle of the PNG; principal sprites have
    // grass near the top, so they use a smaller anchor (~0.40).
    if (drawIslandSpriteFor(
            ctx,
            islandSprites.get('target'),
            pos,
            islandRadius * ISLAND_SPRITE_FOOTPRINT_SCALE.target,
            ISLAND_SPRITE_GRASS_CENTER.target,
        )) return;

    // 25% smaller than the original flag dimensions while preserving the
    // square-ish ratio so the silhouette still reads as a flag.
    const halfW = islandRadius * 0.71;
    const halfH = islandRadius * 0.44;
    const notch = islandRadius * 0.23;

    // Five-point flag polygon (clockwise from top-left).
    // `offsetY` lets the shore/cliff layers drop down for depth, and
    // `shrinkW`/`shrinkH` shrink the polygon inward for inner grass layers.
    const flagPoly = (offsetX, offsetY, shrinkW, shrinkH) => [
        { x: pos.x - halfW + shrinkW + offsetX, y: pos.y - halfH + shrinkH + offsetY },
        { x: pos.x + halfW - shrinkW + offsetX, y: pos.y - halfH + shrinkH + offsetY },
        { x: pos.x + halfW - shrinkW - notch + offsetX, y: pos.y + offsetY },
        { x: pos.x + halfW - shrinkW + offsetX, y: pos.y + halfH - shrinkH + offsetY },
        { x: pos.x - halfW + shrinkW + offsetX, y: pos.y + halfH - shrinkH + offsetY },
    ];

    const fillPoly = (pts) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
        ctx.closePath();
        ctx.fill();
    };

    // Deep shadow for pronounced 3D depth (matches the principal-island
    // wooded terrain so the flag island sits on the water the same way).
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    fillPoly(flagPoly(4, 11, 0, 0));
    // Outer cliff layer -- darker stone beneath the visible cliff face
    ctx.fillStyle = '#5a4a30';
    fillPoly(flagPoly(1, 7, 0, 0));
    // Inner cliff face
    ctx.fillStyle = p.cliffDark;
    fillPoly(flagPoly(0, 4, 0, 0));
    // Shore (sand)
    ctx.fillStyle = p.sandLight;
    fillPoly(flagPoly(0, 0, 0, 0));
    // Golden grass layer -- shrunk inward. Warm ochre reads as "goal" and
    // differentiates target islands from principal/companion islands.
    ctx.fillStyle = TARGET_GOLD_GRASS;
    fillPoly(flagPoly(0, 0, islandRadius * 0.13, islandRadius * 0.09));
    // Inner grass highlight -- brighter gold for sun-caught top surface
    ctx.fillStyle = TARGET_GOLD_GRASS_HIGHLIGHT;
    fillPoly(flagPoly(0, -1, islandRadius * 0.32, islandRadius * 0.18));

    // Slightly opaque red trim around the shore edge of the flag shape --
    // classic flag color to complement the golden grass without
    // overwhelming it.
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#c93030';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const trim = flagPoly(0, 0, 0, 0);
    ctx.moveTo(trim[0].x, trim[0].y);
    for (let j = 1; j < trim.length; j++) ctx.lineTo(trim[j].x, trim[j].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

// Variant C: fortress -- replaces the natural island silhouette with a
// WIDER island so the resource-type banner (left half) and the castle with
// flag (right half) fit side by side without occluding each other. This
// function draws the full island body, gold grass, banner (using the
// standard banner-icon style), and castle. The caller must NOT draw the
// standard terrain or icon for this island; this function is authoritative.
// Island width multiplier -- bumps the horizontal radius so banner + castle
// fit side by side. Height stays at the default islandRadius proportions.
const TARGET_FORTRESS_WIDTH_SCALE = 1.45;

function drawTargetIslandFortress(ctx, pos, islandRadius, seed, p, node) {
    const wScale = TARGET_FORTRESS_WIDTH_SCALE;
    const shoreRx = islandRadius * 1.1 * wScale;
    const shoreRy = islandRadius * 0.42;
    const rockRx  = islandRadius * 0.9 * wScale;
    const rockRy  = islandRadius * 0.35;
    const innerRx = islandRadius * 0.65 * wScale;
    const innerRy = islandRadius * 0.24;

    // Wider shore / cliff / grass layers. Reuses the same procedural
    // shape generator as the classic terrain so the silhouette still has
    // organic noise rather than a perfect ellipse.
    const shore = generateIslandShape(pos.x, pos.y, shoreRx, shoreRy, seed, 24);
    const rock  = generateIslandShape(pos.x, pos.y, rockRx,  rockRy,  seed + 1, 24);
    const inner = generateIslandShape(pos.x, pos.y - 1, innerRx, innerRy, seed + 2, 20);

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
    // Green base (will be tinted gold by the grass overlay below)
    ctx.fillStyle = p.islandGreenB;
    drawSmoothShape(ctx, rock);
    ctx.fill();
    // Inner highlight
    ctx.fillStyle = p.grassHighlight;
    drawSmoothShape(ctx, inner);
    ctx.fill();

    // Golden grass tint across the wider body
    drawTargetGoldGrassTint(ctx, pos, islandRadius, wScale);

    // ---- Banner on the LEFT half ----
    // drawIconBanner draws relative to its pos argument, so shifting pos
    // to the left moves the banner, posts, and logo as a unit. We scale
    // the perceived radius slightly smaller so the banner stays compact
    // and leaves visual room for the castle on the right.
    const halfGap = islandRadius * 0.62;
    const bannerPos = { x: pos.x - halfGap, y: pos.y };
    const bannerRadius = islandRadius * 0.78;
    drawIconBanner(ctx, bannerPos, bannerRadius, node, p);

    // ---- Castle on the RIGHT half ----
    const castleCx = pos.x + halfGap;
    drawTargetCastleAt(ctx, castleCx, pos.y, islandRadius * 0.82, p);
}

// Shared castle drawing helper used by the fortress target variant. Takes
// a center point and an effective radius so the scale matches the right
// half of the wider fortress island.
function drawTargetCastleAt(ctx, cx, cy, radius, p) {
    const gold = p.endFill || '#f59e0b';
    const wallColor = '#8a7a5a';
    const wallDark = '#6a5a3a';
    const wallShadow = 'rgba(0,0,0,0.28)';

    // Crenellated wall fitted to the right half of the island
    const wallW = radius * 0.95;
    const wallH = radius * 0.24;
    const wallX = cx - wallW / 2;
    const wallY = cy - wallH * 0.35;

    ctx.save();
    ctx.fillStyle = wallShadow;
    ctx.fillRect(wallX + 2, wallY + wallH, wallW, 4);
    ctx.fillStyle = wallColor;
    ctx.fillRect(wallX, wallY, wallW, wallH);
    ctx.fillStyle = wallDark;
    ctx.fillRect(wallX, wallY + wallH - 3, wallW, 3);

    const merlonCount = 6;
    const merlonGap = wallW / (merlonCount * 2 - 1);
    const merlonH = wallH * 0.42;
    for (let m = 0; m < merlonCount; m++) {
        const mx = wallX + m * merlonGap * 2;
        ctx.fillStyle = wallColor;
        ctx.fillRect(mx, wallY - merlonH, merlonGap, merlonH);
        ctx.fillStyle = wallDark;
        ctx.fillRect(mx, wallY - merlonH, merlonGap, 2);
    }
    ctx.restore();

    // Central tower rising above the wall
    const towerW = wallW * 0.26;
    const towerH = wallH * 2.0;
    const towerX = cx - towerW / 2;
    const towerY = wallY - towerH * 0.6;

    ctx.save();
    ctx.fillStyle = wallShadow;
    ctx.fillRect(towerX + 2, towerY + 2, towerW, towerH);
    ctx.fillStyle = wallColor;
    ctx.fillRect(towerX, towerY, towerW, towerH);
    ctx.fillStyle = wallDark;
    ctx.fillRect(towerX, towerY + towerH - 3, towerW, 3);

    const tMerlonCount = 3;
    const tMerlonGap = towerW / (tMerlonCount * 2 - 1);
    const tMerlonH = towerH * 0.14;
    for (let m = 0; m < tMerlonCount; m++) {
        const mx = towerX + m * tMerlonGap * 2;
        ctx.fillStyle = wallColor;
        ctx.fillRect(mx, towerY - tMerlonH, tMerlonGap, tMerlonH);
    }
    ctx.fillStyle = '#2a2015';
    ctx.fillRect(cx - 1, towerY + towerH * 0.3, 2, towerH * 0.22);
    ctx.restore();

    // Flagpole from the tower top with a waving red pennant bearing "F"
    const poleX = cx;
    const poleBase = towerY - tMerlonH * 0.5;
    const poleTop = poleBase - 32;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(poleX + 1, poleBase + 1); ctx.lineTo(poleX + 1, poleTop + 1); ctx.stroke();
    ctx.strokeStyle = p.flagPole || '#5a4030';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(poleX, poleBase); ctx.lineTo(poleX, poleTop); ctx.stroke();
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.arc(poleX, poleTop - 1, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = p.flagColor || '#dc2626';
    ctx.beginPath();
    ctx.moveTo(poleX + 1, poleTop);
    ctx.quadraticCurveTo(poleX + 16, poleTop + 3, poleX + 24, poleTop + 9);
    ctx.lineTo(poleX + 1, poleTop + 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('F', poleX + 9, poleTop + 8);
    ctx.restore();
}

// Draw small decorative bling icons pinned around a target island perimeter.
// Items: gold stars, mini flags, tiny rainbow arc, trophy cup, crown.
// Each pin breathes (gentle scale pulse) independently via Date.now().
function drawTargetIslandBling(ctx, pos, islandRadius) {
    // Base icon size scales with island but stays readable at small radii.
    const bs = Math.max(8, Math.min(16, islandRadius * 0.155));

    // angle: radians from center (canvas y-down; negative = upper half).
    // dist: multiple of islandRadius. freq/phase drive the breathing animation.
    const pins = [
        { angle: -Math.PI * 0.92, dist: 0.92, type: 'flag'    },
        { angle: -Math.PI * 0.72, dist: 0.96, type: 'star'    },
        { angle: -Math.PI * 0.50, dist: 1.00, type: 'rainbow' },
        { angle: -Math.PI * 0.28, dist: 0.96, type: 'star'    },
        { angle: -Math.PI * 0.08, dist: 0.92, type: 'trophy'  },
        { angle:  Math.PI * 0.08, dist: 0.92, type: 'flag'    },
        { angle: -Math.PI * 1.10, dist: 0.92, type: 'crown'   },
        { angle: -Math.PI * 0.38, dist: 1.02, type: 'star'    },
        { angle: -Math.PI * 0.62, dist: 1.02, type: 'flag'    },
    ];

    for (const pin of pins) {
        const bx = pos.x + Math.cos(pin.angle) * islandRadius * pin.dist;
        const by = pos.y + Math.sin(pin.angle) * islandRadius * pin.dist;
        const s = bs;

        ctx.save();
        ctx.translate(bx, by);

        switch (pin.type) {
            case 'star': {
                // 5-pointed gold star.
                const outerR = s * 0.75;
                const innerR = outerR * 0.42;
                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const a = (i * Math.PI / 5) - Math.PI / 2;
                    const r = i % 2 === 0 ? outerR : innerR;
                    if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a));
                    else ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
                }
                ctx.closePath();
                ctx.fillStyle = '#ffd700';
                ctx.fill();
                ctx.strokeStyle = '#b8860b';
                ctx.lineWidth = 0.8;
                ctx.stroke();
                break;
            }

            case 'flag': {
                // Small pennant flag on a stick.
                const poleH = s * 1.25;
                ctx.strokeStyle = '#5a3020';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(0, -poleH); ctx.lineTo(0, s * 0.3);
                ctx.stroke();
                ctx.fillStyle = '#e63030';
                ctx.beginPath();
                ctx.moveTo(0, -poleH);
                ctx.lineTo(s * 0.85, -poleH + s * 0.42);
                ctx.lineTo(0, -poleH + s * 0.85);
                ctx.closePath();
                ctx.fill();
                // Tiny golden finial at pole tip.
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(0, -poleH - 1.5, 1.8, 0, Math.PI * 2);
                ctx.fill();
                break;
            }

            case 'rainbow': {
                // Tiny 3-band rainbow arc, centered slightly above origin.
                const yCy = s * 0.2;
                const bands = [
                    ['rgba(220,50,50,0.9)',   s * 0.90],
                    ['rgba(80,210,80,0.85)',  s * 0.62],
                    ['rgba(40,140,230,0.85)', s * 0.35],
                ];
                for (const [color, r] of bands) {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = s * 0.22;
                    ctx.lineCap = 'butt';
                    ctx.beginPath();
                    ctx.arc(0, yCy, r, Math.PI, 0, false);
                    ctx.stroke();
                }
                break;
            }

            case 'trophy': {
                // Simple trophy cup: bowl + stem + base.
                const hw = s * 0.55;
                const bowlH = s * 0.70;
                const stemH = s * 0.35;
                const baseH = s * 0.20;
                const topY = -s * 0.75;

                ctx.fillStyle = '#ffd700';
                ctx.strokeStyle = '#b8860b';
                ctx.lineWidth = 0.9;

                // Bowl (trapezoid narrowing toward base)
                ctx.beginPath();
                ctx.moveTo(-hw,     topY);
                ctx.lineTo( hw,     topY);
                ctx.lineTo( hw * 0.50, topY + bowlH);
                ctx.lineTo(-hw * 0.50, topY + bowlH);
                ctx.closePath();
                ctx.fill(); ctx.stroke();

                // Small handles
                ctx.strokeStyle = '#b8860b';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(-hw, topY + bowlH * 0.40, hw * 0.32, Math.PI * 0.5, Math.PI * 1.5, true);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc( hw, topY + bowlH * 0.40, hw * 0.32, Math.PI * 1.5, Math.PI * 0.5, true);
                ctx.stroke();

                // Stem
                ctx.fillStyle = '#ffd700';
                const stemTop = topY + bowlH;
                ctx.fillRect(-hw * 0.18, stemTop, hw * 0.36, stemH);
                ctx.strokeRect(-hw * 0.18, stemTop, hw * 0.36, stemH);

                // Base
                ctx.fillRect(-hw * 0.65, stemTop + stemH, hw * 1.30, baseH);
                ctx.strokeRect(-hw * 0.65, stemTop + stemH, hw * 1.30, baseH);
                break;
            }

            case 'crown': {
                // Crown with 3 points and tiny gem.
                const cw = s * 0.65;
                const baseY = s * 0.40;
                const baseTopY = -s * 0.10;
                const midPointY = -s * 0.70;
                const sidePointY = -s * 0.40;

                ctx.fillStyle = '#ffd700';
                ctx.strokeStyle = '#b8860b';
                ctx.lineWidth = 0.9;
                ctx.beginPath();
                ctx.moveTo(-cw,  baseY);
                ctx.lineTo(-cw,  baseTopY);
                ctx.lineTo(-cw,  sidePointY);   // left point top
                ctx.lineTo(-cw * 0.35, baseTopY + (baseY - baseTopY) * 0.5);
                ctx.lineTo(0,    midPointY);     // center peak
                ctx.lineTo( cw * 0.35, baseTopY + (baseY - baseTopY) * 0.5);
                ctx.lineTo( cw,  sidePointY);   // right point top
                ctx.lineTo( cw,  baseTopY);
                ctx.lineTo( cw,  baseY);
                ctx.closePath();
                ctx.fill(); ctx.stroke();

                // Tiny gem at center peak
                ctx.fillStyle = '#ff4455';
                ctx.beginPath();
                ctx.arc(0, midPointY + s * 0.08, s * 0.12, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
        }

        ctx.restore();
    }
}


// Draw an admin crown above a node's icon to signal administrator-level access.
// cx/cy is the crown's visual anchor — the crown base band sits just below cy
// and the three points rise above it, so placing cy at the top of the icon/banner
// makes the crown naturally float above the AWS logo.
function drawAdminCrown(ctx, cx, cy, s) {
    const cw      =  s * 0.68;   // half-width of crown body
    const baseY   =  s * 0.30;   // bottom rim (below anchor)
    const rimTopY = -s * 0.05;   // where rim meets the upward points
    const sideY   = -s * 0.42;   // height of the two side points
    const midY    = -s * 0.82;   // height of the tall center peak

    ctx.save();
    ctx.translate(cx, cy);

    // Drop shadow for depth and legibility against varied terrain.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.moveTo(-cw + 2, baseY + 2);
    ctx.lineTo(-cw + 2, rimTopY + 2);
    ctx.lineTo(-cw * 0.35 + 2, rimTopY + (baseY - rimTopY) * 0.5 + 2);
    ctx.lineTo(2,  midY + 2);
    ctx.lineTo( cw * 0.35 + 2, rimTopY + (baseY - rimTopY) * 0.5 + 2);
    ctx.lineTo( cw + 2, rimTopY + 2);
    ctx.lineTo( cw + 2, baseY + 2);
    ctx.closePath();
    ctx.fill();

    // Crown body: gold fill, dark-gold stroke.
    ctx.fillStyle = '#ffd700';
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-cw,  baseY);
    ctx.lineTo(-cw,  rimTopY);
    ctx.lineTo(-cw,  sideY);
    ctx.lineTo(-cw * 0.35, rimTopY + (baseY - rimTopY) * 0.5);
    ctx.lineTo(0,    midY);
    ctx.lineTo( cw * 0.35, rimTopY + (baseY - rimTopY) * 0.5);
    ctx.lineTo( cw,  sideY);
    ctx.lineTo( cw,  rimTopY);
    ctx.lineTo( cw,  baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bright highlight band near the top of the rim.
    ctx.fillStyle = 'rgba(255, 245, 130, 0.48)';
    ctx.fillRect(-cw + 2, rimTopY, cw * 2 - 4, s * 0.10);

    // Red gem at center peak.
    const gemR = s * 0.14;
    ctx.fillStyle = '#ff3344';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, midY + gemR * 0.7, gemR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Small gold dot gems at the two side points.
    ctx.fillStyle = '#ffe44a';
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 0.6;
    for (const px of [-cw, cw]) {
        ctx.beginPath();
        ctx.arc(px, sideY, gemR * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}

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

    // Ocean/sky gradient background. state.skyStyle ('sky' | 'sunset' | 'dusk')
    // optionally overrides the palette's oceanA/B/Deep so the same drawGameMap
    // can paint a default sky, a sunset, or a dusk twilight without touching
    // the rest of the palette.
    const sky = getSkyVariantColors(state.skyStyle);
    const oceanA = sky?.oceanA ?? p.oceanA;
    const oceanB = sky?.oceanB ?? p.oceanB;
    const oceanDeep = sky?.oceanDeep ?? p.oceanDeep;
    const oceanGrad = ctx.createLinearGradient(fillX, fillY, fillX, fillB);
    oceanGrad.addColorStop(0, oceanA);
    oceanGrad.addColorStop(0.6, oceanB);
    oceanGrad.addColorStop(1, oceanDeep);
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(fillX, fillY, fillW, fillH);

    // (Wave lines removed -- the canvas reads as sky now, not ocean.)

    // Cloud sprites (pixel-art PNGs). Pass a custom hudTop for variants that push content down.
    // state._cloudBottom widens the cloud band (used by the single-page / hero
    // renderers to let clouds layer up into the reserved header zone).
    ctx.save();
    cloudSprites.draw(ctx, w, h, 99, state._cloudHudTop, state._cloudBottom, state._cloudCount, state._cloudScaleRange);
    ctx.restore();

    // Paths (edges) between islands -- always draw all paths visibly
    if (edges) {
        for (let ei = 0; ei < edges.length; ei++) {
            const edge = edges[ei];
            if (edge.implicit) continue;
            const from = positions[edge.fromIdx];
            const to = positions[edge.toIdx];
            if (!from || !to) continue;

            const edgeRevealed = isHeliRevealed(state, `edge:${ei}`);
            const edgeDim = edgeRevealed ? 1 : 0.25;

            // Path glow
            ctx.save();
            ctx.strokeStyle = p.pathGlow;
            ctx.lineWidth = 6;
            ctx.globalAlpha = 0.5 * edgeDim;
            ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
            ctx.restore();

            // Dashed path line
            ctx.save();
            ctx.strokeStyle = p.pathStroke;
            ctx.lineWidth = 2;
            ctx.globalAlpha = edgeDim;
            ctx.setLineDash([8, 6]);
            ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    // Islands -- always draw all islands fully (no fog/locked state)
    // Shrink islands by 20% for each main island beyond 3 to avoid crowding.
    // Callers can pass state._baseIslandRadius to use a smaller cap (e.g., mobile preview).
    // Base radius shrunk 30% from the original 104 -> 73 so islands and their
    // banners read more proportionally against the map and labels. Banner /
    // shoreline / tree dimensions all derive from islandRadius, so they
    // scale automatically.
    const baseIslandRadius = state._baseIslandRadius || 73;
    const shrinkSteps = Math.max(0, nodes.length - 3);
    let islandRadius = baseIslandRadius * Math.pow(0.8, shrinkSteps);

    // Overlap detection: shrink radius so island bodies don't collide.
    // Also account for label plates below each island — labels need at least
    // ~90px horizontal separation (approximate plate half-widths) so that the
    // drawGameIslandLabels overlap resolver has less work to do.
    if (positions.length >= 2) {
        let minDist = Infinity;
        let minHorizDist = Infinity;
        for (let a = 0; a < positions.length; a++) {
            for (let b = a + 1; b < positions.length; b++) {
                const dx = Math.abs(positions[b].x - positions[a].x);
                const dy = Math.abs(positions[b].y - positions[a].y);
                minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
                // Only count pairs that are close enough vertically that their
                // label plates could overlap (labels are below islands, so check
                // whether the label Y bands of adjacent islands are in the same range).
                if (dy < islandRadius * 3.5) minHorizDist = Math.min(minHorizDist, dx);
            }
        }
        // Body clearance: islands must be 2.4r apart
        const radiusForBody = minDist / 2.4;
        // Label clearance: horizontally close islands need ~90px per side of breathing room.
        // radiusForBody already covers body; scale radius so body + label plate fits.
        // Effective label half-width at current radius: ~ir * 0.70 (font-scale-corrected estimate).
        // We want ir such that: minHorizDist / 2 >= ir * 0.70 * 2 → ir <= minHorizDist / 2.8
        const radiusForLabels = minHorizDist < Infinity ? minHorizDist / 2.8 : Infinity;
        const radiusLimit = Math.min(radiusForBody, radiusForLabels);
        if (radiusLimit < islandRadius) {
            islandRadius = Math.max(25, radiusLimit);
        }
    }

    if (state._thumbnailMode) islandRadius *= 0.5;
    state.islandRadius = islandRadius; // store for label positioning

    // Auto-compact: when islands are small enough that below-label icons (32px) would
    // dominate the label plate, automatically promote them onto the island instead.
    // This preserves the user's toggle choice (state.iconStyle) while applying a
    // display-time override stored in state.effectiveIconStyle.
    // Threshold: at 5 nodes islandRadius ≈ 66.5px; at 6 nodes ≈ 53px. Use 72 so the
    // 5-node case triggers the compact mode and removes the 32px below-label icon row.
    const AUTO_COMPACT_THRESHOLD = 72;
    state.effectiveIconStyle = (islandRadius < AUTO_COMPACT_THRESHOLD && state.iconStyle === 'below-label')
        ? 'on-island'
        : state.iconStyle;
    positions.forEach((pos, i) => {
        const isFirst = i === 0;
        const isLast = i === lastIdx;
        const seed = i * 997 + 1;  // stable per-island seed, independent of position
        const isTargetIsland = !!nodes[i]?.isTarget;
        const targetStyle = state.targetStyle || 'flag-shape';

        ctx.save();
        if (!isHeliRevealed(state, `node:${i}`)) ctx.globalAlpha = 0.25;

        // Bling ring (stars/flags/rainbows around target island perimeter)
        // is disabled for now -- the function still exists if we want it back.
        // if (isTargetIsland && !state._thumbnailMode) {
        //     drawTargetIslandBling(ctx, pos, islandRadius);
        // }

        // Island terrain / icon dispatch.
        //
        // Target islands short-circuit the standard draw path when they
        // need to replace the silhouette entirely (flag-shape) or when
        // they draw their own icon placement (fortress: banner+castle
        // side by side). For classic-plus, the standard terrain renders
        // first and we tint the grass gold before the icon draws.
        const isFortressTarget = isTargetIsland && targetStyle === 'fortress';
        const isFlagShapeTarget = isTargetIsland && targetStyle === 'flag-shape';

        if (isFlagShapeTarget) {
            // Flag-shape draws its own terrain (with gold grass built in)
            // and its own mast. Normal icon dispatch still runs below.
            drawTargetIslandFlagShape(ctx, pos, islandRadius, seed, p);
        } else if (isFortressTarget) {
            // Fortress draws a wider island body with gold grass, banner
            // on the left half, and castle on the right half. It is
            // authoritative -- the standard icon dispatch is skipped.
            drawTargetIslandFortress(ctx, pos, islandRadius, seed, p, nodes[i]);
        } else {
            const drawIslandTerrain = islandStyleRenderers[state.islandStyle] || drawIslandClassic;
            drawIslandTerrain(ctx, pos, islandRadius, seed, p, isFirst, isLast);
            // classic-plus target: tint grass gold before the icon draws
            // so the icon sits atop the gold field.
            if (isTargetIsland && targetStyle === 'classic-plus') {
                drawTargetGoldGrassTint(ctx, pos, islandRadius);
            }
        }

        // AWS icon on the island -- dispatch based on the active on-island
        // style. Fortress target handles its own icon internally, so skip.
        // Flag-shape target's procedural fallback uses a smaller silhouette
        // and shrinks the icon to 60%; the sprite-backed flag-shape island
        // is normal-sized, so when the sprite is loaded we use full radius.
        if (!isFortressTarget && !state._thumbnailMode) {
            const targetSpriteLoaded = !!islandSprites.images.target;
            const iconRadius = (isFlagShapeTarget && !targetSpriteLoaded)
                ? islandRadius * 0.60
                : islandRadius;
            // Nudge the AWS-icon badge so it sits more centered against the
            // island silhouette: principal islands sit lower on their sprite
            // so push the badge down 10px; target islands sit higher so lift
            // the badge up 10px. Intermediate principals get the same +10
            // nudge as the starting principal.
            const isPrincipalNode = (nodes[i]?.type?.type || nodes[i]?.type) === 'principal';
            const badgeNudgeY = isLast ? -20 : (isPrincipalNode ? 15 : 0);
            const badgePos = badgeNudgeY ? { x: pos.x, y: pos.y + badgeNudgeY } : pos;
            switch (state.effectiveIconStyle) {
                case 'on-island': drawIconOnIsland(ctx, badgePos, iconRadius, nodes[i]);        break;
                case 'building':  drawIconBuilding(ctx,  badgePos, iconRadius, nodes[i], p);    break;
                case 'banner':    drawIconBanner(ctx,    badgePos, iconRadius, nodes[i], p);    break;
                case 'crest':     drawIconCrest(ctx,     badgePos, iconRadius, nodes[i], p);    break;
            }
        }

        // Admin crown: sits above the icon/banner for any node marked isAdmin.
        // Crown center is anchored at the banner-top y (pos.y - 0.38 * islandRadius)
        // so it floats above the AWS logo and may extend above the banner poles.
        if (nodes[i]?.isAdmin && !state._thumbnailMode) {
            const crownS  = Math.max(10, islandRadius * 0.38);
            const crownCy = pos.y - islandRadius * 0.38;
            drawAdminCrown(ctx, pos.x, crownCy, crownS);
        }

        // Startington: the plane indicator is drawn separately after all
        // islands/companions; no additional in-loop decoration needed.

        // Target-island decoration -- only drawn when the YAML explicitly
        // marks a node `isTarget: true`. The flag is the visual signal
        // that "this is the goal of the lab / where the CTF flag lives".
        if (isTargetIsland && targetStyle === 'classic-plus') {
            drawTargetOverlayClassicPlus(ctx, pos, islandRadius, p);
        }
        // flag-shape and fortress variants draw their own flags inside
        // their island renderers above.

        // Label -- positioned below the island bottom edge
        const label = nodes[i]?.label || '';
        if (label && !state._thumbnailMode) {
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

    // Two-column layout: HTML detail panel (left) + canvas map (right).
    // .mg-canvas-wrap is a flex column so the terminal panel can slot below the canvas.
    // .mg-canvas-area is the inner relative container for canvas + menu overlay.
    container.innerHTML = `
        <div class="mg-layout" id="${mapId}">
            <div class="mg-detail-panel" id="${mapId}-panel"></div>
            <div class="mg-divider" id="${mapId}-divider"></div>
            <div class="mg-canvas-wrap" id="${mapId}-canvas-wrap">
                <div class="mg-canvas-area">
                    <canvas id="${mapId}-canvas" class="mg-canvas"></canvas>
                    <div class="mg-menu-overlay" id="${mapId}-menu"></div>
                </div>
            </div>
        </div>`;

    setTimeout(() => initMapGame(mapId, mapNodes, mapEdges, mapCompanions, lab), 60);
}

// Hard-clamp island Y positions so the label plate never slides behind the
// bottom HUD bar. Called after computeMapLayout in all game-mode layout sites.
// Bottom bar geometry: barH=40 + gap=6 → bar top at canvasH - 46.
// Worst-case label plate bottom below pos.y:
//   islandRadius * footprintScale * (1 - grassAnchor) - labelGap(20) + plateH(46)
// Clamp island positions so their label plates never overlap the bottom HUD bar.
// baseIslandRadius must reflect the current _baseIslandRadius (not hardcoded) so
// the clamp stays correct after scroll-wheel resizes or canvas size changes.
function clampIslandsAboveHud(positions, nodeCount, canvasH, baseIslandRadius) {
    const base = baseIslandRadius || 73;
    const shrinkSteps = Math.max(0, nodeCount - 3);
    const ir = base * Math.pow(0.8, shrinkSteps);

    // Distance from island center (pos.y) down to the bottom of the sprite body.
    // Use the loaded sprite's real aspect ratio; fall back to procedural approximation.
    let spriteDrop;
    const principalImg = islandSprites.get('principal');
    if (principalImg && principalImg.naturalWidth) {
        const spriteW = ir * ISLAND_SPRITE_FOOTPRINT_SCALE.principal;
        const spriteH = spriteW * (principalImg.naturalHeight / principalImg.naturalWidth);
        spriteDrop = spriteH * (1 - ISLAND_SPRITE_GRASS_CENTER.principal);
    } else {
        // Procedural shore bottom is shallower; use a generous estimate so the
        // clamp still protects before sprites load.
        spriteDrop = ir * 1.1;
    }

    // labelDrop = distance from pos.y to the bottom of the label plate.
    // labelY = spriteDrop - 20 (matches drawGameIslandLabels), plateTop = labelY - 2,
    // plateH is conservatively 50px (covers name + subtitle + padding at any font scale).
    const labelDrop = spriteDrop - 22 + 50;

    // HUD bar top is at canvasH - 46. Leave 10px breathing room above it.
    const maxY = canvasH - 46 - 10 - labelDrop;
    positions.forEach(p => { p.y = Math.min(p.y, maxY); });
}

function initMapGame(mapId, nodes, edges, companions, lab) {
    const canvas = document.getElementById(`${mapId}-canvas`);
    const panelEl = document.getElementById(`${mapId}-panel`);
    const menuEl = document.getElementById(`${mapId}-menu`);
    if (!canvas || !panelEl) return;

    // canvas.parentElement is .mg-canvas-area (the inner relative container).
    // The outer .mg-canvas-wrap holds the terminal panel as a flex sibling.
    const wrap = canvas.parentElement; // .mg-canvas-area
    const canvasWrapEl = document.getElementById(`${mapId}-canvas-wrap`); // .mg-canvas-wrap
    const layoutEl = document.getElementById(mapId); // .mg-layout
    let w = wrap.clientWidth;
    // Use 78% of the viewport height, clamped between 420px and 92vh.
    // This matches the CSS .mg-layout height values and uses more vertical space.
    const maxH = Math.floor(window.innerHeight * 0.92);
    let h = Math.max(420, Math.min(maxH, Math.round(window.innerHeight * 0.78)));
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

    // V5 (capcom top-left) is the default. Clouds sit between y=110 (just below
    // the title text stack, which tops out at ~95px) and cloudBandBottom. Islands
    // start 20px below cloudBandBottom so cloud and island zones don't overlap.
    // Using h*0.42 gives a generous cloud band while still leaving ~55% of the canvas height for islands.
    const cloudBandBottom = Math.round(h * 0.42);
    // Base island radius scales with canvas width so islands feel appropriately
    // sized on large screens and in fullscreen. w*0.09 yields ~73 at ~810px
    // (matching the old fixed value) and grows for wider canvases.
    const initialBaseRadius = Math.round(Math.max(45, Math.min(120, w * 0.09)));
    const positions = computeMapLayout(nodes.length, w, h, cloudBandBottom + 20, 110);
    clampIslandsAboveHud(positions, nodes.length, h, initialBaseRadius);
    // Pre-compute the island radius (same formula as drawGameMap) so companion
    // placement can avoid landing on main island bodies.
    const initShrinkSteps = Math.max(0, nodes.length - 3);
    const initIslandRadius = initialBaseRadius * Math.pow(0.8, initShrinkSteps);
    // Compute companion positions offset from their parent edge midpoints
    const companionPositions = computeCompanionPositions(companions, edges, positions, initIslandRadius);
    // Filter out mountains from decorations for game mode
    const allDecorations = generateMapDecorations(positions, w, h, 150, 56);
    const decorations = allDecorations.filter(d => d.type !== 'mountain');
    const palette = getGameUIPalette();

    const state = {
        screen: 'playing',       // skip start screen, go directly to map
        arcadeStartShown: true,  // show NES-style start overlay until any key/click
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
        iconStyle: 'crest',  // 'on-island' | 'below-label' | 'off' | 'building' | 'banner' | 'crest' -- toggled with I key
        islandStyle: 'wooded', // 'classic' | 'wooded' | 'tropical' | 'ruins' -- toggled with T key
        targetStyle: 'flag-shape', // 'classic-plus' | 'flag-shape' | 'fortress' -- toggled with G key
        planeStyle: 'helicopter',    // 'jet' | 'biplane' | 'seaplane' | 'helicopter' -- toggled with P key
        skyStyle: 'sky',     // 'sky' | 'sunset' | 'dusk' -- toggled with W key
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
        _islandDrag: null,       // {type:'main'|'companion', idx, phase:'candidate'|'active', sx, sy, offsetX, offsetY}
        _redraw: null,
        _panelEl: panelEl,
        _menuEl: menuEl,
        _container: wrap.parentElement.parentElement.parentElement, // scrollableContent that holds mg-layout
        _w: w,
        _h: h,
        menuFocusIdx: 0,
        menuView: 'main',        // 'main' | 'keybindings' | 'labs-browser'
        labsBrowserLabs: null,   // null = not yet loaded, Array = loaded
        labsBrowserFilter: '',
        // -- HUD variant (cycled with backtick for design exploration) --
        hudVariant: 5,            // 5=capcom TL (default); 0=legacy bar, 1=capcom bar, 2=floating, 3=thin strip, 4=capcom BL
        _hudVariantFlashAt: 0,    // timestamp of last variant change, drives the flash indicator fade
        _basePositions: null,     // saved island positions before variant-specific recompute
        _baseDecorations: null,   // saved decorations before variant-specific recompute
        _baseIslandRadius: initialBaseRadius, // canvas-size-derived base; scroll wheel adjusts from here
        _cloudHudTop: 110,        // push clouds below the title text (~95px bottom) not the gradient (150px)
        _cloudBottom: cloudBandBottom, // cloud band bottom; islands start 20px below this
        // -- Play Online terminal state --
        terminalOpen: false,
        _layoutEl: layoutEl,
        _canvasWrapEl: canvasWrapEl,
        _terminalPanelEl: null,  // created lazily on first open
        _xtermInstance: null,    // xterm Terminal instance
        _mapId: mapId,
        // Free-flight helicopter controls
        heliPos: null,           // world-space position; set after init
        _heliVelX: 0,
        _heliVelY: 0,
        _heliKeys: { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false },
        _heliLastHit: null,      // last hit key "node:N"|"companion:N"|"edge:N"|null
        _heliAnimFrame: null,
        // Progressive reveal mechanic
        _heliRevealSeq: null,    // ordered array of hitKeys; set after init
        _heliRevealed: null,     // Set of hitKeys that have been revealed
        _heliRevealNextIdx: 0,   // index of next hitKey to reveal in sequence
        _heliHoveredButton: null, // button id the helicopter is hovering in the HUD
        _heliLastRevealTime: Date.now(), // timestamp of last reveal (or game start) for idle arrow
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

    // Build reveal sequence first so we can compute the starting position
    state._heliRevealSeq = buildRevealSequence(state.edges);
    // lab-setup is already showing (gameViewPhase defaults to 'setup'), so pre-reveal it
    state._heliRevealed = new Set(['hud:lab-setup']);
    state._heliRevealNextIdx = 1; // next: 'hud:lab-overview'

    // Park helicopter above the lab-setup button; fall back to first island if button is hidden
    const _labSetupBtn = state.buttons.find(b => b.id === 'lab-setup');
    if (_labSetupBtn) {
        const _btnCx = _labSetupBtn.x + _labSetupBtn.w / 2;
        // Visual center (heliPos+21, heliPos-60) → place it 40px above button top
        state.heliPos = { x: _btnCx - 21, y: _labSetupBtn.y - 40 + 60 };
    } else {
        const _heliStart = state.positions[0] || { x: w / 2, y: h / 2 };
        state.heliPos = { x: _heliStart.x, y: _heliStart.y };
    }

    // Free-flight game loop: arrow keys move the helicopter; touching an island selects it.
    function startHeliLoop() {
        let lastTime = null;
        const SCREEN_SPEED = 220; // pixels per second on screen (constant regardless of zoom)

        function tick(timestamp) {
            state._heliAnimFrame = requestAnimationFrame(tick);
            if (state.screen !== 'playing' && state.screen !== 'complete') {
                lastTime = null;
                return;
            }

            const dt = lastTime !== null ? Math.min((timestamp - lastTime) / 1000, 0.05) : 0;
            lastTime = timestamp;

            const keys = state._heliKeys;
            let dx = 0, dy = 0;
            if (keys.ArrowLeft)  dx -= 1;
            if (keys.ArrowRight) dx += 1;
            if (keys.ArrowUp)    dy -= 1;
            if (keys.ArrowDown)  dy += 1;

            let changed = false;

            // Keep redrawing while arcade start overlay is showing so the blink animates
            if (state.arcadeStartShown) changed = true;

            if (dx !== 0 || dy !== 0) {
                // Normalize diagonal so speed is consistent in all directions
                if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

                // Move in world space; divide by zoom so screen speed is constant
                const zoom = state.viewZoom || 1;
                const worldSpeed = SCREEN_SPEED / zoom;
                state.heliPos.x += dx * worldSpeed * dt;
                state.heliPos.y += dy * worldSpeed * dt;

                // Soft clamp: allow flying down into the HUD zone
                state.heliPos.x = Math.max(-w * 0.5, Math.min(w * 1.5, state.heliPos.x));
                state.heliPos.y = Math.max(-h * 0.5, Math.min(h * 1.5, state.heliPos.y));
                changed = true;
            }

            // Visual helicopter center in world space (sprite offset after scale transform)
            const vx = state.heliPos.x + 21;
            const vy = state.heliPos.y - 60;

            // Convert to screen space for HUD hit-testing
            const zoom = state.viewZoom || 1;
            const panX = state.viewPanX || 0;
            const panY = state.viewPanY || 0;
            const vScreenX = vx * zoom + panX;
            const vScreenY = vy * zoom + panY;

            // HUD button hover: when the helicopter descends near the bottom bar,
            // highlight whichever bottom-bar button it is aligned with horizontally.
            const hudBarY = h - 46; // matches barY = h - barH - 6 in buildPlayingButtons
            let newHoveredBtn = null;
            if (vScreenY >= hudBarY - 80) {
                let bestBtn = null, bestDist = Infinity;
                for (const btn of state.buttons) {
                    if (btn.disabled || btn.comingSoon || btn.visible === false) continue;
                    if (btn.y < h * 0.5) continue; // skip top-bar buttons
                    const btnCx = btn.x + btn.w / 2;
                    const dist = Math.abs(vScreenX - btnCx);
                    if (dist <= btn.w / 2 + 24 && dist < bestDist) {
                        bestDist = dist;
                        bestBtn = btn;
                    }
                }
                newHoveredBtn = bestBtn?.id ?? null;
            }
            if (newHoveredBtn !== state._heliHoveredButton) {
                const prevHoveredBtn = state._heliHoveredButton;
                state._heliHoveredButton = newHoveredBtn;
                changed = true;

                // Always open the corresponding panel when hovering lab-setup or lab-overview.
                // Leaving either restores whatever the navigation state was showing.
                if (newHoveredBtn === 'lab-setup') {
                    state.panelOverride = 'setup';
                    updateGamePanel(state);
                } else if (newHoveredBtn === 'lab-overview') {
                    state.panelOverride = 'overview';
                    updateGamePanel(state);
                } else if (prevHoveredBtn === 'lab-setup' || prevHoveredBtn === 'lab-overview') {
                    state.panelOverride = null;
                    updateGamePanel(state);
                }
            }

            // HUD hover advances the reveal sequence only when visiting the next expected step
            if (newHoveredBtn) {
                const hudKey = `hud:${newHoveredBtn}`;
                if (hudKey === state._heliRevealSeq?.[state._heliRevealNextIdx]) {
                    state._heliRevealed.add(hudKey);
                    state._heliRevealNextIdx++;
                    advanceRevealImplicit(state);
                    state._heliLastRevealTime = Date.now();
                    // Update gameViewPhase for button highlighting and Back/Next logic
                    if (newHoveredBtn === 'lab-overview') state.gameViewPhase = 'overview';
                    else if (newHoveredBtn === 'lab-setup') state.gameViewPhase = 'setup';
                    state.buttons = buildPlayingButtons(w, h, state);
                    changed = true;
                }
            }

            // Island / companion / hop collision detection (world space)
            const ir = state._baseIslandRadius || 73;

            // "node:N" | "companion:N" | "edge:N" | null
            let hitKey = null;

            // Main islands: circle for island body + rect for label plate below
            for (let i = 0; i < state.positions.length; i++) {
                const pos = state.positions[i];
                const inBody = Math.hypot(vx - pos.x, vy - pos.y) <= ir * 1.1;
                const inLabel = Math.abs(vx - pos.x) <= ir * 1.1
                    && vy >= pos.y + ir * 0.1
                    && vy <= pos.y + ir * 0.9;
                if (inBody || inLabel) { hitKey = `node:${i}`; break; }
            }

            // Companion islands
            if (!hitKey && state.companionPositions) {
                const companionHitR = ir * 0.45 * 1.2;
                for (let ci = 0; ci < state.companionPositions.length; ci++) {
                    const pos = state.companionPositions[ci];
                    if (!pos || (pos.x === 0 && pos.y === 0)) continue;
                    if (Math.hypot(vx - pos.x, vy - pos.y) <= companionHitR) {
                        hitKey = `companion:${ci}`; break;
                    }
                }
            }

            // Hop labels
            if (!hitKey && state.edges) {
                for (let ei = 0; ei < state.edges.length; ei++) {
                    const edge = state.edges[ei];
                    const from = state.positions[edge.fromIdx];
                    const to = state.positions[edge.toIdx];
                    if (!from || !to) continue;
                    const mx = (from.x + to.x) / 2;
                    const my = (from.y + to.y) / 2;
                    if (Math.abs(vx - mx) <= 70 && Math.abs(vy - my) <= 50) {
                        hitKey = `edge:${ei}`; break;
                    }
                }
            }

            if (hitKey !== state._heliLastHit) {
                state._heliLastHit = hitKey;
                changed = true;
                if (hitKey) {
                    // Reveal if this is the next expected element in sequence
                    if (hitKey === state._heliRevealSeq[state._heliRevealNextIdx]) {
                        state._heliRevealed.add(hitKey);
                        state._heliRevealNextIdx++;
                        advanceRevealImplicit(state);
                        state._heliLastRevealTime = Date.now();
                    }

                    // Only navigate/show panel for revealed elements
                    if (state._heliRevealed.has(hitKey)) {
                        if (state.gameViewPhase === 'setup' || state.gameViewPhase === 'overview') {
                            state.gameViewPhase = 'navigation';
                        }
                        const [hitType, hitIdxStr] = hitKey.split(':');
                        const hitIdx = parseInt(hitIdxStr, 10);
                        if (hitType === 'node') {
                            state.selectedNode = hitIdx;
                            state.selectedEdge = null;
                            state.selectedCompanion = null;
                        } else if (hitType === 'companion') {
                            state.selectedCompanion = hitIdx;
                            state.selectedNode = null;
                            state.selectedEdge = null;
                        } else if (hitType === 'edge') {
                            state.selectedEdge = hitIdx;
                            state.selectedNode = null;
                            state.selectedCompanion = null;
                        }
                        state.buttons = buildPlayingButtons(w, h, state);
                        updateGamePanel(state);
                    }
                }
            }

            // Keep animating while the idle hint arrow is visible or bouncing.
            // The initial intro arrow (targeting hud:lab-overview) shows immediately;
            // subsequent arrows appear after 30 s of idle.
            if (!changed && state._heliRevealNextIdx < (state._heliRevealSeq?.length ?? 0)) {
                const _nextKey = state._heliRevealSeq[state._heliRevealNextIdx];
                const _isIntro = _nextKey === 'hud:lab-overview';
                if (_isIntro || Date.now() - (state._heliLastRevealTime ?? 0) >= 30000) changed = true;
            }

            if (changed) redraw();
        }

        state._heliAnimFrame = requestAnimationFrame(tick);
    }
    startHeliLoop();

    cloudSprites.load().then(() => redraw());
    islandSprites.load().then(() => {
        // Re-clamp now that the real sprite aspect ratio is available
        clampIslandsAboveHud(state.positions, state.nodes.length, h, state._baseIslandRadius);
        redraw();
    });
    helicopterSprite.load().then(() => redraw());
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

        // Handle island drag (candidate -> active once moved > 5px)
        if (state._islandDrag) {
            const drag = state._islandDrag;
            if (drag.phase === 'candidate') {
                if (Math.hypot(sx - drag.sx, sy - drag.sy) > 5) drag.phase = 'active';
            }
            if (drag.phase === 'active') {
                const newX = x - drag.offsetX;
                const newY = y - drag.offsetY;
                if (drag.type === 'main') {
                    state.positions[drag.idx] = { x: newX, y: newY };
                    // Recompute companions so they follow their edge midpoints
                    state.companionPositions = computeCompanionPositions(
                        state.companions, state.edges, state.positions, state.islandRadius);
                } else {
                    state.companionPositions[drag.idx] = { x: newX, y: newY };
                }
                canvas.style.cursor = 'grabbing';
                redraw();
                return;
            }
        }

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
                    // Check if hovering over an island or edge. Match the
                    // click hit-test: the full silhouette + badge + label
                    // plate are all hoverable.
                    let overIsland = false;
                    const irHover = state.islandRadius || 52;
                    for (let i = 0; i < state.positions.length; i++) {
                        const pos = state.positions[i];
                        const spriteKey = pickIslandSpriteKey(state, i);
                        const islandBottom = getIslandBottomY(pos, irHover, spriteKey);
                        if (x >= pos.x - irHover * 1.4 && x <= pos.x + irHover * 1.4
                            && y >= pos.y - irHover * 1.2 && y <= islandBottom + 56) {
                            overIsland = true; break;
                        }
                    }
                    if (overIsland) {
                        canvas.style.cursor = 'grab';
                    } else {
                        // Check companions. Match the click hit-test: full
                        // silhouette + badge + label plate are hoverable.
                        let overCompanion = false;
                        const baseCR = 56;
                        const cShrink = Math.max(0, (state.nodes?.length || 0) - 3);
                        const cRadius = baseCR * Math.pow(0.8, cShrink);
                        for (let ci = 0; ci < state.companions.length; ci++) {
                            const cPos = state.companionPositions[ci];
                            if (!cPos || (cPos.x === 0 && cPos.y === 0)) continue;
                            const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
                            if (!parentEdge) continue;
                            const edgeIdx = state.edges.indexOf(parentEdge);
                            if (!state.revealedEdges.has(edgeIdx) && state.screen !== 'complete') continue;
                            if (state.companionStyle === 'note') {
                                if (Math.hypot(cPos.x - x, cPos.y - y) < 40) { overCompanion = true; break; }
                            } else {
                                const islandBottom = getIslandBottomY(cPos, cRadius, 'resource');
                                if (x >= cPos.x - cRadius * 1.4 && x <= cPos.x + cRadius * 1.4
                                    && y >= cPos.y - cRadius * 1.0 && y <= islandBottom + 36) {
                                    overCompanion = true; break;
                                }
                            }
                        }
                        if (overCompanion) {
                            canvas.style.cursor = 'grab';
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
        const { sx, sy, x, y } = canvasCoords(e);
        const hit = hitTestButtons(state.buttons, sx, sy);
        if (hit) {
            state.activeButton = hit;
            redraw();
        }

        if ((state.screen === 'playing' || state.screen === 'complete') && !hit) {
            // Check main islands first -- if pointer is over one, begin island drag
            // tracking instead of pan tracking so the island can be repositioned.
            const ir = state.islandRadius || 52;
            let islandIdx = -1;
            for (let i = 0; i < state.positions.length; i++) {
                const pos = state.positions[i];
                const spriteKey = pickIslandSpriteKey(state, i);
                const islandBottom = getIslandBottomY(pos, ir, spriteKey);
                if (x >= pos.x - ir * 1.4 && x <= pos.x + ir * 1.4
                    && y >= pos.y - ir * 1.2 && y <= islandBottom + 56) {
                    islandIdx = i; break;
                }
            }
            if (islandIdx >= 0) {
                const pos = state.positions[islandIdx];
                state._islandDrag = { type: 'main', idx: islandIdx, phase: 'candidate',
                    sx, sy, offsetX: x - pos.x, offsetY: y - pos.y };
                return;
            }

            // Check companion islands
            const baseCR = 56;
            const cShrink = Math.max(0, (state.nodes?.length || 0) - 3);
            const cRadius = baseCR * Math.pow(0.8, cShrink);
            for (let ci = 0; ci < state.companions.length; ci++) {
                const cPos = state.companionPositions[ci];
                if (!cPos || (cPos.x === 0 && cPos.y === 0)) continue;
                const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
                if (!parentEdge) continue;
                const edgeIdx = state.edges.indexOf(parentEdge);
                if (!state.revealedEdges.has(edgeIdx) && state.screen !== 'complete') continue;
                let inside = false;
                if (state.companionStyle === 'note') {
                    inside = Math.hypot(cPos.x - x, cPos.y - y) < 40;
                } else {
                    const islandBottom = getIslandBottomY(cPos, cRadius, 'resource');
                    inside = (x >= cPos.x - cRadius * 1.4 && x <= cPos.x + cRadius * 1.4
                        && y >= cPos.y - cRadius * 1.0 && y <= islandBottom + 36);
                }
                if (inside) {
                    state._islandDrag = { type: 'companion', idx: ci, phase: 'candidate',
                        sx, sy, offsetX: x - cPos.x, offsetY: y - cPos.y };
                    return;
                }
            }

            // Not over any island -- start pan tracking
            state._panStartPointer = { x: sx, y: sy };
            state._panStartView = { panX: state.viewPanX, panY: state.viewPanY };
        }
    }

    function onPointerUp(e) {
        // Island drag cleanup
        if (state._islandDrag) {
            if (state._islandDrag.phase === 'active') {
                state._suppressClick = true;
                canvas.style.cursor = 'grab';
            }
            state._islandDrag = null;
            return;
        }

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
        // Dismiss arcade start overlay on any click
        if (state.arcadeStartShown) {
            state.arcadeStartShown = false;
            redraw();
            return;
        }
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
                // Clicking on the map switches the side panel to the
                // navigation (per-node/edge) view, even from setup/overview.
                if (state.screen === 'playing') {
                    state.gameViewPhase = 'navigation';
                    state.buttons = buildPlayingButtons(w, h, state);
                }
                redraw();
                updateGamePanel(state);
                return;
            }

            // Hit-test islands (main principal nodes). The clickable region
            // covers the full silhouette: badge/banner above the island, the
            // island body itself, and the label plate below. Use a bounding
            // box keyed off the rendered sprite + a generous label allowance,
            // and tie-break with a center-distance score so adjacent islands
            // don't fight over an overlapping click region.
            const ir = state.islandRadius || 52;
            let closest = -1, closestDist = Infinity;
            state.positions.forEach((pos, i) => {
                const spriteKey = pickIslandSpriteKey(state, i);
                const islandBottom = getIslandBottomY(pos, ir, spriteKey);
                const left   = pos.x - ir * 1.4;
                const right  = pos.x + ir * 1.4;
                const top    = pos.y - ir * 1.2;     // covers banner/crest above
                const bottom = islandBottom + 56;    // covers label plate below
                if (x >= left && x <= right && y >= top && y <= bottom) {
                    const d = Math.hypot(pos.x - x, pos.y - y);
                    if (d < closestDist) { closest = i; closestDist = d; }
                }
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
                // Companions are always clickable if their parent edge is revealed.
                // Like the main islands, the clickable region covers the full
                // companion silhouette: badge above, islet body, and label
                // plate below. Note-style companions stay as a tight card hit.
                let companionHit = -1;
                let companionBest = Infinity;
                const baseCompanionRadius = 56;
                const companionShrinkSteps = Math.max(0, (state.nodes?.length || 0) - 3);
                const companionRadius = baseCompanionRadius * Math.pow(0.8, companionShrinkSteps);
                for (let ci = 0; ci < state.companions.length; ci++) {
                    const cPos = state.companionPositions[ci];
                    if (!cPos || (cPos.x === 0 && cPos.y === 0)) continue;
                    const parentEdge = state.edges.find(e => e.companionIndices && e.companionIndices.includes(ci));
                    if (!parentEdge) continue;
                    const edgeIdx = state.edges.indexOf(parentEdge);
                    // Clickable if edge is revealed, selected, or on complete screen
                    if (!state.revealedEdges.has(edgeIdx) && state.selectedEdge !== edgeIdx && state.screen !== 'complete') continue;
                    let inside = false;
                    if (state.companionStyle === 'note') {
                        inside = Math.hypot(cPos.x - x, cPos.y - y) < 40;
                    } else {
                        const islandBottom = getIslandBottomY(cPos, companionRadius, 'resource');
                        const left   = cPos.x - companionRadius * 1.4;
                        const right  = cPos.x + companionRadius * 1.4;
                        const top    = cPos.y - companionRadius * 1.0;
                        const bottom = islandBottom + 36;
                        inside = (x >= left && x <= right && y >= top && y <= bottom);
                    }
                    if (inside) {
                        const d = Math.hypot(cPos.x - x, cPos.y - y);
                        if (d < companionBest) { companionBest = d; companionHit = ci; }
                    }
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
                // Clicking any map element (island, companion, edge) drops
                // out of setup/overview into the per-node/edge navigation
                // panel so the side page tracks the helicopter.
                state.gameViewPhase = 'navigation';
                state.buttons = buildPlayingButtons(w, h, state);
            }
            redraw();
            updateGamePanel(state);
        }
    }

    function onKeyDown(e) {
        // Dismiss arcade start overlay on any key press
        if (state.arcadeStartShown) {
            state.arcadeStartShown = false;
            state._heliLastRevealTime = Date.now(); // reset idle timer after dismissal
            redraw();
            // Let arrow keys fall through so the helicopter starts moving immediately
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                return;
            }
        }
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
        // I key cycles AWS icon display style:
        //   on-island  -> flat logo on the island surface (original treatment)
        //   below-label -> 32px logo inside the label plate beneath the island
        //   off         -> no logo
        //   building    -> wooden outpost with logo as front signage
        //   banner      -> banner on two posts with logo as the charge
        //   crest       -> heraldic shield on a small stand, logo as the charge
        if ((e.key === 'i' || e.key === 'I') && (state.screen === 'playing' || state.screen === 'complete')) {
            const iconStyles = ['on-island', 'below-label', 'off', 'building', 'banner', 'crest'];
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
        // G key cycles target-island visual style (classic-plus -> flag-shape -> fortress)
        // Applies only to nodes flagged isTarget: true in the attack map YAML.
        if ((e.key === 'g' || e.key === 'G') && (state.screen === 'playing' || state.screen === 'complete')) {
            const targetStyles = ['classic-plus', 'flag-shape', 'fortress'];
            const currentIdx = targetStyles.indexOf(state.targetStyle);
            state.targetStyle = targetStyles[(currentIdx + 1) % targetStyles.length];
            redraw();
        }
        // P key toggles plane visual style (jet -> biplane -> seaplane -> helicopter)
        if ((e.key === 'p' || e.key === 'P') && (state.screen === 'playing' || state.screen === 'complete')) {
            const planeStyles = ['jet', 'biplane', 'seaplane', 'helicopter'];
            const currentIdx = planeStyles.indexOf(state.planeStyle);
            state.planeStyle = planeStyles[(currentIdx + 1) % planeStyles.length];
            redraw();
        }
        // W key cycles sky background (sky -> sunset -> dusk).
        // Defined in SKY_STYLE_LIST so adding a new variant here requires
        // only one edit (the list constant) instead of changing this handler.
        if ((e.key === 'w' || e.key === 'W') && (state.screen === 'playing' || state.screen === 'complete')) {
            const currentIdx = SKY_STYLE_LIST.indexOf(state.skyStyle);
            state.skyStyle = SKY_STYLE_LIST[(currentIdx + 1) % SKY_STYLE_LIST.length];
            redraw();
        }
        // F key toggles fullscreen on the game layout container
        if ((e.key === 'f' || e.key === 'F') && (state.screen === 'playing' || state.screen === 'complete')) {
            const fsEl = state._layoutEl || document.documentElement;
            if (!document.fullscreenElement) {
                fsEl.requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
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
        // ` key: cycle HUD variants for design exploration (0→1→2→3→4→5→0)
        if (e.key === '`' && state.screen === 'playing') {
            state.hudVariant = ((state.hudVariant || 0) + 1) % 6;
            state._hudVariantFlashAt = Date.now();

            // Save base positions/decorations on first variant switch so we can restore them
            if (!state._basePositions) {
                state._basePositions    = state.positions;
                state._baseDecorations  = state.decorations;
            }

            // Variants 4 (capcom bottom-left) and 5 (capcom top-left) need recomputed layout
            // so islands and decorations avoid the capcom title zone.
            if (state.hudVariant === 4) {
                // SCRIM_H4=180px + bottom bar (~46px) = 226px from bottom; add gap → 230
                state.positions   = computeMapLayout(state.nodes.length, w, h, 48, 230);
                const allDeco4    = generateMapDecorations(state.positions, w, h, 48, 180);
                state.decorations = allDeco4.filter(d => d.type !== 'mountain');
                state.companionPositions = computeCompanionPositions(state.companions, state.edges, state.positions);
                state._cloudHudTop = undefined; // clouds stay near top
            } else if (state.hudVariant === 5) {
                // SCRIM_H5=150px from top; clouds span 155 → cloudBandBottom, islands start below
                const v5CloudBottom = Math.round(h * 0.42);
                state._cloudBottom = v5CloudBottom;
                state.positions   = computeMapLayout(state.nodes.length, w, h, v5CloudBottom + 20, 110);
                clampIslandsAboveHud(state.positions, state.nodes.length, h, state._baseIslandRadius);
                const allDeco5    = generateMapDecorations(state.positions, w, h, 150, 56);
                state.decorations = allDeco5.filter(d => d.type !== 'mountain');
                state.companionPositions = computeCompanionPositions(state.companions, state.edges, state.positions);
                state._cloudHudTop = 110; // push clouds below the title text, not the gradient bottom
            } else {
                // Restore original layout for all other variants
                state.positions   = state._basePositions;
                state.decorations = state._baseDecorations;
                state.companionPositions = computeCompanionPositions(state.companions, state.edges, state.positions);
                state._cloudHudTop = undefined;
            }

            state.buttons = buildPlayingButtons(w, h, state);
            redraw();
            setTimeout(() => redraw(), 2100); // ensure flash indicator clears
        }
        // B key: cycle demo button style (terminal → danger → void)
        if (e.key === 'b' && state.screen === 'playing') {
            state._demoButtonStyleIdx = ((state._demoButtonStyleIdx || 0) + 1) % 3;
            state.buttons = buildPlayingButtons(w, h, state);
            redraw();
        }
        // -/+ keys resize islands
        if ((e.key === '-' || e.key === '_') && (state.screen === 'playing' || state.screen === 'complete')) {
            resizeIslands(0.92);
        }
        if ((e.key === '=' || e.key === '+') && (state.screen === 'playing' || state.screen === 'complete')) {
            resizeIslands(1.08);
        }
        // Arrow keys fly the helicopter when playing
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
                && state.screen === 'playing') {
            e.preventDefault();
            state._heliKeys[e.key] = true;
        }
        // Space = Next, Backspace = Back (mirror the on-screen buttons + reveal mechanic)
        if (e.key === ' ' && state.screen === 'playing') {
            e.preventDefault();
            advanceGameState(w, h, state);
            syncRevealToNavigation(state);
            redraw();
        }
        if (e.key === 'Backspace' && state.screen === 'playing') {
            e.preventDefault();
            retreatGameState(w, h, state);
            syncRevealToNavigation(state);
            redraw();
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

    function onKeyUp(e) {
        if (Object.prototype.hasOwnProperty.call(state._heliKeys, e.key)) {
            state._heliKeys[e.key] = false;
        }
    }

    function onWheel(e) {
        if (state.screen !== 'playing' && state.screen !== 'complete') return;

        if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd + scroll: zoom, keeping the point under the cursor fixed
            e.preventDefault();
            const { sx, sy } = canvasCoords(e);
            const oldZoom = state.viewZoom;
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newZoom = Math.max(0.4, Math.min(3.0, oldZoom * zoomFactor));
            state.viewPanX = sx - (sx - state.viewPanX) * (newZoom / oldZoom);
            state.viewPanY = sy - (sy - state.viewPanY) * (newZoom / oldZoom);
            state.viewZoom = newZoom;
            if (state.screen === 'playing') state.buttons = buildPlayingButtons(w, h, state);
            redraw();
        }
        // Plain scroll does nothing — island size is controlled with -/+ keys
    }

    // Helper: resize islands by a multiplicative factor (shared by +/- key handlers)
    function resizeIslands(factor) {
        const current = state._baseIslandRadius || 73;
        state._baseIslandRadius = Math.max(30, Math.min(150, current * factor));
        clampIslandsAboveHud(state.positions, state.nodes.length, h, state._baseIslandRadius);
        state.companionPositions = computeCompanionPositions(
            state.companions, state.edges, state.positions, state._baseIslandRadius);
        redraw();
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Draggable panel/canvas divider
    const dividerEl = document.getElementById(`${mapId}-divider`);
    if (dividerEl) {
        // Restore saved panel width from previous session
        const savedPanelW = localStorage.getItem('mg-panel-width');
        if (savedPanelW) {
            panelEl.style.width = savedPanelW + 'px';
            panelEl.style.maxWidth = 'none';
            panelEl.style.minWidth = '0';
        }

        let divDragging = false;
        let divStartX = 0;
        let divStartW = 0;

        dividerEl.addEventListener('pointerdown', e => {
            divDragging = true;
            divStartX = e.clientX;
            divStartW = panelEl.getBoundingClientRect().width;
            dividerEl.setPointerCapture(e.pointerId);
            dividerEl.classList.add('dragging');
            e.preventDefault();
        });

        dividerEl.addEventListener('pointermove', e => {
            if (!divDragging) return;
            const layoutW = layoutEl.getBoundingClientRect().width;
            const newW = Math.round(Math.max(200, Math.min(layoutW * 0.65, divStartW + (e.clientX - divStartX))));
            panelEl.style.width = newW + 'px';
            panelEl.style.maxWidth = 'none';
            panelEl.style.minWidth = '0';
        });

        const stopDividerDrag = () => {
            if (!divDragging) return;
            divDragging = false;
            dividerEl.classList.remove('dragging');
            localStorage.setItem('mg-panel-width', Math.round(panelEl.getBoundingClientRect().width));
        };

        dividerEl.addEventListener('pointerup', stopDividerDrag);
        dividerEl.addEventListener('pointercancel', stopDividerDrag);
    }

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

        // Recompute base island radius for new canvas width
        state._baseIslandRadius = Math.round(Math.max(45, Math.min(120, w * 0.09)));

        // Recompute layout for new dimensions, respecting the active HUD variant's margins.
        const resizeV = state.hudVariant || 0;
        if (resizeV === 4) {
            state.positions = computeMapLayout(state.nodes.length, w, h, 48, 230);
            const rd4 = generateMapDecorations(state.positions, w, h, 48, 180);
            state.decorations = rd4.filter(d => d.type !== 'mountain');
        } else if (resizeV === 5) {
            const resizeCloudBottom = Math.round(h * 0.42);
            state._cloudBottom = resizeCloudBottom;
            state.positions = computeMapLayout(state.nodes.length, w, h, resizeCloudBottom + 20, 110);
            clampIslandsAboveHud(state.positions, state.nodes.length, h, state._baseIslandRadius);
            const rd5 = generateMapDecorations(state.positions, w, h, 150, 56);
            state.decorations = rd5.filter(d => d.type !== 'mountain');
        } else {
            state.positions = computeMapLayout(state.nodes.length, w, h);
            const rdDef = generateMapDecorations(state.positions, w, h);
            state.decorations = rdDef.filter(d => d.type !== 'mountain');
        }
        state.companionPositions = computeCompanionPositions(state.companions, state.edges, state.positions);

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
        document.removeEventListener('keyup', onKeyUp);
        if (state._heliAnimFrame) cancelAnimationFrame(state._heliAnimFrame);
        resizeObserver.disconnect();
    };
}

// ============================================================
// Play Online: Terminal Functions
// ============================================================

// Lazy-load xterm.js v5 from CDN. Resolves immediately if already loaded.
function loadXterm() {
    return new Promise((resolve) => {
        if (window.Terminal && window.FitAddon) { resolve(); return; }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.css';
        document.head.appendChild(link);

        // Load xterm core, then the fit addon (needed to properly size the
        // terminal to fill its container instead of defaulting to 80x24 fixed)
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.min.js';
        script.onload = () => {
            const fitScript = document.createElement('script');
            fitScript.src = 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10/lib/addon-fit.min.js';
            fitScript.onload = resolve;
            document.head.appendChild(fitScript);
        };
        document.head.appendChild(script);
    });
}

// Create the terminal panel + resize handle DOM elements inside .mg-canvas-wrap.
// Called once; subsequent calls are no-ops.
function initTerminalPanel(state) {
    if (state._terminalPanelEl) return;

    // Drag handle sits between .mg-canvas-area and .mg-terminal-panel.
    // Dragging it up grows the terminal; down shrinks it.
    const handle = document.createElement('div');
    handle.className = 'mg-terminal-resize-handle';
    state._canvasWrapEl.appendChild(handle);
    state._terminalResizeHandleEl = handle;
    initTerminalResizeHandle(handle, state);

    const panel = document.createElement('div');
    panel.className = 'mg-terminal-panel';
    state._canvasWrapEl.appendChild(panel);

    panel.addEventListener('click', (e) => {
        // Prevent clicks inside the terminal from bubbling to canvas hit-tests
        e.stopPropagation();
    });

    state._terminalPanelEl = panel;
}

// Render the "coming soon" placeholder inside the terminal panel.
function renderComingSoonPanel(state) {
    const panel = state._terminalPanelEl;
    panel.innerHTML = `
        <div class="mg-terminal-header">
            <div class="mg-terminal-header-title">
                <span class="mg-terminal-status-dot coming-soon"></span>
                <span>Online Play &mdash; Coming Soon</span>
            </div>
            <div class="mg-terminal-header-actions">
                <button class="mg-terminal-btn mg-terminal-expand-btn" title="Expand to full height">&#x2B06;</button>
                <button class="mg-terminal-close" title="Close">&times;</button>
            </div>
        </div>
        <div class="mg-terminal-viewport">
            <div class="mg-terminal-coming-soon">
                <div class="mg-terminal-coming-soon-label">Coming Soon</div>
                <div class="mg-terminal-coming-soon-title">Interactive Lab Environments</div>
                <div class="mg-terminal-coming-soon-body">
                    Online play is coming to pathfinding.cloud. You&rsquo;ll be able to run real commands
                    against deployed emphemeral AWS infrastructure directly from this terminal &mdash; no local setup required.
                </div>
            </div>
        </div>`;

    panel.querySelector('.mg-terminal-close').addEventListener('click', () => {
        closePlayOnlineTerminal(state);
    });
    panel.querySelector('.mg-terminal-expand-btn').addEventListener('click', () => {
        toggleExpandTerminal(state);
    });
}

// Skip ahead to the objective/mission-briefing phase, bypassing lab setup.
// Called when Play Online is clicked so the user lands on the overview rather than setup.
function skipToObjective(state) {
    if (state.gameViewPhase === 'setup') {
        state.gameViewPhase = 'overview';
        state.panelOverride = null;
        state.selectedNode = null;
        state.selectedEdge = null;
        state.selectedCompanion = null;
        updateGamePanel(state);
    }
}

// Open or close the coming-soon terminal panel (toggled by Play Online button when globally disabled).
function toggleComingSoonTerminal(state) {
    if (state.terminalOpen) {
        closePlayOnlineTerminal(state);
        return;
    }
    skipToObjective(state);
    initTerminalPanel(state);
    renderComingSoonPanel(state);
    state._terminalResizeHandleEl.classList.add('visible');
    state._layoutEl.classList.add('terminal-open');
    state.terminalOpen = true;
    state.buttons = buildPlayingButtons(state._w, state._h, state);
    state._redraw();
}

// Open or close the live xterm terminal (used when PLAY_ONLINE_GLOBALLY_ENABLED is true).
async function togglePlayOnlineTerminal(state) {
    if (state.terminalOpen) {
        closePlayOnlineTerminal(state);
        return;
    }
    skipToObjective(state);
    initTerminalPanel(state);

    // Show header immediately while xterm loads
    const panel = state._terminalPanelEl;
    panel.innerHTML = `
        <div class="mg-terminal-header">
            <div class="mg-terminal-header-title">
                <span class="mg-terminal-status-dot"></span>
                <span>Lab Terminal &mdash; ${state.lab.displayName || state.lab.name || state.lab.slug || ''}</span>
            </div>
            <div class="mg-terminal-header-actions">
                <button class="mg-terminal-btn mg-terminal-expand-btn" title="Expand to full height">&#x2B06;</button>
                <button class="mg-terminal-close" title="Close">&times;</button>
            </div>
        </div>
        <div class="mg-terminal-viewport" id="${state._mapId}-terminal-vp"></div>`;

    panel.querySelector('.mg-terminal-close').addEventListener('click', () => {
        closePlayOnlineTerminal(state);
    });
    panel.querySelector('.mg-terminal-expand-btn').addEventListener('click', () => {
        toggleExpandTerminal(state);
    });

    state._terminalResizeHandleEl.classList.add('visible');
    state._layoutEl.classList.add('terminal-open');
    state.terminalOpen = true;
    state.buttons = buildPlayingButtons(state._w, state._h, state);
    state._redraw();

    await loadXterm();

    // Only create a new Terminal instance if one doesn't exist yet (survives open/close cycles)
    if (!state._xtermInstance) {
        const term = new window.Terminal({
            theme: {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#58a6ff',
                selectionBackground: '#264f78',
            },
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            cursorBlink: true,
            convertEol: true,
            scrollback: 2000,
        });

        // addon-fit sizes the terminal to fill its container instead of
        // defaulting to a fixed 80x24 grid that overflows or leaves gaps
        const fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        const vp = document.getElementById(`${state._mapId}-terminal-vp`);
        term.open(vp);
        fitAddon.fit();
        state._xtermFitAddon = fitAddon;

        // Re-fit when the panel resizes (e.g. when the layout height changes)
        const fitObserver = new ResizeObserver(() => fitAddon.fit());
        fitObserver.observe(vp);
        state._xtermFitObserver = fitObserver;

        term.writeln('\x1b[1;32mPathfinding Labs Terminal\x1b[0m');
        term.writeln('Type \x1b[33mhelp\x1b[0m for available commands.\r\n');
        term.write('$ ');

        let inputBuffer = '';
        const cmdHistory = [];
        let historyIdx = -1;

        term.onData((data) => {
            if (data === '\r') {
                // Enter — async handler writes the next prompt after the response
                term.writeln('');
                const cmd = inputBuffer.trim();
                inputBuffer = '';
                if (cmd) {
                    cmdHistory.unshift(cmd);
                    historyIdx = -1;
                    sendTerminalCommand(cmd, term, state);
                } else {
                    term.write('$ ');
                }
            } else if (data === '\x7f') {
                // Backspace
                if (inputBuffer.length > 0) {
                    inputBuffer = inputBuffer.slice(0, -1);
                    term.write('\b \b');
                }
            } else if (data === '\x1b[A') {
                // Arrow up: history recall
                if (cmdHistory.length > 0 && historyIdx < cmdHistory.length - 1) {
                    historyIdx++;
                    // Clear current line and write history entry
                    term.write('\r\x1b[2K$ ' + cmdHistory[historyIdx]);
                    inputBuffer = cmdHistory[historyIdx];
                }
            } else if (data === '\x1b[B') {
                // Arrow down: history forward
                if (historyIdx > 0) {
                    historyIdx--;
                    term.write('\r\x1b[2K$ ' + cmdHistory[historyIdx]);
                    inputBuffer = cmdHistory[historyIdx];
                } else if (historyIdx === 0) {
                    historyIdx = -1;
                    term.write('\r\x1b[2K$ ');
                    inputBuffer = '';
                }
            } else if (data.charCodeAt(0) >= 32) {
                // Printable character
                inputBuffer += data;
                term.write(data);
            }
        });

        state._xtermInstance = term;
    } else {
        // Re-attach existing terminal to the new DOM node and re-fit
        const vp = document.getElementById(`${state._mapId}-terminal-vp`);
        state._xtermInstance.open(vp);
        state._xtermFitAddon?.fit();
    }
}

// Collapse the terminal panel and update button state.
function closePlayOnlineTerminal(state) {
    // Reset any manual height so CSS transition starts clean next open
    if (state._terminalPanelEl) state._terminalPanelEl.style.height = '';
    if (state._terminalResizeHandleEl) state._terminalResizeHandleEl.classList.remove('visible');
    state._terminalExpanded = false;
    state._layoutEl.classList.remove('terminal-open');
    state.terminalOpen = false;
    state.buttons = buildPlayingButtons(state._w, state._h, state);
    state._redraw();
}

// Wire up pointer-drag resizing on the handle bar.
function initTerminalResizeHandle(handle, state) {
    let startY, startTermH;

    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startY = e.clientY;
        startTermH = state._terminalPanelEl.getBoundingClientRect().height;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('dragging');

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    });

    function onMove(e) {
        const delta = startY - e.clientY; // drag up → positive → terminal grows
        const layoutH = state._layoutEl.getBoundingClientRect().height;
        const minTermH = 80;
        const maxTermH = layoutH - 60; // leave room for canvas HUD
        const newH = Math.max(minTermH, Math.min(maxTermH, startTermH + delta));
        state._terminalPanelEl.style.height = newH + 'px';
        state._xtermFitAddon?.fit();
        // If user dragged away from the expanded state, clear the expanded flag
        state._terminalExpanded = false;
        updateExpandButton(state);
    }

    function onUp() {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        // Persist the dragged height as the new "normal" so restore goes here
        const currentH = state._terminalPanelEl.getBoundingClientRect().height;
        state._terminalNormalHeight = currentH;
        state._xtermFitAddon?.fit();
    }
}

// Toggle between expanded (full canvas height) and normal terminal height.
function toggleExpandTerminal(state) {
    if (state._terminalExpanded) {
        restoreTerminalHeight(state);
    } else {
        expandTerminalHeight(state);
    }
}

function expandTerminalHeight(state) {
    // Save current height as the restore point
    const currentH = state._terminalPanelEl.getBoundingClientRect().height;
    state._terminalNormalHeight = currentH > 60 ? currentH : (state._terminalNormalHeight || 260);

    const layoutH = state._layoutEl.getBoundingClientRect().height;
    const expandedH = layoutH - 60; // leave 60px for the canvas HUD bar
    state._terminalPanelEl.style.height = expandedH + 'px';
    state._terminalExpanded = true;
    state._xtermFitAddon?.fit();
    updateExpandButton(state);
}

function restoreTerminalHeight(state) {
    const normalH = state._terminalNormalHeight || 260;
    state._terminalPanelEl.style.height = normalH + 'px';
    state._terminalExpanded = false;
    state._xtermFitAddon?.fit();
    updateExpandButton(state);
}

// Sync the expand button icon/title to reflect current state.
function updateExpandButton(state) {
    const btn = state._terminalPanelEl?.querySelector('.mg-terminal-expand-btn');
    if (!btn) return;
    if (state._terminalExpanded) {
        btn.innerHTML = '&#x2B07;'; // downward arrow = restore
        btn.title = 'Restore terminal height';
    } else {
        btn.innerHTML = '&#x2B06;'; // upward arrow = expand
        btn.title = 'Expand to full height';
    }
}

// Send a command to the lab's API endpoint and echo the response in the terminal.
async function sendTerminalCommand(command, term, state) {
    if (PLAY_ONLINE_MOCK_MODE) {
        await sendTerminalCommandMock(command, term, state);
        return;
    }

    // Built-in help command (always available, no API needed)
    if (command === 'help') {
        term.writeln('Available commands are provided by the deployed lab environment.');
        term.writeln('Type any AWS CLI command or lab-specific command to interact with the lab.\r\n');
        term.write('$ ');
        return;
    }

    const endpoint = state.lab?.onlineEndpoint;
    if (!endpoint) {
        term.writeln('\x1b[33mNo API endpoint configured for this lab.\x1b[0m\r\n');
        term.write('$ ');
        return;
    }

    try {
        term.write('\x1b[2m...running\x1b[0m');
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command }),
        });
        // Clear the "...running" text before printing response
        term.write('\r\x1b[2K');
        const text = await resp.text();
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            if (i < lines.length - 1) term.writeln(line);
            else if (line) term.writeln(line);
        });
    } catch (err) {
        term.write('\r\x1b[2K');
        term.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
    }

    term.write('$ ');
    term.scrollToBottom();
}

// Mock backend for local demo/testing. Simulates an AWS lab environment.
async function sendTerminalCommandMock(command, term, state) {
    // Simulate a short network round-trip
    term.write('\x1b[2m  executing...\x1b[0m');
    await new Promise(r => setTimeout(r, 280 + Math.random() * 220));
    term.write('\r\x1b[2K');

    const cmd = command.trim();
    const acct = '123456789012';
    const region = 'us-east-1';
    const slug = state.lab?.slug || 'lab';

    // Derive lab-specific names from the slug if possible
    const labPrefix = `pl-prod-${slug}`;
    const startingUser = `${labPrefix}-starting-user`;
    const targetRole = `${labPrefix}-target-role`;

    // Match common AWS CLI patterns and return plausible mock output
    if (cmd === 'help' || cmd === '--help') {
        term.writeln('\x1b[1mPathfinding Labs Terminal\x1b[0m');
        term.writeln('Connected to lab: \x1b[33m' + (state.lab?.displayName || slug) + '\x1b[0m\r\n');
        term.writeln('Your starting identity has been pre-configured. Try:');
        term.writeln('  \x1b[32maws sts get-caller-identity\x1b[0m');
        term.writeln('  \x1b[32maws iam list-attached-user-policies --user-name <user>\x1b[0m');
        term.writeln('  \x1b[32maws iam get-policy-version ...\x1b[0m');
        term.writeln('  \x1b[32maws apprunner create-service ...\x1b[0m');

    } else if (cmd.match(/aws sts get-caller-identity/)) {
        term.writeln('{');
        term.writeln(`    "UserId": "AIDA${randHex(16).toUpperCase()}",`);
        term.writeln(`    "Account": "${acct}",`);
        term.writeln(`    "Arn": "arn:aws:iam::${acct}:user/${startingUser}"`);
        term.writeln('}');

    } else if (cmd.match(/aws iam list-attached-user-policies/)) {
        term.writeln('{');
        term.writeln('    "AttachedPolicies": [');
        term.writeln('        {');
        term.writeln(`            "PolicyName": "${labPrefix}-starting-policy",`);
        term.writeln(`            "PolicyArn": "arn:aws:iam::${acct}:policy/${labPrefix}-starting-policy"`);
        term.writeln('        }');
        term.writeln('    ]');
        term.writeln('}');

    } else if (cmd.match(/aws iam get-policy-version|aws iam get-policy/)) {
        term.writeln('{');
        term.writeln('    "PolicyVersion": {');
        term.writeln('        "Document": {');
        term.writeln('            "Version": "2012-10-17",');
        term.writeln('            "Statement": [');
        term.writeln('                { "Effect": "Allow", "Action": ["apprunner:CreateService", "iam:PassRole", "iam:CreateServiceLinkedRole"], "Resource": "*" }');
        term.writeln('            ]');
        term.writeln('        }');
        term.writeln('    }');
        term.writeln('}');

    } else if (cmd.match(/aws iam list-roles/)) {
        term.writeln('{');
        term.writeln('    "Roles": [');
        term.writeln('        {');
        term.writeln(`            "RoleName": "${targetRole}",`);
        term.writeln(`            "Arn": "arn:aws:iam::${acct}:role/${targetRole}",`);
        term.writeln('            "AssumeRolePolicyDocument": { "Statement": [{ "Principal": { "Service": "tasks.apprunner.amazonaws.com" } }] }');
        term.writeln('        }');
        term.writeln('    ]');
        term.writeln('}');

    } else if (cmd.match(/aws apprunner create-service/)) {
        const svcId = randHex(8);
        term.writeln('{');
        term.writeln('    "Service": {');
        term.writeln(`        "ServiceName": "pl-exploit-${svcId}",`);
        term.writeln(`        "ServiceId": "${svcId}",`);
        term.writeln(`        "ServiceArn": "arn:aws:apprunner:${region}:${acct}:service/pl-exploit-${svcId}/${randHex(16)}",`);
        term.writeln('        "Status": "OPERATION_IN_PROGRESS"');
        term.writeln('    },');
        term.writeln('    "OperationId": "' + randHex(32) + '"');
        term.writeln('}');
        term.writeln('\x1b[33m[i] Service is starting — poll with: aws apprunner describe-service --service-arn <arn>\x1b[0m');

    } else if (cmd.match(/aws apprunner describe-service/)) {
        term.writeln('{');
        term.writeln('    "Service": {');
        term.writeln('        "Status": "RUNNING",');
        term.writeln(`        "ServiceUrl": "https://${randHex(8)}.${region}.awsapprunner.com"`);
        term.writeln('    }');
        term.writeln('}');

    } else if (cmd.match(/aws iam attach-user-policy|aws iam put-user-policy/)) {
        // This is the payload command that would run inside App Runner
        term.writeln('\x1b[32m[+] Policy attached successfully.\x1b[0m');
        term.writeln('\x1b[32m[+] Starting user now has AdministratorAccess.\x1b[0m');

    } else if (cmd.match(/aws sts assume-role/)) {
        term.writeln('{');
        term.writeln('    "Credentials": {');
        term.writeln(`        "AccessKeyId": "ASIA${randHex(16).toUpperCase()}",`);
        term.writeln(`        "SecretAccessKey": "${randHex(40)}",`);
        term.writeln(`        "SessionToken": "${randHex(100)}",`);
        term.writeln(`        "Expiration": "${new Date(Date.now() + 3600000).toISOString()}"`);
        term.writeln('    }');
        term.writeln('}');

    } else if (cmd.match(/^aws /)) {
        // Generic AWS CLI passthrough for anything else
        term.writeln('\x1b[33mCommand forwarded to lab environment.\x1b[0m');
        term.writeln('{}');

    } else if (cmd === 'whoami') {
        term.writeln(startingUser);

    } else if (cmd === 'clear') {
        term.clear();

    } else {
        term.writeln(`\x1b[31mbash: ${cmd.split(' ')[0]}: command not found\x1b[0m`);
        term.writeln('Type \x1b[33mhelp\x1b[0m to see available commands.');
    }

    term.writeln('');
    term.write('$ ');
    term.scrollToBottom();
}

function randHex(len) {
    return Array.from({length: len}, () => Math.floor(Math.random() * 16).toString(16)).join('');
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

    const w = containerEl.clientWidth;
    const isMobile = w <= 600;

    // Header zone height matches SCRIM_H5 = 150 in game mode V5 HUD.
    const mapYOffset = 150;
    const bottomPad = 90;

    let h, mapH, positions;
    if (isMobile) {
        // Vertical layout: nodes stacked top-to-bottom so the full path is visible.
        // Islands are capped at MOBILE_BASE_RADIUS (46px, was 65 before the
        // 30% global island shrink) and shrink further with node count.
        // perNodeH is computed so the label bottom of node i always clears the island top of
        // node i+1 with ~20px headroom. Formula accounts for:
        //   - island body: r * 0.87 vertical (0.45 above + 0.42 below center)
        //   - tree/terrain clearance above: ~25px
        //   - label lines + gap below: ~46px
        //   Total fixed overhead: ~91px, plus 30px safety margin → 3*r + 30 heuristic, min 130.
        const MOBILE_BASE_RADIUS = 46;
        const mShrinkSteps = Math.max(0, mapNodes.length - 3);
        const naturalMobileRadius = MOBILE_BASE_RADIUS * Math.pow(0.8, mShrinkSteps);
        const perNodeH = Math.max(Math.ceil(naturalMobileRadius * 3.0 + 30), 130);
        mapH = mapNodes.length * perNodeH + bottomPad;
        h = mapYOffset + mapH;
        const rng = mapRng(mapNodes.length * 31);
        // xMargin keeps island bodies (r*1.3 wide) safely inside the canvas.
        // The label plate can be up to ~170px wide; drawMapWithGameLabels clamps
        // its draw X independently, so this margin only needs to cover the island body.
        const xMargin = Math.ceil(naturalMobileRadius * 1.4 + 10);
        positions = mapNodes.map((_, i) => {
            const zigzag = (i % 2 === 0 ? 1 : -1) * Math.min(w * 0.12, 44);
            const jitter = (rng() - 0.5) * 14;
            return {
                x: Math.max(xMargin, Math.min(w - xMargin, w * 0.5 + zigzag + jitter)),
                y: i * perNodeH + perNodeH * 0.5,
            };
        });
    } else {
        // Canvas height bumped from 460 -> 500 so the island band gets enough
        // vertical room to zigzag comfortably AND clear the badge footer
        // overlay at the bottom (~42px tall: 9px padding + ~24px pill height
        // + 9px padding + 1px border).
        h = 500;
        mapH = h - mapYOffset;
        // Reserve an extra 10% of the canvas height as a bottom buffer on
        // top of the default 110. This raises all islands (and their labels)
        // by ~50px so they sit higher up in the map zone and stay well clear
        // of the badge-footer overlay. Clouds (capped at h*0.22 from the top
        // of the map zone) and the title (in the header zone above the map)
        // are unaffected -- only the island band moves.
        const previewHudBottom = 110 + Math.round(h * 0.10);
        positions = computeMapLayout(mapNodes.length, w, mapH, undefined, previewHudBottom);
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = '100%';
    canvas.style.height = h + 'px';
    canvas.style.display = 'block';
    containerEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const companionPositions = computeCompanionPositions(mapCompanions, mapEdges, positions, undefined, undefined, isMobile);
    const allDecorations = generateMapDecorations(positions, w, mapH);
    const decorations = allDecorations.filter(d => d.type !== 'mountain');
    const palette = getGameUIPalette();

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
        iconStyle: 'crest',
        islandStyle: 'wooded',
        targetStyle: 'flag-shape',
        planeStyle: 'helicopter',
        skyStyle: 'sky',
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
        // Let clouds drift up into the reserved header zone so they layer
        // behind the title scrim (same feel as game mode where clouds peek
        // out from beneath the HUD). Without these overrides clouds sit in a
        // narrow h*0.20 band inside the map zone and look vertically crammed.
        //
        // Values are in translated map-zone coords -- the map is drawn at
        // ctx.translate(0, mapYOffset). The HTML title overlay ends at
        // approximately y=100 absolute (14 padding + 17 brand + 7 + 2 + 9 +
        // 46 lab-name ≈ 95); we set the cloud top boundary to -50 translated
        // (= 100 absolute) so cloud centers start just below the title text.
        // The scrim gradient on top will still darken any cloud pixels that
        // happen to extend into the header zone.
        _cloudHudTop: -50,
        // Sprite-backed islands (taller PNG silhouettes than the procedural
        // ellipses) need more vertical room in the map zone, so on desktop
        // we squeeze the cloud band up by ~15% of mapH and shift the island
        // band up by the same amount (see post-layout shift below). Mobile
        // stacks islands vertically, so it doesn't need either adjustment.
        _cloudBottom: Math.round(mapH * (isMobile ? 0.12 : 0.13)),
        // Mobile: cap island size so the dynamic perNodeH guarantee holds
        // (46 = 65 * 0.7 to match the 30% global island shrink).
        _baseIslandRadius: isMobile ? 46 : undefined,
    };

    // Desktop: shift islands down into the map zone and clamp above footer+label clearance.
    // Mobile: positions are already vertically placed — skip the shift.
    if (!isMobile) {
        // Shift the island band ~10% of mapH down (was 25%). Sprite-backed
        // islands extend ~1 * islandRadius further below pos.y than the
        // procedural shape, and labels now sit beneath the sprite bottom, so
        // pulling islands up by 15% of mapH keeps the endpoint plate clear
        // of the badge-footer overlay.
        const shift = Math.round(mapH * 0.10);

        // Clamp pos.y so the endpoint label plate (Startington / Targetville)
        // never slips behind the .map-preview-badge-footer overlay at the
        // bottom of the canvas. The plate's bottom y in map-zone coords is
        // pos.y + (island bottom offset) + (-20 label gap) + 46 (plate height).
        // For procedural islands the bottom offset is ir*0.42 (~31 at ir=73);
        // for sprite islands it's ir*2.4*0.6 (~105 at ir=73). Use the worst
        // case for whichever path is currently active.
        const badgeFooterH = 44;
        const baseRadius = 73;
        const labelGap = -20;        // matches drawGameIslandLabels
        const plateH   = 46;
        const proceduralPlateDrop = baseRadius * 0.42 + labelGap + plateH;        // ~57
        // Plate-bottom worst case is the principal sprite -- it uses the
        // largest footprint scale (3.0) and the lowest grass-center anchor
        // among the three sprites, so it extends the furthest below pos.y.
        const principalScale      = ISLAND_SPRITE_FOOTPRINT_SCALE.principal;
        const principalAnchor     = ISLAND_SPRITE_GRASS_CENTER.principal;
        const spritePlateDrop     = baseRadius * principalScale * (1 - principalAnchor)
                                        + labelGap + plateH;                       // ~157 at scale 3.0
        const endpointPlateDrop   = islandSprites.images.principal
                                        ? spritePlateDrop
                                        : proceduralPlateDrop;
        const safetyGap = 6;
        const maxAllowed = mapH - badgeFooterH - endpointPlateDrop - safetyGap;
        state.positions.forEach(p => { p.y = Math.min(maxAllowed, p.y + shift); });

        // Lift the target (last) island so it never sits below the average y
        // of the rest of the path. Without this, odd-count chains place the
        // last island at the natural zigzag low (matching the start island's
        // y), which combined with its right-edge x position reads as "stuck
        // in the bottom-right corner." We only ever move it UP, so layouts
        // where the target naturally sits high (e.g. 4-island zigzag) are
        // left alone.
        if (state.positions.length >= 2) {
            const targetIdx = state.positions.length - 1;
            const others = state.positions.slice(0, targetIdx);
            const avgOtherY = others.reduce((s, p) => s + p.y, 0) / others.length;
            state.positions[targetIdx].y = Math.min(state.positions[targetIdx].y, avgOtherY);
        }

        // Pull the last island's x in so its endpoint plate doesn't get
        // clamped flush against the right edge by drawMapWithGameLabels'
        // drawX clamp. The endpoint plate can be ~160px wide (80 half-width);
        // leave 12px breathing room from the canvas edge.
        const lastPos = state.positions[state.positions.length - 1];
        if (lastPos) {
            const endpointPlateHalfW = 80;
            const rightMargin = 12;
            lastPos.x = Math.min(lastPos.x, w - endpointPlateHalfW - rightMargin);
        }
    }

    function draw() {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const isLight = document.documentElement.classList.contains('light-theme');
        const p = state.palette;

        // Apply the chosen sky variant to the canvas-wide pre-paint. Both
        // this pre-paint AND drawGameMap (called below) read state.skyStyle,
        // but we only WANT the pre-paint to do the actual ocean fill -- if
        // we let drawGameMap repaint its own ocean gradient over its
        // translated map zone, the gradient stops won't line up with the
        // pre-paint at y = mapYOffset and there's a visible seam right
        // under the title text. Stripping ocean colors to transparent
        // makes drawGameMap's fillRect a no-op so the single pre-paint
        // becomes the only sky paint, fading seamlessly from the dark
        // header scrim down to the bottom.
        //
        // (Game mode doesn't have this seam because there drawGameMap is
        // called against the full canvas height with no separate pre-paint
        // -- one gradient does it all.)
        const sky = getSkyVariantColors(state.skyStyle);
        const oceanA = sky?.oceanA ?? p.oceanA;
        const oceanB = sky?.oceanB ?? p.oceanB;
        const oceanDeep = sky?.oceanDeep ?? p.oceanDeep;

        // Fill the full canvas with the sky background so the header zone has
        // the same sky colour underneath the scrim that the game mode has.
        const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
        skyGrad.addColorStop(0,   oceanA);
        skyGrad.addColorStop(0.6, oceanB);
        skyGrad.addColorStop(1,   oceanDeep);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, w, h);

        // Draw the map translated down below the header zone. We override
        // palette ocean colors to transparent only for this draw call (and
        // restore them afterwards) so drawGameMap doesn't repaint its own
        // gradient over our pre-paint. Clouds, paths, islands, and labels
        // all still render normally.
        const savedOceanA = state.palette.oceanA;
        const savedOceanB = state.palette.oceanB;
        const savedOceanDeep = state.palette.oceanDeep;
        state.palette.oceanA = 'rgba(0,0,0,0)';
        state.palette.oceanB = 'rgba(0,0,0,0)';
        state.palette.oceanDeep = 'rgba(0,0,0,0)';
        ctx.save();
        ctx.translate(0, mapYOffset);
        drawMapWithGameLabels(ctx, w, mapH, state);
        ctx.restore();
        state.palette.oceanA = savedOceanA;
        state.palette.oceanB = savedOceanB;
        state.palette.oceanDeep = savedOceanDeep;

        // Gradient scrim over the header zone — matches SCRIM_H5 in game mode V5 exactly.
        const scrim = ctx.createLinearGradient(0, 0, 0, mapYOffset);
        scrim.addColorStop(0,   isLight ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.92)');
        scrim.addColorStop(0.6, isLight ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.50)');
        scrim.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, w, mapYOffset);

        ctx.restore();
    }

    // --- HTML overlays ---
    const labTitle = escapeHtmlGame(lab.displayName || lab.name || '');

    // Title overlay: brand line + shimmering rule + gold gradient lab name
    const titleEl = document.createElement('div');
    titleEl.className = 'map-preview-title-overlay';
    titleEl.innerHTML = `
        <span class="map-preview-brand">Pathfinding Labs</span>
        <div class="map-preview-rule"></div>
        <span class="map-preview-lab-name">${labTitle}</span>
    `;
    containerEl.appendChild(titleEl);

    // Set the lab name font size. On mobile CSS allows wrapping so we start smaller
    // and skip the shrink loop. On desktop shrink until it fits on one line.
    requestAnimationFrame(() => {
        const nameEl = titleEl.querySelector('.map-preview-lab-name');
        if (!nameEl) return;
        if (isMobile) {
            nameEl.style.fontSize = '28px';
        } else {
            const maxW = containerEl.clientWidth - 40; // 20px left pad + 20px right margin
            let size = 46;
            nameEl.style.fontSize = size + 'px';
            while (size > 14 && nameEl.scrollWidth > maxW) {
                size--;
                nameEl.style.fontSize = size + 'px';
            }
        }
    });

    // Badge footer: KV pills + service tags, built by labs.js helper
    const footerEl = document.createElement('div');
    footerEl.className = 'map-preview-badge-footer';
    if (typeof buildPreviewFooterHTML === 'function') {
        footerEl.innerHTML = buildPreviewFooterHTML(lab);
    }
    containerEl.appendChild(footerEl);

    awsIconSprites.preload(mapNodes);
    if (mapCompanions) awsIconSprites.preload(mapCompanions);
    cloudSprites.load().then(() => draw());
    islandSprites.load().then(() => draw());
    helicopterSprite.load().then(() => draw());
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

// ─── Compact game-map thumbnail renderer ──────────────────────────────────────
// Renders the same island/cloud/path aesthetic as the full lab detail map but
// into a small container (card thumbnail, getting-started cards, etc.).
// No title overlay, no badge footer — just the raw map canvas filling the
// container's current dimensions. Call after layout so clientWidth/clientHeight
// are non-zero.
function renderStaticMapThumbnail(containerEl, lab) {
    let mapNodes = [], mapEdges = [], mapCompanions = [];
    if (lab.attackMap?.nodes?.length) {
        const parsed = parseAttackMapToGameNodes(lab.attackMap);
        mapNodes = parsed.nodes;
        mapEdges = parsed.edges;
        mapCompanions = parsed.companions || [];
    }
    if (mapNodes.length === 0 && lab.readme?.attackDiagram) {
        const mermaidData = parseMermaidToSteps(lab.readme.attackDiagram);
        if (mermaidData.steps.length > 0) {
            mapNodes.push({ label: mermaidData.steps[0].fromNode.label, type: getNodeTypeFromColor(mermaidData.steps[0].fromNode.color) });
            mermaidData.steps.forEach((step, i) => {
                mapNodes.push({ label: step.toNode.label, type: getNodeTypeFromColor(step.toNode.color) });
                mapEdges.push({ fromIdx: mapNodes.length - 2, toIdx: mapNodes.length - 1, label: step.edgeLabel || '', description: '', commands: [], hints: [], implicit: false });
            });
        }
    }
    if (mapNodes.length === 0) return null;

    const w = containerEl.clientWidth  || 240;
    const h = containerEl.clientHeight || 160;
    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement('canvas');
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width   = '100%';
    canvas.style.height  = '100%';
    canvas.style.display = 'block';
    containerEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Islands occupy the bottom 75% of the thumbnail; clouds get the top 25%.
    // Pass hudTop equal to the 25% boundary so computeMapLayout seeds positions
    // in roughly the right zone before the amplification step below refines them.
    const islandTop = Math.round(h * 0.25);
    const positions = computeMapLayout(mapNodes.length, w, h, islandTop, 0);

    // Remap all positions into the bottom 75% and amplify the zig-zag so the
    // alternating pattern is clearly visible at thumbnail scale.
    if (positions.length >= 2) {
        const zoneTop    = islandTop + 5;
        const zoneBottom = h - 5;
        const centerY    = (zoneTop + zoneBottom) / 2;
        positions.forEach(p => {
            const delta = p.y - centerY;
            p.y = Math.max(zoneTop, Math.min(zoneBottom, centerY + delta * 2.2));
        });
    }

    // Estimate island radius as drawGameMap will compute it (base → overlap shrink →
    // thumbnail *0.5) so we know how much buffer to keep from each canvas edge.
    // Island shapes extend up to ~1.4× the radius from center (jitter + shape overscan).
    // 73 matches the 30% global island shrink in drawGameMap.
    const baseIslandRadius = 73;
    let estRadius = baseIslandRadius * Math.pow(0.8, Math.max(0, mapNodes.length - 3));
    if (positions.length >= 2) {
        let minDist = Infinity;
        for (let a = 0; a < positions.length; a++) {
            for (let b = a + 1; b < positions.length; b++) {
                const dx = positions[b].x - positions[a].x;
                const dy = positions[b].y - positions[a].y;
                minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
            }
        }
        estRadius = Math.min(estRadius, Math.max(30, minDist / 2.4));
    }
    estRadius *= 0.5; // thumbnail mode halves radius (mirrors drawGameMap line)
    const edgeBuf = Math.ceil(estRadius * 1.4) + 4;
    positions.forEach(p => {
        p.x = Math.max(edgeBuf, Math.min(w - edgeBuf, p.x));
        p.y = Math.max(islandTop + edgeBuf, Math.min(h - edgeBuf, p.y));
    });

    // Companion radius in thumbnail mode mirrors the *0.5 halving applied to main islands.
    // Pass estRadius (already halved) as the clearance hint and 0.5 as the offset scale
    // so perpendicular placement candidates stay proportional to the smaller canvas.
    const companionRadius = 56 * Math.pow(0.8, Math.max(0, mapNodes.length - 3)) * 0.25;
    const companionPositions = computeCompanionPositions(mapCompanions, mapEdges, positions, companionRadius, 0.5);

    // Clamp companion centers with their own (smaller) edge buffer so they stay on-canvas.
    const companionEdgeBuf = Math.ceil(companionRadius * 1.4) + 4;
    companionPositions.forEach(p => {
        if (p.x === 0 && p.y === 0) return;
        p.x = Math.max(companionEdgeBuf, Math.min(w - companionEdgeBuf, p.x));
        p.y = Math.max(islandTop + companionEdgeBuf, Math.min(h - companionEdgeBuf, p.y));
    });

    const decorations = generateMapDecorations(positions, w, h, islandTop + edgeBuf, edgeBuf).filter(d => d.type !== 'mountain');
    const palette            = getGameUIPalette();

    const state = {
        screen: 'playing',
        revealed:         new Set(mapNodes.map((_, i) => i)),
        currentNode:      0,
        currentEdge:      -1,
        revealedEdges:    new Set(mapEdges.map((_, i) => i)),
        revealedCommands: new Set(),
        selectedNode:     null, selectedEdge: null,
        selectedCompanion: null, completeView: null,
        gameViewPhase:    'navigation', panelOverride: null,
        positions, companionPositions,
        companions:       mapCompanions,
        companionStyle:   'islet',
        iconStyle:        'crest',
        islandStyle:      'wooded',
        targetStyle:      'flag-shape',
        planeStyle:       'helicopter',
        skyStyle:         'sky',
        nodes:            mapNodes,
        edges:            mapEdges,
        decorations,
        hintsUsed: 0, revealedHints: {},
        hoveredButton: null, activeButton: null, hoveredHop: null,
        buttons: [], lab, palette,
        _redraw: null, _panelEl: null,
        // Clouds fill the top 25%; islands fill the bottom 75%. Scale is capped so
        // cloud sprites stay within their band at thumbnail size — the default 2-4x
        // native scale overflows a 40px zone on a 160px canvas.
        _cloudHudTop:      0,
        _cloudBottom:      Math.round(h * 0.25),
        _cloudCount:       5,
        _cloudScaleRange:  { min: 1.0, max: 2.0 },
        _thumbnailMode:    true,
    };

    function draw() {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawGameMap(ctx, w, h, state);
        drawCompanions(ctx, w, h, state);
        ctx.restore();
    }

    cloudSprites.load().then(draw);
    islandSprites.load().then(draw);
    helicopterSprite.load().then(draw);
    return canvas;
}
