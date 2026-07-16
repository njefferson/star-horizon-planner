// Headless unit tests for model/sites.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A fresh localStorage shim per relevant test via clear().
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const {
  loadSites, activeSite, setActiveSite, addSite, updateSite, removeSite,
  saveSiteHorizon, exportBundle, importBundle,
} = await import('../src/model/sites.js');

test('first added site becomes active; add/switch works', () => {
  localStorage.clear();
  assert.deepEqual(loadSites(), []);
  assert.equal(activeSite(), null);
  const a = addSite({ name: 'Backyard', lat: 37.5, lon: -122 });
  assert.equal(activeSite().id, a.id);
  const b = addSite({ name: 'Dark site', lat: 38.9, lon: -120.1 });
  assert.equal(activeSite().id, a.id, 'still the first');
  assert.equal(setActiveSite(b.id), true);
  assert.equal(activeSite().id, b.id);
  assert.equal(setActiveSite('nope'), false);
});

test('sites clamp latitude and wrap longitude, default a flat 36-row horizon', () => {
  localStorage.clear();
  const s = addSite({ name: 'Edge', lat: 120, lon: 400 });
  assert.equal(s.lat, 90);
  assert.equal(s.lon, 40);
  assert.equal(s.horizon.length, 36);
  assert.ok(s.horizon.every((a) => a === 0));
});

test('update + saveSiteHorizon patch a site', () => {
  localStorage.clear();
  const s = addSite({ name: 'A', lat: 10, lon: 10 });
  updateSite(s.id, { name: 'Renamed', lat: 11 });
  assert.equal(activeSite().name, 'Renamed');
  assert.equal(activeSite().lat, 11);
  const alts = Array(36).fill(0); alts[9] = 25;
  saveSiteHorizon(s.id, alts);
  assert.equal(loadSites()[0].horizon[9], 25);
});

test('removing the active site activates another (or clears)', () => {
  localStorage.clear();
  const a = addSite({ name: 'A', lat: 0, lon: 0 });
  const b = addSite({ name: 'B', lat: 1, lon: 1 });
  setActiveSite(a.id);
  removeSite(a.id);
  assert.equal(activeSite().id, b.id, 'falls back to the remaining site');
  removeSite(b.id);
  assert.equal(activeSite(), null, 'no sites left');
});

test('migrates a legacy location + profile into one site, once', () => {
  localStorage.clear();
  const alts = Array(36).fill(0); alts[0] = 15;
  localStorage.setItem('horizon.location', JSON.stringify({ lat: 34.2, lon: -118.1, label: 'Old yard' }));
  localStorage.setItem('horizon.profile', JSON.stringify({ altitudes: alts }));
  const sites = loadSites();
  assert.equal(sites.length, 1);
  assert.equal(sites[0].name, 'Old yard');
  assert.equal(sites[0].lat, 34.2);
  assert.equal(sites[0].horizon[0], 15);
  assert.equal(activeSite().id, sites[0].id);
});

test('backup bundle round-trips sites, favourites and custom scopes', () => {
  localStorage.clear();
  addSite({ name: 'Home', lat: 40, lon: -75 });
  localStorage.setItem('horizon.favorites', JSON.stringify(['NGC0224', 'NGC6720']));
  localStorage.setItem('horizon.instruments', JSON.stringify([{ id: 'redcat', name: 'RedCat 51' }]));
  localStorage.setItem('horizon.instrument', 's30');
  const json = exportBundle('2026-07-16T00:00:00Z');

  localStorage.clear(); // simulate a fresh browser
  assert.deepEqual(loadSites(), []);
  const res = importBundle(json);
  assert.equal(res.sites, 1);
  assert.equal(activeSite().name, 'Home');
  assert.deepEqual(JSON.parse(localStorage.getItem('horizon.favorites')), ['NGC0224', 'NGC6720']);
  assert.equal(localStorage.getItem('horizon.instrument'), 's30');
  assert.equal(JSON.parse(localStorage.getItem('horizon.instruments'))[0].id, 'redcat');
});

test('importBundle rejects a non-backup file', () => {
  assert.throws(() => importBundle('{"hello":1}'), /not a Horizon Planner backup/);
  assert.throws(() => importBundle('not json'), /not valid JSON/);
});
