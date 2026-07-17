// Headless unit tests for model/night.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const { makeObserver } = await import('../src/model/astro.js');
const { nightWindow, sampleTwilight, darkestAltitude } = await import('../src/model/night.js');

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

// (The legacy single-location store was absorbed by sites.js in v1.1; its
// clamp/wrap behaviour lives on in sites.test.mjs.)
