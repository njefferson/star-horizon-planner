// Headless unit tests for model/precache.js — favourite-image Cache-API
// warming. Node has no Cache API, so the module is dependency-injected and
// these tests hand in fakes; the browser defaults are exercised only for their
// absent-API no-op path.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const { precacheUrls, warmObject, pruneObject, sweepFavorites, THUMBS_CACHE } =
  await import('../src/model/precache.js');
const { thumbUrl, detailImageSpec } = await import('../src/model/thumbnails.js');

const crab = { id: 'NGC1952', ra: 5.57555, dec: 22.0145, size: { maj: 8, min: 4 } };
const m31 = { id: 'NGC0224', ra: 0.7123, dec: 41.2692, size: { maj: 178, min: 63 } };

// --- fakes -------------------------------------------------------------------
function fakeCaches() {
  const stores = new Map(); // name → Map(url → response)
  return {
    opened: [],
    async open(name) {
      this.opened.push(name);
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name);
      return {
        async match(url) { return s.get(typeof url === 'string' ? url : url.url) || null; },
        async put(url, res) { s.set(typeof url === 'string' ? url : url.url, res); },
        async delete(url) { return s.delete(typeof url === 'string' ? url : url.url); },
        async keys() { return [...s.keys()].map((u) => ({ url: u })); },
      };
    },
    store(name) { return stores.get(name) || new Map(); },
  };
}
function fakeFetch({ fail = false, log = [] } = {}) {
  let inFlight = 0, maxInFlight = 0;
  const fn = async (url) => {
    log.push(url);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 2)); // let the pool overlap
    inFlight--;
    if (fail) return { ok: false };
    return { ok: true, body: url, clone() { return this; } };
  };
  fn.log = log;
  fn.max = () => maxInFlight;
  return fn;
}

// --- tests -------------------------------------------------------------------
test('precacheUrls: exactly the list thumb + the details-page image', () => {
  const urls = precacheUrls(crab);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('width=96'), 'list preview');
  assert.equal(urls[1], thumbUrl(crab, detailImageSpec(crab)), 'detail URL agrees with the page');
});

test('warmObject puts both URLs; a second warm fetches nothing', async () => {
  const cachesApi = fakeCaches();
  const fetchFn = fakeFetch();
  const r1 = await warmObject(crab, { cachesApi, fetchFn });
  assert.deepEqual(r1, { warmed: 2, failed: 0 });
  assert.equal(cachesApi.store(THUMBS_CACHE).size, 2);
  const r2 = await warmObject(crab, { cachesApi, fetchFn });
  assert.deepEqual(r2, { warmed: 0, failed: 0 });
  assert.equal(fetchFn.log.length, 2, 'already-cached URLs are not refetched');
});

test('pruneObject removes exactly that object', async () => {
  const cachesApi = fakeCaches();
  const fetchFn = fakeFetch();
  await warmObject(crab, { cachesApi, fetchFn });
  await warmObject(m31, { cachesApi, fetchFn });
  await pruneObject(crab, { cachesApi });
  const left = [...cachesApi.store(THUMBS_CACHE).keys()];
  assert.equal(left.length, 2);
  assert.ok(left.every((u) => precacheUrls(m31).includes(u)));
});

test('sweepFavorites warms missing favourites and prunes strangers', async () => {
  const cachesApi = fakeCaches();
  const fetchFn = fakeFetch();
  await warmObject(crab, { cachesApi, fetchFn });         // crab cached but WON'T be a favourite
  const r = await sweepFavorites([crab, m31], new Set(['NGC0224']), { cachesApi, fetchFn });
  assert.deepEqual(r, { warmed: 2, pruned: 2, failed: 0 });
  const left = [...cachesApi.store(THUMBS_CACHE).keys()];
  assert.ok(left.every((u) => precacheUrls(m31).includes(u)) && left.length === 2);
});

test('failures resolve quietly: counted, cache untouched', async () => {
  const cachesApi = fakeCaches();
  const r = await warmObject(crab, { cachesApi, fetchFn: fakeFetch({ fail: true }) });
  assert.deepEqual(r, { warmed: 0, failed: 2 });
  assert.equal(cachesApi.store(THUMBS_CACHE).size, 0);
  const rejecting = async () => { throw new Error('offline'); };
  const r2 = await warmObject(crab, { cachesApi, fetchFn: rejecting });
  assert.deepEqual(r2, { warmed: 0, failed: 2 });
});

test('absent Cache API → safe no-op', async () => {
  assert.deepEqual(await warmObject(crab, { cachesApi: null }), { warmed: 0, failed: 0 });
  await pruneObject(crab, { cachesApi: null }); // must not throw
  assert.deepEqual(await sweepFavorites([crab], new Set(['NGC1952']), { cachesApi: null }),
    { warmed: 0, pruned: 0, failed: 0 });
});

test('sweep respects the concurrency cap across many favourites', async () => {
  const cachesApi = fakeCaches();
  const fetchFn = fakeFetch();
  const favs = Array.from({ length: 5 }, (_, i) => ({ id: `T${i}`, ra: i, dec: i, size: { maj: 8 } }));
  const r = await sweepFavorites(favs, new Set(favs.map((f) => f.id)), { cachesApi, fetchFn, concurrency: 3 });
  assert.equal(r.warmed, 10);
  assert.ok(fetchFn.max() <= 3, `max in-flight ${fetchFn.max()} ≤ 3`);
});
