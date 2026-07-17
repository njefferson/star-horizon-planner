// Unit tests for model/geocode.js — result shaping and the graceful contract
// (injected fetch, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResult, geocode } from '../src/model/geocode.js';

test('formatResult builds a readable label and coords', () => {
  const r = formatResult({ name: 'Austin', admin1: 'Texas', country: 'United States', country_code: 'US', latitude: 30.27, longitude: -97.74 });
  assert.equal(r.label, 'Austin, Texas, US');
  assert.equal(r.lat, 30.27);
  assert.equal(r.lon, -97.74);
});

test('geocode maps results and drops coordinate-less entries', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ results: [
    { name: 'Denver', admin1: 'Colorado', country_code: 'US', latitude: 39.74, longitude: -104.99 },
    { name: 'Nowhere', admin1: 'X' }, // no lat/lon → dropped
  ] }) });
  const out = await geocode('denver', { fetchImpl: fake });
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Denver, Colorado, US');
});

test('geocode fails closed: empty query, not-ok, no results, throw', async () => {
  assert.deepEqual(await geocode('', { fetchImpl: async () => { throw new Error('should not be called'); } }), []);
  assert.deepEqual(await geocode('x', { fetchImpl: async () => ({ ok: false }) }), []);
  assert.deepEqual(await geocode('x', { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), []);
  assert.deepEqual(await geocode('x', { fetchImpl: async () => { throw new Error('offline'); } }), []);
});
