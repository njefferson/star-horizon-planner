#!/usr/bin/env node
// =============================================================================
// ui-smoke.mjs — headless-Chromium smoke pass over the real app: the UI layer
// `node --test` can't reach. Serves the repo over localhost, then walks the
// full first-run journey: empty gates → add a site → edit + import a horizon →
// favourite a target → night graph + visibility table → add/remove a custom
// scope → About credits → Night Mode persistence. Fails loudly on any uncaught
// page error.
//
// Run:  npm run test:ui
// Needs `npm i --no-save playwright-core` once (no browser download — this
// launches the preinstalled container Chromium; override with CHROMIUM_PATH).
// Exits 0 with a SKIP note when playwright-core or Chromium is unavailable, so
// plain `npm test` environments (CI) are unaffected.
//
// GOTCHA (NOTES.md): poll SYNCHRONOUS DOM predicates only — waitForFunction
// does NOT await Promise predicates; a Promise is truthy, so such a poll
// "passes" instantly.
// =============================================================================
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const SHOTS = process.env.SMOKE_SHOTS_DIR || null; // optional screenshot dir

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  console.log('SKIP ui-smoke: playwright-core not installed (npm i --no-save playwright-core).');
  process.exit(0);
}
try { await access(CHROMIUM); }
catch {
  console.log(`SKIP ui-smoke: no Chromium at ${CHROMIUM} (set CHROMIUM_PATH).`);
  process.exit(0);
}

// --- tiny static server (correct MIME types matter for ES modules) ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// --- harness -----------------------------------------------------------------
const failures = [];
const pageErrors = [];
let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${String(e.message).split('\n')[0]}`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch({ executablePath: CHROMIUM });
// serviceWorkers:'block' — page.route can't intercept SW-mediated fetches, so
// after first load the SW re-introduces the hanging font request on reload.
// Offline/SW behaviour is a device concern, not this smoke pass's.
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, serviceWorkers: 'block' });
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  // External font fetches can't resolve in a sandbox — everything else is real.
  // The URL lives in location(), not always in the message text.
  const t = m.text();
  const at = `${m.location()?.url || ''} ${t}`;
  if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com/.test(at)) pageErrors.push(t);
});
page.on('dialog', (d) => d.accept()); // confirm() on remove/reset
// Kill external font requests outright: in a sandbox they hang until a
// connection reset, and module scripts (thus DOMContentLoaded and first
// render) sit behind the pending stylesheet the whole time.
await page.route(/fonts\.g(oogleapis|static)\.com/, (r) => r.abort());
const tab = (label) => page.click(`.tab:has-text("${label}")`);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name) }); };

// --- the journey ---------------------------------------------------------------
await step('boot: 6 tabs, Tonight shows the no-site gate (honest first run)', async () => {
  // domcontentloaded: the window 'load' event hangs on the external font
  // <link> in offline sandboxes; the app itself is fully local.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tab');
  ok(await page.$$eval('.tab', (e) => e.length) === 6, 'expected 6 tabs');
  // The dock grid's column count must track the tab count — a forgotten
  // repeat(N, 1fr) wraps the last tab onto a second, clipped row.
  const rows = await page.$$eval('.tab', (els) => new Set(els.map((e) => e.getBoundingClientRect().top)).size);
  ok(rows === 1, `all tabs on one dock row (got ${rows} rows)`);
  await page.waitForSelector('.dead-end');
  const gate = await page.$eval('.dead-end h2', (e) => e.textContent);
  ok(/observing site/i.test(gate), `Tonight gate says: ${gate}`);
});

await step('horizon: gated too before any site exists', async () => {
  await tab('Horizon');
  await page.waitForSelector('.dead-end');
  ok(/no site yet/i.test(await page.$eval('.dead-end h2', (e) => e.textContent)), 'Horizon gate');
});

await step('sites: add a site via the dialog; it lists and becomes active', async () => {
  await tab('Sites');
  await page.click('.row-actions .btn.primary');
  await page.fill('dialog input[placeholder="Name (e.g. Backyard)"]', 'Smoke Yard');
  await page.fill('dialog input[placeholder="Latitude"]', '37.5');
  await page.fill('dialog input[placeholder="Longitude"]', '-122');
  await page.click('dialog .btn.primary');
  await page.waitForSelector('.site-row.active');
  ok(/Smoke Yard/.test(await page.$eval('.site-row.active', (e) => e.textContent)), 'active site name');
});

await step('horizon editor: 36 handles; keyboard nudge writes through', async () => {
  await tab('Horizon');
  await page.waitForSelector('.hz-handle');
  ok(await page.$$eval('.hz-handle', (e) => e.length) === 36, '36 draggable rows');
  await page.focus('.hz-handle[data-i="0"]');
  for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowUp');
  const readout = await page.$eval('.hz-readout', (e) => e.textContent);
  ok(/0° · 3°/.test(readout), `readout after 3 nudges: ${readout}`);
});

await step('horizon editor: Stellarium import (keeps the file\'s density)', async () => {
  await page.click('.hz-actions .btn:has-text("Import")');
  await page.fill('.hz-import', '# smoke\n0 12\n90 5\n180 20\n270 8');
  await page.click('.hz-dialog .btn.primary');
  await page.waitForSelector('.hz-dialog', { state: 'detached' });
  const max = await page.$eval('.hz-max', (e) => e.textContent);
  ok(/tallest 20°/.test(max), `tallest after import: ${max}`);
});

await step('capture: synthetic sensor sweep bins, covers the circle, saves', async () => {
  await page.click('.hz-actions .btn:has-text("Measure")');
  await page.waitForSelector('.cap-live');
  await page.click('.pa-card .btn:has-text("Enable compass")');
  await page.click('#cap-rec'); // Record (uncalibrated → raw-headings toast, offset 0)
  // Synthetic Android sweep, one event per degree: absolute α with
  // heading = 360 − α; an 18° south treeline over 4° open sky.
  await page.evaluate(() => {
    for (let heading = 0; heading < 360; heading++) {
      const beta = heading >= 170 && heading <= 190 ? 18 : 4;
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {
        alpha: (360 - heading) % 360, beta, gamma: 0, absolute: true,
      }));
    }
  });
  await page.click('#cap-rec'); // Stop — repaints counters synchronously
  const cov = await page.$eval('#cap-cov', (e) => e.textContent);
  ok(/ 100% /.test(cov), `full-circle coverage: ${cov}`);
  await shot('capture.png');
  await page.click('.pa-card .btn:has-text("Save measured horizon")');
  await page.waitForSelector('.hz-svg'); // lands back on the editor
  const max = await page.$eval('.hz-max', (e) => e.textContent);
  ok(/tallest 18°/.test(max), `captured treeline applied: ${max}`);
});

await step('targets: search the catalog and favourite M42', async () => {
  await tab('Targets');
  await page.waitForSelector('.target-row');
  await page.fill('.search', 'orion nebula');
  await page.waitForSelector('.target-row'); // list repaints in place
  await page.click('.target-row .fav');
  ok(await page.$('.target-row .fav.on') !== null, 'favourite toggled on');
});

await step('tonight: canvas paints, visibility row + effective window language', async () => {
  await tab('Tonight');
  await page.waitForSelector('.ng-base');
  await page.waitForSelector('.vis-row');
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.ng-base');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  });
  ok(painted, 'night-graph canvas has pixels');
  const row = await page.$eval('.vis-row', (e) => e.textContent);
  ok(/up|never up/.test(row), `row shows a geometric window: ${row}`);
  const moon = await page.$('.vis-moon');
  if (moon) ok(/☾ \d+°/.test(await moon.textContent()), 'moon chip formats as ☾ N°');
  await shot('tonight.png');
});

await step('settings: custom scope — live FOV preview, save, active, remove', async () => {
  await tab('Settings');
  await page.waitForSelector('.inst-card'); // hashchange renders async — wait, don't race
  ok(await page.$$eval('.inst-card', (e) => e.length) === 2, 'two presets to start');
  await page.click('.row-actions .btn:has-text("Add custom telescope")');
  await page.fill('dialog input[placeholder="e.g. RedCat 51 + ASI533"]', 'Smoke Scope');
  await page.fill('dialog input[placeholder="250"]', '250');
  await page.fill('dialog input[placeholder="1920"]', '1920');
  await page.fill('dialog input[placeholder="1080"]', '1080');
  await page.fill('dialog input[placeholder="2.9"]', '2.9');
  const prev = await page.$eval('.fov-preview', (e) => e.textContent);
  ok(/1\.28° × 0\.72°/.test(prev), `live FOV preview (S50 optics): ${prev}`);
  await shot('custom-scope.png');
  await page.click('dialog .btn.primary');
  await page.waitForSelector('.inst-card:nth-child(3)');
  ok(/Smoke Scope/.test(await page.$eval('.inst-card.active', (e) => e.textContent)), 'new scope is active');
  await page.click('.inst-card.active .btn.danger'); // confirm auto-accepted
  await page.waitForSelector('.inst-card:nth-child(3)', { state: 'detached' });
  ok(/Seestar S50/.test(await page.$eval('.inst-card.active', (e) => e.textContent)), 'falls back to the S50');
});

await step('polar align: aim card renders from the site, horizon-aware', async () => {
  await tab('Polar');
  await page.waitForSelector('.pa-card');
  const text = await page.$eval('#app', (e) => e.textContent);
  ok(/Polaris/.test(text), 'names the pole star for a northern site');
  ok(/Where to aim/.test(text), 'aim card present');
  await shot('polar.png');
});

await step('about: credits visible, scaffold copy gone', async () => {
  await page.click('#about-btn');
  await page.waitForSelector('.about-dialog');
  const text = await page.$eval('.about-dialog', (e) => e.textContent);
  ok(/OpenNGC/.test(text), 'OpenNGC credited');
  ok(/astronomy-engine/.test(text), 'astronomy-engine credited');
  ok(!/early scaffold/i.test(text), 'stale scaffold line removed');
  await page.keyboard.press('Escape');
});

await step('night mode: persists across reload and the checkbox reflects it', async () => {
  await tab('Settings');
  await page.check('.theme-checkbox');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark applied');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.theme-checkbox');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark survives reload (pre-paint boot)');
  // Regression: the checkbox used to render unchecked in dark mode.
  ok(await page.$eval('.theme-checkbox', (e) => e.checked) === true, 'checkbox reflects dark on first render');
  await shot('settings-dark.png');
});

await step('no uncaught page errors anywhere in the journey', async () => {
  ok(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
});

await browser.close();
server.close();
console.log(failures.length
  ? `\n${passed} ok, ${failures.length} FAILED: ${failures.join(', ')}`
  : `\nall ${passed} smoke steps passed`);
process.exit(failures.length ? 1 : 0);
