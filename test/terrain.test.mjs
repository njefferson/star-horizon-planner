// Headless unit tests for model/terrain.js — the map-pin terrain horizon math.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const {
  bearingDistance, destPoint, pinAltitudeDeg, makePin, applyPinsToProfile,
  fetchElevations, traceSamplePoints, traceHorizon, TRACE,
  EARTH_R, REFRACTION_K, EYE_M,
} = await import('../src/model/terrain.js');
const { makeHorizon, sampleAt } = await import('../src/model/horizon.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('bearingDistance: textbook pairs', () => {
  // One degree of longitude on the equator ≈ 111.19 km, due east.
  const e = bearingDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  near(e.dist_m, 111195, 50, 'equator 1° lon');
  near(e.az, 90, 0.01, 'due east');
  // Due north: 1° of latitude anywhere ≈ the same 111.19 km.
  const n = bearingDistance({ lat: 37.5, lon: -122 }, { lat: 38.5, lon: -122 });
  near(n.dist_m, 111195, 50, '1° lat');
  near(n.az, 0, 0.01, 'due north');
  // Southwest quadrant bearing.
  const sw = bearingDistance({ lat: 37.5, lon: -122 }, { lat: 37.4, lon: -122.1 });
  assert.ok(sw.az > 180 && sw.az < 270, `SW bearing ${sw.az}`);
});

test('destPoint inverts bearingDistance', () => {
  const site = { lat: 37.5, lon: -122 };
  for (const [brg, dist] of [[0, 5000], [90, 12000], [217, 30000], [355, 800]]) {
    const p = destPoint(site, brg, dist);
    const back = bearingDistance(site, p);
    near(back.dist_m, dist, 1, `round-trip distance @${brg}°`);
    near(back.az, brg, 0.01, `round-trip bearing @${brg}°`);
  }
});

test('pinAltitudeDeg: curvature + refraction dip', () => {
  // A ridge 1000 m above a site, 10 km away: the effective-radius drop is
  // d²/(2·R/(1−k)) = 1e8 / 14.65e6 ≈ 6.8 m, eye height 2 m →
  // atan((1000 − 2 − 6.8)/10000) ≈ 5.66°.
  const rEff = EARTH_R / (1 - REFRACTION_K);
  const drop10k = 1e8 / (2 * rEff);
  const expect = Math.atan2(1000 - EYE_M - drop10k, 10000) * 180 / Math.PI;
  near(pinAltitudeDeg(100, 1100, 10000), expect, 1e-9, 'ridge Δh 1000 m @ 10 km');
  assert.ok(expect > 5.6 && expect < 5.7, `sanity: ${expect}`);
  // Level terrain far away sits BELOW level — the curvature dip.
  // drop@50 km ≈ 170.7 m (+2 m eye) → atan(−172.7/50000) ≈ −0.20°.
  assert.ok(pinAltitudeDeg(100, 100, 50000) < -0.15, 'level ground @ 50 km dips below 0°');
  // Downhill ridge → negative altitude (depressed horizon).
  assert.ok(pinAltitudeDeg(500, 300, 5000) < 0, 'lower terrain → negative');
  assert.equal(pinAltitudeDeg(100, 900, 0), 0, 'zero distance guarded');
});

test('makePin composes bearing, distance, and altitude', () => {
  const site = { lat: 37.5, lon: -122 };
  const ridge = destPoint(site, 183, 8000);
  const pin = makePin(site, 30, ridge, 530);
  near(pin.az, 183, 0.01, 'pin azimuth');
  near(pin.dist_m, 8000, 1, 'pin distance');
  assert.ok(pin.alt > 3.4 && pin.alt < 3.6, `pin altitude ${pin.alt}`); // atan(~496/8000) ≈ 3.55°
});

test('applyPinsToProfile: each pin claims its 10° wedge, like a hand drag', () => {
  const profile = makeHorizon(); // flat
  const pins = [{ az: 183, alt: 12.4 }, { az: 92, alt: 4.2 }, { az: 271, alt: -3 }];
  applyPinsToProfile(profile, pins);
  near(sampleAt(profile, 180), 12.4, 0.01, 'pin near 183° lands on the 180° bin');
  near(sampleAt(profile, 90), 4.2, 0.01, '92° → 90° bin');
  near(sampleAt(profile, 270), -3, 0.01, 'below-level terrain records negative (hilltop sees extra sky)');
  near(sampleAt(profile, 0), 0, 0.01, 'unpinned directions untouched');
});

// A fake elevation fetch backed by a synthetic terrain function of (lat, lon).
function terrainFetch(elevOf) {
  return async (url) => {
    const u = new URL(url);
    const lats = u.searchParams.get('latitude').split(',').map(Number);
    const lons = u.searchParams.get('longitude').split(',').map(Number);
    return { ok: true, json: async () => ({ elevation: lats.map((la, i) => elevOf(la, lons[i])) }) };
  };
}

const SITE = { lat: 37.5, lon: -122 };

test('traceSamplePoints: 36 rays, log-spaced dense-near sparse-far', () => {
  const pts = traceSamplePoints(SITE);
  assert.equal(pts.length, (360 / TRACE.azStep) * TRACE.samplesPerRay);
  const ray0 = pts.filter((p) => p.az === 0).map((p) => p.dist_m);
  near(ray0[0], TRACE.minDist_m, 1, 'first sample at minDist');
  near(ray0[ray0.length - 1], TRACE.maxDist_m, 1, 'last sample at maxDist');
  const early = ray0[1] - ray0[0], late = ray0[ray0.length - 1] - ray0[ray0.length - 2];
  assert.ok(late > early * 20, `log spacing: near step ${early} m, far step ${late} m`);
});

test('traceHorizon: a ray takes its MAX — near ground out-blocks a far ridge', async () => {
  // Flat 100 m everywhere; due south a 300 m hill from 2 km out AND an 800 m
  // ridge wall beyond 30 km. The hill subtends ~5.7°, the far ridge only
  // ~1.2° — the trace must report the HILL (the pin-model bug this replaces).
  const elevOf = (lat) => {
    const southKm = (SITE.lat - lat) * 111.195;
    if (southKm > 30) return 800;
    if (southKm > 2) return 300;
    return 100;
  };
  const t = await traceHorizon(SITE, 100, { fetchFn: terrainFetch(elevOf), sleep: async () => {} });
  assert.equal(t.points.length, 36);
  const south = t.points.find((p) => p.az === 180);
  assert.ok(south.alt > 4 && south.alt < 6, `south alt ${south.alt} — the near hill, not the far ridge`);
  assert.ok(south.dist_m < 4000, `blocking point is the near hill (${south.dist_m} m)`);
  const north = t.points.find((p) => p.az === 0);
  assert.ok(Math.abs(north.alt) < 0.25, `flat north ~level (${north.alt})`);
  // The argmax carries its location for the map ring.
  assert.ok(south.lat < SITE.lat && Number.isFinite(south.elev_m));
});

test('traceHorizon: 50-coord batches, backoff retries, named final failure', async () => {
  const sleep = async () => {}; // injected — tests run instantly
  // Healthy run: 864 samples → 18 batches of ≤50.
  let calls = 0;
  const counting = async (url) => { calls++; return terrainFetch(() => 100)(url); };
  const t = await traceHorizon(SITE, 100, { fetchFn: counting, sleep });
  assert.equal(t.points.length, 36);
  assert.equal(calls, Math.ceil((360 / TRACE.azStep) * TRACE.samplesPerRay / TRACE.batchSize), '12 batches');
  // The whole trace must fit Open-Meteo's ~600-coordinates-per-minute budget
  // (the confirmed 2026-07-18 429 root cause: 864 coords died at 69% = 600/864).
  assert.ok((360 / TRACE.azStep) * TRACE.samplesPerRay < 600, 'trace fits the per-minute coordinate budget');

  // A batch that fails twice then succeeds — the backoff attempts absorb it.
  let n = 0;
  const failTwice = async (url) => { n++; if (n <= 2) throw new Error('blip'); return terrainFetch(() => 100)(url); };
  const t2 = await traceHorizon(SITE, 100, { fetchFn: failTwice, sleep });
  assert.equal(t2.points.length, 36);

  // Persistent 429 → fails closed with the REAL cause in the message.
  const always429 = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => traceHorizon(SITE, 100, { fetchFn: always429, sleep }),
    /failed after 3 tries \(elevation API 429\)/);

  // Backoff actually waits between attempts (and paces between batches).
  const waits = [];
  const logSleep = async (ms) => { waits.push(ms); };
  const failOnceEarly = (() => { let k = 0; return async (url) => { k++; if (k === 1) throw new Error('x'); return terrainFetch(() => 100)(url); }; })();
  await traceHorizon(SITE, 100, { fetchFn: failOnceEarly, sleep: logSleep });
  assert.equal(waits[0], TRACE.backoff_ms[0], 'first retry waits the first backoff');
  assert.ok(waits.filter((w) => w === TRACE.pace_ms).length >= 10, 'batches are paced');

  // A 429 gets the LONG rate-limit wait (out of the minute window), not the
  // quick backoff — and the pause is surfaced via onNote.
  const rlWaits = [], notes = [];
  const fail429Once = (() => { let k = 0; return async (url) => { k++; if (k === 1) return { ok: false, status: 429 }; return terrainFetch(() => 100)(url); }; })();
  await traceHorizon(SITE, 100, { fetchFn: fail429Once, sleep: async (ms) => { rlWaits.push(ms); }, onNote: (m) => notes.push(m) });
  assert.equal(rlWaits[0], TRACE.rateBackoff_ms[0], '429 waits out the minute window');
  assert.ok(notes.some((m) => /rate-limited — pausing 20 s/.test(m)), `pause surfaced: ${notes[0]}`);
});

test('fetchElevations: batch URL + parsed metres, fails closed', async () => {
  let seen;
  const okFetch = async (url) => { seen = url; return { ok: true, json: async () => ({ elevation: [12.5, 480] }) }; };
  const out = await fetchElevations([{ lat: 37.5, lon: -122 }, { lat: 37.6, lon: -122.1 }], okFetch);
  assert.deepEqual(out, [12.5, 480]);
  assert.ok(seen.startsWith('https://api.open-meteo.com/v1/elevation?'), seen);
  assert.ok(seen.includes('latitude=37.50000,37.60000') && seen.includes('longitude=-122.00000,-122.10000'), seen);
  await assert.rejects(() => fetchElevations([{ lat: 0, lon: 0 }], async () => ({ ok: false, status: 500 })), /elevation API 500/);
  await assert.rejects(() => fetchElevations([{ lat: 0, lon: 0 }], async () => ({ ok: true, json: async () => ({}) })), /unexpected shape/);
  assert.deepEqual(await fetchElevations([], okFetch), []);
});
