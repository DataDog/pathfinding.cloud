#!/usr/bin/env node
/**
 * Generate per-lab social hero images by rendering each lab's attack map
 * preview in a headless Chromium and capturing the canvas as a PNG.
 *
 * Output: docs/labs/{slug}/hero.png
 *
 * Incremental by content, not timestamps (a fresh CI checkout gives every file
 * the same mtime, which used to re-render every lab on every deploy). Each
 * lab's fingerprint covers its data file, its labs.json entry and
 * HERO_RENDER_VERSION; docs/labs/hero-manifest.json records the fingerprint
 * each committed PNG was rendered from. A lab re-renders only when its PNG is
 * missing or its fingerprint changed. Commit the PNGs and the manifest
 * together after rendering locally, so deploys can skip them.
 *
 * Usage:
 *   node scripts/generate-lab-hero-images.js                  # all labs (incremental)
 *   node scripts/generate-lab-hero-images.js --plan           # list labs to render; render nothing
 *   node scripts/generate-lab-hero-images.js --force          # regenerate all
 *   node scripts/generate-lab-hero-images.js --slug iam-002   # single lab
 *   node scripts/generate-lab-hero-images.js --port 8891      # alternate dev-server port (8888 is reserved)
 *
 * Requires: `npm install` (Playwright) and `npx playwright install chromium`,
 * except for --plan, which never loads Playwright.
 *
 * The dev-server (docs/dev-server.py) is started by this script if it isn't
 * already listening on the chosen port.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const LABS_DATA_DIR = path.join(DOCS_DIR, 'labs', 'data');
const LABS_OUTPUT_DIR = path.join(DOCS_DIR, 'labs');
const RESERVED_DEV_SERVER_PORT = 8888;

// Per-lab hero image lives next to that lab's stub: docs/labs/{slug}/hero.png
function heroPathFor(slug) {
    return path.join(LABS_OUTPUT_DIR, slug, 'hero.png');
}

// Bump this when a change alters how hero images look: the map preview
// drawing in map-game.js (renderStaticMapPreview and what it calls), the
// title and badge overlays from labs.js or viz-shared.js, the map preview
// rules in style.css, or the sprites. It is part of every fingerprint, so a
// bump re-renders every lab. It stands in for hashing those files because
// they change often for reasons that don't affect the images.
const HERO_RENDER_VERSION = 1;

// The fingerprint each committed hero.png was rendered from.
const MANIFEST_PATH = path.join(LABS_OUTPUT_DIR, 'hero-manifest.json');

// Social card target. The native canvas is ~viewport-width x 500 -- we render
// at this viewport size and capture the canvas element's natural pixels.
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

function parseArgs(argv) {
    const args = { force: false, plan: false, slug: null, port: 8899 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--force') args.force = true;
        else if (a === '--plan') args.plan = true;
        else if (a === '--slug') args.slug = argv[++i];
        else if (a === '--port') args.port = parseInt(argv[++i], 10);
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node scripts/generate-lab-hero-images.js [--plan] [--force] [--slug SLUG] [--port N]');
            process.exit(0);
        } else {
            console.error(`Unknown arg: ${a}`);
            process.exit(2);
        }
    }
    if (args.port === RESERVED_DEV_SERVER_PORT) {
        console.error(`Port ${RESERVED_DEV_SERVER_PORT} is reserved by another local service and must not be used for pathfinding.cloud.`);
        console.error('Use the script default or choose another port, such as 8890.');
        process.exit(2);
    }
    return args;
}

/** labs.json entries by slug. */
function readLabIndex() {
    const indexPath = path.join(DOCS_DIR, 'labs.json');
    if (!fs.existsSync(indexPath)) {
        throw new Error(`labs.json not found at ${indexPath}. Run scripts/generate-labs-json.py first.`);
    }
    const index = new Map();
    for (const lab of JSON.parse(fs.readFileSync(indexPath, 'utf-8'))) {
        if (lab.slug) index.set(lab.slug, lab);
    }
    return index;
}

/**
 * Categories the site hides (HIDDEN_CATEGORIES in docs/js/labs.js): their
 * detail pages never render, so there is no map preview to capture. Read from
 * labs.js so the two lists can't drift apart.
 */
function readHiddenCategories() {
    const labsJs = fs.readFileSync(path.join(DOCS_DIR, 'js', 'labs.js'), 'utf-8');
    const match = labsJs.match(/const HIDDEN_CATEGORIES = (\[[^\]]*\]);/);
    if (!match) throw new Error('HIDDEN_CATEGORIES not found in docs/js/labs.js; update readHiddenCategories.');
    return new Set(JSON.parse(match[1]));
}

function listLabSlugs() {
    if (!fs.existsSync(LABS_DATA_DIR)) {
        throw new Error(`Lab data directory not found: ${LABS_DATA_DIR}. Run scripts/generate-labs-json.py first.`);
    }
    // Only generate hero images for labs that appear in labs.json (the SPA
    // index). Labs that exist in docs/labs/data/ but not in labs.json are
    // hidden/draft and the SPA's router falls back to the list view when
    // visited, so renderStaticMapPreview never runs and we'd just time out.
    const index = readLabIndex();
    const hiddenCategories = readHiddenCategories();
    const listed = new Set([...index].filter(([, lab]) => !hiddenCategories.has(lab.category)).map(([slug]) => slug));
    return fs.readdirSync(LABS_DATA_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -'.json'.length))
        .filter(slug => listed.has(slug))
        .sort();
}

/**
 * JSON with object keys sorted at every level. The labs generator's GitHub and
 * local-clone modes emit the same data with keys in a different order, so
 * fingerprints must not depend on key order.
 */
function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** What a lab's hero image is drawn from, hashed. */
function fingerprintFor(slug, labIndex) {
    const data = JSON.parse(fs.readFileSync(path.join(LABS_DATA_DIR, `${slug}.json`), 'utf-8'));
    const inputs = { rendererVersion: HERO_RENDER_VERSION, data, indexEntry: labIndex.get(slug) ?? null };
    return crypto.createHash('sha256').update(canonicalJson(inputs)).digest('hex');
}

function readManifest() {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')).labs || {};
    } catch (_) {
        return {};
    }
}

function writeManifest(labs) {
    const sorted = Object.fromEntries(Object.keys(labs).sort().map(slug => [slug, labs[slug]]));
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ rendererVersion: HERO_RENDER_VERSION, labs: sorted }, null, 2) + '\n');
}

function shouldRegenerate(slug, force, fingerprints, manifest) {
    if (force) return true;
    if (!fs.existsSync(heroPathFor(slug))) return true;
    return manifest[slug] !== fingerprints.get(slug);
}

function isPortListening(port) {
    return new Promise((resolve) => {
        const sock = net.connect({ port, host: '127.0.0.1' }, () => {
            sock.end();
            resolve(true);
        });
        sock.on('error', () => resolve(false));
        sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
    });
}

async function waitForPort(port, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isPortListening(port)) return true;
        await new Promise(r => setTimeout(r, 200));
    }
    return false;
}

async function startDevServer(port) {
    if (await isPortListening(port)) {
        console.log(`✓ Reusing existing server on port ${port}`);
        return null; // not owned by us
    }
    console.log(`→ Starting dev server on port ${port}...`);
    // Use the project's server entry point so its default-port and reserved-port
    // policy applies consistently here as well as during manual development.
    const proc = spawn('python3', [path.join(DOCS_DIR, 'dev-server.py'), '--port', String(port)], {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    const ready = await waitForPort(port, 10000);
    if (!ready) {
        proc.kill('SIGTERM');
        throw new Error(`Dev server did not start within 10s on port ${port}.`);
    }
    return proc;
}

async function captureOne(page, slug, port) {
    // URL-encode the slug for the path so characters like `+` and spaces
    // round-trip cleanly to the SPA router (which decodeURIComponent's it).
    const url = `http://127.0.0.1:${port}/labs/${encodeURIComponent(slug)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // The container ID embeds the raw slug, which can include `+` (adjacent-
    // sibling combinator) and spaces. Use an attribute selector to match the
    // ID literally and avoid CSS-escaping every special character.
    const containerSelector = `[id="gv2-map-preview-container-${slug}"]`;
    // Wait for the SPA to mount the detail view and renderStaticMapPreview to
    // finish (data-rendered set by map-game.js after sprites + final draw).
    await page.waitForSelector(`${containerSelector}[data-rendered="true"]`, { timeout: 30000 });

    // Strip the container's border + rounded corners so the captured PNG has
    // no white frame around the artwork. The CSS rule lives in
    // docs/css/style.css (.lab-gv2-map-preview) and applies in the live UI;
    // we only override it for the capture.
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.style.border = 'none';
        el.style.borderRadius = '0';
        el.style.margin = '0';
    }, containerSelector);

    // The canvas inside the preview container is what we want to capture --
    // the badge-footer/title overlays are HTML siblings rendered into the
    // same container. Capturing the container gets all of them composited.
    const container = await page.locator(containerSelector);
    const outPath = heroPathFor(slug);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await container.screenshot({ path: outPath });
    return outPath;
}

async function main() {
    const args = parseArgs(process.argv);

    const allSlugs = args.slug ? [args.slug] : listLabSlugs();
    if (args.slug && !fs.existsSync(path.join(LABS_DATA_DIR, `${args.slug}.json`))) {
        console.error(`No lab data for slug: ${args.slug}`);
        process.exit(2);
    }

    const labIndex = readLabIndex();
    const fingerprints = new Map(allSlugs.map(slug => [slug, fingerprintFor(slug, labIndex)]));
    const manifest = readManifest();
    const todo = allSlugs.filter(s => shouldRegenerate(s, args.force, fingerprints, manifest));
    const skipped = allSlugs.length - todo.length;
    console.log(`${allSlugs.length} labs total, ${todo.length} to (re)generate, ${skipped} cached.`);
    if (args.plan) {
        for (const slug of todo) console.log(`  needs render: ${slug}`);
        // Lets the deploy workflow skip installing Playwright when nothing needs rendering.
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `stale_count=${todo.length}\n`);
        return;
    }
    if (todo.length === 0) return;

    let playwright;
    try {
        playwright = require('playwright');
    } catch (e) {
        console.error('Playwright not installed. Run: npm install && npx playwright install chromium');
        process.exit(1);
    }

    const serverProc = await startDevServer(args.port);

    const browser = await playwright.chromium.launch();
    const context = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    let ok = 0, fail = 0;
    for (const slug of todo) {
        try {
            const out = await captureOne(page, slug, args.port);
            manifest[slug] = fingerprints.get(slug);
            const sz = fs.statSync(out).size;
            console.log(`  ✓ ${slug} → ${path.relative(REPO_ROOT, out)} (${(sz/1024).toFixed(1)}K)`);
            ok++;
        } catch (e) {
            console.warn(`  ✗ ${slug}: ${e.message}`);
            fail++;
        }
    }

    await browser.close();
    if (serverProc) serverProc.kill('SIGTERM');

    // Record what each PNG was rendered from. A full run also drops labs that
    // are no longer listed, so the manifest doesn't grow forever.
    if (!args.slug) {
        for (const slug of Object.keys(manifest)) if (!fingerprints.has(slug)) delete manifest[slug];
    }
    writeManifest(manifest);

    console.log(`\nDone. ${ok} generated, ${fail} failed, ${skipped} cached.`);
    if (fail > 0 && !process.env.IGNORE_HERO_FAILURES) {
        // Don't fail the build -- failed labs simply fall back to the generic
        // OG image in their stub. Surface a non-zero exit code only when the
        // caller opts in (CI may want to alarm).
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
