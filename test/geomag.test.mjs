// Verify model/geomag.js against NOAA/NCEI's OFFICIAL published WMM2025 test
// values (the "Test Values for WMM2025" table, D column, sea level). These are
// an independent oracle — not produced by this code — so a match proves the
// spherical-harmonic synthesis and the embedded coefficients are both correct.
// Source: https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025testvalues.pdf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declination, modelExpired, VALID_UNTIL } from '../src/model/geomag.js';

// A UTC Date whose decimal-year equals `year` under geomag.js's own convention.
function dateFor(year) {
  const y = Math.floor(year);
  const leap = (y % 400 === 0) || (y % 4 === 0 && y % 100 !== 0);
  return new Date(Date.UTC(y, 0) + (year - y) * (leap ? 366 : 365) * 86400000);
}

// (decimal_year, lat, lon, published D°) — spans both hemispheres, ±80° (near-
// pole Legendre terms) and two epochs (secular-variation term).
const NOAA = [
  [2025.0, 80, 0, 1.28],
  [2025.0, 0, 120, -0.16],
  [2025.0, -80, 240, 68.78],
  [2027.5, 80, 0, 2.59],
  [2027.5, -80, 240, 68.49],
];

for (const [year, lat, lon, expected] of NOAA) {
  test(`WMM2025 declination at (${lat}, ${lon}) in ${year} matches NOAA (${expected}°)`, () => {
    const d = declination(lat, lon, dateFor(year));
    assert.ok(Math.abs(d - expected) < 0.1, `got ${d.toFixed(3)}, NOAA published ${expected}`);
  });
}

test('declination is east-positive and finite in populated mid-latitudes', () => {
  // Boulder, CO is well east-positive today (~+7–8°); NYC is west (negative).
  const boulder = declination(40.02, -105.27, dateFor(2026.5));
  const nyc = declination(40.71, -74.01, dateFor(2026.5));
  assert.ok(boulder > 5 && boulder < 11, `Boulder declination plausible: ${boulder.toFixed(2)}`);
  assert.ok(nyc < -8 && nyc > -16, `NYC declination plausible: ${nyc.toFixed(2)}`);
});

test('modelExpired flags dates outside the WMM2025 valid span', () => {
  assert.equal(modelExpired(dateFor(2026.5)), false);
  assert.equal(modelExpired(dateFor(VALID_UNTIL + 0.1)), true);
  assert.equal(modelExpired(dateFor(2024.5)), true);
});
