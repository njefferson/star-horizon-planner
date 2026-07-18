// =============================================================================
// terrainmap.js (UI) — the TERRAIN view (#/horizon/map), reworked after the
// 2026-07-18 device pass. Noah's insight killed the pin model: a pin measures
// ONE point's angle, but the horizon at a bearing is the MAX over EVERY point
// along the ray — so the app now ray-traces all 360° itself (model/terrain.js
// traceHorizon) and applies the result in one tap, with an Undo. The traced
// "horizon ring" (each ray's blocking point) draws on the map so you can SEE
// where your horizon comes from.
//
// The map's remaining pointer job is CREATING SITES: tap a spot → name it →
// it becomes the active site (scouting flow). The non-pointer equivalent is
// the Sites tab's manual/geolocation/search entry, so the map is never the
// only way in; the trace itself is a plain button.
//
// HONESTY (per NOTES, stated in the UI): elevation data has NO TREES — the
// trace models terrain ridgelines only; a tree-ringed yard needs the camera.
//
// Tile sources are keyless with automatic fallback (Esri imagery →
// OpenTopoMap), a dedicated un-clobberable tile-status line, and the SW
// BYPASSES tile hosts entirely (iOS opaque-piping breakage — see sw.js).
// =============================================================================
import { el, clear, toast } from './dom.js';
import { activeSite, addSite, setActiveSite, saveSiteHorizon } from '../model/sites.js';
import { makeHorizon, serializeHorizon, maxAltitude } from '../model/horizon.js';
import { traceHorizon, fetchElevations } from '../model/terrain.js';

const SOURCES = [
  {
    name: 'Esri satellite imagery',
    url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attrib: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 17,
  },
  {
    name: 'OpenTopoMap terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attrib: '© OpenStreetMap contributors, SRTM · style © OpenTopoMap (CC-BY-SA)',
    maxZoom: 15,
  },
];
const FALLBACK_AFTER = 3; // consecutive tile errors (with no success) before swapping
const START_ZOOM = 14;    // close-in: you're locating YOUR yard, not a region (device ask)

let tm = null; // { site, siteElev, map, L, ring, tracing }
let root = null;
const mounted = () => root && root.isConnected;

export async function renderTerrainMap(app, state, nav) {
  clear(app);
  stopTerrainMap();
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Terrain horizon'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'The terrain trace runs from a site’s coordinates. Add one first.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }

  tm = { site, siteElev: null, map: null, L: null, ring: null, tracing: false };
  buildShell(app, site, nav);
  window.addEventListener('hashchange', onHashLeave);
  await initMap(site, nav);
  await initSiteElevation(site);
}

// --- shell -------------------------------------------------------------------
function buildShell(app, site, nav) {
  root = el('div.tm-root');
  const label = site.name || `${site.lat.toFixed(2)}, ${site.lon.toFixed(2)}`;

  const head = el('div.pa-head', {}, [
    el('h1', {}, 'Terrain horizon'),
    el('div.row-actions', {}, [
      el('button.chip.ng-site', { onclick: () => { stopTerrainMap(); nav.go('#/sites'); }, 'aria-label': `Site: ${label} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${label}`)]),
      el('button.btn.small', { onclick: () => { stopTerrainMap(); nav.go('#/horizon'); } }, '← Horizon'),
    ]),
  ]);

  const caveat = el('div.sky-notice', {}, [
    el('span', {}, '🌲 Elevation data has no trees — the trace models terrain ridgelines only. For a tree-ringed yard, '),
    el('button.linklike', { onclick: () => { stopTerrainMap(); nav.go('#/capture/live'); } }, 'measure with the camera'),
    el('span', {}, ' instead.'),
  ]);

  const mapBox = el('div.tm-map', {
    id: 'tm-map', role: 'application',
    'aria-label': 'Terrain map centred on your site. Tap a spot to create a new site there. The trace button below computes the horizon without the map.',
  });
  const tileStatus = el('p.dim.small', { id: 'tm-tiles', role: 'status', 'aria-live': 'polite' }, '');

  // The headline action: ray-trace all 360° and apply, with an Undo toast.
  const traceBtn = el('button.btn.primary', { id: 'tm-trace', onclick: () => runTrace(nav) },
    '⛰ Trace terrain horizon (360°)');
  // Progress meter is a SILENT visual (updated per batch); only start/done/
  // fail announce via the live status node — a stream is not an announcement.
  const progress = el('p.dim.small.mono', { id: 'tm-progress' }, '');
  const statusNode = el('p.dim.small', { id: 'tm-status', role: 'status', 'aria-live': 'polite' }, '');
  const summary = el('p.tm-summary.mono', { id: 'tm-summary' }, '');

  root.append(
    head, caveat, mapBox, tileStatus,
    el('div.card-actions', {}, [traceBtn]),
    progress, summary, statusNode,
    el('p.settings-foot', {}, 'The trace samples elevations along 36 rays (dense nearby, out to 40 km), keeps each ray’s HIGHEST apparent point — near ground can out-block a distant ridge — and applies the result to this site’s horizon (Undo in the toast). Tap the map to start a new site somewhere else.'),
  );
  app.append(root);
}

// --- map ---------------------------------------------------------------------
async function initMap(site, nav) {
  if (!document.querySelector('link[href$="vendor/leaflet.css"]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: './src/vendor/leaflet.css' }));
  }
  let L;
  try { L = await import('../vendor/leaflet.js'); }
  catch { say('The map library could not load.'); return; }
  if (!mounted() || !tm) return;
  tm.L = L;
  const map = L.map('tm-map', { zoomControl: true }).setView([site.lat, site.lon], START_ZOOM);
  addTileSource(map, L, 0);
  L.circleMarker([site.lat, site.lon], {
    radius: 7, color: '#0b0e17', weight: 2, fillColor: '#ffd166', fillOpacity: 1,
  }).addTo(map).bindTooltip(site.name);
  map.on('click', (e) => openNewSiteDialog({ lat: e.latlng.lat, lon: e.latlng.lng }, nav));
  tm.map = map;
}

function addTileSource(map, L, idx) {
  const s = SOURCES[idx];
  let errors = 0, anyLoaded = false, swapped = false, deadSaid = false;
  const layer = L.tileLayer(s.url, { maxZoom: s.maxZoom, attribution: s.attrib }).addTo(map);
  layer.on('tileload', () => {
    if (anyLoaded) return;
    anyLoaded = true;
    // Late tiles must CORRECT a premature failure verdict (rate limiters
    // error a few tiles, then serve); after a swap the "switched" note stays.
    if (deadSaid) tileSay(idx > 0 ? `${SOURCES[idx - 1].name} isn’t loading — switched to ${s.name}.` : '');
    else if (idx === 0) tileSay('');
  });
  layer.on('tileerror', () => {
    if (anyLoaded || swapped) return;
    errors++;
    if (errors < FALLBACK_AFTER) return;
    if (idx + 1 < SOURCES.length) {
      swapped = true;
      map.removeLayer(layer);
      tileSay(`${s.name} isn’t loading — switched to ${SOURCES[idx + 1].name}.`);
      addTileSource(map, L, idx + 1);
    } else if (!deadSaid) {
      deadSaid = true;
      tileSay('No map tiles are loading — imagery may be blocked on this network. The trace works without tiles.');
    }
  });
}
function tileSay(msg) { const n = root && root.querySelector('#tm-tiles'); if (n) n.textContent = msg; }

// Site + trace share one reference surface: the elevation MODEL's value for
// the site (not site.elevation_m, often 0/unknown).
async function initSiteElevation(site) {
  try {
    const [e] = await fetchElevations([{ lat: site.lat, lon: site.lon }]);
    if (!tm) return;
    tm.siteElev = e;
    say(`Site elevation ${Math.round(e)} m. Trace to compute the terrain horizon.`);
  } catch (err) {
    if (!tm) return;
    // Name the real error (a 429 here misled as "offline" on 2026-07-18).
    say(`Elevation lookup failed (${err?.message || 'no connection'}) — the trace needs it. Try again shortly.`);
  }
}

// --- the trace ---------------------------------------------------------------
async function runTrace(nav) {
  if (!tm || tm.tracing) return;
  if (tm.siteElev == null) { await initSiteElevation(tm.site); if (!tm || tm.siteElev == null) return; }
  tm.tracing = true;
  const btn = root.querySelector('#tm-trace');
  if (btn) btn.disabled = true;
  say('Tracing the terrain horizon — 36 directions out to 40 km…');
  setProgress(0);
  try {
    const site = tm.site;
    const traced = await traceHorizon(site, tm.siteElev, {
      onProgress: setProgress,
      // Rate-limit pauses show in the silent progress line (not the live
      // status node — a countdown is a stream, not an announcement).
      onNote: (msg) => { const n = root && root.querySelector('#tm-progress'); if (n && msg) n.textContent = msg; },
    });
    if (!tm || !mounted()) return;

    // Apply as the site's horizon (the automatic draw Noah asked for), with a
    // real Undo — the previous profile restores byte-identically.
    const before = serializeHorizon(makeHorizon(site.horizon));
    const profile = makeHorizon({ points: traced.points.map((p) => ({ az: p.az, alt: p.alt })) });
    saveSiteHorizon(site.id, serializeHorizon(profile));
    tm.site = activeSite(); // re-read: keep the in-view copy current

    drawTraceOverlay(traced.points);
    const top = traced.points.reduce((a, b) => (b.alt > a.alt ? b : a));
    const summary = root.querySelector('#tm-summary');
    if (summary) {
      summary.textContent = `Tallest terrain ${top.alt.toFixed(1)}° at az ${top.az}° (${(top.dist_m / 1000).toFixed(1)} km, ${Math.round(top.elev_m)} m) · profile max ${maxAltitude(profile).toFixed(1)}°`;
    }
    say('Terrain horizon applied to this site.');
    toast(`Terrain horizon applied to ${site.name}.`, {
      action: { label: 'Undo', onClick: () => { saveSiteHorizon(site.id, before); say('Terrain horizon undone — previous profile restored.'); } },
    });
  } catch (err) {
    // Name the ACTUAL failure (HTTP status, shape, network) — a generic
    // "unreachable" hides the diagnosis, the v2.6.x tile lesson.
    say(`The trace failed part-way — ${err?.message || 'unknown error'}. Nothing was changed; try again.`);
  } finally {
    setProgress(null);
    if (tm) tm.tracing = false;
    const b = root && root.querySelector('#tm-trace');
    if (b) b.disabled = false;
  }
}

function setProgress(frac) {
  const n = root && root.querySelector('#tm-progress');
  if (!n) return;
  n.textContent = frac == null ? '' : `sampling elevations ${Math.round(frac * 100)}%`;
}

// The trace, drawn: 36 thin RAYS from the site to each direction's blocking
// point, and the heavier RING joining all their ends (Noah's ask) — a radar
// sweep that shows each sightline and where it terminates. Decorative (the
// summary + editor carry the data).
function drawTraceOverlay(points) {
  if (!tm || !tm.map || !tm.L) return;
  if (tm.ring) tm.map.removeLayer(tm.ring);
  const here = [tm.site.lat, tm.site.lon];
  const rays = points.map((p) => tm.L.polyline([here, [p.lat, p.lon]], {
    color: '#ffd166', weight: 1, opacity: 0.5,
  }));
  const latlngs = points.map((p) => [p.lat, p.lon]);
  const casing = tm.L.polygon(latlngs, { color: '#0b0e17', weight: 4, opacity: 0.55, fill: false });
  const line = tm.L.polygon(latlngs, { color: '#ffd166', weight: 2, opacity: 0.95, fill: false });
  tm.ring = tm.L.layerGroup([...rays, casing, line]).addTo(tm.map);
  // animate:false — an in-flight zoom animation outliving a fast navigation
  // away is the other classic _leaflet_pos crash.
  tm.map.fitBounds(line.getBounds(), { padding: [20, 20], animate: false });
}

// --- new site from a map tap -------------------------------------------------
function openNewSiteDialog(point, nav) {
  if (!tm) return;
  document.querySelector('.loc-dialog')?.remove();
  const name = el('input.loc-in', { type: 'text', placeholder: 'e.g. Ridge Spot' });
  const dlg = el('dialog.loc-dialog', { 'aria-labelledby': 'tm-newsite-title' }, [
    el('h2', { id: 'tm-newsite-title' }, 'New site here?'),
    el('p.dim.small.mono', {}, `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`),
    el('div.loc-grid', {}, [el('label.fld', {}, [el('span', {}, 'Name'), name])]),
    el('div.hz-dialog-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancel'),
      el('button.btn.primary', { onclick: () => {
        const s = addSite({ name: name.value.trim() || 'Map pin site', lat: point.lat, lon: point.lon });
        setActiveSite(s.id);
        dlg.close();
        toast(`“${s.name}” created and active.`);
        // Defer past Leaflet's click-event stack: rerender tears the map down,
        // and removing a map while it's still dispatching this event crashes
        // its positioning code (_leaflet_pos).
        setTimeout(() => nav.rerender(), 0);
      } }, 'Create & switch'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

function say(msg) { const n = root && root.querySelector('#tm-status'); if (n) n.textContent = msg; }

// --- teardown ----------------------------------------------------------------
function onHashLeave() { if (!location.hash.startsWith('#/horizon/map')) stopTerrainMap(); }
export function stopTerrainMap() {
  window.removeEventListener('hashchange', onHashLeave);
  if (tm && tm.map) { try { tm.map.remove(); } catch { /* already gone */ } }
  tm = null;
}
