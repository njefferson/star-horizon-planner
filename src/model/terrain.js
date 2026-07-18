// =============================================================================
// terrain.js — the map-pin TERRAIN horizon (Noah's "10° in 360°" idea): drop a
// pin on a distant ridge on the satellite map, and its (azimuth, altitude)
// from the active site is computed from geodesy + the Open-Meteo elevation
// model, then applied to the SAME horizon profile everything else reads —
// each pin claims its 10° manual-editor wedge via setAltitudeAt, exactly like
// a hand-dragged handle.
//
// HONESTY CAVEAT (bake in, per NOTES): elevation models carry NO TREES. Map
// pins estimate distant ridgelines only; a tree-ringed yard still needs the
// physical sensor/camera capture. The UI states this plainly.
//
// GEOMETRY. Spherical earth (R = 6371 km) is plenty at horizon-pin distances.
// The apparent altitude of a ridge Δh above the observer's eye at ground
// distance d dips by earth curvature, partly offset by terrestrial refraction
// (standard k ≈ 0.13 → effective radius R/(1−k)):
//     alt = atan( (Δh − d²/(2·R_eff)) / d )
// At 10 km that hides ~7 m of ridge; at 50 km, ~170 m — why far mountains sit
// lower than trigonometry alone suggests.
//
// 100% headless: the elevation fetch is dependency-injected (Open-Meteo
// /v1/elevation, keyless + CORS, batch ≤ 100 coords — the same host the
// weather already uses, so CSP needs nothing new).
// =============================================================================
import { setAltitudeAt, indexForAz } from './horizon.js';

export const EARTH_R = 6371000;        // metres
export const REFRACTION_K = 0.13;      // standard terrestrial refraction factor
export const EYE_M = 2;                // observer eye height above ground
const R_EFF = EARTH_R / (1 - REFRACTION_K);
const RAD = Math.PI / 180;

/** Great-circle distance (m) and initial bearing (° clockwise from N) A → B. */
export function bearingDistance(a, b) {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, Δλ = (b.lon - a.lon) * RAD;
  const sinφ1 = Math.sin(φ1), cosφ1 = Math.cos(φ1);
  const sinφ2 = Math.sin(φ2), cosφ2 = Math.cos(φ2);
  const h = Math.sin((φ2 - φ1) / 2) ** 2 + cosφ1 * cosφ2 * Math.sin(Δλ / 2) ** 2;
  const dist_m = 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(Δλ) * cosφ2;
  const x = cosφ1 * sinφ2 - sinφ1 * cosφ2 * Math.cos(Δλ);
  const az = ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
  return { az, dist_m };
}

/** The point `dist_m` from `a` along `bearingDeg` (spherical direct problem). */
export function destPoint(a, bearingDeg, dist_m) {
  const δ = dist_m / EARTH_R, θ = bearingDeg * RAD;
  const φ1 = a.lat * RAD, λ1 = a.lon * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return { lat: φ2 / RAD, lon: ((λ2 / RAD + 540) % 360) - 180 };
}

/**
 * Apparent altitude (°) of a point `elev_m` (ground elevation) at `dist_m`
 * from an observer whose ground sits at `siteElev_m` (+ eye height), with
 * earth-curvature dip and standard refraction. Negative = below level.
 */
export function pinAltitudeDeg(siteElev_m, elev_m, dist_m) {
  if (!(dist_m > 0)) return 0;
  const dh = elev_m - (siteElev_m + EYE_M);
  const drop = (dist_m * dist_m) / (2 * R_EFF);
  return Math.atan2(dh - drop, dist_m) / RAD;
}

/**
 * Build a pin record from the site + a map point with a known elevation.
 * @returns { lat, lon, elev_m, az, dist_m, alt }
 */
export function makePin(site, siteElev_m, point, elev_m) {
  const { az, dist_m } = bearingDistance(site, point);
  return {
    lat: point.lat, lon: point.lon, elev_m,
    az, dist_m,
    alt: pinAltitudeDeg(siteElev_m, elev_m, dist_m),
  };
}

/**
 * Apply pins to a horizon profile (mutates + returns it): each pin sets its
 * 10° manual-editor wedge — same semantics as dragging that handle, so a
 * later hand-correction or camera capture coarsens/overwrites just the wedge.
 * Negative altitudes are kept — a ridge below a hilltop site IS the horizon
 * there (the same below-0° support capture and import already have).
 */
export function applyPinsToProfile(profile, pins) {
  for (const p of pins) setAltitudeAt(profile, indexForAz(p.az), p.alt);
  return profile;
}

// --- automatic terrain-horizon trace -----------------------------------------
// A pin measures ONE point's angle; the horizon at a bearing is the MAXIMUM
// angle over EVERY point along the ray — nearer ground can out-block a distant
// ridge (device-pass insight, 2026-07-18). So the trace sweeps all 360°:
// per 10° ray, sample elevations at log-spaced distances (dense near, sparse
// far), take the max apparent altitude, and note WHERE it came from (the
// argmax point draws the "horizon ring" on the map).
// ROOT CAUSE, confirmed on-device 2026-07-18: Open-Meteo's free rate limit
// meters ~600 per MINUTE counting each COORDINATE, not each request — the old
// 864-coordinate trace died at exactly 600/864 ≈ 69% with "elevation API 429"
// at every site. So the whole trace must fit one minute's budget: 36 rays ×
// 16 samples = 576 coordinates (+1 for the site) — under 600, still
// log-spaced dense-near. A 429 anyway (e.g. two traces back-to-back) waits
// out the minute window instead of burning quick retries.
export const TRACE = {
  azStep: 10, minDist_m: 150, maxDist_m: 40000, samplesPerRay: 16,
  batchSize: 50,               // half the documented 100 — shorter URLs, gentler
  attempts: 3,                 // per batch, with real backoff between attempts
  backoff_ms: [800, 2000],     // non-429 failures: quick retries
  rateBackoff_ms: [20000, 45000], // 429: wait out the minute window
  pace_ms: 150,                // breather between successive batches
};

/** All sample points of a full trace: rays × log-spaced distances. */
export function traceSamplePoints(site, T = TRACE) {
  const pts = [];
  const growth = Math.log(T.maxDist_m / T.minDist_m);
  for (let az = 0; az < 360; az += T.azStep) {
    for (let i = 0; i < T.samplesPerRay; i++) {
      const dist_m = T.minDist_m * Math.exp(growth * (i / (T.samplesPerRay - 1)));
      const p = destPoint(site, az, dist_m);
      pts.push({ az, dist_m, lat: p.lat, lon: p.lon });
    }
  }
  return pts;
}

/**
 * Trace the full terrain horizon: per azimuth, the max apparent altitude along
 * the ray, with the blocking point's location. Batches the elevation API 100
 * coords at a time (one retry per batch, then fails closed). `onProgress`
 * (0..1) is for a silent visual meter — announce start/done, not every tick.
 * @returns { points: [{ az, alt, dist_m, lat, lon, elev_m }, …] } 36 rays.
 */
export async function traceHorizon(site, siteElev_m, { fetchFn, onProgress, onNote, sleep, T = TRACE } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const samples = traceSamplePoints(site, T);
  const elevs = new Array(samples.length);
  const B = T.batchSize || 50;
  for (let i = 0; i < samples.length; i += B) {
    const chunk = samples.slice(i, i + B);
    let got, lastErr;
    for (let attempt = 0; attempt < (T.attempts || 3); attempt++) {
      if (attempt > 0) {
        // 429 = the per-minute coordinate budget is spent — wait it out.
        // Anything else gets the quick backoff.
        const rated = /429/.test(String(lastErr?.message || ''));
        const ms = (rated ? T.rateBackoff_ms : T.backoff_ms)?.[attempt - 1] ?? 1000;
        if (rated && onNote) onNote(`elevation service rate-limited — pausing ${Math.round(ms / 1000)} s…`);
        await wait(ms);
        if (rated && onNote) onNote('');
      }
      try { got = await fetchElevations(chunk, fetchFn); lastErr = null; break; }
      catch (e) { lastErr = e; }
    }
    if (lastErr) throw new Error(`elevation lookup failed after ${T.attempts || 3} tries (${lastErr.message || lastErr})`);
    for (let j = 0; j < got.length; j++) elevs[i + j] = got[j];
    if (onProgress) onProgress(Math.min(1, (i + B) / samples.length));
    if (i + B < samples.length && T.pace_ms) await wait(T.pace_ms); // politeness between batches
  }
  const best = new Map(); // az → sample with max apparent altitude
  samples.forEach((s, i) => {
    const alt = pinAltitudeDeg(siteElev_m, elevs[i], s.dist_m);
    const cur = best.get(s.az);
    if (!cur || alt > cur.alt) best.set(s.az, { az: s.az, alt, dist_m: s.dist_m, lat: s.lat, lon: s.lon, elev_m: elevs[i] });
  });
  return { points: [...best.values()].sort((a, b) => a.az - b.az) };
}

/**
 * Ground elevations (m) for up to 100 points via Open-Meteo's keyless
 * elevation API. Fails closed (throws) — callers surface a plain message.
 * @param points [{ lat, lon }, …]
 */
export async function fetchElevations(points, fetchFn = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null) {
  if (!fetchFn) throw new Error('no fetch available');
  if (!points.length) return [];
  const lat = points.map((p) => p.lat.toFixed(5)).join(',');
  const lon = points.map((p) => p.lon.toFixed(5)).join(',');
  const res = await fetchFn(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  if (!res.ok) throw new Error(`elevation API ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.elevation) || data.elevation.length !== points.length) {
    throw new Error(`elevation API returned an unexpected shape (${data?.elevation?.length ?? 'none'} of ${points.length} values)`);
  }
  return data.elevation.map(Number);
}
