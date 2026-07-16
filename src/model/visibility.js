// =============================================================================
// visibility.js — from the same alt/az computation the night graph draws, work
// out WHEN a target is usable tonight. Two answers, both honest:
//   • geometric  — plain rise/set (above the astronomical 0° horizon)
//   • effective  — above YOUR measured treeline AND below the mount's near-
//                  zenith dead-zone (an alt-az smart scope can't track through
//                  the zenith; EQ mode relaxes it). This is the emphasised one.
// Returns merged intervals with edge times refined by interpolation, plus the
// transit altitude/time. Headless-testable; the table lives in the UI.
// =============================================================================
import { altAz } from './astro.js';
import { isAbove } from './horizon.js';
import { zenithDeadZone } from './instruments.js';

/**
 * @param target      { ra (hours), dec (deg) } J2000.
 * @param observer    an astro Observer.
 * @param horizon     a horizon profile (or null → flat 0°).
 * @param opts        { start, end, instrument, eqMode=false, stepMinutes=2 }
 * @returns {
 *   geometric: [{ start, end }],   // above 0°
 *   effective: [{ start, end }],   // above treeline & below dead-zone
 *   transit:   { time, altitude, azimuth } | null,  // highest within [start,end]
 *   maxAltitude,
 *   deadZone,                      // applied high-altitude cutoff (0 if none)
 *   clipsDeadZone: bool,           // target rises into the dead-zone
 * }
 */
export function visibility(target, observer, horizon, opts) {
  const { start, end, instrument = null, eqMode = false, stepMinutes = 2 } = opts;
  const deadZone = eqMode || !instrument ? 0 : zenithDeadZone(instrument);
  const step = stepMinutes * 60000;
  const t0 = start.getTime(), t1 = end.getTime();

  const samples = [];
  let transit = null, maxAltitude = -90;
  for (let ms = t0; ms <= t1 + 1; ms += step) {
    const d = new Date(ms);
    const { altitude, azimuth } = altAz(target, observer, d);
    const geo = altitude > 0;
    const aboveTrees = horizon ? isAbove(horizon, azimuth, altitude) : altitude > 0;
    const belowZenith = deadZone > 0 ? altitude < deadZone : true;
    samples.push({ ms, altitude, azimuth, geo, eff: aboveTrees && belowZenith });
    if (altitude > maxAltitude) { maxAltitude = altitude; transit = { time: d, altitude, azimuth }; }
  }

  return {
    geometric: intervals(samples, 'geo'),
    effective: intervals(samples, 'eff'),
    transit: maxAltitude > -90 ? transit : null,
    maxAltitude,
    deadZone,
    clipsDeadZone: deadZone > 0 && maxAltitude >= deadZone,
  };
}

// Merge contiguous true-runs of `key` into intervals, refining each edge to the
// linear-interpolated crossing time between the two bracketing samples so the
// window boundaries read cleanly rather than snapping to the sample grid.
function intervals(samples, key) {
  const out = [];
  let open = null;
  for (let i = 0; i < samples.length; i++) {
    const on = samples[i][key];
    if (on && open === null) {
      open = i > 0 ? midpoint(samples[i - 1].ms, samples[i].ms) : samples[i].ms;
    } else if (!on && open !== null) {
      out.push({ start: new Date(open), end: new Date(midpoint(samples[i - 1].ms, samples[i].ms)) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: new Date(open), end: new Date(samples[samples.length - 1].ms) });
  return out;
}
const midpoint = (a, b) => Math.round((a + b) / 2);

/** Total minutes across a set of intervals. */
export function totalMinutes(list) {
  return Math.round(list.reduce((m, iv) => m + (iv.end - iv.start), 0) / 60000);
}
