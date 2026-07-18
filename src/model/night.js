// =============================================================================
// night.js — the time axis for the night graph, and the twilight backdrop.
// nightWindow() finds the dusk→dawn span to plot; sampleTwilight() turns the
// Sun's altitude over that span into the shaded twilight bands. Headless-
// testable; the drawing lives in ui/nightgraph.js.
// =============================================================================
import { sunAltAz, riseSet, twilightBand } from './astro.js';

const HOUR = 3600000;

/**
 * The night to plot for a given calendar date at a site: from ~an hour before
 * sunset to ~an hour after the next sunrise. If the Sun doesn't rise or set
 * (polar day/night), falls back to a fixed local 18:00→06:00 window so the
 * graph always has an axis.
 * @returns { start, end, sunset, sunrise, polar }
 */
export function nightWindow(observer, date) {
  const noon = new Date(date); noon.setHours(12, 0, 0, 0);
  const sunset = riseSet('Sun', observer, noon, { direction: -1 });
  const searchFrom = sunset || new Date(noon.getTime() + 6 * HOUR);
  const sunrise = riseSet('Sun', observer, searchFrom, { direction: +1 });

  if (sunset && sunrise) {
    return {
      start: new Date(sunset.getTime() - HOUR),
      end: new Date(sunrise.getTime() + HOUR),
      sunset, sunrise, polar: false,
    };
  }
  const start = new Date(noon); start.setHours(18, 0, 0, 0);
  const end = new Date(noon.getTime()); end.setHours(30, 0, 0, 0); // 06:00 next day
  return { start, end, sunset: sunset || null, sunrise: sunrise || null, polar: true };
}

/**
 * Sample the Sun's altitude across [start,end] and label each sample's twilight
 * band. Returns [{ t: Date, alt, band }] — the graph shades contiguous runs of
 * the same band.
 */
export function sampleTwilight(observer, start, end, stepMinutes = 5) {
  const out = [];
  const step = stepMinutes * 60000;
  const t1 = end.getTime();
  for (let ms = start.getTime(); ms <= t1 + 1; ms += step) {
    const d = new Date(ms);
    const alt = sunAltAz(observer, d).altitude;
    out.push({ t: d, alt, band: twilightBand(alt) });
  }
  return out;
}

/** Darkest sun altitude within the window (deepest night) — a quick quality read. */
export function darkestAltitude(samples) {
  return samples.reduce((m, s) => Math.min(m, s.alt), Infinity);
}

/**
 * Sky brightness 0..1 for the Astro-weather "darkness" row — 1 = daylight,
 * 0 = moonless astronomical night. Computed entirely on-device (no forecast):
 * the Sun term ramps 1→0 as its altitude falls 0°→−18° (the twilight ladder),
 * and a risen Moon adds an illumination-weighted term that fades in over its
 * first ~20° of altitude (a full Moon high up ≈ 0.35 — bright, but never
 * daylight). Clamped to [0, 1].
 */
export function darknessLevel(sunAltitudeDeg, moonAltitudeDeg, moonIllumination) {
  const sun = Math.max(0, Math.min(1, (sunAltitudeDeg + 18) / 18));
  const moon = moonAltitudeDeg > 0
    ? 0.35 * Math.max(0, Math.min(1, moonIllumination)) * Math.min(1, moonAltitudeDeg / 20)
    : 0;
  return Math.min(1, sun + moon);
}

/**
 * The astronomically-dark sub-span of tonight — from the Sun crossing −18° at
 * dusk to −18° at dawn. Falls back to nautical (−12°) when it never gets fully
 * dark, and to the whole nightWindow if even that fails (bright northern
 * summer). Used by the "visible tonight" target filter to judge visibility
 * only while the sky is actually usable.
 * @returns { start, end, dark: bool }
 */
export function darkWindow(observer, date) {
  const win = nightWindow(observer, date);
  const samples = sampleTwilight(observer, win.start, win.end, 10);
  for (const limit of [-18, -12]) {
    const dark = samples.filter((s) => s.alt < limit);
    if (dark.length) return { start: dark[0].t, end: dark[dark.length - 1].t, dark: true };
  }
  return { start: win.start, end: win.end, dark: false };
}
