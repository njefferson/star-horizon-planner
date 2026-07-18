// =============================================================================
// geomag.js — magnetic declination (a.k.a. magnetic variation / grid-magnetic
// angle) from latitude & longitude, on-device and offline. This replaces the
// old "sight the Sun through a filter" compass calibration: declination is a
// KNOWN, published quantity, so with each site's coordinates we correct a
// magnetic heading to true north automatically — no Sun, no filters.
//
// Model: NOAA/NCEI + BGS **World Magnetic Model 2025** (epoch 2025.0, valid
// 2025.0–2030.0). The Gauss coefficients below are the official WMM2025.COF,
// verbatim. The spherical-harmonic evaluation is adapted from Christopher
// Weiss's geomagJS (MIT), itself a port of NOAA's geomag software.
//
// UPKEEP: when 2030 approaches, drop in WMM2030's coefficients + EPOCH and bump
// VALID_UNTIL. `modelExpired(date)` lets the UI warn if run past the valid span
// (declination drifts ~0.1°/yr, so it degrades gracefully, not catastrophically).
// =============================================================================

const EPOCH = 2025.0;
export const VALID_UNTIL = 2030.0;

// [n, m, gnm, hnm, dgnm, dhnm] — official WMM2025 coefficients (nT, nT/yr).
const COEFFS = [
  [1,0,-29351.8,0,12,0],[1,1,-1410.8,4545.4,9.7,-21.5],[2,0,-2556.6,0,-11.6,0],[2,1,2951.1,-3133.6,-5.2,-27.7],[2,2,1649.3,-815.1,-8,-12.1],[3,0,1361,0,-1.3,0],[3,1,-2404.1,-56.6,-4.2,4],[3,2,1243.8,237.5,0.4,-0.3],[3,3,453.6,-549.5,-15.6,-4.1],[4,0,895,0,-1.6,0],[4,1,799.5,278.6,-2.4,-1.1],[4,2,55.7,-133.9,-6,4.1],[4,3,-281.1,212,5.6,1.6],[4,4,12.1,-375.6,-7,-4.4],[5,0,-233.2,0,0.6,0],[5,1,368.9,45.4,1.4,-0.5],[5,2,187.2,220.2,0,2.2],[5,3,-138.7,-122.9,0.6,0.4],[5,4,-142,43,2.2,1.7],[5,5,20.9,106.1,0.9,1.9],[6,0,64.4,0,-0.2,0],[6,1,63.8,-18.4,-0.4,0.3],[6,2,76.9,16.8,0.9,-1.6],[6,3,-115.7,48.8,1.2,-0.4],[6,4,-40.9,-59.8,-0.9,0.9],[6,5,14.9,10.9,0.3,0.7],[6,6,-60.7,72.7,0.9,0.9],[7,0,79.5,0,0,0],[7,1,-77,-48.9,-0.1,0.6],[7,2,-8.8,-14.4,-0.1,0.5],[7,3,59.3,-1,0.5,-0.8],[7,4,15.8,23.4,-0.1,0],[7,5,2.5,-7.4,-0.8,-1],[7,6,-11.1,-25.1,-0.8,0.6],[7,7,14.2,-2.3,0.8,-0.2],[8,0,23.2,0,-0.1,0],[8,1,10.8,7.1,0.2,-0.2],[8,2,-17.5,-12.6,0,0.5],[8,3,2,11.4,0.5,-0.4],[8,4,-21.7,-9.7,-0.1,0.4],[8,5,16.9,12.7,0.3,-0.5],[8,6,15,0.7,0.2,-0.6],[8,7,-16.8,-5.2,0,0.3],[8,8,0.9,3.9,0.2,0.2],[9,0,4.6,0,0,0],[9,1,7.8,-24.8,-0.1,-0.3],[9,2,3,12.2,0.1,0.3],[9,3,-0.2,8.3,0.3,-0.3],[9,4,-2.5,-3.3,-0.3,0.3],[9,5,-13.1,-5.2,0,0.2],[9,6,2.4,7.2,0.3,-0.1],[9,7,8.6,-0.6,-0.1,-0.2],[9,8,-8.7,0.8,0.1,0.4],[9,9,-12.9,10,-0.1,0.1],[10,0,-1.3,0,0.1,0],[10,1,-6.4,3.3,0,0],[10,2,0.2,0,0.1,0],[10,3,2,2.4,0.1,-0.2],[10,4,-1,5.3,0,0.1],[10,5,-0.6,-9.1,-0.3,-0.1],[10,6,-0.9,0.4,0,0.1],[10,7,1.5,-4.2,-0.1,0],[10,8,0.9,-3.8,-0.1,-0.1],[10,9,-2.7,0.9,0,0.2],[10,10,-3.9,-9.1,0,0],[11,0,2.9,0,0,0],[11,1,-1.5,0,0,0],[11,2,-2.5,2.9,0,0.1],[11,3,2.4,-0.6,0,0],[11,4,-0.6,0.2,0,0.1],[11,5,-0.1,0.5,-0.1,0],[11,6,-0.6,-0.3,0,0],[11,7,-0.1,-1.2,0,0.1],[11,8,1.1,-1.7,-0.1,0],[11,9,-1,-2.9,-0.1,0],[11,10,-0.2,-1.8,-0.1,0],[11,11,2.6,-2.3,-0.1,0],[12,0,-2,0,0,0],[12,1,-0.2,-1.3,0,0],[12,2,0.3,0.7,0,0],[12,3,1.2,1,0,-0.1],[12,4,-1.3,-1.4,0,0.1],[12,5,0.6,0,0,0],[12,6,0.6,0.6,0.1,0],[12,7,0.5,-0.1,0,0],[12,8,-0.1,0.8,0,0],[12,9,-0.4,0.1,0,0],[12,10,-0.2,-1,-0.1,0],[12,11,-1.3,0.1,0,0],[12,12,-0.7,0.2,-0.1,-0.1],
];

const MAXORD = 12;
const deg2rad = (d) => d * Math.PI / 180;
const rad2deg = (r) => r * 180 / Math.PI;

// Build the evaluator once (Schmidt→unnormalized coefficient prep). Adapted from
// geomagJS (Christopher Weiss, MIT) — NOAA's WMM spherical-harmonic routine.
function build() {
  const zero = () => new Array(13).fill(0);
  const grid = () => Array.from({ length: 13 }, zero);
  const c = grid(), cd = grid(), snorm = grid(), k = grid(), tc = grid(), p = grid(), dp = grid();
  const sp = zero(), cp = zero(), pp = zero();
  const a = 6378.137, b = 6356.7523142, re = 6371.2;
  const a2 = a * a, b2 = b * b, c2 = a2 - b2, a4 = a2 * a2, b4 = b2 * b2, c4 = a4 - b4;
  const fn = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const fm = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  cp[0] = 1; pp[0] = 1; p[0][0] = 1;
  for (const [n, m, gnm, hnm, dgnm, dhnm] of COEFFS) {
    if (m > n) continue;
    c[m][n] = gnm; cd[m][n] = dgnm;
    if (m !== 0) { c[n][m - 1] = hnm; cd[n][m - 1] = dhnm; }
  }

  snorm[0][0] = 1;
  for (let n = 1; n <= MAXORD; n++) {
    snorm[0][n] = snorm[0][n - 1] * (2 * n - 1) / n;
    let j = 2;
    for (let m = 0, D2 = n - m + 1; D2 > 0; D2--, m++) {
      k[m][n] = (((n - 1) * (n - 1)) - (m * m)) / ((2 * n - 1) * (2 * n - 3));
      if (m > 0) {
        const flnmj = ((n - m + 1) * j) / (n + m);
        snorm[m][n] = snorm[m - 1][n] * Math.sqrt(flnmj);
        j = 1;
        c[n][m - 1] *= snorm[m][n]; cd[n][m - 1] *= snorm[m][n];
      }
      c[m][n] *= snorm[m][n]; cd[m][n] *= snorm[m][n];
    }
  }
  k[1][1] = 0;

  return function field(glat, glon, altKm, time) {
    const dt = time - EPOCH;
    const rlat = deg2rad(glat), rlon = deg2rad(glon);
    const srlon = Math.sin(rlon), srlat = Math.sin(rlat), crlon = Math.cos(rlon), crlat = Math.cos(rlat);
    const srlat2 = srlat * srlat, crlat2 = crlat * crlat;
    sp[1] = srlon; cp[1] = crlon;
    // Geodetic → spherical.
    const q = Math.sqrt(a2 - c2 * srlat2), q1 = altKm * q;
    const q2 = ((q1 + a2) / (q1 + b2)) ** 2;
    const ct = srlat / Math.sqrt(q2 * crlat2 + srlat2), st = Math.sqrt(1 - ct * ct);
    const r = Math.sqrt(altKm * altKm + 2 * q1 + (a4 - c4 * srlat2) / (q * q));
    const d = Math.sqrt(a2 * crlat2 + b2 * srlat2);
    const ca = (altKm + d) / r, sa = c2 * crlat * srlat / (r * d);
    for (let m = 2; m <= MAXORD; m++) {
      sp[m] = sp[1] * cp[m - 1] + cp[1] * sp[m - 1];
      cp[m] = cp[1] * cp[m - 1] - sp[1] * sp[m - 1];
    }
    let br = 0, bt = 0, bp = 0, bpp = 0;
    const aor = re / r; let ar = aor * aor;
    for (let n = 1; n <= MAXORD; n++) {
      ar *= aor;
      for (let m = 0, D4 = n + m + 1; D4 > 0; D4--, m++) {
        if (n === m) {
          p[m][n] = st * p[m - 1][n - 1];
          dp[m][n] = st * dp[m - 1][n - 1] + ct * p[m - 1][n - 1];
        } else if (n === 1 && m === 0) {
          p[m][n] = ct * p[m][n - 1];
          dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1];
        } else if (n > 1 && n !== m) {
          if (m > n - 2) { p[m][n - 2] = 0; dp[m][n - 2] = 0; }
          p[m][n] = ct * p[m][n - 1] - k[m][n] * p[m][n - 2];
          dp[m][n] = ct * dp[m][n - 1] - st * p[m][n - 1] - k[m][n] * dp[m][n - 2];
        }
        tc[m][n] = c[m][n] + dt * cd[m][n];
        if (m !== 0) tc[n][m - 1] = c[n][m - 1] + dt * cd[n][m - 1];
        const par = ar * p[m][n];
        let temp1, temp2;
        if (m === 0) { temp1 = tc[m][n] * cp[m]; temp2 = tc[m][n] * sp[m]; }
        else { temp1 = tc[m][n] * cp[m] + tc[n][m - 1] * sp[m]; temp2 = tc[m][n] * sp[m] - tc[n][m - 1] * cp[m]; }
        bt -= ar * temp1 * dp[m][n];
        bp += fm[m] * temp2 * par;
        br += fn[n] * temp1 * par;
        if (st === 0 && m === 1) {
          pp[n] = n === 1 ? pp[n - 1] : ct * pp[n - 1] - k[m][n] * pp[n - 2];
          bpp += fm[m] * temp2 * (ar * pp[n]);
        }
      }
    }
    bp = st === 0 ? bpp : bp / st;
    const bx = -bt * ca - br * sa;
    const by = bp;
    return rad2deg(Math.atan2(by, bx)); // declination, east-positive
  };
}

const _field = build();

/** Decimal year (UTC) for a Date. */
function decimalYear(date) {
  const y = date.getUTCFullYear();
  const leap = (y % 400 === 0) || (y % 4 === 0 && y % 100 !== 0);
  const msInYear = (leap ? 366 : 365) * 86400000;
  return y + (date.valueOf() - Date.UTC(y, 0)) / msInYear;
}

/**
 * Magnetic declination in degrees, EAST-POSITIVE, at a location. Add it to a
 * magnetic compass heading to get a true-north heading. Altitude's effect on
 * declination is negligible, so sea level is assumed.
 */
export function declination(lat, lon, date = new Date()) {
  return _field(lat, lon, 0, decimalYear(date));
}

/** True whether the model is being used outside its valid span (declination drifts). */
export function modelExpired(date = new Date()) {
  const y = decimalYear(date);
  return y < EPOCH || y >= VALID_UNTIL;
}
