// =============================================================================
// panorama.js — the headless math under the spin-and-record panorama (Noah's
// headline ask): while the live-camera sweep records the horizon, each
// orientation sample also paints a narrow vertical strip of the video frame
// onto an EQUIRECTANGULAR canvas — azimuth across (x=0 = TRUE NORTH, eastward
// rightward, matching toStellarium's 0=N-clockwise convention so the image and
// the horizon list share one origin), altitude down (+90° = row 0, −90° = row
// H). The finished strip exports with landscape.ini + horizon.txt as a
// Stellarium `spherical` landscape — the measured DATA drives Stellarium's
// horizon math while the PHOTO draws it.
//
// KNOWN v1 SIMPLIFICATIONS (NEEDS-HIS-HANDS refinement): roll (γ) is ignored —
// strips paint as vertical world columns, assuming the phone is held upright;
// later strips overwrite earlier ones (hard seams); per-device FOV error skews
// the vertical scale. A rough stitched strip, not a photographic panorama.
// =============================================================================

export const PANO_W = 2048;          // 2:1 equirect, full sphere
export const PANO_H = 1024;
export const STRIP_HALF_DEG = 1;     // each sample paints az ± 1°

const norm360 = (az) => ((az % 360) + 360) % 360;

/** Canvas column for an azimuth (x=0 = north, east rightward). */
export function colForAz(az, W = PANO_W) { return (norm360(az) / 360) * W; }

/** Canvas row for an altitude: +90° → 0 (top), −90° → H (bottom). Clamped. */
export function rowForAlt(alt, H = PANO_H) {
  return Math.max(0, Math.min(H, ((90 - alt) / 180) * H));
}

/**
 * Where one sample's strip lands: the az±halfDeg column band (split into two
 * bands when it crosses the north seam — never wrapped inside one band) and
 * the row span of the camera's vertical field centred on its altitude.
 * yTop < yBottom always (the video frame's top row is camAlt + vfov/2, the
 * SMALLER pano row — a sign flip here paints the world upside down).
 */
export function stripPlacement(az, camAlt, vfov, W = PANO_W, H = PANO_H, halfDeg = STRIP_HALF_DEG) {
  const yTop = Math.round(rowForAlt(camAlt + vfov / 2, H));
  const yBottom = Math.round(rowForAlt(camAlt - vfov / 2, H));
  const left = norm360(az - halfDeg);
  const width = (2 * halfDeg / 360) * W;
  const x0 = colForAz(left, W);
  const bands = [];
  if (x0 + width <= W) {
    bands.push({ x0: Math.round(x0), x1: Math.round(x0 + width) });
  } else { // crosses the north seam → split
    bands.push({ x0: Math.round(x0), x1: W });
    bands.push({ x0: 0, x1: Math.round(x0 + width - W) });
  }
  return { bands, yTop, yBottom };
}

// --- coverage (which degrees of the circle have been painted) ----------------

/** One byte per whole degree of azimuth. */
export function makeCoverage() { return new Uint8Array(360); }

/** Mark az ± halfDeg as painted (wrap-aware). */
export function markCovered(cov, az, halfDeg = STRIP_HALF_DEG) {
  const c = Math.floor(norm360(az));
  for (let d = -halfDeg; d <= halfDeg; d++) cov[(c + d + 360) % 360] = 1;
  return cov;
}

/** Painted degrees + the widest unpainted gap (wrapping north). */
export function coverageStats(cov) {
  let deg = 0;
  for (let i = 0; i < 360; i++) deg += cov[i];
  if (deg === 0) return { deg: 0, maxGapDeg: 360 };
  if (deg === 360) return { deg: 360, maxGapDeg: 0 };
  // Longest run of zeros, wrap-aware: scan a doubled circle.
  let maxGap = 0, run = 0;
  for (let i = 0; i < 720; i++) {
    if (cov[i % 360]) run = 0;
    else maxGap = Math.max(maxGap, ++run);
  }
  return { deg, maxGapDeg: Math.min(maxGap, 360) };
}

// --- landscape.ini -----------------------------------------------------------

/**
 * A Stellarium `spherical` landscape ini: the panorama image draws the view,
 * and the bundled polygonal horizon list drives the actual horizon math —
 * data + image together. x=0 = north with angle_rotatez = 0; if a real device
 * pass shows a constant rotation in Stellarium, that one number is the fix
 * (the horizon list is unambiguously 0=N, so any offset is self-evident).
 */
export function buildLandscapeIni({ name, author = 'Clear Horizons (clear-horizons.pages.dev)', lat, lon, elevation_m = 0 }) {
  return [
    '[landscape]',
    `name = ${name || 'My site'}`,
    `author = ${author}`,
    'type = spherical',
    'maptex = panorama.png',
    'angle_rotatez = 0',
    'polygonal_horizon_list = horizon.txt',
    'polygonal_horizon_list_mode = azDeg_altDeg',
    '',
    '[location]',
    'planet = Earth',
    `latitude = ${Number(lat).toFixed(5)}`,
    `longitude = ${Number(lon).toFixed(5)}`,
    `altitude = ${Math.round(elevation_m || 0)}`,
    '',
  ].join('\n');
}
