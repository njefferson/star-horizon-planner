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
  // External fetches can't resolve in a sandbox and are handled with fallbacks:
  // Google fonts, and the hips2fits survey thumbnails (each <img> degrades to a
  // placeholder on error). Everything else is a real error.
  const t = m.text();
  const at = `${m.location()?.url || ''} ${t}`;
  const external = /fonts\.g(oogleapis|static)\.com|alasky\.u-strasbg\.fr|hips2fits|wikipedia\.org|open-meteo\.com|7timer\.info|arcgisonline\.com|opentopomap\.org/.test(at);
  if (m.type() === 'error' && !external) pageErrors.push(t);
});
page.on('dialog', (d) => d.accept()); // confirm() on remove/reset
// Kill external font requests outright: in a sandbox they hang until a
// connection reset, and module scripts (thus DOMContentLoaded and first
// render) sit behind the pending stylesheet the whole time.
await page.route(/fonts\.g(oogleapis|static)\.com/, (r) => r.abort());
// hips2fits cutouts: fulfil with a real 1×1 JPEG so the <img> load (not error)
// path runs — the framing overlay stays mounted and the precache steps can
// warm the Cache API deterministically without network.
const JPG1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');
await page.route(/alasky\.u-strasbg\.fr/, (r) => r.fulfill({ contentType: 'image/jpeg', body: JPG1PX }));
// Terrain-map fixtures: 1×1 PNG tiles, and a deterministic elevation model —
// the site (Smoke Yard, 37.5/-122) sits at 100 m, everywhere else at 600 m.
const PNG1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// no-store: a later step simulates an Esri outage by re-routing these URLs to
// abort — cached tile responses would bypass that route and hide the outage.
const tilePng = (r) => r.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: PNG1PX });
await page.route(/(server|services)\.arcgisonline\.com/, tilePng);
await page.route(/tile\.opentopomap\.org/, tilePng);
await page.route(/api\.open-meteo\.com\/v1\/elevation/, (r) => {
  const u = new URL(r.request().url());
  const lats = u.searchParams.get('latitude').split(',').map(Number);
  // Synthetic terrain for the 360° trace: a 600 m plateau starting ~4.4 km
  // south of the Smoke Yard site (lat < 37.46); 100 m everywhere else. The
  // nearest qualifying ray sample (~4.5 km) subtends ≈6.3° — so a correct
  // max-over-ray trace reports ~6° due south and ~0° due north.
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elevation: lats.map((la) => (la < 37.46 ? 600 : 100)) }) });
});
// Deterministic cloud forecast: fulfil the Open-Meteo forecast call with a
// synthetic ramp spanning ±48 h of "now", so the Tonight cloud strip renders
// the same way on every run (no sandbox network, no real weather).
await page.route(/api\.open-meteo\.com\/v1\/forecast/, (r) => {
  const now = Math.floor(Date.now() / 3600000) * 3600; // top of the current hour, s
  const time = [], cc = [], lo = [], mi = [], hi = [], wind = [], rh = [], temp = [];
  for (let k = -48; k <= 48; k++) {
    time.push(now + k * 3600);
    const v = Math.abs(k * 7) % 101;
    cc.push(v); lo.push(Math.round(v / 2)); mi.push(Math.round(v / 3)); hi.push(Math.round(v / 6));
    wind.push(5 + (Math.abs(k) % 20)); rh.push(30 + (Math.abs(k) % 60)); temp.push(75 - (Math.abs(k) % 25));
  }
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ hourly: {
    time, cloud_cover: cc, cloud_cover_low: lo, cloud_cover_mid: mi, cloud_cover_high: hi,
    wind_speed_10m: wind, relative_humidity_2m: rh, temperature_2m: temp,
  } }) });
});
// 7Timer astro fixture: 3-hourly seeing/transparency around now.
await page.route(/7timer\.info/, (r) => {
  const d = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 6 * 3600000);
  const init = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
  const dataseries = [];
  for (let tp = 3; tp <= 72; tp += 3) dataseries.push({ timepoint: tp, seeing: (tp / 3) % 8 + 1, transparency: ((tp / 3) + 3) % 8 + 1 });
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ init, dataseries }) });
});
const tab = (label) => page.click(`.tab:has-text("${label}")`);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name) }); };

// --- the journey ---------------------------------------------------------------
await step('boot: 6 tabs, Tonight opens into the sky at the seeded default site', async () => {
  // domcontentloaded: the window 'load' event hangs on the external font
  // <link> in offline sandboxes; the app itself is fully local.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tab');
  ok(await page.$$eval('.tab', (e) => e.length) === 6, 'expected 6 tabs');
  // The dock grid's column count must track the tab count — a forgotten
  // repeat(N, 1fr) wraps the last tab onto a second, clipped row.
  const rows = await page.$$eval('.tab', (els) => new Set(els.map((e) => e.getBoundingClientRect().top)).size);
  ok(rows === 1, `all tabs on one dock row (got ${rows} rows)`);
  // Exactly one tab marks itself the current page for assistive tech.
  ok(await page.$$eval('.tab[aria-current="page"]', (e) => e.length) === 1, 'active tab has aria-current="page"');
  // First run shows a welcome that asks for a location; dismiss it.
  await page.waitForSelector('.welcome-dialog');
  ok(/where are you|find your sky/i.test(await page.$eval('.welcome-dialog', (e) => e.textContent)), 'first-run welcome prompts for location');
  await page.click('.welcome-dialog .btn.ghost'); // Not now
  await page.waitForSelector('.welcome-dialog', { state: 'detached' });
  // No create-a-site wall: a placeholder site is seeded so Tonight shows the sky
  // right away, with one-tap geolocation AND a city/ZIP search (location approx).
  await page.waitForSelector('.ng-approx');
  ok(/use my location/i.test(await page.$eval('.ng-approx', (e) => e.textContent)), 'approx-location nudge offers geolocation');
  ok(/city or zip/i.test(await page.$eval('.ng-approx', (e) => e.textContent)), 'approx-location nudge offers a city/ZIP search');
  ok(!(await page.$('.dead-end')), 'Tonight is not a dead-end on first run');
  // Flat (unmeasured) horizon → an explicit prompt explaining why nothing is
  // greyed as blocked, with a way to measure it.
  ok(/measure horizon/i.test(await page.$eval('.ng-flat', (e) => e.textContent)), 'flat horizon prompts to measure it');
});

await step('location: the city/ZIP search dialog opens from the Tonight nudge', async () => {
  await page.click('.ng-approx .btn:has-text("City or ZIP")');
  await page.waitForSelector('.loc-dialog input');
  ok(/find your location/i.test(await page.$eval('.loc-dialog h2', (e) => e.textContent)), 'geocode search dialog opens');
  await page.click('.loc-dialog .btn.ghost'); // Cancel (live geocoding needs network)
  await page.waitForSelector('.loc-dialog', { state: 'detached' });
});

await step('horizon: the seeded site opens the editor (no create-a-site wall)', async () => {
  await tab('Horizon');
  await page.waitForSelector('.hz-handle');
  ok(!(await page.$('.dead-end')), 'Horizon opens the editor, not a gate');
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
  ok(await page.$eval('.hz-handle[data-i="0"]', (e) => e.getAttribute('role')) === 'slider', 'handles are ARIA sliders');
  await page.focus('.hz-handle[data-i="0"]');
  for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowUp');
  const readout = await page.$eval('.hz-readout', (e) => e.textContent);
  ok(/0° · 3°/.test(readout), `readout after 3 nudges: ${readout}`);
  ok(await page.$eval('.hz-handle[data-i="0"]', (e) => e.getAttribute('aria-valuenow')) === '3', 'slider exposes aria-valuenow=3');
  // Depressed horizons: the editor now records and shows below 0° (downhill).
  for (let k = 0; k < 8; k++) await page.keyboard.press('ArrowDown'); // 3 → -5
  ok(await page.$eval('.hz-handle[data-i="0"]', (e) => Number(e.getAttribute('aria-valuenow'))) === -5, 'handle edits below 0° (depressed horizon)');
  ok(await page.$eval('.hz-handle[data-i="0"]', (e) => e.getAttribute('aria-valuemin')) === '-60', 'slider range extends below 0°');
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowUp'); // back to 0 for downstream steps
});

await step('horizon editor: Stellarium import (keeps the file\'s density)', async () => {
  await page.click('.hz-actions .btn:has-text("Import")');
  await page.fill('.hz-import', '# smoke\n0 12\n90 5\n180 20\n270 8');
  await page.click('.hz-dialog .btn.primary');
  await page.waitForSelector('.hz-dialog', { state: 'detached' });
  const max = await page.$eval('.hz-max', (e) => e.textContent);
  ok(/tallest 20°/.test(max), `tallest after import: ${max}`);
});

await step('terrain: 360° trace applies the horizon; map tap creates a site', async () => {
  // Entered from the Horizon editor's Map… button; #/horizon/map must route
  // before #/horizon (the capture/live precedent).
  await page.click('.hz-actions .btn:has-text("Terrain")');
  await page.waitForFunction(() => location.hash.startsWith('#/horizon/map'));
  await page.waitForSelector('.tm-map.leaflet-container'); // Leaflet classes the map div itself
  ok(/no trees/i.test(await page.$eval('.sky-notice', (e) => e.textContent)), 'tree caveat stated plainly');
  ok(/Esri/.test(await page.$eval('.leaflet-control-attribution', (e) => e.textContent)), 'Esri imagery attributed');

  // The trace: max-over-ray against the synthetic south plateau. Near ground
  // out-blocks distance — ~6.3° due south from the ~4.5 km sample, ~0° north.
  await page.waitForFunction(() => /Site elevation/.test(document.querySelector('#tm-status')?.textContent || ''));
  await page.click('#tm-trace');
  await page.waitForFunction(() => /Terrain horizon applied/.test(document.querySelector('#tm-status')?.textContent || ''), null, { timeout: 20000 });
  const summary = await page.$eval('#tm-summary', (e) => e.textContent);
  ok(/Tallest terrain 6\.\d° at az 180°/.test(summary), `trace summary: ${summary}`);
  ok((await page.$$('.leaflet-overlay-pane path')).length >= 37, '36 trace rays + the ring through their ends drawn on the map');
  await shot('terrain-trace.png');

  // Map tap → a NEW SITE (the map's remaining pointer job); non-pointer site
  // entry lives on the Sites tab, so this is never the only way in.
  await page.click('.tm-map', { position: { x: 60, y: 60 } });
  await page.waitForSelector('.loc-dialog');
  await page.fill('.loc-dialog input', 'Ridge Spot');
  await page.click('.loc-dialog .btn.primary');
  await page.waitForFunction(() => /Ridge Spot/.test(document.querySelector('.ng-site')?.textContent || ''));
  ok(true, 'tapped spot became the active site');

  // Restore Smoke Yard as active, then confirm the editor carries the trace.
  await page.evaluate(() => { location.hash = '#/sites'; });
  await page.waitForSelector('.site-row');
  await page.click('.site-row:has-text("Smoke Yard") button');
  await page.waitForSelector('.site-row.active:has-text("Smoke Yard")');
  await page.evaluate(() => { location.hash = '#/horizon'; });
  await page.waitForSelector('.hz-svg');
  const max = await page.$eval('.hz-max', (e) => e.textContent);
  ok(/tallest 6°/.test(max), `traced terrain landed in the editor (${max})`);
});

await step('terrain map: Esri outage falls back to OpenTopoMap, announced', async () => {
  // Kill the Esri mock (simulating the real 2026-07-18 device failure) and
  // re-enter the map: after a few tile errors the layer must swap to
  // OpenTopoMap and say so on the DEDICATED tile-status line (which pin and
  // elevation messages must never overwrite).
  await page.unroute(/(server|services)\.arcgisonline\.com/);
  await page.route(/(server|services)\.arcgisonline\.com/, (r) => r.abort());
  let otmRequested = false;
  await page.unroute(/tile\.opentopomap\.org/);
  await page.route(/tile\.opentopomap\.org/, (r) => { otmRequested = true; tilePng(r); });
  await page.evaluate(() => { location.hash = '#/horizon/map'; });
  await page.waitForSelector('.tm-map.leaflet-container');
  await page.waitForFunction(() => /switched to OpenTopoMap/.test(document.querySelector('#tm-tiles')?.textContent || ''));
  ok(otmRequested, 'fallback source actually requested');
  ok(/OpenTopoMap/.test(await page.$eval('.leaflet-control-attribution', (e) => e.textContent)), 'attribution follows the active source');
  // The elevation status still lands in ITS line without clobbering the tile line.
  await page.waitForFunction(() => /Site elevation/.test(document.querySelector('#tm-status')?.textContent || ''));
  ok(/switched to OpenTopoMap/.test(await page.$eval('#tm-tiles', (e) => e.textContent)), 'tile message survives the elevation message');
  // Restore the Esri mock for any later map visits (overflow probe).
  await page.unroute(/(server|services)\.arcgisonline\.com/);
  await page.route(/(server|services)\.arcgisonline\.com/, tilePng);
  await page.evaluate(() => { location.hash = '#/horizon'; });
  await page.waitForSelector('.hz-svg');
});

await step('capture: synthetic sensor sweep bins, covers the circle, saves', async () => {
  // "Measure" now opens the live camera; the sensor sweep is the no-camera
  // backup, reached directly (or via "No-camera mode" from the camera view).
  await page.evaluate(() => { location.hash = '#/capture'; });
  await page.waitForSelector('.cap-live');
  await page.click('.pa-card .btn:has-text("Enable compass")');
  await page.click('#cap-rec'); // Record (headings auto-corrected to true north by the site declination)
  // Synthetic Android sweep, one event per degree: absolute α with
  // heading = 360 − α; an 18° south treeline over 4° open sky. Camera model:
  // altitude = β − 90, so a β of 108/94 aims the camera 18°/4° above level.
  await page.evaluate(() => {
    for (let heading = 0; heading < 360; heading++) {
      const beta = 90 + (heading >= 170 && heading <= 190 ? 18 : 4);
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

await step('live camera: mocked stream, AR overlay, keyboard reticle, sweep saves', async () => {
  // No real camera in headless — hand getUserMedia a canvas stream so the
  // viewfinder path (video + overlay canvas + draw loop) runs end to end.
  await page.evaluate(() => {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      return c.captureStream(1);
    };
    location.hash = '#/capture/live';
  });
  await page.waitForSelector('.lc-stage');
  await page.waitForSelector('.lc-canvas');
  ok(!(await page.$('.lc-stage.lc-nocam')), 'camera path taken (not the no-camera fallback)');
  // Where motion isn't permission-gated (Android/desktop/headless), compass
  // auto-attaches and the Enable-compass button stays hidden.
  ok(await page.$eval('#lc-motion', (e) => e.hidden || getComputedStyle(e).display === 'none'), 'Enable-compass button hidden on the auto-attach path');

  // The reticle is keyboard-operable: focus it, nudge up, confirm the ARIA
  // value moved — the pointer-free path to aim above eye level.
  await page.focus('.lc-reticle-focus');
  const before = await page.$eval('.lc-reticle-focus', (e) => e.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowUp');
  const after = await page.$eval('.lc-reticle-focus', (e) => e.getAttribute('aria-valuenow'));
  ok(Number(after) > Number(before), `reticle altitude nudged up by keyboard: ${before}→${after}`);
  await page.keyboard.press('Home'); // back to centre so the sweep records the axis

  // Same synthetic Android sweep as the sensor path: an 18° south wall.
  await page.click('#lc-rec');
  await page.evaluate(() => {
    for (let heading = 0; heading < 360; heading++) {
      const beta = 90 + (heading >= 170 && heading <= 190 ? 18 : 4);
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', {
        alpha: (360 - heading) % 360, beta, gamma: 0, absolute: true,
      }));
    }
  });
  // Recording auto-stops at a full circle — no manual Stop, and no angry second
  // lap. Wait for the button to fall back to "Record".
  await page.waitForFunction(() => /Record/.test(document.querySelector('#lc-rec')?.textContent || ''));
  const cov = await page.$eval('#lc-cov', (e) => e.textContent);
  ok(/traced|✓/.test(cov), `full-circle traced over the camera path: ${cov}`);
  const readout = await page.$eval('#lc-readout', (e) => e.textContent);
  ok(/az \d+° · reticle -?\d+° alt/.test(readout), `live numeric readout present: ${readout}`);
  await shot('livecapture.png');
  await page.click('.lc-controls .btn.primary:has-text("Save")');
  await page.waitForSelector('.hz-svg'); // lands back on the editor
  const max = await page.$eval('.hz-max', (e) => e.textContent);
  ok(/tallest 18°/.test(max), `live-captured treeline applied: ${max}`);
});

await step('targets: "Up tonight" narrows to the observable sky, then filters', async () => {
  await tab('Targets');
  await page.waitForSelector('.target-row');
  const all = await page.$$eval('.target-row', (e) => e.length);
  // The site (Smoke Yard, with the captured 18° south wall) is set → chip enabled.
  await page.click('.chip:has-text("Up tonight")');
  // Deferred compute paints "Checking…" then the result; wait for the count to settle.
  await page.waitForFunction(() => /up tonight|No matches/.test(document.querySelector('.count,.dead-end h2')?.textContent || ''), null, { timeout: 8000 });
  const cnt = await page.$eval('.count', (e) => e.textContent);
  ok(/up tonight/.test(cnt), `count reflects the filter: ${cnt}`);
  const upTonight = await page.$$eval('.target-row', (e) => e.length);
  ok(upTonight <= all, `up-tonight subset (${upTonight}) ≤ full (${all})`);
  await page.click('.chip:has-text("Up tonight")'); // toggle back off
  await page.waitForSelector('.target-row');
});

await step('targets: search the catalog and favourite M42', async () => {
  await page.fill('.search', 'orion nebula');
  await page.waitForSelector('.target-row'); // list repaints in place
  await page.click('.target-row .fav');
  ok(await page.$('.target-row .fav.on') !== null, 'favourite toggled on');
  ok(await page.$eval('.target-row .fav.on', (e) => e.getAttribute('aria-pressed')) === 'true', 'favourite aria-pressed tracks state in place');
});

await step('target details: a row thumbnail opens the details page and back returns', async () => {
  await page.waitForSelector('.target-row .target-thumb');
  // The thumbnail is the tap target → per-object details. (The survey image
  // itself needs network; here it degrades to a placeholder, tested below.)
  await page.click('.target-row .target-thumb');
  await page.waitForSelector('.td-facts');
  const facts = await page.$eval('.td-facts', (e) => e.textContent);
  ok(/RA/.test(facts) && /Dec/.test(facts), `coordinates render (RA/Dec): ${facts.replace(/\s+/g, ' ').slice(0, 60)}`);
  ok(await page.$('.td-image, .td-image.broken') !== null, 'representative image area present (image or offline placeholder)');
  ok(await page.$('.td-curve') !== null, 'tonight altitude curve renders');
  ok(await page.$('.td-cta .btn.block') !== null, 'prominent primary CTA present');

  // Framing overlay (v2.5.0): the active instrument's FOV rectangle draws over
  // the image (canvas is decorative), and the caption is the text channel.
  const cap = await page.$eval('.td-frame-cap', (e) => e.textContent);
  ok(/frame/.test(cap) && /fits in one frame|\d+×\d+ mosaic|frame wider/.test(cap), `framing caption: ${cap}`);
  ok(/Seestar S50/.test(cap), 'caption names the active instrument');
  if (!/frame wider/.test(cap)) {
    const painted = await page.evaluate(() => {
      const c = document.querySelector('.td-frame');
      if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
      return false;
    });
    ok(painted, 'framing overlay has painted pixels');
  }

  await page.click('.td-head .btn:has-text("Targets")');
  await page.waitForSelector('.target-row');
  ok(true, 'back to the Targets list');
});

await step('precache: favouriting warms the offline image cache; unfavouriting drains it', async () => {
  // Use a details page so both URLs (list 96px + detail 800px) warm. M42 is
  // already favourited (and warmed) by the earlier search step, so pick an
  // UNFAVOURITED row and assert cache-count DELTAS, not absolutes.
  // page.evaluate awaits promises (unlike waitForFunction — the NOTES gotcha),
  // so poll with a plain loop.
  await page.fill('.search', '');                    // clear the M42 search
  await page.waitForTimeout(150);                    // list repaints in place
  await page.click('.target-row:has(.fav:not(.on)) .target-thumb');
  await page.waitForSelector('.td-cta');
  const cacheCount = () => page.evaluate(async () =>
    (await (await caches.open('horizon-thumbs-v1')).keys()).length);
  const base = await cacheCount();
  const favBtn = '.td-cta .btn[aria-pressed]';
  ok(await page.$eval(favBtn, (e) => e.getAttribute('aria-pressed')) === 'false', 'picked an unfavourited object');
  await page.click(favBtn);                          // favourite → warm
  let n = base;
  for (let i = 0; i < 40 && n < base + 2; i++) { n = await cacheCount(); if (n < base + 2) await page.waitForTimeout(100); }
  ok(n === base + 2, `favourite warmed both cutouts into horizon-thumbs-v1 (${base} → ${n})`);
  await page.click(favBtn);                          // unfavourite → prune
  for (let i = 0; i < 40 && n > base; i++) { n = await cacheCount(); if (n > base) await page.waitForTimeout(100); }
  ok(n === base, `unfavourite pruned this object's entries (back to ${n})`);
  await page.click('.td-head .btn:has-text("Targets")');
  await page.waitForSelector('.target-row');
});

await step('keyboard: focus survives an in-view filter toggle (no jump to h1)', async () => {
  // Regression guard for WCAG 3.2.2: toggling a chip must not throw focus to the
  // view heading — rerender restores focus to the control by its accessible name.
  await page.focus('.chip:has-text("Galaxy")');
  await page.keyboard.press('Enter'); // toggles the category → nav.rerender()
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return { text: (a.textContent || '').trim(), cls: a.className, tag: a.tagName };
  });
  ok(/Galaxy/.test(focused.text) && /chip/.test(focused.cls), `focus stayed on the chip, not h1 (was ${focused.tag}.${focused.cls})`);
  await page.keyboard.press('Enter'); // toggle back off, focus should still hold
  ok(await page.evaluate(() => /chip/.test(document.activeElement.className)), 'focus holds across a second toggle');
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
  // This site has a measured 18° horizon → no "measure horizon" prompt, and the
  // curves are cut by it (blocked runs drawn grey).
  ok(!(await page.$('.ng-flat')), 'measured horizon → no flat-horizon prompt');
  // Keyboard time-scrub (WCAG 2.1.1): the graph is a focusable slider; arrows
  // move the cursor and the aria-valuetext (clock time) updates.
  await page.focus('.ng-wrap');
  const before = await page.$eval('.ng-wrap', (e) => e.getAttribute('aria-valuetext'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const after = await page.$eval('.ng-wrap', (e) => e.getAttribute('aria-valuetext'));
  ok(before !== after && /\d\d:\d\d/.test(after), `keyboard scrub advanced the time cursor (${before} → ${after})`);
  ok(/\d/.test(await page.$eval('.ng-readout', (e) => e.textContent)), 'readout shows values after keyboard scrub');
  const row = await page.$eval('.vis-row', (e) => e.textContent);
  ok(/up|never up/.test(row), `row shows a geometric window: ${row}`);
  const moon = await page.$('.vis-moon');
  if (moon) ok(/☾ \d+°/.test(await moon.textContent()), 'moon chip formats as ☾ N°');

  // Astro-weather block (v2.2.0): both mocked forecasts make it deterministic —
  // the block unhides, paints (clouds + seeing/transparency + darkness + ground
  // rows), and carries its text twins in the summary and the scrub readout.
  await page.waitForSelector('.ng-cloud:not([hidden])');
  const blockPainted = await page.evaluate(() => {
    const c = document.querySelector('.ng-cloud-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  });
  ok(blockPainted, 'astro-weather canvas has pixels');
  const sum = await page.$eval('.ng-cloud-sum', (e) => e.textContent);
  ok(/Astro weather tonight/.test(sum) && /clouds/.test(sum), `summary carries clouds: ${sum.slice(0, 70)}`);
  ok(/seeing \d\/8/.test(sum) && /7Timer/.test(sum), 'summary carries seeing + the 7Timer source');
  // The block is taller than the old 3-row strip: 9 rows incl. the temp digits.
  ok(await page.$eval('.ng-cloud-canvas', (e) => e.getBoundingClientRect().height) > 100, 'full block height (9 rows)');
  await page.focus('.ng-wrap');
  await page.keyboard.press('ArrowRight');
  const ro = await page.$eval('.ng-readout', (e) => e.textContent.replace(/\s+/g, ' '));
  ok(/clouds\s*\d+%/.test(ro), `readout: numeric clouds row (${ro.slice(0, 90)})`);
  ok(/seeing\s*\d\/8/.test(ro) && /transparency \d\/8/.test(ro), 'readout: seeing/transparency row');
  ok(/\d+°F/.test(ro) && /wind \d+ mph/.test(ro) && /RH \d+%/.test(ro), 'readout: ground row (°F, wind, RH)');
  await shot('tonight.png');
});

await step('sky (AR): "View in sky" opens #/sky; camera overlay, Moon in the list, keyboard scrub, flat toggle', async () => {
  // No real camera in headless — hand getUserMedia a canvas stream so the AR
  // overlay path (video + overlay canvas + draw loop) runs end to end.
  await page.evaluate(() => {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; return c.captureStream(1); };
  });
  await tab('Tonight');
  await page.waitForSelector('.ng-sky-hero');
  await page.click('.ng-sky-hero'); // the premier "View in sky" hero on Tonight
  await page.waitForFunction(() => location.hash.startsWith('#/sky'));
  await page.waitForSelector('.lc-stage');
  await page.waitForSelector('.lc-canvas'); // AR overlay canvas (not the flat fallback)
  ok(!(await page.$('.sky-flat')), 'camera path taken (AR overlay, not the flat chart)');

  // Before any compass fix, the on-camera "turn on compass" cue is visible over
  // the viewfinder (the on-device gap Noah hit).
  ok(await page.$eval('#sky-cta', (e) => !e.hidden), 'compass cue shown while pointing with no compass fix');

  // The Moon is always listed (Noah's requirement), with its phase; M42 was
  // favourited earlier, so a favourite target is listed too. The list is the
  // colour-independent, screen-reader channel.
  const listText = await page.$eval('.sky-list', (e) => e.textContent);
  ok(/Moon/.test(listText), `Moon appears in the sky list: ${listText.replace(/\s+/g, ' ').slice(0, 80)}`);
  ok((await page.$$('.sky-li')).length >= 1, 'at least one object row in the sky list');

  // Feed a synthetic Android orientation so the camera axis reads, then confirm
  // the live (silent, non-aria-live) az/alt readout formats — and the compass
  // cue dismisses now that the sky has locked on.
  await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 180, beta: 135, gamma: 0, absolute: true })));
  await page.waitForFunction(() => /pointing az \d+°/.test(document.querySelector('#sky-readout')?.textContent || ''));
  const readout = await page.$eval('#sky-readout', (e) => e.textContent);
  ok(/pointing az \d+° · alt -?\d+°/.test(readout), `live pointing readout present: ${readout}`);
  await page.waitForFunction(() => document.querySelector('#sky-cta')?.hidden === true);
  ok(await page.$eval('#sky-cta', (e) => e.hidden), 'compass cue hidden once the sky locks on');

  // Regression (v2.0.1): the iOS compass path must NOT flip azimuth when pitched
  // past ~45°. Anchor true north from a near-level reading, then feed a steeply
  // pitched event whose webkitCompassHeading has bogusly FLIPPED — azimuth holds.
  const iosEvt = (alpha, beta, heading) => page.evaluate(({ alpha, beta, heading }) => {
    const ev = new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma: 0 });
    Object.defineProperty(ev, 'webkitCompassHeading', { value: heading, configurable: true });
    window.dispatchEvent(ev);
  }, { alpha, beta, heading });
  const azOf = () => page.$eval('#sky-readout', (e) => { const m = (e.textContent || '').match(/az (\d+)°/); return m ? Number(m[1]) : null; });
  await iosEvt(180, 90, 72);   // near level → anchors north to compass heading 72°
  await page.waitForFunction(() => /· alt -?0°/.test(document.querySelector('#sky-readout')?.textContent || ''));
  const azLevel = await azOf();
  await iosEvt(180, 140, 250); // pitched ~50° up, compass now bogusly flipped to 250°
  await page.waitForFunction(() => /· alt 5\d°/.test(document.querySelector('#sky-readout')?.textContent || ''));
  const azPitched = await azOf();
  const flip = Math.min(Math.abs(azPitched - azLevel), 360 - Math.abs(azPitched - azLevel));
  ok(flip <= 5, `iOS azimuth holds through a steep pitch — no flip (level ${azLevel}° → pitched ${azPitched}°, Δ ${flip}°)`);

  // Hour scrubber is a native range with a keyboard path; arrow steps advance
  // the clock and its aria-valuetext.
  await page.focus('.sky-range');
  const t0 = await page.$eval('#sky-time', (e) => e.textContent);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const t1 = await page.$eval('#sky-time', (e) => e.textContent);
  const vt = await page.$eval('.sky-range', (e) => e.getAttribute('aria-valuetext'));
  ok(t0 !== t1 && /\d\d:\d\d/.test(t1), `keyboard scrub advanced the hour (${t0} → ${t1})`);
  ok(/\d\d:\d\d/.test(vt), `range announces a clock time, not raw minutes: ${vt}`);

  // Flat fallback toggle — the no-camera / desktop path renders the az/alt chart.
  await page.click('#sky-mode');
  await page.waitForSelector('.lc-stage.sky-flat');
  await page.waitForSelector('.sky-flatcanvas');
  const flatPainted = await page.evaluate(() => {
    const c = document.querySelector('.sky-flatcanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  });
  ok(flatPainted, 'flat az/alt sky chart has pixels');
  await shot('sky.png');
  await page.evaluate(() => { location.hash = '#/'; }); // leave → camera tears down
});

await step('settings: custom scope — live FOV preview, save, active, remove', async () => {
  await tab('Settings');
  await page.waitForSelector('.inst-card'); // hashchange renders async — wait, don't race
  ok(await page.$$eval('.inst-card', (e) => e.length) === 7, 'seven library presets to start (S50/S30/Dwarf II/Dwarf 3/Vespera/II/Pro)');
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
  await page.waitForSelector('.inst-card:nth-child(8)');
  ok(/Smoke Scope/.test(await page.$eval('.inst-card.active', (e) => e.textContent)), 'new scope is active');
  await page.click('.inst-card.active .btn.danger'); // confirm auto-accepted
  await page.waitForSelector('.inst-card:nth-child(8)', { state: 'detached' });
  ok(/Seestar S50/.test(await page.$eval('.inst-card.active', (e) => e.textContent)), 'falls back to the S50');

  // mm entry path (v2.4.0): a camera-lens style spec — sensor millimetres, no
  // pixel pitch — computes the FOV live (no ″/px, there's no pitch to scale).
  await page.click('.row-actions .btn:has-text("Add custom telescope")');
  await page.fill('dialog input[placeholder="250"]', '200');
  await page.fill('dialog input[placeholder="23.5"]', '11.1');
  await page.fill('dialog input[placeholder="15.6"]', '6.3');
  const mmPrev = await page.$eval('.fov-preview', (e) => e.textContent);
  ok(/FOV 3\.18° × 1\.80°/.test(mmPrev), `mm-path FOV computes: ${mmPrev}`);
  ok(!/″\/px/.test(mmPrev), 'no pixel scale claimed without a pixel pitch');
  await page.click('dialog .btn.ghost'); // cancel — nothing saved
  await page.waitForSelector('.loc-dialog', { state: 'detached' });
});

await step('polar align: aim card renders from the site, horizon-aware', async () => {
  await tab('Polar');
  await page.waitForSelector('.pa-card');
  const text = await page.$eval('#app', (e) => e.textContent);
  ok(/Polaris/.test(text), 'names the pole star for a northern site');
  ok(/Where to aim/.test(text), 'aim card present');
  await shot('polar.png');
});

await step('polar aim: hero opens #/polar/aim; guidance readout, then ON TARGET announces', async () => {
  // Same mocked camera as the sky step (re-set in case of an earlier reload).
  await page.evaluate(() => {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; return c.captureStream(1); };
  });
  await page.click('.ng-sky-hero'); // "Point to the pole" hero on the Polar tab
  await page.waitForFunction(() => location.hash.startsWith('#/polar/aim'));
  await page.waitForSelector('.lc-canvas');
  ok(!(await page.$('.lc-stage.lc-nocam')), 'camera path taken (not the numbers fallback)');
  ok(await page.$eval('#aim-cta', (e) => !e.hidden), 'compass cue shown before any compass fix');

  // Point well away from the pole (due south, 10° up) → directional guidance in
  // the silent readout, and the compass cue dismisses now that the axis reads.
  const dispatch = (alpha, beta) => page.evaluate(({ alpha, beta }) => window.dispatchEvent(
    new DeviceOrientationEvent('deviceorientationabsolute', { alpha, beta, gamma: 0, absolute: true })), { alpha, beta });
  await dispatch(180, 100);
  await page.waitForFunction(() => /pole: .*° (left|right) · .*° (up|down) · off by/.test(document.querySelector('#aim-readout')?.textContent || ''));
  ok(await page.$eval('#aim-cta', (e) => e.hidden), 'compass cue hidden once the axis reads');

  // Compute the lock-on orientation FROM THE PAGE (declination from the readout,
  // pole altitude from the explainer) — no hard-coded WMM values to go stale.
  // Camera model: heading = (360 − α) % 360, altitude = β − 90; true az =
  // magnetic az + declination, so α = declination aims at true north.
  const { decl, poleAlt } = await page.evaluate(() => {
    const m = (document.querySelector('#aim-readout')?.textContent || '').match(/\(([+-][\d.]+)° decl\)/);
    const a = (document.querySelector('.lc-controls')?.textContent || '').match(/latitude \(([\d.]+)°\)/);
    return { decl: m ? Number(m[1]) : null, poleAlt: a ? Number(a[1]) : null };
  });
  ok(decl != null && poleAlt != null, `page carries declination (${decl}) and pole altitude (${poleAlt})`);
  await dispatch(((decl % 360) + 360) % 360, 90 + poleAlt);
  await page.waitForFunction(() => /ON TARGET ✓/.test(document.querySelector('#aim-readout')?.textContent || ''));
  ok(/On target/.test(await page.$eval('#aim-hint', (e) => e.textContent)), 'lock announced via the role=status node (discrete, not per-frame)');
  await shot('polar-aim.png');
  await page.evaluate(() => { location.hash = '#/polar'; }); // leave → camera tears down
  await page.waitForSelector('.pa-dial');
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

await step('no view overflows the page width at phone size (iPhone 12/13/14)', async () => {
  // A single overflowing row (long visibility strings, an un-shrunk canvas)
  // makes mobile Safari load the whole app zoomed-in — reported on-device.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [label, hash] of [['Tonight', '#/'], ['Targets', '#/targets'],
    ['Horizon', '#/horizon'], ['Polar', '#/polar'], ['Sites', '#/sites'], ['Settings', '#/settings']]) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(120); // let the async view render settle
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1, `${label} overflows by ${over}px at 390px wide`);
  }
  // Capture views aren't in the tab loop. html{overflow-x:hidden} hides a real
  // overflow from scrollWidth, so probe actual element right-edges instead.
  await page.evaluate(() => {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    navigator.mediaDevices.getUserMedia = async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; return c.captureStream(1); };
  });
  const edgeOver = () => page.evaluate(() => {
    let max = 0;
    for (const el of document.querySelectorAll('#app, #app *')) {
      // Leaflet positions tiles/panes at world-coordinate offsets inside the
      // overflow-hidden map box — clipped by design, not a page overflow.
      if (el.closest('.leaflet-container') && !el.classList.contains('leaflet-container')) continue;
      max = Math.max(max, Math.ceil(el.getBoundingClientRect().right));
    }
    return max - window.innerWidth;
  });
  for (const [label, hash] of [['Capture', '#/capture'], ['Live capture', '#/capture/live'], ['Sky', '#/sky'], ['Polar aim', '#/polar/aim'], ['Terrain map', '#/horizon/map']]) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(200);
    const over = await edgeOver();
    ok(over <= 1, `${label} overflows by ${over}px at 390px wide`);
  }
  await page.evaluate(() => { location.hash = '#/'; });
  await page.setViewportSize({ width: 900, height: 900 });
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
