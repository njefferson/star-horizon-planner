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
  fovOf, pixelScale, mosaicFor, mosaicLayout, zenithDeadZone,
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

test('preset library: FOVs compute to the published optics', () => {
  // Spec-driven, computed — where a maker publishes a FOV it must agree.
  const expect = [
    ['dwarf2', 3.19, 1.79],        // 100 mm + IMX415 (3840×2160 @ 1.45 µm)
    ['dwarf3', 2.93, 1.65],        // 150 mm + IMX678 (3840×2160 @ 2.0 µm)
    ['vespera', 1.60, 0.90],       // 200 mm + IMX462 — same chip as the S50
    ['vespera2', 2.55, 1.44],      // 250 mm + IMX585; ~2.5°×1.4° published.
    //             ^ made to fail once with 1.60 (the original Vespera's width,
    //               which one review misattributes to the II) — it did.
    ['vespera-pro', 1.62, 1.62],   // 250 mm + IMX676 square sensor
  ];
  for (const [id, w, h] of expect) {
    const inst = instrumentById(id);
    assert.ok(inst, `preset ${id} exists`);
    const f = fovOf(inst);
    near(f.w_deg, w, 0.02, `${id} width`);
    near(f.h_deg, h, 0.02, `${id} height`);
  }
});

test('preset library: ids unique, every profile complete', () => {
  const all = allInstruments();
  assert.equal(new Set(all.map((p) => p.id)).size, all.length, 'no duplicate ids');
  for (const p of all) {
    const f = fovOf(p);
    assert.ok(Number.isFinite(f.w_deg) && f.w_deg > 0, `${p.id} FOV computes`);
    assert.ok(p.mount && typeof p.mount.altAz === 'boolean', `${p.id} has a mount profile`);
    assert.ok(p.name && p.focalLength_mm > 0, `${p.id} named + focal`);
  }
  // The square-sensor Pro frames square; the EQ flags follow the makers.
  const pro = fovOf(instrumentById('vespera-pro'));
  near(pro.w_deg, pro.h_deg, 1e-9, 'Vespera Pro is square');
  assert.equal(instrumentById('dwarf3').mount.eqCapable, true, 'Dwarf 3 has EQ mode');
  assert.equal(instrumentById('dwarf2').mount.eqCapable, false, 'Dwarf II does not');
});

test('mosaicLayout: centred panel grid at the overlap stride', () => {
  const fov = fovOf(S50);
  // A fit is one centred panel.
  const one = mosaicLayout(mosaicFor({ w_deg: 0.5, h_deg: 0.3 }, S50), fov);
  assert.deepEqual(one, [{ dx_deg: 0, dy_deg: 0 }]);
  // 2×1: two columns at ±stride/2, one centred row.
  const fr2 = mosaicFor({ w_deg: fov.w_deg * 1.5, h_deg: 0.3 }, S50);
  assert.equal(fr2.tier, 'mosaic 2×1');
  const two = mosaicLayout(fr2, fov);
  const strideW = fov.w_deg * (1 - fr2.overlap);
  assert.equal(two.length, 2);
  assert.ok(Math.abs(two[0].dx_deg + strideW / 2) < 1e-12 && Math.abs(two[1].dx_deg - strideW / 2) < 1e-12);
  assert.ok(two.every((p) => p.dy_deg === 0));
  // 3×2: symmetric about the centre; total extent spans (n−1) strides + one FOV.
  const fr6 = mosaicFor({ w_deg: fov.w_deg * 2.5, h_deg: fov.h_deg * 1.5 }, S50);
  assert.equal(fr6.panels, 6);
  const six = mosaicLayout(fr6, fov);
  const xs = six.map((p) => p.dx_deg), ys = six.map((p) => p.dy_deg);
  assert.ok(Math.abs(Math.max(...xs) + Math.min(...xs)) < 1e-12, 'x-symmetric');
  assert.ok(Math.abs(Math.max(...ys) + Math.min(...ys)) < 1e-12, 'y-symmetric');
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - 2 * strideW) < 1e-12, '3 cols span 2 strides');
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
