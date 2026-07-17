// =============================================================================
// capture.js — the headless math under sensor-trace horizon capture: pointing
// from device orientation, compass-truth calibration, and sweep → profile.
//
// POINTING. The sighting axis is the phone's TOP EDGE (portrait, screen
// vertical, like a gunsight). Under the W3C Z-X′-Y″ Euler convention the
// device Y-axis in the earth frame is (−sinα·cosβ, cosα·cosβ, sinβ) — it is
// INVARIANT under γ (roll about that very axis) — so for the top edge,
// heading = (360 − α) % 360 and altitude = β hold EXACTLY, not just for a
// level phone. iOS supplies `webkitCompassHeading` directly (tilt-compensated,
// magnetic); Android's absolute α goes through headingFromAlpha().
//
// CALIBRATION. Every device heading is MAGNETIC and locally disturbed;
// declination alone runs to ~±15° across the US — over a full editor row. One
// sighting of the Sun (whose true azimuth astro.js computes) yields an offset
// that corrects declination AND local interference at once. Manual offset
// entry is the night-time fallback.
//
// SWEEP. Samples accumulate into 1° azimuth bins; each bin's altitude is the
// MEDIAN of its samples (robust to hand jitter and single-sample outliers).
// The finished profile has one point per covered bin — sampleAt() already
// interpolates linearly across uncovered gaps, so no fill pass is needed.
// =============================================================================
import { sunAltAz } from './astro.js';
import { ALT_MIN, ALT_MAX, makeHorizon } from './horizon.js';

const norm360 = (az) => ((az % 360) + 360) % 360;

/** Wrap a degree difference into (−180, 180]. */
export function wrapOffset(deg) {
  const d = norm360(deg);
  return d > 180 ? d - 360 : d;
}

/** Android path: compass heading of the top edge from an ABSOLUTE alpha. */
export function headingFromAlpha(alpha) { return norm360(360 - alpha); }

/**
 * Where the top edge points, from device Euler angles.
 * @returns { heading (° cw from north, magnetic), altitude (°, [−90, 90]) }
 */
export function topAxisPointing(alpha, beta) {
  return {
    heading: headingFromAlpha(alpha),
    altitude: Math.max(-90, Math.min(90, beta)),
  };
}

/** The calibration offset that maps a measured heading onto a true azimuth. */
export function calibrationOffset(trueAzimuth, measuredHeading) {
  return wrapOffset(trueAzimuth - measuredHeading);
}

/** True azimuth from a measured heading and a calibration offset. */
export function applyOffset(heading, offset) { return norm360(heading + offset); }

/**
 * Calibrate against the Sun: aim the top edge at the Sun, pass the measured
 * heading. `ok` is false when the Sun isn't up to sight (use manual offset).
 * @returns { ok, offset, sunAzimuth, sunAltitude }
 */
export function sunCalibration(measuredHeading, observer, date) {
  const sun = sunAltAz(observer, date);
  return {
    ok: sun.altitude > -0.5,
    offset: calibrationOffset(sun.azimuth, measuredHeading),
    sunAzimuth: sun.azimuth,
    sunAltitude: sun.altitude,
  };
}

// --- sweep session -----------------------------------------------------------

/** A capture session: azimuth bins accumulating altitude samples. */
export function makeSession(binDeg = 1) {
  return { binDeg, bins: new Map() }; // bin index → number[]
}

/** Record one calibrated sample. Non-finite input is ignored. */
export function addSample(session, azTrue, alt) {
  if (!Number.isFinite(azTrue) || !Number.isFinite(alt)) return session;
  const i = Math.floor(norm360(azTrue) / session.binDeg);
  const clamped = Math.max(ALT_MIN, Math.min(ALT_MAX, alt));
  const bin = session.bins.get(i);
  if (bin) bin.push(clamped); else session.bins.set(i, [clamped]);
  return session;
}

/** Total recorded samples. */
export function sampleCount(session) {
  let n = 0;
  for (const b of session.bins.values()) n += b.length;
  return n;
}

/**
 * How much of the circle the sweep has touched.
 * @returns { binsWithData, totalBins, pct, maxGapDeg } — maxGap wraps north.
 */
export function coverage(session) {
  const total = Math.round(360 / session.binDeg);
  const filled = [...session.bins.keys()].sort((a, b) => a - b);
  if (!filled.length) return { binsWithData: 0, totalBins: total, pct: 0, maxGapDeg: 360 };
  // Largest run of empty bins between consecutive filled ones, wrapping north.
  let maxGap = 0;
  for (let k = 0; k < filled.length; k++) {
    const next = k + 1 < filled.length ? filled[k + 1] : filled[0] + total;
    maxGap = Math.max(maxGap, next - filled[k] - 1);
  }
  return {
    binsWithData: filled.length,
    totalBins: total,
    pct: Math.round((filled.length / total) * 100),
    maxGapDeg: maxGap * session.binDeg,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The captured horizon: one point per covered bin (bin-centre azimuth, median
 * altitude). Returns a profile; gaps interpolate naturally via sampleAt().
 * Throws when the session is empty.
 */
export function profileFromSession(session) {
  if (!session.bins.size) throw new Error('no samples recorded');
  const points = [...session.bins.entries()].map(([i, alts]) => ({
    az: (i + 0.5) * session.binDeg,
    alt: median(alts),
  }));
  return makeHorizon({ points });
}
