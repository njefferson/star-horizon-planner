// Headless unit tests for model/polar.js (and astro.starHourAngle).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const { makeObserver, starHourAngle } = await import('../src/model/astro.js');
const { polarAlignment, poleAimFor, poleStarFor, POLARIS, SIGMA_OCTANTIS } = await import('../src/model/polar.js');

const NORTH = { lat: 37.5, lon: -122.0, horizon: null };   // mid-northern site
const SOUTH = { lat: -33.9, lon: 151.2, horizon: null };   // Sydney-ish
const DATE = new Date('2026-07-17T10:00:00Z');

// Scan a full sidereal-ish day for the samples nearest upper/lower transit.
function scanDay(site) {
  let upper = null, lower = null;
  const t0 = new Date('2026-07-17T00:00:00Z').getTime();
  for (let min = 0; min <= 24 * 60; min += 2) {
    const p = polarAlignment(site, new Date(t0 + min * 60000));
    const dUp = Math.min(p.hourAngle, 24 - p.hourAngle);   // distance to HA 0 (upper)
    const dLo = Math.abs(p.hourAngle - 12);                 // distance to HA 12 (lower)
    if (!upper || dUp < upper.d) upper = { d: dUp, p };
    if (!lower || dLo < lower.d) lower = { d: dLo, p };
  }
  return { upper: upper.p, lower: lower.p };
}

test('poleAimFor: pole altitude = |lat|, azimuth N above equator / S below', () => {
  assert.deepEqual(poleAimFor(37.5), { altitude: 37.5, azimuth: 0, hemisphere: 'north' });
  assert.deepEqual(poleAimFor(-33.9), { altitude: 33.9, azimuth: 180, hemisphere: 'south' });
  assert.equal(poleAimFor(0).altitude, 0);          // pole on the horizon at the equator
});

test('poleStarFor picks Polaris north, σ Octantis south', () => {
  assert.equal(poleStarFor(45), POLARIS);
  assert.equal(poleStarFor(-45), SIGMA_OCTANTIS);
});

test('northern alignment: Polaris, pole due north at altitude=lat', () => {
  const p = polarAlignment(NORTH, DATE);
  assert.equal(p.hemisphere, 'north');
  assert.equal(p.star.name, 'Polaris');
  assert.equal(p.pole.azimuth, 0);
  assert.equal(p.pole.altitude, 37.5);
});

test('southern alignment: σ Octantis, pole due south', () => {
  const p = polarAlignment(SOUTH, DATE);
  assert.equal(p.hemisphere, 'south');
  assert.equal(p.star.designation, 'σ Oct');
  assert.equal(p.pole.azimuth, 180);
  assert.equal(p.pole.altitude, 33.9);
});

test('pole-star separation from the pole is the sub-degree modern value', () => {
  // Polaris ≈ 0.6–0.7° from the NCP this epoch; σ Oct ≈ 1.0–1.1° from the SCP.
  const n = polarAlignment(NORTH, DATE);
  assert.ok(n.separationDeg > 0.5 && n.separationDeg < 0.75, `Polaris sep ${n.separationDeg}`);
  assert.ok(Math.abs(n.separationArcmin - n.separationDeg * 60) < 1e-9);
  const s = polarAlignment(SOUTH, DATE);
  assert.ok(s.separationDeg > 0.8 && s.separationDeg < 1.3, `σ Oct sep ${s.separationDeg}`);
});

test('the pole star orbits within one separation of the pole altitude', () => {
  // At any instant the star sits within `separation` of the pole (+ a little
  // refraction near the horizon). Invariant across the whole day.
  const t0 = new Date('2026-07-17T00:00:00Z').getTime();
  for (let h = 0; h < 24; h++) {
    const p = polarAlignment(NORTH, new Date(t0 + h * 3600000));
    assert.ok(Math.abs(p.star.altitude - p.pole.altitude) <= p.separationDeg + 0.1,
      `hour ${h}: star ${p.star.altitude} vs pole ${p.pole.altitude}`);
    assert.ok(Math.abs(p.star.azimuth) < 2 || Math.abs(p.star.azimuth - 360) < 2, `Polaris near due north, az ${p.star.azimuth}`);
  }
});

test('reticle reads 12 o’clock above the pole at upper transit, 6 below at lower', () => {
  const { upper, lower } = scanDay(NORTH);
  assert.equal(upper.reticle.clockHour, 12);                 // star above the pole
  assert.ok(upper.star.altitude > upper.pole.altitude, 'above pole at upper transit');
  assert.equal(lower.reticle.clockHour, 6);                  // star below the pole
  assert.ok(lower.star.altitude < lower.pole.altitude, 'below pole at lower transit');
});

test('reticle clock is always a valid clock face', () => {
  const t0 = new Date('2026-07-17T00:00:00Z').getTime();
  for (let min = 0; min < 24 * 60; min += 37) {
    const r = polarAlignment(NORTH, new Date(t0 + min * 60000)).reticle;
    assert.ok(r.clockAngleDeg >= 0 && r.clockAngleDeg < 360);
    assert.ok(r.clockHour >= 1 && r.clockHour <= 12 && Number.isInteger(r.clockHour));
  }
});

test('north and south skies rotate opposite ways around the pole', () => {
  // As time advances the reticle angle decreases in the north (the sky turns
  // counter-clockwise about the NCP) and increases in the south. Signed step,
  // unwrapped to (−180,180], over a 20-minute advance.
  const signedStep = (site, ms) => {
    const a = polarAlignment(site, new Date(ms)).reticle.clockAngleDeg;
    const b = polarAlignment(site, new Date(ms + 20 * 60000)).reticle.clockAngleDeg;
    return ((b - a + 540) % 360) - 180;
  };
  const ms = new Date('2026-07-17T06:00:00Z').getTime();
  assert.ok(signedStep(NORTH, ms) < -0.5, 'north reticle turns counter-clockwise (angle decreases)');
  assert.ok(signedStep(SOUTH, ms) > 0.5, 'south reticle turns clockwise (angle increases)');
});

test('horizon-aware: a flat horizon leaves the pole clear; a tall treeline blocks it', () => {
  const clear = polarAlignment(NORTH, DATE);
  assert.equal(clear.poleAboveHorizon, true);
  assert.ok(Math.abs(clear.poleClearance - 37.5) < 1e-9);   // full altitude clear
  assert.equal(clear.usable, true);

  const trees = new Array(36).fill(0); trees[0] = 40;         // 40° trees due north
  const blocked = polarAlignment({ lat: 37.5, lon: -122, horizon: trees }, DATE);
  assert.equal(blocked.poleAboveHorizon, false);
  assert.ok(blocked.poleClearance < 0);
  assert.ok(Math.abs(blocked.horizonAltitudeAtPole - 40) < 1e-9);
  assert.equal(blocked.usable, false);
});

test('starHourAngle matches the engine convention and wraps to [0,24)', () => {
  const obs = makeObserver(37.5, -122, 0);
  const { hourAngle, ra, dec } = starHourAngle(POLARIS, obs, DATE);
  assert.ok(hourAngle >= 0 && hourAngle < 24);
  assert.ok(dec > 89 && dec < 90);                            // Polaris of date
  assert.ok(Number.isFinite(ra));
});
