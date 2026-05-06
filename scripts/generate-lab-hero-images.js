#!/usr/bin/env node
/**
 * Generate per-lab social hero images by rendering each lab's attack map
 * preview in a headless Chromium and capturing the canvas as a PNG.
 *
 * Output: docs/images/labs/{slug}.png
 *
 * Incremental: skip a lab if its PNG is newer than every input that can
 * affect the rendered output (lab data JSON + the JS/CSS files used to
 * render it). Pass --force to regenerate all.
 *
 * Usage:
 *   node scripts/generate-lab-hero-images.js                  # all labs (incremental)
 *   node scripts/generate-lab-hero-images.js --force          # regenerate all
 *   node scripts/generate-lab-hero-images.js --slug iam-002   # single lab
 *   node scripts/generate-lab-hero-images.js --port 8889      # alternate dev-server port
 *
 * Requires: `npm install` (Playwright) and `npx playwright install chromium`.
 *
 * The dev-server (docs/dev-server.py) is started by this script if it isn't
 * already listening on the chosen port.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const LABS_DATA_DIR = path.join(DOCS_DIR, 'labs', 'data');
const LABS_OUTPUT_DIR = path.join(DOCS_DIR, 'labs');

// Per-lab hero image lives next to that lab's stub: docs/labs/{slug}/hero.png
function heroPathFor(slug) {
    return path.join(LABS_OUTPUT_DIR, slug, 'hero.png');
}

// Files whose mtime invalidates the cached PNG. If any is newer than the
// PNG, that lab regenerates.
const SHARED_INVALIDATORS = [
    path.join(DOCS_DIR, 'js', 'viz-shared.js'),
    path.join(DOCS_DIR, 'js', 'labs.js'),
    path.join(DOCS_DIR, 'js', 'map-game.js'),
    path.join(DOCS_DIR, 'css', 'style.css'),
];

// Social card target. The native canvas is ~viewport-width x 500 -- we render
// at this viewport size and capture the canvas element's natural pixels.
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

function parseArgs(argv) {
    const args = { force: false, slug: null, port: 8899 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--force') args.force = true;
        else if (a === '--slug') args.slug = argv[++i];
        else if (a === '--port') args.port = parseInt(argv[++i], 10);
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node scripts/generate-lab-hero-images.js [--force] [--slug SLUG] [--port N]');
            process.exit(0);
        } else {
            console.error(`Unknown arg: ${a}`);
            process.exit(2);
        }
    }
    return args;
}

function listLabSlugs() {
    if (!fs.existsSync(LABS_DATA_DIR)) {
        throw new Error(`Lab data directory not found: ${LABS_DATA_DIR}. Run scripts/generate-labs-json.py first.`);
    }
    // Only generate hero images for labs that appear in labs.json (the SPA
    // index). Labs that exist in docs/labs/data/ but not in labs.json are
    // hidden/draft and the SPA's router falls back to the list view when
    // visited, so renderStaticMapPreview never runs and we'd just time out.
    const indexPath = path.join(DOCS_DIR, 'labs.json');
    if (!fs.existsSync(indexPath)) {
        throw new Error(`labs.json not found at ${indexPath}. Run scripts/generate-labs-json.py first.`);
    }
    const listed = new Set(
        JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
            .map(l => l.slug)
            .filter(Boolean)
    );
    return fs.readdirSync(LABS_DATA_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -'.json'.length))
        .filter(slug => listed.has(slug))
        .sort();
}

function mtimeOrZero(p) {
    try { return fs.statSync(p).mtimeMs; } catch (_) { return 0; }
}

function shouldRegenerate(slug, force) {
    if (force) return true;
    const pngPath = heroPathFor(slug);
    if (!fs.existsSync(pngPath)) return true;
    const pngMtime = mtimeOrZero(pngPath);
    const dataPath = path.join(LABS_DATA_DIR, `${slug}.json`);
    const newest = Math.max(mtimeOrZero(dataPath), ...SHARED_INVALIDATORS.map(mtimeOrZero));
    return newest >= pngMtime;
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
    // dev-server.py hard-codes port 8888. Start a generic Python http.server
    // from docs/ on the requested port, then SPA-fallback by serving files
    // directly. For our purposes this works because Playwright navigates to
    // /labs/index.html and we use pushState to set the lab URL inside JS, OR
    // it visits /labs/{slug}/ and once stubs exist they serve directly.
    //
    // Simpler: just exec the existing dev-server.py with PORT overridden via
    // a tiny env-aware wrapper. We instead set PYTHONUNBUFFERED and pass the
    // port by patching dev-server.py at runtime is overkill -- spawn a
    // one-line Python runner that imports the handler and binds to `port`.
    const runner = `
import sys, os, socketserver
sys.path.insert(0, ${JSON.stringify(DOCS_DIR)})
os.chdir(${JSON.stringify(DOCS_DIR)})
import importlib.util
spec = importlib.util.spec_from_file_location('dev_server', ${JSON.stringify(path.join(DOCS_DIR, 'dev-server.py'))})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", ${port}), mod.SPAHTTPRequestHandler) as httpd:
    print("dev-server up on ${port}", flush=True)
    httpd.serve_forever()
`;
    const proc = spawn('python3', ['-c', runner], {
        cwd: REPO_ROOT,
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

    const todo = allSlugs.filter(s => shouldRegenerate(s, args.force));
    const skipped = allSlugs.length - todo.length;
    console.log(`${allSlugs.length} labs total, ${todo.length} to (re)generate, ${skipped} cached.`);
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
