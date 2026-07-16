// Headless unit tests for model/visibility.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const { makeObserver } = await import('../src/model/astro.js');
const { makeHorizon } = await import('../src/model/horizon.js');
const { instrumentById } = await import('../src/model/instruments.js');
const { visibility, totalMinutes } = await import('../src/model/visibility.js');

const obs = makeObserver(40, 0, 0);
const S50 = instrumentById('s50'); // zenith dead-zone 85°
const START = new Date('2026-09-22T00:00:00Z');
const END = new Date(START.getTime() + 24 * 3600000);
const win = { start: START, end: END };

const midDec = { ra: 12.0, dec: 10 };   // transits at ~60°, well clear of zenith
const zenithTgt = { ra: 12.0, dec: 40 }; // dec == lat → transits through the zenith

test('flat horizon, no instrument: effective equals geometric', () => {
  const v = visibility(midDec, obs, null, { ...win });
  assert.equal(v.deadZone, 0);
  assert.equal(v.effective.length, v.geometric.length);
  assert.equal(totalMinutes(v.effective), totalMinutes(v.geometric));
  assert.ok(v.geometric.length >= 1 && totalMinutes(v.geometric) > 0);
});

test('transit altitude ≈ 90 − |lat − dec|', () => {
  const v = visibility(midDec, obs, null, { ...win });
  assert.ok(v.transit);
  assert.ok(Math.abs(v.transit.altitude - 60) < 0.5, `transit ${v.transit.altitude}`);
});

test('a raised treeline shortens the effective window', () => {
  const trees = makeHorizon(Array(36).fill(20)); // 20° wall all around
  const v = visibility(midDec, obs, trees, { ...win });
  assert.ok(totalMinutes(v.effective) > 0, 'still visible above 20°');
  assert.ok(totalMinutes(v.effective) < totalMinutes(v.geometric), 'effective < geometric');
  // Effective can't begin before geometric (you must be up first).
  assert.ok(v.effective[0].start.getTime() > v.geometric[0].start.getTime());
});

test('the zenith dead-zone splits a through-the-zenith target in two', () => {
  const v = visibility(zenithTgt, obs, null, { ...win, instrument: S50 });
  assert.equal(v.deadZone, 85);
  assert.equal(v.clipsDeadZone, true, 'rises into the dead-zone');
  assert.equal(v.geometric.length, 1, 'geometrically one long pass');
  assert.equal(v.effective.length, 2, 'split around the zenith exclusion');
  assert.ok(totalMinutes(v.effective) < totalMinutes(v.geometric));
});

test('EQ mode relaxes the dead-zone (no split)', () => {
  const v = visibility(zenithTgt, obs, null, { ...win, instrument: S50, eqMode: true });
  assert.equal(v.deadZone, 0);
  assert.equal(v.clipsDeadZone, false);
  assert.equal(v.effective.length, 1, 'continuous once the dead-zone is relaxed');
});

test('interval edges stay within the requested window', () => {
  const v = visibility(midDec, obs, null, { ...win });
  for (const iv of [...v.geometric, ...v.effective]) {
    assert.ok(iv.start.getTime() >= START.getTime() && iv.end.getTime() <= END.getTime());
    assert.ok(iv.end.getTime() > iv.start.getTime());
  }
});
