// =============================================================================
// astro.js — thin, purpose-built wrappers over the vendored astronomy-engine.
//
// Everything the planner needs to answer "where is it in the sky, and when":
//   • alt/az of any deep-sky target (RA/Dec, J2000) at a site and instant
//   • Sun altitude → twilight band (civil / nautical / astronomical)
//   • Moon altitude, azimuth, phase angle + illuminated fraction
//   • rise / set / transit times (geometric, or against a chosen altitude)
//   • a sampled altitude-vs-time curve for the night graph to draw
//
// Angles are degrees; azimuth is compass bearing clockwise from true north
// (0=N, 90=E, 180=S, 270=W), matching astronomy-engine's Horizon(). Targets
// carry RA in HOURS and Dec in DEGREES (J2000 / EQJ), the way catalogs store
// them; precession + nutation to date are handled here so callers never worry.
// =============================================================================
import * as Astronomy from '../vendor/astronomy.js';

// Sun-altitude thresholds (degrees) that bound each twilight band. Standard
// definitions; the Sun's geometric centre altitude is compared against these.
export const TWILIGHT = { day: 0, civil: -6, nautical: -12, astronomical: -18 };

/** Build an observer for a site. Elevation is metres above sea level. */
export function makeObserver(lat, lon, elevation_m = 0) {
  return new Astronomy.Observer(lat, lon, elevation_m);
}

// Coerce a Date | AstroTime | number(ms) into an AstroTime the engine accepts.
function time(t) { return Astronomy.MakeTime(t); }

// Map our friendly refraction option to what Horizon() accepts: apparent
// ('normal', the default) or geometric (the engine wants null, not a string).
function refOpt(r) { return r === 'none' || r === null ? null : r; }

// A fixed target's J2000 equatorial position → apparent horizontal coords at a
// site/instant. Rotating the star's EQJ vector to EQD (precession + nutation)
// and only then to the horizon keeps a J2000 catalog position honest decades
// from epoch. refraction: 'normal' (apparent, default) | 'none' (geometric).
function targetHorizon(target, observer, t, refraction) {
  const sph = new Astronomy.Spherical(target.dec, target.ra * 15, 1); // dec, RA°, unit dist
  const eqjVec = Astronomy.VectorFromSphere(sph, t);
  const eqdVec = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(t), eqjVec);
  const eqd = Astronomy.EquatorFromVector(eqdVec); // ra (hours of date), dec (deg of date)
  return Astronomy.Horizon(t, observer, eqd.ra, eqd.dec, refOpt(refraction));
}

/**
 * Apparent alt/az of a deep-sky target.
 * @param target    { ra (hours), dec (degrees) } in J2000.
 * @returns { altitude, azimuth } in degrees.
 */
export function altAz(target, observer, date, { refraction = 'normal' } = {}) {
  const h = targetHorizon(target, observer, time(date), refraction);
  return { altitude: h.altitude, azimuth: h.azimuth };
}

// alt/az of a Solar-System body (Sun/Moon/planets), apparent-of-date.
function bodyHorizon(body, observer, t, refraction) {
  const eq = Astronomy.Equator(body, t, observer, /*ofdate*/ true, /*aberration*/ true);
  return Astronomy.Horizon(t, observer, eq.ra, eq.dec, refOpt(refraction));
}

/** Apparent alt/az of the Sun. */
export function sunAltAz(observer, date, { refraction = 'normal' } = {}) {
  const h = bodyHorizon(Astronomy.Body.Sun, observer, time(date), refraction);
  return { altitude: h.altitude, azimuth: h.azimuth };
}

/** Apparent alt/az of the Moon. */
export function moonAltAz(observer, date, { refraction = 'normal' } = {}) {
  const h = bodyHorizon(Astronomy.Body.Moon, observer, time(date), refraction);
  return { altitude: h.altitude, azimuth: h.azimuth };
}

// Name the lunar phase from its phase angle (0=new, 90=first quarter,
// 180=full, 270=last quarter). Quarters get a ±5° window; the rest are the
// four crescents/gibbous spans.
function phaseName(angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a < 5 || a >= 355) return 'new';
  if (a < 85) return 'waxing crescent';
  if (a < 95) return 'first quarter';
  if (a < 175) return 'waxing gibbous';
  if (a < 185) return 'full';
  if (a < 265) return 'waning gibbous';
  if (a < 275) return 'last quarter';
  return 'waning crescent';
}

/**
 * Moon summary for a site/instant: position, phase angle, illuminated
 * fraction (0–1) and a human phase name. Illumination is site-independent but
 * bundled here so the night graph reads one call.
 */
export function moonInfo(observer, date) {
  const t = time(date);
  const h = bodyHorizon(Astronomy.Body.Moon, observer, t, 'normal');
  const phaseAngle = Astronomy.MoonPhase(t);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, t);
  return {
    altitude: h.altitude,
    azimuth: h.azimuth,
    phaseAngle,
    illumination: illum.phase_fraction,
    phaseName: phaseName(phaseAngle),
  };
}

/** Classify a Sun altitude (degrees) into a lighting band. */
export function twilightBand(sunAltitudeDeg) {
  // Each boundary belongs to the DARKER band, so darkness begins exactly at the
  // named angle: the Sun at −18° is already 'night', at −6° already 'nautical'.
  if (sunAltitudeDeg >= TWILIGHT.day) return 'day';
  if (sunAltitudeDeg > TWILIGHT.civil) return 'civil';
  if (sunAltitudeDeg > TWILIGHT.nautical) return 'nautical';
  if (sunAltitudeDeg > TWILIGHT.astronomical) return 'astronomical';
  return 'night';
}

/** The lighting band at a site/instant, straight from the Sun's altitude. */
export function twilightAt(observer, date) {
  return twilightBand(sunAltAz(observer, date).altitude);
}

// --- Event times (rise / set / transit) ------------------------------------
// Fixed targets aren't Bodies, so they're loaded into an engine "user star"
// slot just before searching. JS is single-threaded, so the shared slot is
// safe between the define and the search.
const STAR_SLOT = Astronomy.Body.Star1;
function asBody(bodyOrTarget) {
  if (typeof bodyOrTarget === 'string') return bodyOrTarget; // already a Body
  Astronomy.DefineStar(STAR_SLOT, bodyOrTarget.ra, bodyOrTarget.dec, 1000);
  return STAR_SLOT;
}

/**
 * Next rise or set after `date`.
 * @param bodyOrTarget  a Body string (Astronomy.Body.Sun) or a { ra, dec } target.
 * @param direction     +1 = rise, -1 = set.
 * @param horizonAltitude  degrees the body's centre must cross (default 0 =
 *        geometric horizon; pass a measured treeline altitude for "above MY
 *        horizon"). For the Sun/Moon at 0 the engine already accounts for the
 *        disc radius + standard refraction.
 * @returns a Date, or null if no such crossing within `limitDays`.
 */
export function riseSet(bodyOrTarget, observer, date, { direction = +1, horizonAltitude = 0, limitDays = 1 } = {}) {
  const body = asBody(bodyOrTarget);
  const t0 = time(date);
  const found = horizonAltitude === 0
    ? Astronomy.SearchRiseSet(body, observer, direction, t0, limitDays)
    : Astronomy.SearchAltitude(body, observer, direction, t0, limitDays, horizonAltitude);
  return found ? found.date : null;
}

/**
 * Upper transit (culmination) after `date` — when the target crosses the local
 * meridian at its highest. @returns { time: Date, altitude } or null.
 */
export function transit(bodyOrTarget, observer, date, { limitDays = 1 } = {}) {
  const body = asBody(bodyOrTarget);
  const he = Astronomy.SearchHourAngle(body, observer, 0, time(date), +1);
  if (!he) return null;
  // Guard the search window so callers get a clean null past the horizon.
  const dt = (he.time.date - time(date).date) / 86400000;
  if (dt > limitDays) return null;
  return { time: he.time.date, altitude: he.hor.altitude, azimuth: he.hor.azimuth };
}

/**
 * Local hour angle of a fixed target (RA in hours, Dec in degrees), for the
 * polar-alignment reticle. Mirrors the engine's own HourAngle() but for a
 * user-defined star: HA = observer_longitude/15 + GAST − RA(of date), wrapped
 * to [0,24). At HA = 0 the target is at upper transit (on the meridian, highest).
 * Also returns its apparent equatorial position of date (precession + nutation).
 * @returns { hourAngle (hours), ra (hours of date), dec (deg of date) }
 */
export function starHourAngle(target, observer, date) {
  const t = time(date);
  const eq = Astronomy.Equator(asBody(target), t, observer, /*ofdate*/ true, /*aberration*/ true);
  const gast = Astronomy.SiderealTime(t);
  let ha = (observer.longitude / 15 + gast - eq.ra) % 24;
  if (ha < 0) ha += 24;
  return { hourAngle: ha, ra: eq.ra, dec: eq.dec };
}

/**
 * Sample a target's altitude/azimuth from start to end at a fixed cadence —
 * the raw series the night graph draws and the visibility model scans.
 * @returns [{ time: Date, altitude, azimuth }] inclusive of both ends.
 */
export function altitudeCurve(target, observer, start, end, stepMinutes = 5, opts = {}) {
  const out = [];
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  const step = stepMinutes * 60000;
  for (let ms = t0; ms <= t1 + 1; ms += step) {
    const d = new Date(ms);
    out.push({ time: d, ...altAz(target, observer, d, opts) });
  }
  return out;
}
