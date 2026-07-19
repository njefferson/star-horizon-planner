#!/usr/bin/env node
// =============================================================================
// a11y-scan.mjs — drive every view in headless Chromium, inject axe-core, and
// fail on any WCAG 2.2 A/AA violation. The automated backstop for the
// accessibility standing order; runs in the release ritual (needs a browser,
// like test:ui) alongside the contrast gate that runs in CI.
//
// Run:  npm run test:a11y
// Needs `npm i --no-save playwright-core axe-core` once. Exits 0 with a SKIP
// when either is missing or Chromium is absent, so plain `npm test` is
// unaffected. A known, justified violation can be parked in
// scripts/a11y-allowlist.json ({ "<rule-id>": "why it's acceptable" }) — every
// entry needs a written reason, and the scan prints what it skipped.
// =============================================================================
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('SKIP a11y-scan: playwright-core not installed.'); process.exit(0); }
let AXE;
try { AXE = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8'); }
catch { console.log('SKIP a11y-scan: axe-core not installed (npm i --no-save axe-core).'); process.exit(0); }
try { await access(CHROMIUM); }
catch { console.log(`SKIP a11y-scan: no Chromium at ${CHROMIUM}.`); process.exit(0); }

let allow = {};
try { allow = JSON.parse(readFileSync(join(ROOT, 'scripts/a11y-allowlist.json'), 'utf8')); } catch { /* none */ }

// --- static server (correct MIME types for ES modules) ----------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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

// A seeded site (with a jagged measured horizon) + two favourites that exist in
// the bundled catalog, so every view has real content to audit.
const SEED = {
  'horizon.sites': JSON.stringify([{
    id: 'site-a11y', name: 'Audit Yard', lat: 37.5, lon: -122, elevation_m: 0,
    horizon: Array.from({ length: 36 }, (_, i) => [i * 10, i % 3 === 0 ? 18 : 6]),
  }]),
  'horizon.activeSite': 'site-a11y',
  'horizon.favorites': JSON.stringify(['NGC1952', 'NGC0224']),
};

const VIEWS = [
  ['Tonight', '#/'], ['Targets', '#/targets'], ['Horizon', '#/horizon'], ['Terrain map', '#/horizon/map'],
  ['Polar', '#/polar'], ['Polar aim', '#/polar/aim'], ['Sites', '#/sites'], ['Settings', '#/settings'], ['Capture', '#/capture'],
  ['Live capture', '#/capture/live'], ['Sky', '#/sky'], ['Target detail', '#/target/NGC1952'],
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const browser = await chromium.launch({ executablePath: CHROMIUM });
const violations = [];
let scanned = 0;

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript((seed) => {
    for (const [k, v] of Object.entries(seed.store)) localStorage.setItem(k, v);
    localStorage.setItem('horizon.theme', seed.theme);
  }, { store: SEED, theme });
  await ctx.route(/fonts\.g(oogleapis|static)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);

  async function runAxe(label) {
    await page.evaluate(AXE);
    const res = await page.evaluate((tags) => window.axe.run(document, {
      runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'],
    }), TAGS);
    scanned++;
    for (const v of res.violations) {
      if (allow[v.id]) continue;
      violations.push({ theme, label, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') });
    }
  }

  for (const [label, hash] of VIEWS) {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
    // Wait for the async views to paint real content, not the "Loading…" stub.
    await page.waitForFunction(() => {
      const a = document.getElementById('app');
      return a && !/^\s*(Loading|Checking)/.test(a.textContent || '') && a.children.length > 0;
    }).catch(() => {});
    await page.waitForTimeout(150);
    await runAxe(label);
  }

  // Modal dialogs are a classic automated-audit blind spot — axe on the initial
  // DOM never reaches them. Open each and scan its contents + labelling.
  const DIALOGS = [
    ['About dialog', '#/', '#about-btn', '.about-dialog'],
    ['Add-site dialog', '#/sites', '.row-actions .btn.primary', '.loc-dialog'],
    ['Import-backup dialog', '#/sites', '.btn:has-text("Import backup")', '.loc-dialog'],
    ['Custom-scope dialog', '#/settings', '.btn:has-text("Add custom telescope")', '.loc-dialog'],
    ['Import-horizon dialog', '#/horizon', '.hz-actions .btn:has-text("Import")', '.hz-dialog'],
  ];
  for (const [label, hash, opener, dialog] of DIALOGS) {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(opener).catch(() => {});
    await page.click(opener).catch(() => {});
    if (await page.$(dialog)) {
      await page.waitForTimeout(100);
      await runAxe(label);
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      console.error(`a11y-scan: could not open ${label} (${opener})`);
      process.exitCode = 1;
    }
  }

  // The What's-new popup isn't opened by a button — it auto-shows to a
  // returning user on a build with unseen notes. Simulate that and scan it.
  await page.goto(BASE + '#/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('horizon.welcomed', '1'); localStorage.removeItem('horizon.whatsNewSeen'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await page.waitForSelector('.whatsnew-dialog', { timeout: 4000 }).catch(() => null)) {
    await page.waitForTimeout(100);
    await runAxe("What's-new dialog");
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    console.error("a11y-scan: could not open What's-new dialog");
    process.exitCode = 1;
  }
  await ctx.close();
}
await browser.close();
server.close();

const skipped = Object.keys(allow);
if (skipped.length) console.log(`allowlisted (with justification): ${skipped.join(', ')}`);
if (violations.length) {
  console.error(`\naxe: ${violations.length} violation(s) across ${scanned} view scans:`);
  for (const v of violations) {
    console.error(`  [${v.impact}] ${v.theme}/${v.label}: ${v.id} — ${v.help} (${v.nodes}×, e.g. ${v.sample})`);
  }
  process.exit(1);
}
console.log(`\naxe: 0 violations across ${scanned} scans (12 views + 6 dialogs × 2 themes), WCAG 2.2 A/AA.`);
