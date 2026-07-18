#!/usr/bin/env node
// =============================================================================
// check-contrast.mjs — compute WCAG 2.1 contrast for the colour pairs the app
// actually renders, in BOTH themes, and fail (exit 1) if any is below its
// target. The accessibility standing order says colour is decided by
// computation, not by eye — this script is that computation, and it runs in CI.
//
// Thresholds: 4.5:1 for normal text, 3:1 for large text (≥18px, or ≥14px bold)
// and for non-text UI (graph lines, axis, focus rings). Add every new colour
// pair here rather than waving it past.
//
// Pure Node, no deps. Parses the token blocks from src/styles.css and the graph
// constants from src/ui/nightgraph.js so the script can't drift from the CSS.
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(ROOT + 'src/styles.css', 'utf8');
const ng = readFileSync(ROOT + 'src/ui/nightgraph.js', 'utf8');
const marks = readFileSync(ROOT + 'src/ui/marks.js', 'utf8'); // shared series palette + casing

// --- parse -------------------------------------------------------------------
function tokenBlock(selector) {
  // Grab `selector { ... }` and pull every `--name: value;`.
  const re = new RegExp(`${selector.replace(/[.[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const body = (css.match(re) || [])[1] || '';
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokenBlock(':root');
const dark = { ...light, ...tokenBlock('[data-theme="dark"]') }; // dark overrides light

// Categorical palette + casing now live in the shared ui/marks.js (used by both
// the night graph and the AR sky view); axis/moon-path stay graph-local.
const SERIES = JSON.parse((marks.match(/export const SERIES = (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
const CASE = (marks.match(/export const CASE = '([^']+)'/) || [])[1]; // dark casing under every curve pixel
const NIGHT = '#0d1018';           // darkest twilight band / ng-wrap background
const AXIS = (ng.match(/AXIS = '([^']+)'/) || [])[1];
const MOON = (ng.match(/MOON = '([^']+)'/) || [])[1];

// --- WCAG contrast ------------------------------------------------------------
function toRGB(c) {
  c = c.trim();
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const n = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  throw new Error(`cannot parse colour: ${c}`);
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => { const [r, g, b] = toRGB(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
function ratio(a, b) { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
// Opaque approximation of `color-mix(in srgb, a t%, b)` — for badge tints.
function mix(a, b, t) { const A = toRGB(a), B = toRGB(b); return `#${[0, 1, 2].map((i) => Math.round(A[i] * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`; }

// --- pair list ---------------------------------------------------------------
// Each: [label, foreground, background, minRatio]. `t(name)` resolves a token
// in the current theme. Small text → 4.5, large/UI → 3.
const AA = 4.5, UI = 3;
function pairs(t, mode) {
  const p = [
    ['body text (ink/bg)', t('ink'), t('bg'), AA],
    ['card text (ink/card)', t('ink'), t('card'), AA],
    ['link text (a) on card', t('accent-ink'), t('card'), AA],
    ['inline link (.linklike) on bg', t('accent-ink'), t('bg'), AA],
    ['dim small text on bg2', t('dim'), t('bg2'), AA],
    ['dim small text on card', t('dim'), t('card'), AA],
    ['accent-ink on accent-wash (badges)', t('accent-ink'), t('accent-wash'), AA],
    ['sky notice text on accent-wash', t('ink'), t('accent-wash'), AA],
    ['primary button ink on accent', '#12131c', t('accent'), AA],
    ['tab label on dock', t('tab-ink'), t('dock'), AA],
    ['active tab on dock', t('tab-ink-active'), t('dock'), AA],
    ['danger text on card', t('danger'), t('card'), AA],
    // Tinted status pills: the text sits on a wash of ITS OWN hue, darker than
    // plain card — these are what axe flags if the token is too light.
    ['warn pill text on warn tint', t('warn'), mix(t('warn'), t('card'), 0.14), AA],
    ['polar "clear" title on slate-wash', t('slate'), t('slate-wash'), AA],
    // "fits" tier badge: --park text on a 16%-green tinted card.
    ['fits-tier text on green tint', t('park'), mix('#5fae79', t('card'), 0.16), AA],
    // Graph (fixed palette, both themes) — lines/axis are non-text UI (3:1).
    // Every curve pixel is drawn over the dark CASE casing (not the twilight
    // band it visually crosses), so the series are checked against the casing.
    ['graph axis labels on night band', AXIS, NIGHT, UI],
    ['moon path on night band', MOON, NIGHT, UI],
    ...SERIES.map((c, i) => [`series ${i + 1} on curve casing`, c, CASE, UI]),
  ];
  return p.map(([label, fg, bg, min]) => {
    const r = ratio(fg, bg);
    return { mode, label, fg, bg, min, r, pass: r >= min };
  });
}

const results = [...pairs((n) => light[n], 'light'), ...pairs((n) => dark[n], 'dark')];
const fails = results.filter((x) => !x.pass);

for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${r.mode.padEnd(5)} ${r.label.padEnd(38)} ${r.r.toFixed(2)}:1 (min ${r.min})  ${r.fg} on ${r.bg}`);
}
if (fails.length) {
  console.error(`\ncontrast: ${fails.length} pair(s) below target — fix the token(s) or raise the surface.`);
  process.exit(1);
}
console.log(`\ncontrast: all ${results.length} pairs pass (light + dark).`);
