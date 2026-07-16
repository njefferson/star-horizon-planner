// Headless unit tests for model/catalog.js. Run: `node --test`.
// Exercised against the REAL bundled catalog.json so the filters are checked on
// live data, not a fixture that could drift from what ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// localStorage shim (favourites + active instrument) and a fetch shim so
// loadCatalog()'s file: URL resolves under Node.
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();
globalThis.fetch = async (url) => {
  const txt = await readFile(fileURLToPath(url), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};

const {
  loadCatalog, filterCatalog, framing, categoryOf, CATEGORIES,
  toggleFavorite, isFavorite, favoriteIds,
} = await import('../src/model/catalog.js');
const { instrumentById } = await import('../src/model/instruments.js');

const objects = await loadCatalog();
const byId = (id) => objects.find((o) => o.id === id);
const M31 = byId('NGC0224'); // Andromeda, ~3.17°×1.0°
const M57 = byId('NGC6720'); // Ring Nebula, tiny

test('loadCatalog returns a non-empty array and memoises', async () => {
  assert.ok(Array.isArray(objects) && objects.length > 1000);
  assert.equal(await loadCatalog(), objects); // same cached reference
});

test('categoryOf folds fine types into Galaxy/Cluster/Nebula', () => {
  assert.equal(categoryOf({ typeLabel: 'Galaxy' }), 'Galaxy');
  assert.equal(categoryOf({ typeLabel: 'Globular cluster' }), 'Cluster');
  assert.equal(categoryOf({ typeLabel: 'Planetary nebula' }), 'Nebula');
  assert.ok(CATEGORIES.includes('Galaxy'));
});

test('framing reads the active instrument: Andromeda mosaics, wider scope fewer panels', () => {
  const on50 = framing(M31, instrumentById('s50'));
  const on30 = framing(M31, instrumentById('s30'));
  assert.equal(on50.fits, false);
  assert.ok(on30.panels < on50.panels);
  assert.equal(framing(M57, instrumentById('s50')).fits, true); // tiny → one frame
});

test('category filter keeps only the requested families', () => {
  const gals = filterCatalog(objects, { categories: new Set(['Galaxy']) });
  assert.ok(gals.length > 0);
  assert.ok(gals.every((o) => categoryOf(o) === 'Galaxy'));
});

test('magnitude filter excludes fainter objects (Messier kept even w/o mag)', () => {
  const bright = filterCatalog(objects, { magMax: 6 });
  assert.ok(bright.every((o) => o.mag == null || o.mag <= 6));
  assert.ok(bright.some((o) => o.id === 'NGC0224')); // M31 at 3.44 passes
});

test('size filter bounds the major axis', () => {
  const big = filterCatalog(objects, { minSizeArcmin: 60 });
  assert.ok(big.length > 0);
  assert.ok(big.every((o) => o.size && o.size.maj >= 60));
});

test('query matches name, common name, and Messier shorthand', () => {
  assert.ok(filterCatalog(objects, { query: 'andromeda' }).some((o) => o.id === 'NGC0224'));
  assert.ok(filterCatalog(objects, { query: 'm31' }).some((o) => o.id === 'NGC0224'));
  assert.ok(filterCatalog(objects, { query: 'NGC 224' }).some((o) => o.id === 'NGC0224'));
});

test('fit filter splits fits vs mosaic against the active instrument', () => {
  const s50 = instrumentById('s50');
  const fitsOnly = filterCatalog(objects, { fit: 'fits' }, s50);
  const mosaicOnly = filterCatalog(objects, { fit: 'mosaic' }, s50);
  assert.ok(fitsOnly.every((o) => o.framing.fits));
  assert.ok(mosaicOnly.every((o) => !o.framing.fits));
  assert.ok(mosaicOnly.some((o) => o.id === 'NGC0224')); // Andromeda is a mosaic on S50
});

test('favorites toggle + favoritesOnly filter', () => {
  localStorage.clear();
  assert.equal(isFavorite('NGC0224'), false);
  assert.equal(toggleFavorite('NGC0224'), true);
  assert.ok(favoriteIds().has('NGC0224'));
  const favs = filterCatalog(objects, { favoritesOnly: true });
  assert.equal(favs.length, 1);
  assert.equal(favs[0].id, 'NGC0224');
  assert.equal(toggleFavorite('NGC0224'), false); // toggles back off
});

test('sort options order the results', () => {
  const byMag = filterCatalog(objects, { sort: 'mag', magMax: 8 });
  for (let i = 1; i < byMag.length; i++) {
    assert.ok((byMag[i - 1].mag ?? 99) <= (byMag[i].mag ?? 99), 'ascending magnitude');
  }
});
