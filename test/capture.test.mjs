// Headless unit tests for model/capture.js — the math under sensor capture.
// Pointing identities, Sun calibration (the compass-truth fix), and the
// sweep → median-binned profile pipeline, all synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapOffset, headingFromAlpha, cameraPointing, calibrationOffset,
  applyOffset, makeSession, addSample, sampleCount,
  coverage, largestGap, profileFromSession,
} from '../src/model/capture.js';
import { sampleAt } from '../src/model/horizon.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('camera pointing: heading = (360 − α) % 360, altitude = β − 90 clamped', () => {
  assert.equal(cameraPointing(0, 90).heading, 0, 'α 0 → north');
  assert.equal(cameraPointing(90, 90).heading, 270, 'α 90 (device CCW) → west');
  assert.equal(cameraPointing(-30, 90).heading, 30);
  // Phone upright (β 90) → camera level with the horizon → 0°, NOT 90°.
  assert.equal(cameraPointing(0, 90).altitude, 0, 'upright reads the horizon as 0°');
  assert.equal(cameraPointing(0, 120).altitude, 30, 'tilt back → obstruction above eye level');
  assert.equal(cameraPointing(0, 60).altitude, -30, 'tip forward → downhill horizon');
  assert.equal(cameraPointing(0, 190).altitude, 90, 'past-zenith clamps');
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

test('largestGap locates the widest hole so the UI can point you at it', () => {
  assert.deepEqual(largestGap(makeSession(1)), { gapDeg: 360, centerAz: 0 }, 'empty → whole circle');
  const s = makeSession(1);
  // Fill everything except a block 180–219 (a 40° hole centred on 200°).
  for (let az = 0; az < 360; az++) if (az < 180 || az >= 220) addSample(s, az + 0.5, 5);
  const g = largestGap(s);
  assert.equal(g.gapDeg, 40, 'the untouched 40° block');
  assert.ok(Math.abs(g.centerAz - 200) <= 1, `gap centre near 200°, got ${g.centerAz}`);
  // A near-complete sweep with only 1° pinholes → widest gap is tiny (done-ish).
  const w = makeSession(1);
  for (let az = 0; az < 360; az += 2) addSample(w, az + 0.5, 5); // every other degree
  assert.ok(largestGap(w).gapDeg <= 1, 'alternating fills leave only 1° gaps');
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
