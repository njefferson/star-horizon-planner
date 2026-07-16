// Headless unit tests for model/horizon.js. Run: `node --test`.
// The wrap-around-north interpolation and the Stellarium round-trip are the
// bits most likely to bite, so they're checked hardest.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const {
  makeHorizon, STEP, N, azForIndex, indexForAz, setAltitudeAt,
  sampleAt, isAbove, maxAltitude, isFlat,
  toStellarium, fromStellarium, loadHorizon, saveHorizon,
} = await import('../src/model/horizon.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('a fresh profile is 36 rows, flat, at 10° spacing', () => {
  const h = makeHorizon();
  assert.equal(N, 36);
  assert.equal(STEP, 10);
  assert.equal(h.altitudes.length, 36);
  assert.ok(isFlat(h));
  assert.equal(azForIndex(0), 0);
  assert.equal(azForIndex(9), 90);
  assert.equal(indexForAz(94), 9);   // nearest row
  assert.equal(indexForAz(95), 10);
});

test('makeHorizon clamps altitudes into [0,90]', () => {
  const h = makeHorizon(Array(36).fill(0).map((_, i) => (i === 0 ? 200 : i === 1 ? -5 : 0)));
  assert.equal(h.altitudes[0], 90);
  assert.equal(h.altitudes[1], 0);
});

test('sampleAt returns exact rows and interpolates between them', () => {
  const h = makeHorizon();
  setAltitudeAt(h, 9, 20);   // az 90 → 20°
  setAltitudeAt(h, 10, 30);  // az 100 → 30°
  assert.equal(sampleAt(h, 90), 20);
  assert.equal(sampleAt(h, 100), 30);
  near(sampleAt(h, 95), 25, 1e-9, 'midpoint');
  near(sampleAt(h, 92), 22, 1e-9, 'weighted');
});

test('sampleAt wraps cleanly across the 350°→0° seam (north)', () => {
  const h = makeHorizon();
  setAltitudeAt(h, 35, 10);  // az 350 → 10°
  setAltitudeAt(h, 0, 20);   // az 0/360 → 20°
  near(sampleAt(h, 355), 15, 1e-9, 'halfway across the seam');
  near(sampleAt(h, 359), 19, 1e-9, 'near 360');
  assert.equal(sampleAt(h, 360), 20); // 360 normalises to 0
});

test('isAbove is the above-my-horizon primitive, with an optional margin', () => {
  const h = makeHorizon();
  setAltitudeAt(h, 9, 20); // treeline 20° due east
  assert.equal(isAbove(h, 90, 25), true);
  assert.equal(isAbove(h, 90, 15), false);
  assert.equal(isAbove(h, 90, 21, 5), false); // needs to clear by 5°
  assert.equal(isAbove(h, 90, 26, 5), true);
});

test('maxAltitude reports the tallest obstruction', () => {
  const h = makeHorizon();
  setAltitudeAt(h, 3, 12); setAltitudeAt(h, 20, 41);
  assert.equal(maxAltitude(h), 41);
});

test('Stellarium round-trip reproduces the grid exactly', () => {
  const src = makeHorizon(Array.from({ length: 36 }, (_, i) => (i % 5) * 4 + (i % 3)));
  const back = fromStellarium(toStellarium(src));
  for (let i = 0; i < 36; i++) near(back.altitudes[i], src.altitudes[i], 0.01, `row ${i}`);
});

test('fromStellarium resamples a coarse (cardinal-only) file onto 36 rows', () => {
  // Only the four cardinals given; the rows between must interpolate.
  const text = '0 10\n90 30\n180 10\n270 30\n';
  const h = fromStellarium(text);
  assert.equal(sampleAt(h, 0), 10);
  assert.equal(sampleAt(h, 90), 30);
  near(sampleAt(h, 45), 20, 1e-6, 'N→E midpoint interpolates');
  near(sampleAt(h, 135), 20, 1e-6, 'E→S midpoint');
});

test('fromStellarium ignores comments/blanks and rejects an empty file', () => {
  const h = fromStellarium('# comment\n\n  120   15 \n');
  assert.equal(sampleAt(h, 120), 15);
  assert.throws(() => fromStellarium('# only comments\n\n'), /no azimuth/);
});

test('persistence round-trips through localStorage', () => {
  localStorage.clear();
  const h = makeHorizon();
  setAltitudeAt(h, 12, 33);
  saveHorizon(h);
  const loaded = loadHorizon();
  assert.equal(loaded.altitudes[12], 33);
  assert.ok(isFlat(loadHorizonFresh())); // a cleared store loads flat
  function loadHorizonFresh() { localStorage.clear(); return loadHorizon(); }
});
