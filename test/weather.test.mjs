// Headless unit tests for model/weather.js — the night's astro weather:
// URL shapes, response parsing (Open-Meteo hourly + 7Timer 3-hourly), night
// trimming, and the one-slot per-(site,night) cache with staleness and
// per-source degradation. All synthetic; fetch and storage are injected fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastUrl, parseForecast, sevenTimerUrl, parseSevenTimer,
  nightSlice, cacheKey, getNightAstro, MAX_AGE_MS,
} from '../src/model/weather.js';

const H = 3600000;
const T0 = Date.parse('2026-07-18T03:00:00Z'); // "tonight" anchor for synthetic data

// A fake Open-Meteo response: hourly samples every hour from T0-2h to T0+10h.
function apiJson() {
  const time = [], cc = [], lo = [], mi = [], hi = [], wind = [], rh = [], temp = [];
  for (let k = -2; k <= 10; k++) {
    time.push((T0 + k * H) / 1000);
    cc.push(10 * Math.abs(k)); lo.push(5); mi.push(3); hi.push(2);
    wind.push(8 + k); rh.push(40 + k); temp.push(60 - k);
  }
  return { hourly: { time, cloud_cover: cc, cloud_cover_low: lo, cloud_cover_mid: mi, cloud_cover_high: hi, wind_speed_10m: wind, relative_humidity_2m: rh, temperature_2m: temp } };
}
// A fake 7Timer astro response: init at T0-3h, 3-hourly timepoints.
function sevenJson() {
  const d = new Date(T0 - 3 * H);
  const init = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
  const dataseries = [3, 6, 9, 12].map((tp) => ({ timepoint: tp, seeing: (tp / 3) % 8 + 1, transparency: 7 }));
  return { init, dataseries };
}
const win = { start: new Date(T0), end: new Date(T0 + 8 * H) };
const site = { id: 'site-x', lat: 37.5, lon: -122 };

function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), dump: () => m };
}
// Route-style fake fetch: picks a response by hostname; null → that host fails.
const routes = (byHost) => async (url) => {
  const host = new URL(url).hostname;
  const json = byHost[host];
  if (!json) throw new Error('offline');
  return { ok: true, json: async () => json };
};

test('forecastUrl asks Open-Meteo for cloud bands + ground rows in US units', () => {
  const u = new URL(forecastUrl(37.5, -122));
  assert.equal(u.hostname, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('hourly'),
    'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,relative_humidity_2m,temperature_2m');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(u.searchParams.get('timeformat'), 'unixtime');
});

test('parseForecast maps sky + ground; broken cloud rows drop, broken ground gaps', () => {
  const j = apiJson();
  j.hourly.cloud_cover[3] = null;      // broken cloud row → dropped
  j.hourly.wind_speed_10m[4] = 'bad';  // broken ground value → null gap only
  const rows = parseForecast(j);
  assert.equal(rows.length, 12, '13 hours minus the broken-cloud row');
  assert.equal(rows[0].windMph, 6, 'wind carried (mph)');
  assert.equal(rows[0].tempF, 62, 'temperature carried (°F)');
  const gapped = rows.find((r) => r.windMph === null);
  assert.ok(gapped && Number.isFinite(gapped.total), 'bad wind gaps that row only');
  assert.deepEqual(parseForecast({}), []);
});

test('sevenTimerUrl + parseSevenTimer: init epoch math and 1–8 scales', () => {
  const u = new URL(sevenTimerUrl(37.5, -122));
  assert.equal(u.hostname, 'www.7timer.info');
  assert.equal(u.searchParams.get('output'), 'json');
  const rows = parseSevenTimer(sevenJson());
  assert.equal(rows.length, 4);
  assert.equal(rows[0].ms, T0, 'init (T0−3h) + timepoint 3h = T0');
  assert.equal(rows[1].ms, T0 + 3 * H);
  assert.ok(rows.every((r) => r.seeing >= 1 && r.seeing <= 8 && r.transparency === 7));
  assert.deepEqual(parseSevenTimer({ init: 'nope', dataseries: [] }), []);
  assert.deepEqual(parseSevenTimer(null), []);
});

test('nightSlice keeps the plotted night ± the given pad', () => {
  const rows = parseForecast(apiJson()); // T0-2h … T0+10h
  const sliced = nightSlice(rows, win, 30);
  assert.equal(sliced[0].ms, T0);
  assert.equal(sliced[sliced.length - 1].ms, T0 + 8 * H);
  const wide = nightSlice(rows, win, 90); // 3-hourly pad pulls one more in each direction
  assert.equal(wide[0].ms, T0 - H);
});

test('getNightAstro: fetches both sources in parallel, trims, caches v2 shape', async () => {
  const storage = fakeStorage();
  const fetchImpl = routes({ 'api.open-meteo.com': apiJson(), 'www.7timer.info': sevenJson() });
  const got = await getNightAstro({ site, win, fetchImpl, storage, now: T0 });
  assert.equal(got.samples.length, 9, 'hourly rows across the window');
  assert.equal(got.astro.length, 4, '3-hourly rows across the window (90 min pad)');
  const cached = JSON.parse(storage.dump().get('horizon.weather'));
  assert.equal(cached.v, 2);
  assert.equal(cached.key, cacheKey(site.id, win));
});

test('getNightAstro: 7Timer down → clouds still come back (and vice versa)', async () => {
  const noSeven = await getNightAstro({ site, win, storage: fakeStorage(), now: T0,
    fetchImpl: routes({ 'api.open-meteo.com': apiJson() }) });
  assert.ok(noSeven.samples && noSeven.samples.length, 'Open-Meteo rows survive');
  assert.equal(noSeven.astro, null, '7Timer rows absent, not fabricated');
  const noMeteo = await getNightAstro({ site, win, storage: fakeStorage(), now: T0,
    fetchImpl: routes({ 'www.7timer.info': sevenJson() }) });
  assert.equal(noMeteo.samples, null);
  assert.ok(noMeteo.astro && noMeteo.astro.length);
});

test('getNightAstro: fresh cache short-circuits; stale survives failed refetch', async () => {
  const entry = { v: 2, key: cacheKey(site.id, win), fetchedAt: T0, samples: [{ ms: T0, total: 1, low: 1, mid: 0, high: 0, windMph: 5, rh: 50, tempF: 60 }], astro: null };
  const storage = fakeStorage({ 'horizon.weather': JSON.stringify(entry) });
  let called = 0;
  const fresh = await getNightAstro({ site, win, storage, now: T0 + H,
    fetchImpl: async () => { called++; throw new Error('no'); } });
  assert.equal(called, 0, 'no fetch within MAX_AGE');
  assert.equal(fresh.samples.length, 1);
  const stale = await getNightAstro({ site, win, storage: fakeStorage({ 'horizon.weather': JSON.stringify({ ...entry, fetchedAt: T0 - MAX_AGE_MS - 1 }) }), now: T0,
    fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(stale.samples[0].total, 1, 'stale beats nothing');
});

test('getNightAstro: an old (v1) cache shape and a wrong night both miss', async () => {
  const v1 = { key: cacheKey(site.id, win), fetchedAt: T0, samples: [{ ms: T0, total: 1, low: 0, mid: 0, high: 0 }] };
  const storage = fakeStorage({ 'horizon.weather': JSON.stringify(v1) });
  const got = await getNightAstro({ site, win, storage, now: T0, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(got, null, 'v1 shape is a miss, never half-parsed');
  const nextNight = { start: new Date(T0 + 24 * H), end: new Date(T0 + 32 * H) };
  const v2 = { v: 2, key: cacheKey(site.id, win), fetchedAt: T0, samples: [], astro: null };
  const got2 = await getNightAstro({ site, win: nextNight, storage: fakeStorage({ 'horizon.weather': JSON.stringify(v2) }), now: T0 + 24 * H, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(got2, null, 'another night\'s cache never leaks in');
});
