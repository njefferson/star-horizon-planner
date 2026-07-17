// =============================================================================
// geocode.js — turn a typed place ("Denver", "Austin, TX", "90210") into
// coordinates, so setting your location doesn't require knowing latitude and
// longitude. Uses Open-Meteo's geocoding API (keyless, CORS-friendly — the same
// provider the weather roadmap uses). Fails closed: offline or no match → an
// empty list, never an error. The lat/long field stays as the manual fallback.
// =============================================================================

const BASE = 'https://geocoding-api.open-meteo.com/v1/search';

/** Shape one API result into { name, admin1, country, countryCode, lat, lon, label }. */
export function formatResult(r) {
  const parts = [r.name, r.admin1, r.country_code].filter(Boolean);
  return {
    name: r.name || '',
    admin1: r.admin1 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    lat: r.latitude,
    lon: r.longitude,
    label: parts.join(', '),
  };
}

/**
 * Look up places by name / "city, state" / postal code. Resolves to an array
 * (possibly empty). Never throws for the caller.
 * @param opts { signal, fetchImpl, count }
 */
export async function geocode(query, { signal, fetchImpl, count = 6 } = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return [];
  try {
    const url = `${BASE}?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
    const res = await f(url, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j && Array.isArray(j.results) ? j.results : [])
      .map(formatResult)
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  } catch { return []; } // offline / aborted / bad JSON — degrade to no results
}
