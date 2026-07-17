// Headless unit tests for model/capture.js — the math under sensor capture.
// Pointing identities, Sun calibration (the compass-truth fix), and the
// sweep → median-binned profile pipeline, all synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapOffset, headingFromAlpha, topAxisPointing, calibrationOffset,
  applyOffset, sunCalibration, makeSession, addSample, sampleCount,
  coverage, profileFromSession,
} from '../src/model/capture.js';
import { makeObserver } from '../src/model/astro.js';
import { sampleAt } from '../src/model/horizon.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('top-edge pointing: heading = (360 − α) % 360, altitude = β clamped', () => {
  assert.equal(topAxisPointing(0, 0).heading, 0, 'α 0 → north');
  assert.equal(topAxisPointing(90, 0).heading, 270, 'α 90 (device CCW) → west');
  assert.equal(topAxisPointing(-30, 0).heading, 30);
  assert.equal(topAxisPointing(0, 15).altitude, 15);
  assert.equal(topAxisPointing(0, 120).altitude, 90, 'past-zenith clamps');
  assert.equal(headingFromAlpha(360), 0);
});

test('calibration offsets wrap the short way and invert cleanly', () => {
  assert.equal(wrapOffset(190), -170);
  assert.equal(wrapOffset(-190), 170);
  assert.equal(calibrationOffset(10, 350), 20, 'true 10 vs measured 350 → +20');
  assert.equal(calibrationOffset(350, 10), -20);
  assert.equal(applyOffset(350, 20), 10);
  assert.equal(applyOffset(10, -20), 350);
});

test('sunCalibration recovers a known compass error while the Sun is up', () => {
  const obs = makeObserver(37.5, -122.0, 0);
  const noonish = new Date('2026-03-20T20:00:00Z'); // ~13:00 PDT — Sun well up
  const trueError = 13.4; // pretend declination + local interference
  const first = sunCalibration(0, obs, noonish);
  assert.ok(first.ok, 'Sun is up at local midday');
  const measured = first.sunAzimuth - trueError; // what a miscalibrated compass reads
  const cal = sunCalibration(measured, obs, noonish);
  near(cal.offset, trueError, 1e-9, 'offset equals the injected error');
  near(applyOffset(measured, cal.offset), cal.sunAzimuth, 1e-9, 'corrected heading hits the Sun');
  const night = sunCalibration(0, obs, new Date('2026-03-20T08:00:00Z')); // ~1:00 PDT
  assert.equal(night.ok, false, 'no Sun to sight at night');
});

test('sweep bins by azimuth and medians shrug off outliers', () => {
  const s = makeSession(1);
  addSample(s, 90.2, 10.1);
  addSample(s, 90.7, 9.9);
  addSample(s, 90.4, 10.0);
  addSample(s, 90.5, 55);        // a wild swing of the arm
  addSample(s, NaN, 5);          // ignored
  addSample(s, 45, Infinity);    // ignored
  assert.equal(sampleCount(s), 4);
  const p = profileFromSession(s);
  assert.equal(p.points.length, 1);
  assert.equal(p.points[0].az, 90.5, 'bin centre');
  near(p.points[0].alt, 10.05, 1e-9, 'median of 9.9/10/10.1/55');
});

test('coverage reports filled bins and the widest wrap-aware gap', () => {
  const s = makeSession(1);
  assert.deepEqual(coverage(s), { binsWithData: 0, totalBins: 360, pct: 0, maxGapDeg: 360 });
  for (let az = 0; az < 180; az++) addSample(s, az + 0.5, 5);
  const c = coverage(s);
  assert.equal(c.binsWithData, 180);
  assert.equal(c.pct, 50);
  assert.equal(c.maxGapDeg, 180, 'the empty southern-to-north half');
  // A gap spanning the seam: fill 350–359 and 10–19 → the 350↔10 side has no gap > 10.
  const w = makeSession(1);
  for (let az = 350; az < 360; az++) addSample(w, az + 0.5, 5);
  for (let az = 10; az < 20; az++) addSample(w, az + 0.5, 5);
  assert.equal(coverage(w).maxGapDeg, 330, 'the long way around, not the seam');
});

test('a synthetic treeline sweep reconstructs the profile; gaps interpolate', () => {
  const truth = (az) => (az >= 80 && az <= 100 ? 20 : 5);
  const s = makeSession(1);
  let k = 0;
  for (let az = 0; az < 360; az += 0.25) {
    addSample(s, az, truth(az) + (((k++ % 5) - 2) * 0.4)); // ±0.8° hand jitter
  }
  const p = profileFromSession(s);
  near(sampleAt(p, 90), 20, 1, 'treeline recovered');
  near(sampleAt(p, 270), 5, 1, 'open sky recovered');
  // Sparse session: two sightings only → linear interpolation between them.
  const sparse = makeSession(1);
  addSample(sparse, 0.5, 0);
  addSample(sparse, 180.5, 10);
  const q = profileFromSession(sparse);
  near(sampleAt(q, 90.5), 5, 0.1, 'halfway between the two sightings');
  assert.throws(() => profileFromSession(makeSession(1)), /no samples/);
});
