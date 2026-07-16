// =============================================================================
// catalog.js — load the bundled deep-sky catalog and filter it. Fit-vs-mosaic
// is decided HERE at runtime against the active instrument's FOV, so the same
// catalog serves the S50, S30, and any custom scope. Favourites live in
// horizon.favorites.
// =============================================================================
import { fovOf, mosaicFor, activeInstrument } from './instruments.js';

const FAV_KEY = 'horizon.favorites';

// Coarse family for the filter chips, folded from the fine OpenNGC type.
const CATEGORY = {
  Galaxy: 'Galaxy', 'Galaxy pair': 'Galaxy', 'Galaxy triplet': 'Galaxy', 'Galaxy group': 'Galaxy',
  'Open cluster': 'Cluster', 'Globular cluster': 'Cluster',
  'Cluster + nebula': 'Nebula', Nebula: 'Nebula', 'Planetary nebula': 'Nebula',
  'HII region': 'Nebula', 'Emission nebula': 'Nebula', 'Reflection nebula': 'Nebula',
  'Supernova remnant': 'Nebula', 'Star cloud': 'Cluster',
};
export const CATEGORIES = ['Galaxy', 'Cluster', 'Nebula'];

export function categoryOf(obj) { return CATEGORY[obj.typeLabel] || 'Other'; }

let _cache = null;
/** Load + memoise the bundled catalog. Resolves to the array of objects. */
export async function loadCatalog() {
  if (_cache) return _cache;
  const url = new URL('../data/catalog.json', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalog load failed: ${res.status}`);
  const doc = await res.json();
  _cache = doc.objects;
  return _cache;
}

// Object angular size (arcmin major/minor) → degrees for the FOV comparison.
function sizeDeg(obj) {
  if (!obj.size) return { w_deg: 0, h_deg: 0 };
  return { w_deg: obj.size.maj / 60, h_deg: (obj.size.min ?? obj.size.maj) / 60 };
}

/**
 * How the given instrument frames an object: { fits, cols, rows, panels, tier }.
 * A sizeless object is a point source → fits.
 */
export function framing(obj, instrument = activeInstrument()) {
  return mosaicFor(sizeDeg(obj), instrument);
}

// --- Favourites -------------------------------------------------------------
function readFavs() {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); }
  catch { return new Set(); }
}
function writeFavs(set) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
}
export function favoriteIds() { return readFavs(); }
export function isFavorite(id) { return readFavs().has(id); }
export function toggleFavorite(id) {
  const s = readFavs();
  s.has(id) ? s.delete(id) : s.add(id);
  writeFavs(s);
  return s.has(id);
}

/**
 * Filter + sort the catalog.
 * @param objects   from loadCatalog().
 * @param criteria  {
 *   query,                    // substring on name / common / Messier ("m31")
 *   categories: Set<string>,  // 'Galaxy'|'Cluster'|'Nebula'|'Other'; empty = all
 *   magMax,                   // include mag <= this (objects w/o mag pass)
 *   minSizeArcmin, maxSizeArcmin,
 *   fit: 'any'|'fits'|'mosaic',   // vs the active instrument
 *   favoritesOnly: bool,
 *   sort: 'messier'|'mag'|'name'|'size',
 * }
 * @param instrument  active instrument (for the fit filter). Defaults to active.
 * @returns filtered array, each item carrying a `.framing` under this instrument.
 */
export function filterCatalog(objects, criteria = {}, instrument = activeInstrument()) {
  const {
    query = '', categories = null, magMax = null,
    minSizeArcmin = null, maxSizeArcmin = null,
    fit = 'any', favoritesOnly = false, sort = 'messier',
  } = criteria;
  const favs = favoritesOnly ? readFavs() : null;
  const q = query.trim().toLowerCase();
  const fovArea = (() => { const f = fovOf(instrument); return f.w_deg * f.h_deg; })();

  const rows = [];
  for (const o of objects) {
    if (favs && !favs.has(o.id)) continue;
    if (categories && categories.size && !categories.has(categoryOf(o))) continue;
    if (magMax != null && o.mag != null && o.mag > magMax) continue;
    const maj = o.size?.maj ?? null;
    if (minSizeArcmin != null && (maj == null || maj < minSizeArcmin)) continue;
    if (maxSizeArcmin != null && maj != null && maj > maxSizeArcmin) continue;
    if (q && !matches(o, q)) continue;
    const fr = mosaicFor(sizeDeg(o), instrument);
    if (fit === 'fits' && !fr.fits) continue;
    if (fit === 'mosaic' && fr.fits) continue;
    rows.push({ ...o, framing: fr });
  }
  sortRows(rows, sort);
  return rows;
  // (fovArea kept intentionally out of the filter — reserved for a future
  // "fills the frame" relevance sort; referenced here to document intent.)
}

function matches(o, q) {
  if (o.name.toLowerCase().includes(q)) return true;
  if (o.common && o.common.toLowerCase().includes(q)) return true;
  if (o.m && (`m${o.m}` === q || `m ${o.m}` === q || String(o.m) === q)) return true;
  return false;
}

function sortRows(rows, sort) {
  const byMag = (a, b) => (a.mag ?? 99) - (b.mag ?? 99);
  if (sort === 'mag') rows.sort(byMag);
  else if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  else if (sort === 'size') rows.sort((a, b) => (b.size?.maj ?? 0) - (a.size?.maj ?? 0));
  else rows.sort((a, b) => { // 'messier': Messier by number first, then brightest
    if (a.m && b.m) return a.m - b.m;
    if (a.m) return -1;
    if (b.m) return 1;
    return byMag(a, b);
  });
}
