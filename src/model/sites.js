// =============================================================================
// sites.js — named observing sites, each with its own coordinates AND its own
// measured horizon. Generalises the single working location + horizon the app
// used up to now; the Tonight and Horizon views read the ACTIVE site. Plus a
// JSON backup bundle so your sites, favourites and custom scopes aren't trapped
// in one browser.
//
// A site: { id, name, lat, lon, elevation_m, horizon: number[36] }.
// Keys: horizon.sites (array), horizon.activeSite (id). Legacy single-location
// data (horizon.location + horizon.profile) is migrated once on first read.
// =============================================================================
const SITES_KEY = 'horizon.sites';
const ACTIVE_KEY = 'horizon.activeSite';
// Keys folded into the backup bundle so a restore carries everything.
const FAV_KEY = 'horizon.favorites';
const CUSTOM_INST_KEY = 'horizon.instruments';
const ACTIVE_INST_KEY = 'horizon.instrument';

const N = 36;
const clampLat = (x) => Math.max(-90, Math.min(90, Number(x)));
const wrapLon = (x) => { let v = Number(x); v = ((v + 180) % 360 + 360) % 360 - 180; return v; };
const clampAlt = (a) => Math.max(0, Math.min(90, Number(a) || 0));

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
  catch { return fallback; }
}
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

// A short, collision-resistant id. (Math.random is fine here — this is app
// runtime, not a resumable workflow script.)
function sid() { return 'site-' + Math.random().toString(36).slice(2, 8); }

function normalizeHorizon(arr) {
  const out = new Array(N).fill(0);
  if (Array.isArray(arr)) for (let i = 0; i < N; i++) out[i] = clampAlt(arr[i]);
  return out;
}
function normalizeSite(s) {
  return {
    id: s.id || sid(),
    name: (s.name || '').trim() || 'Site',
    lat: clampLat(s.lat),
    lon: wrapLon(s.lon),
    elevation_m: Number.isFinite(s.elevation_m) ? s.elevation_m : 0,
    horizon: normalizeHorizon(s.horizon),
  };
}

/** All sites, migrating legacy single-location data once if present. */
export function loadSites() {
  let sites = readJSON(SITES_KEY, null);
  if (Array.isArray(sites)) return sites.map(normalizeSite);

  // Migration: fold a legacy horizon.location + horizon.profile into one site.
  sites = [];
  const loc = readJSON('horizon.location', null);
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    const prof = readJSON('horizon.profile', null);
    const site = normalizeSite({
      name: loc.label || 'My site', lat: loc.lat, lon: loc.lon,
      horizon: prof && Array.isArray(prof.altitudes) ? prof.altitudes : null,
    });
    sites = [site];
    writeJSON(SITES_KEY, sites);
    writeJSON(ACTIVE_KEY, site.id);
  }
  return sites;
}

function persist(sites) { writeJSON(SITES_KEY, sites); return sites; }

export function activeSite() {
  const sites = loadSites();
  if (!sites.length) return null;
  let id; try { id = localStorage.getItem(ACTIVE_KEY); } catch { id = null; }
  return sites.find((s) => s.id === id) || sites[0];
}

export function setActiveSite(id) {
  if (!loadSites().some((s) => s.id === id)) return false;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
  return true;
}

/** Add a site; the first one added becomes active. Returns the stored site. */
export function addSite(site) {
  const s = normalizeSite(site);
  const sites = loadSites();
  sites.push(s);
  persist(sites);
  if (sites.length === 1) setActiveSite(s.id);
  return s;
}

/** Patch a site by id (name/lat/lon/elevation/horizon). Returns it or null. */
export function updateSite(id, patch) {
  const sites = loadSites();
  const i = sites.findIndex((s) => s.id === id);
  if (i < 0) return null;
  sites[i] = normalizeSite({ ...sites[i], ...patch, id });
  persist(sites);
  return sites[i];
}

/** Write just the horizon of a site (from the editor). */
export function saveSiteHorizon(id, altitudes) {
  return updateSite(id, { horizon: altitudes });
}

/** Remove a site; if it was active, activate another. */
export function removeSite(id) {
  const sites = loadSites().filter((s) => s.id !== id);
  persist(sites);
  let active; try { active = localStorage.getItem(ACTIVE_KEY); } catch { active = null; }
  if (active === id) {
    if (sites.length) setActiveSite(sites[0].id);
    else { try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ } }
  }
  return sites;
}

// --- Backup bundle ----------------------------------------------------------
const BUNDLE_APP = 'horizon-planner';

/** Serialize sites + favourites + custom scopes into a portable JSON string. */
export function exportBundle(nowIso) {
  const bundle = {
    app: BUNDLE_APP,
    version: 1,
    exportedAt: nowIso || null,
    sites: loadSites(),
    activeSite: (activeSite() || {}).id || null,
    favorites: readJSON(FAV_KEY, []),
    instruments: readJSON(CUSTOM_INST_KEY, []),
    activeInstrument: safeGet(ACTIVE_INST_KEY),
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Restore a backup bundle (replacing sites/favourites/custom scopes). Returns
 * a summary { sites } on success; throws on an unrecognised file.
 */
export function importBundle(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('not valid JSON'); }
  if (!b || b.app !== BUNDLE_APP || !Array.isArray(b.sites)) throw new Error('not a Horizon Planner backup');
  const sites = b.sites.map(normalizeSite);
  persist(sites);
  if (b.activeSite && sites.some((s) => s.id === b.activeSite)) setActiveSite(b.activeSite);
  else if (sites.length) setActiveSite(sites[0].id);
  if (Array.isArray(b.favorites)) writeJSON(FAV_KEY, b.favorites);
  if (Array.isArray(b.instruments)) writeJSON(CUSTOM_INST_KEY, b.instruments);
  if (typeof b.activeInstrument === 'string') { try { localStorage.setItem(ACTIVE_INST_KEY, b.activeInstrument); } catch { /* ignore */ } }
  return { sites: sites.length };
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
