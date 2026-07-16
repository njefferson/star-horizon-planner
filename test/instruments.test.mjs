// Headless unit tests for model/instruments.js. Run: `node --test`.
//
// FOV is checked against the real optics (S50: 250 mm + IMX462 → ~1.28°×0.72°;
// S30: 150 mm → ~2.13°×1.20°), and the mosaic math against the geometric truth
// that a wider scope tiles a big object in fewer panels.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage shim so the persistence paths are exercisable in Node.
globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

const {
  fovOf, pixelScale, mosaicFor, zenithDeadZone,
  activeInstrument, setActiveInstrument, instrumentById, allInstruments,
  addCustomInstrument, removeCustomInstrument, makeCustomInstrument,
} = await import('../src/model/instruments.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const S50 = instrumentById('s50');
const S30 = instrumentById('s30');

test('FOV computes from focal length + sensor, not a constant', () => {
  const f50 = fovOf(S50);
  near(f50.w_deg, 1.276, 0.02, 'S50 width');
  near(f50.h_deg, 0.718, 0.02, 'S50 height');
  const f30 = fovOf(S30);
  near(f30.w_deg, 2.126, 0.03, 'S30 width');
  near(f30.h_deg, 1.196, 0.03, 'S30 height');
  assert.ok(f30.w_deg > f50.w_deg, 'S30 frames wider than S50');
});

test('fovOf honours an explicit override', () => {
  const custom = { focalLength_mm: 999, sensor: { w_mm: 1, h_mm: 1 }, fov: { w_deg: 3.3, h_deg: 2.2 } };
  const f = fovOf(custom);
  assert.equal(f.w_deg, 3.3);
  assert.equal(f.h_deg, 2.2);
});

test('pixel scale matches 206.265·pitch/focal', () => {
  near(pixelScale(S50), 2.393, 0.01, 'S50 arcsec/px');
  near(pixelScale(S30), 3.988, 0.01, 'S30 arcsec/px');
});

test('a small object fits in one frame on the S50', () => {
  const m57 = { w_deg: 1.4 / 60, h_deg: 1.0 / 60 }; // Ring Nebula ~1.4′×1′
  const m = mosaicFor(m57, S50);
  assert.equal(m.fits, true);
  assert.equal(m.panels, 1);
  assert.equal(m.tier, 'fits');
});

test('a big object needs a mosaic, and the wider scope needs fewer panels', () => {
  const m31 = { w_deg: 190 / 60, h_deg: 60 / 60 }; // Andromeda ~3.17°×1.0°
  const on50 = mosaicFor(m31, S50);
  const on30 = mosaicFor(m31, S30);
  assert.equal(on50.fits, false);
  assert.equal(on50.tier, 'mosaic 3×2');
  assert.equal(on50.panels, 6);
  assert.ok(on30.panels < on50.panels, `S30 (${on30.panels}) tiles Andromeda in fewer panels than S50 (${on50.panels})`);
  assert.equal(on30.tier, 'mosaic 2×1');
});

test('an object exactly one FOV across still fits (1×1)', () => {
  const fov = fovOf(S50);
  const m = mosaicFor({ w_deg: fov.w_deg, h_deg: fov.h_deg }, S50);
  assert.equal(m.fits, true);
});

test('zenith dead-zone reads the mount trait', () => {
  assert.equal(zenithDeadZone(S50), 85);
  assert.equal(zenithDeadZone({ mount: {} }), 0);
  assert.equal(zenithDeadZone({}), 0);
});

test('active instrument defaults to the S50 and switches by id', () => {
  localStorage.clear();
  assert.equal(activeInstrument().id, 's50');           // default
  assert.equal(setActiveInstrument('s30'), true);
  assert.equal(activeInstrument().id, 's30');
  assert.equal(setActiveInstrument('nope'), false);     // unknown id ignored
  assert.equal(activeInstrument().id, 's30');
});

test('custom instruments register, activate, compute FOV, and remove', () => {
  localStorage.clear();
  const prof = makeCustomInstrument({
    name: 'RedCat 51', focalLength_mm: 250, sensor: { w_mm: 23.5, h_mm: 15.7 },
  });
  addCustomInstrument(prof);
  assert.ok(allInstruments().some((p) => p.id === prof.id), 'shows in registry');
  assert.equal(setActiveInstrument(prof.id), true);
  const f = fovOf(activeInstrument());
  near(f.w_deg, 5.38, 0.1, 'custom width from 23.5mm @250mm'); // 2·atan(23.5/500)
  removeCustomInstrument(prof.id);
  assert.ok(!allInstruments().some((p) => p.id === prof.id), 'removed');
  assert.equal(activeInstrument().id, 's50', 'falls back to default after removing the active custom');
});
