// =============================================================================
// weather.js — the night's "Astro weather" data (Clear-Sky-Chart style), for
// the block Tonight shades under the night graph on the SAME hour axis:
//
//   • Open-Meteo forecast (keyless, CORS; same provider as geocode.js):
//     hourly cloud cover (total/low/mid/high), wind (mph), relative humidity,
//     temperature (°F).
//   • 7Timer astro product (keyless): seeing and transparency, 1–8 scales,
//     3-hourly cells — the two numbers only astronomy forecasts carry.
//   • Darkness is NOT here — it's astronomy, computed offline in model/night.js.
//
// Each source degrades independently and fails closed like geocode.js: offline /
// bad JSON → cached data if we have it, else that source's rows simply don't
// render; with nothing at all Tonight renders exactly as before (offline-first:
// no nagging). Cache is one slot per (site, night) in localStorage under
// horizon.weather ({ v: 2, key, fetchedAt, samples, astro }) — an old shape is
// a miss. Storage and fetch are injected for headless tests.
// =============================================================================

const KEY = 'horizon.weather';
const V = 2; // cache-shape version — bump when the stored fields change
export const MAX_AGE_MS = 3 * 3600000; // refetch a forecast older than 3 h

/** The Open-Meteo forecast request for a site: sky + ground rows, unix times. */
export function forecastUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,relative_humidity_2m,temperature_2m',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timeformat: 'unixtime',
    timezone: 'UTC',
    forecast_days: '3',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

/**
 * Open-Meteo JSON → [{ ms, total, low, mid, high, windMph, rh, tempF }].
 * Rows with broken CLOUD data are dropped (clouds are the load-bearing bands);
 * a missing ground value renders as a gap in just that row (null, not dropped).
 */
export function parseForecast(json) {
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const num = (v) => (Number.isFinite(v) ? v : null);
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    const s = {
      ms: h.time[i] * 1000,
      total: h.cloud_cover?.[i],
      low: h.cloud_cover_low?.[i],
      mid: h.cloud_cover_mid?.[i],
      high: h.cloud_cover_high?.[i],
      windMph: num(h.wind_speed_10m?.[i]),
      rh: num(h.relative_humidity_2m?.[i]),
      tempF: num(h.temperature_2m?.[i]),
    };
    if ([s.ms, s.total, s.low, s.mid, s.high].every(Number.isFinite)) out.push(s);
  }
  return out;
}

/** The 7Timer astro-product request for a site (JSON, 3-hourly, 72 h). */
export function sevenTimerUrl(lat, lon) {
  const p = new URLSearchParams({
    lon: lon.toFixed(3), lat: lat.toFixed(3),
    ac: '0', unit: 'metric', output: 'json', tzshift: '0',
  });
  return `https://www.7timer.info/bin/astro.php?${p}`;
}

/**
 * 7Timer astro JSON → [{ ms, seeing, transparency }] (both 1–8; 8 best).
 * `init` is the model run "YYYYMMDDHH" in UTC; each row sits `timepoint` hours
 * after it. Malformed init or rows are dropped.
 */
export function parseSevenTimer(json) {
  const init = json && json.init;
  const rows = json && Array.isArray(json.dataseries) ? json.dataseries : null;
  if (!rows || typeof init !== 'string' || !/^\d{10}$/.test(init)) return [];
  const base = Date.UTC(+init.slice(0, 4), +init.slice(4, 6) - 1, +init.slice(6, 8), +init.slice(8, 10));
  const out = [];
  for (const r of rows) {
    const s = { ms: base + r.timepoint * 3600000, seeing: r.seeing, transparency: r.transparency };
    if ([s.ms, s.seeing, s.transparency].every(Number.isFinite)) out.push(s);
  }
  return out;
}

/** Trim samples to the plotted night (± half a cell so edge cells reach the axis). */
export function nightSlice(samples, win, padMinutes = 30) {
  const pad = padMinutes * 60000;
  const a = win.start.getTime() - pad, b = win.end.getTime() + pad;
  return samples.filter((s) => s.ms >= a && s.ms <= b);
}

/** Cache identity: one night at one site. */
export function cacheKey(siteId, win) {
  const d = win.start;
  return `${siteId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readCache(storage) {
  try { return JSON.parse(storage.getItem(KEY) || 'null'); } catch { return null; }
}
function writeCache(storage, entry) {
  try { storage.setItem(KEY, JSON.stringify(entry)); } catch { /* private mode */ }
}

/**
 * The night's astro weather for a site — cache-first, network-refresh, both
 * sources fetched in parallel and degrading independently.
 * @param opts { site: {id,lat,lon}, win: {start,end}, fetchImpl, storage, now }
 * @returns { samples: [hourly Open-Meteo rows] | null,
 *            astro:   [3-hourly 7Timer rows]  | null } — or null when neither
 *          source (nor cache) has anything.
 */
export async function getNightAstro({ site, win, fetchImpl, storage, now = Date.now() } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const key = cacheKey(site.id, win);
  const cached = store ? readCache(store) : null;
  const hit = cached && cached.v === V && cached.key === key ? cached : null;
  if (hit && now - hit.fetchedAt <= MAX_AGE_MS) return { samples: hit.samples, astro: hit.astro };

  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  let samples = null, astro = null;
  if (f) {
    const grab = async (url, parse, pad) => {
      try {
        const res = await f(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return null;
        const rows = nightSlice(parse(await res.json()), win, pad);
        return rows.length ? rows : null;
      } catch { return null; } // offline / aborted — this source just sits out
    };
    [samples, astro] = await Promise.all([
      grab(forecastUrl(site.lat, site.lon), parseForecast, 30),
      grab(sevenTimerUrl(site.lat, site.lon), parseSevenTimer, 90),
    ]);
  }

  if (samples || astro) {
    // Keep the better of new vs cached per source, so one flaky provider
    // doesn't erase the other's earlier catch.
    const merged = {
      v: V, key, fetchedAt: now,
      samples: samples || (hit ? hit.samples : null),
      astro: astro || (hit ? hit.astro : null),
    };
    if (store) writeCache(store, merged);
    return { samples: merged.samples, astro: merged.astro };
  }
  return hit ? { samples: hit.samples, astro: hit.astro } : null; // stale beats nothing
}
