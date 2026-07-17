// Unit tests for model/describe.js — title selection (pure) and the graceful
// fetch contract (with an injected fetch, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wikiTitle, fetchDescription } from '../src/model/describe.js';

test('wikiTitle prefers common name, then Messier, then designation', () => {
  assert.equal(wikiTitle({ common: 'Crab Nebula', m: 1, name: 'NGC 1952' }), 'Crab Nebula');
  assert.equal(wikiTitle({ m: 42, name: 'NGC 1976' }), 'Messier 42');
  assert.equal(wikiTitle({ name: 'NGC 7000' }), 'NGC 7000');
  assert.equal(wikiTitle({ common: '  ', name: 'IC 1318' }), 'IC 1318', 'blank common is ignored');
});

test('fetchDescription returns the extract on a good summary', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ title: 'Crab Nebula', extract: 'A supernova remnant.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Crab_Nebula' } } }) });
  const r = await fetchDescription({ common: 'Crab Nebula' }, { fetchImpl: fake });
  assert.equal(r.extract, 'A supernova remnant.');
  assert.equal(r.url, 'https://en.wikipedia.org/wiki/Crab_Nebula');
});

test('fetchDescription fails closed: not-ok, disambiguation, missing extract, throw', async () => {
  assert.equal(await fetchDescription({ common: 'X' }, { fetchImpl: async () => ({ ok: false }) }), null);
  assert.equal(await fetchDescription({ common: 'X' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ type: 'disambiguation', extract: 'nope' }) }) }), null);
  assert.equal(await fetchDescription({ common: 'X' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ title: 'X' }) }) }), null, 'no extract → null');
  assert.equal(await fetchDescription({ common: 'X' }, { fetchImpl: async () => { throw new Error('offline'); } }), null, 'network error → null');
});
