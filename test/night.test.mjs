// Headless unit tests for model/night.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const { makeObserver } = await import('../src/model/astro.js');
const { nightWindow, sampleTwilight, darkestAltitude, darkWindow, darknessLevel } = await import('../src/model/night.js');

const obs = makeObserver(37.5, -122.0, 0);
const DATE = new Date('2026-03-20T12:00:00Z');

test('nightWindow spans dusk→dawn, ordered, non-polar at mid-latitude', () => {
  const w = nightWindow(obs, DATE);
  assert.equal(w.polar, false);
  assert.ok(w.sunset && w.sunrise, 'has sunset and sunrise');
  assert.ok(w.start.getTime() < w.sunset.getTime(), 'starts before sunset');
  assert.ok(w.sunset.getTime() < w.sunrise.getTime(), 'sunset before sunrise');
  assert.ok(w.sunrise.getTime() < w.end.getTime(), 'ends after sunrise');
});

test('sampleTwilight covers the window with valid bands and a dark middle', () => {
  const w = nightWindow(obs, DATE);
  const s = sampleTwilight(obs, w.start, w.end, 10);
  const BANDS = new Set(['day', 'civil', 'nautical', 'astronomical', 'night']);
  assert.ok(s.every((x) => BANDS.has(x.band)), 'all bands valid');
  assert.ok(s.some((x) => x.band === 'night'), 'reaches astronomical darkness');
  // The middle sample is darker than either edge (the Sun is lowest mid-night).
  const mid = s[Math.floor(s.length / 2)].alt;
  assert.ok(mid < s[0].alt && mid < s[s.length - 1].alt, 'middle is darkest');
});

test('darkestAltitude is well below the astronomical limit here', () => {
  const w = nightWindow(obs, DATE);
  const s = sampleTwilight(obs, w.start, w.end, 10);
  assert.ok(darkestAltitude(s) < -18, 'true darkness');
});

test('nightWindow falls back to a fixed polar-day window', () => {
  const arctic = makeObserver(78, 15, 0);              // Svalbard
  const w = nightWindow(arctic, new Date('2026-06-21T12:00:00Z')); // sun never sets
  assert.equal(w.polar, true);
  assert.equal(w.sunset, null);
  assert.ok(w.start.getTime() < w.end.getTime());
});

test('darkWindow returns an astronomically-dark span inside the night window', () => {
  const w = nightWindow(obs, DATE);
  const d = darkWindow(obs, DATE);
  assert.equal(d.dark, true);
  assert.ok(d.start.getTime() >= w.start.getTime() && d.end.getTime() <= w.end.getTime(), 'inside the plot window');
  assert.ok(d.start.getTime() < d.end.getTime(), 'ordered');
  // The dark span is strictly shorter than dusk→dawn (twilight trimmed off).
  assert.ok((d.end - d.start) < (w.end - w.start));
});

test('darkWindow falls back (dark:false) under the polar-day sun', () => {
  const arctic = makeObserver(78, 15, 0);
  const d = darkWindow(arctic, new Date('2026-06-21T12:00:00Z'));
  assert.equal(d.dark, false, 'never reaches nautical darkness');
  assert.ok(d.start.getTime() < d.end.getTime());
});

test('darknessLevel: sun ladder, moonlight term, clamps', () => {
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
  assert.equal(darknessLevel(10, -20, 0.5), 1, 'daylight is 1 regardless of moon');
  assert.equal(darknessLevel(0, -20, 0), 1, 'sunset instant still 1');
  near(darknessLevel(-9, -20, 0), 0.5, 1e-9, 'mid-twilight (−9°) is halfway');
  assert.equal(darknessLevel(-18, -20, 0.99), 0, 'moonless astro night is 0 (moon below horizon)');
  near(darknessLevel(-18, 40, 1), 0.35, 1e-9, 'full moon high up caps the moon term');
  near(darknessLevel(-18, 10, 1), 0.35 * 0.5, 1e-9, 'low moon fades in over first 20°');
  near(darknessLevel(-18, 40, 0.5), 0.175, 1e-9, 'half-lit moon is half the term');
  assert.equal(darknessLevel(-2, 40, 1), 1, 'twilight + full moon clamps at 1');
});

// (The legacy single-location store was absorbed by sites.js in v1.1; its
// clamp/wrap behaviour lives on in sites.test.mjs.)
