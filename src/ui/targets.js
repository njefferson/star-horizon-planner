// =============================================================================
// targets.js — the Targets view: the bundled catalog with type / magnitude /
// size filters, a fits-vs-mosaic tier computed against the ACTIVE instrument,
// and favourites. Every framing answer here reads the active profile.
// =============================================================================
import { el, clear } from './dom.js';
import {
  loadCatalog, filterCatalog, CATEGORIES, shortName,
  isFavorite, toggleFavorite,
} from '../model/catalog.js';
import { activeInstrument, fovOf } from '../model/instruments.js';
import { activeSite } from '../model/sites.js';
import { makeObserver } from '../model/astro.js';
import { makeHorizon } from '../model/horizon.js';
import { darkWindow } from '../model/night.js';
import { visibleTonight } from '../model/visibility.js';

// Per-session filter state, hung off the app state so it survives re-renders.
function filters(state) {
  if (!state.targets) {
    state.targets = {
      query: '', categories: new Set(), magMax: 12,
      sizeBand: 'any', fit: 'any', favoritesOnly: false, visibleOnly: false, sort: 'messier',
    };
  }
  return state.targets;
}

// "Up tonight" is expensive (a sky sweep over the whole catalog), but the
// answer is fixed until the site, night, or instrument changes — so cache it.
let _visCache = null; // { key, ids: Set }
function visKey(state) {
  const s = activeSite(); if (!s) return null;
  return `${s.id}:${state.night.toDateString()}:${activeInstrument().id}`;
}
function cachedVisible(state) {
  const key = visKey(state);
  return key && _visCache && _visCache.key === key ? _visCache.ids : null;
}
function computeVisible(objects, state) {
  const key = visKey(state); if (!key) return null;
  const s = activeSite();
  const observer = makeObserver(s.lat, s.lon, s.elevation_m || 0);
  const window = darkWindow(observer, state.night);
  const ids = visibleTonight(objects, observer, makeHorizon(s.horizon), { window, instrument: activeInstrument() });
  _visCache = { key, ids };
  return ids;
}

const SIZE_BANDS = {
  any: [null, null],
  small: [null, 10],     // ≤ 10′
  medium: [10, 60],      // 10′–60′
  large: [60, null],     // ≥ 60′
};

export async function renderTargets(app, state, nav) {
  const f = filters(state);
  clear(app);
  app.append(el('p.empty', {}, 'Loading catalog…'));

  let objects;
  try { objects = await loadCatalog(); }
  catch { clear(app); app.append(el('h1', {}, 'Targets'), deadEnd('Catalog unavailable', 'The bundled catalog failed to load. If you just went offline, reopen once online to cache it.')); return; }

  // A late load could land after the user tabbed away — don't paint over them.
  if (!isTargetsRoute()) return;

  const inst = activeInstrument();
  const list = el('div.target-list');
  const count = el('p.count');

  // "Up tonight" needs the active site's sky swept — cheap once cached, a
  // ~half-second sweep on a cache miss. Grab the cache now; if it's a miss and
  // the filter is on, compute AFTER first paint (deferred below) so the tab
  // never freezes on the toggle.
  let visSet = cachedVisible(state);
  const hasSite = !!activeSite();
  const needCompute = f.visibleOnly && hasSite && !visSet;

  // Repaint just the list + count from current filters — used by the search box
  // so typing never rebuilds (and unfocuses) the input.
  function paint() {
    const [minSizeArcmin, maxSizeArcmin] = SIZE_BANDS[f.sizeBand];
    let rows = filterCatalog(objects, {
      query: f.query, categories: f.categories, magMax: f.magMax,
      minSizeArcmin, maxSizeArcmin, fit: f.fit,
      favoritesOnly: f.favoritesOnly, sort: f.sort,
    }, inst);
    if (f.visibleOnly && visSet) rows = rows.filter((o) => visSet.has(o.id));

    if (f.visibleOnly && needCompute && !visSet) {
      count.textContent = 'Checking what’s up tonight…';
    } else if (f.visibleOnly) {
      count.textContent = `${rows.length} up tonight · ${objects.length} in the catalog`;
    } else {
      count.textContent = `${rows.length} of ${objects.length} objects`;
    }
    clear(list);
    if (f.visibleOnly && needCompute && !visSet) return; // list fills after compute
    if (!rows.length) {
      const why = f.visibleOnly
        ? 'Nothing clears your horizon during dark hours tonight at this site — try another night, or check your horizon profile.'
        : 'Loosen a filter — lower the magnitude limit, clear the category, or turn off favourites-only.';
      list.append(deadEnd('No matches', why));
      return;
    }
    for (const o of rows) list.append(row(o));
  }

  clear(app);
  app.append(controls(f, inst, nav, paint), count, list);
  paint();

  // Deferred first compute: yields a frame so "Checking…" paints, then the
  // sweep runs and the list fills. Guarded against the user tabbing away.
  if (needCompute) {
    setTimeout(() => {
      visSet = computeVisible(objects, state);
      if (isTargetsRoute()) paint();
    }, 0);
  }
}

function isTargetsRoute() {
  const h = location.hash || '#/';
  return h.startsWith('#/targets');
}

function controls(f, inst, nav, paint) {
  const fov = fovOf(inst);
  const chip = (label, active, on) =>
    el('button.chip', { class: active ? 'active' : '', 'aria-pressed': active ? 'true' : 'false', onclick: on }, label);

  // role=group + aria-label gives each chip set spoken context ("Object type,
  // Galaxy, toggle button") instead of a bare "Galaxy".
  const chipRow = (label, kids) => el('div.chip-row', { role: 'group', 'aria-label': label }, kids);

  const catRow = chipRow('Object type', CATEGORIES.map((c) =>
    chip(c, f.categories.has(c), () => { toggle(f.categories, c); nav.rerender(); })));

  const fitRow = chipRow('Framing', [
    chip('All', f.fit === 'any', () => { f.fit = 'any'; nav.rerender(); }),
    chip('Fits', f.fit === 'fits', () => { f.fit = 'fits'; nav.rerender(); }),
    chip('Mosaic', f.fit === 'mosaic', () => { f.fit = 'mosaic'; nav.rerender(); }),
  ]);

  const sizeRow = chipRow('Size', Object.keys(SIZE_BANDS).map((b) =>
    chip(b === 'any' ? 'Any size' : b, f.sizeBand === b, () => { f.sizeBand = b; nav.rerender(); })));

  const search = el('input.search', {
    type: 'search', placeholder: 'Search name, common name, or M#…', value: f.query,
    'aria-label': 'Search targets by name, common name, or Messier number',
    oninput: (e) => { f.query = e.target.value; paint(); }, // in-place: keeps focus
  });

  const magSel = labeled('Mag ≤', select(['6', '8', '10', '11', '12'], String(f.magMax), (v) => { f.magMax = Number(v); nav.rerender(); }));
  const sortSel = labeled('Sort', select(
    [['messier', 'Messier'], ['mag', 'Brightness'], ['size', 'Size'], ['name', 'Name']],
    f.sort, (v) => { f.sort = v; nav.rerender(); }));
  const favBtn = chip('★ Favourites', f.favoritesOnly, () => { f.favoritesOnly = !f.favoritesOnly; nav.rerender(); });
  favBtn.setAttribute('aria-label', 'Favourites only'); // else SR reads the ★ glyph name

  // "Up tonight" narrows to what actually clears the active site's measured
  // horizon during dark hours — the app's thesis applied to discovery. Needs a
  // site; disabled (with a hint) until one exists.
  const site = activeSite();
  const visBtn = site
    ? chip('🌙 Up tonight', f.visibleOnly, () => { f.visibleOnly = !f.visibleOnly; nav.rerender(); })
    : el('button.chip', { disabled: '', title: 'Add an observing site first (Sites tab)', 'aria-disabled': 'true', 'aria-label': 'Up tonight (add a site first)' }, '🌙 Up tonight');
  if (site) visBtn.setAttribute('aria-label', 'Up tonight — clears your horizon during dark hours');

  return el('div.filters', {}, [
    el('div.filters-head', {}, [
      el('h1', {}, 'Targets'),
      el('span.inst-tag', { title: 'Framing is computed for the active instrument' },
        `${inst.name} · ${fov.w_deg.toFixed(2)}°×${fov.h_deg.toFixed(2)}° · change in Settings`),
    ]),
    search,
    catRow,
    el('div.filters-row', {}, [magSel, sortSel, visBtn, favBtn]),
    el('div.filters-labelrow', {}, [el('span.fl', {}, 'Framing'), fitRow]),
    el('div.filters-labelrow', {}, [el('span.fl', {}, 'Size'), sizeRow]),
  ]);
}

function row(o) {
  const fr = o.framing;
  const tier = fr.fits
    ? el('span.tier.fits', { title: 'Fits in a single frame' }, 'fits')
    : el('span.tier.mosaic', { title: `${fr.panels} panels` }, `${fr.cols}×${fr.rows}`);
  const fav = isFavorite(o.id);
  return el('div.target-row', {}, [
    el('button.fav', {
      class: fav ? 'on' : '', title: fav ? 'Remove favourite' : 'Add favourite',
      'aria-label': fav ? 'Remove favourite' : 'Add favourite', 'aria-pressed': fav ? 'true' : 'false',
      onclick: (e) => {
        const on = toggleFavorite(o.id);
        const b = e.currentTarget;
        b.classList.toggle('on', on);
        b.textContent = on ? '★' : '☆';
        // Refresh the accessible state in place — this button mutates without a
        // re-render, so the label/pressed state must be updated by hand.
        const label = on ? 'Remove favourite' : 'Add favourite';
        b.title = label; b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      },
    }, fav ? '★' : '☆'),
    el('div.target-main', {}, [
      el('div.target-name', {}, [
        o.m ? el('span.mbadge', {}, `M${o.m}`) : null,
        el('span.tname', {}, shortName(o)),
        o.common ? el('span.tsub', {}, o.name) : null,
      ]),
      el('div.target-meta', {}, [
        el('span.ttype', {}, o.typeLabel),
        el('span.tnum', {}, o.mag != null ? `mag ${o.mag.toFixed(1)}` : 'mag —'),
        el('span.tnum', {}, o.size ? `${fmtSize(o.size.maj)}×${fmtSize(o.size.min)}` : 'size —'),
      ]),
    ]),
    tier,
  ]);
}

// arcmin, but switch to degrees once an object is bigger than a degree.
function fmtSize(arcmin) {
  return arcmin >= 60 ? `${(arcmin / 60).toFixed(1)}°` : `${arcmin.toFixed(arcmin < 10 ? 1 : 0)}′`;
}

// --- small DOM helpers ------------------------------------------------------
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function labeled(label, control) { return el('label.fld', {}, [el('span', {}, label), control]); }
function select(options, value, onchange) {
  const opts = options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return el('option', { value: v, selected: v === value ? '' : null }, l);
  });
  return el('select.sel', { onchange: (e) => onchange(e.target.value) }, opts);
}
function deadEnd(title, body) {
  return el('div.dead-end', {}, [el('h2', {}, title), el('p', {}, body)]);
}
