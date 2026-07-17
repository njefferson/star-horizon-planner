// Headless unit tests for model/thumbnails.js — the hips2fits URL builder.
// No network: we assert the URL is well-formed and the coordinate/FOV maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raDeg, thumbFovDeg, thumbUrl } from '../src/model/thumbnails.js';

const crab = { id: 'NGC1952', ra: 5.57555, dec: 22.0145, size: { maj: 8, min: 4 } };
const point = { id: 'X', ra: 0, dec: 0 }; // sizeless → point source

test('RA hours → degrees (×15)', () => {
  assert.ok(Math.abs(raDeg(crab) - 83.63325) < 1e-4, `${raDeg(crab)}`);
  assert.equal(raDeg({ ra: 0 }), 0);
  assert.equal(raDeg({ ra: 24 }), 360);
});

test('FOV frames the object with margin, clamped', () => {
  // 8′ major → 8/60 deg × 2.5 ≈ 0.333°.
  assert.ok(Math.abs(thumbFovDeg(crab) - (8 / 60) * 2.5) < 1e-9);
  assert.ok(Math.abs(thumbFovDeg(point) - 0.25) < 1e-9, 'sizeless → 0.1° default × 2.5 margin');
  const huge = thumbFovDeg({ size: { maj: 600 } }); // 10° object
  assert.equal(huge, 3, 'clamped to the 3° ceiling');
});

test('URL is well-formed hips2fits with degrees, size, and format', () => {
  const url = thumbUrl(crab, { width: 96, height: 96 });
  assert.ok(url.startsWith('https://alasky.u-strasbg.fr/hips-image-services/hips2fits?'), url);
  const q = new URL(url).searchParams;
  assert.equal(q.get('hips'), 'CDS/P/DSS2/color');
  assert.ok(Math.abs(Number(q.get('ra')) - 83.63325) < 1e-3, `ra ${q.get('ra')}`);
  assert.ok(Math.abs(Number(q.get('dec')) - 22.0145) < 1e-3);
  assert.equal(q.get('width'), '96');
  assert.equal(q.get('height'), '96');
  assert.equal(q.get('format'), 'jpg');
  assert.equal(q.get('projection'), 'TAN');
});

test('explicit fovDeg overrides the computed field (details-page big image)', () => {
  const url = thumbUrl(crab, { width: 480, height: 360, fovDeg: 1.0 });
  const q = new URL(url).searchParams;
  assert.equal(q.get('fov'), '1.0000');
  assert.equal(q.get('width'), '480');
});
