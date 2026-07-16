// =============================================================================
// targets.js — the Targets view: the bundled catalog with type / magnitude /
// size filters, a fits-vs-mosaic tier computed against the ACTIVE instrument,
// and favourites. Every framing answer here reads the active profile.
// =============================================================================
import { el, clear } from './dom.js';
import {
  loadCatalog, filterCatalog, CATEGORIES,
  isFavorite, toggleFavorite,
} from '../model/catalog.js';
import { activeInstrument, fovOf } from '../model/instruments.js';

// Per-session filter state, hung off the app state so it survives re-renders.
function filters(state) {
  if (!state.targets) {
    state.targets = {
      query: '', categories: new Set(), magMax: 12,
      sizeBand: 'any', fit: 'any', favoritesOnly: false, sort: 'messier',
    };
  }
  return state.targets;
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
  catch { clear(app); app.append(deadEnd('Catalog unavailable', 'The bundled catalog failed to load. If you just went offline, reopen once online to cache it.')); return; }

  // A late load could land after the user tabbed away — don't paint over them.
  if (!isTargetsRoute()) return;

  const inst = activeInstrument();
  const list = el('div.target-list');
  const count = el('p.count');

  // Repaint just the list + count from current filters — used by the search box
  // so typing never rebuilds (and unfocuses) the input.
  function paint() {
    const [minSizeArcmin, maxSizeArcmin] = SIZE_BANDS[f.sizeBand];
    const rows = filterCatalog(objects, {
      query: f.query, categories: f.categories, magMax: f.magMax,
      minSizeArcmin, maxSizeArcmin, fit: f.fit,
      favoritesOnly: f.favoritesOnly, sort: f.sort,
    }, inst);
    count.textContent = `${rows.length} of ${objects.length} objects`;
    clear(list);
    if (!rows.length) {
      list.append(deadEnd('No matches', 'Loosen a filter — lower the magnitude limit, clear the category, or turn off favourites-only.'));
      return;
    }
    for (const o of rows) list.append(row(o));
  }

  clear(app);
  app.append(controls(f, inst, nav, paint), count, list);
  paint();
}

function isTargetsRoute() {
  const h = location.hash || '#/';
  return h.startsWith('#/targets');
}

function controls(f, inst, nav, paint) {
  const fov = fovOf(inst);
  const chip = (label, active, on) =>
    el('button.chip', { class: active ? 'active' : '', onclick: on }, label);

  const catRow = el('div.chip-row', {}, CATEGORIES.map((c) =>
    chip(c, f.categories.has(c), () => { toggle(f.categories, c); nav.rerender(); })));

  const fitRow = el('div.chip-row', {}, [
    chip('All', f.fit === 'any', () => { f.fit = 'any'; nav.rerender(); }),
    chip('Fits', f.fit === 'fits', () => { f.fit = 'fits'; nav.rerender(); }),
    chip('Mosaic', f.fit === 'mosaic', () => { f.fit = 'mosaic'; nav.rerender(); }),
  ]);

  const sizeRow = el('div.chip-row', {}, Object.keys(SIZE_BANDS).map((b) =>
    chip(b === 'any' ? 'Any size' : b, f.sizeBand === b, () => { f.sizeBand = b; nav.rerender(); })));

  const search = el('input.search', {
    type: 'search', placeholder: 'Search name, common name, or M#…', value: f.query,
    oninput: (e) => { f.query = e.target.value; paint(); }, // in-place: keeps focus
  });

  const magSel = labeled('Mag ≤', select(['6', '8', '10', '11', '12'], String(f.magMax), (v) => { f.magMax = Number(v); nav.rerender(); }));
  const sortSel = labeled('Sort', select(
    [['messier', 'Messier'], ['mag', 'Brightness'], ['size', 'Size'], ['name', 'Name']],
    f.sort, (v) => { f.sort = v; nav.rerender(); }));
  const favBtn = chip('★ Favourites', f.favoritesOnly, () => { f.favoritesOnly = !f.favoritesOnly; nav.rerender(); });

  return el('div.filters', {}, [
    el('div.filters-head', {}, [
      el('h1', {}, 'Targets'),
      el('span.inst-tag', { title: 'Framing is computed for the active instrument' },
        `${inst.name} · ${fov.w_deg.toFixed(2)}°×${fov.h_deg.toFixed(2)}° · change in Settings`),
    ]),
    search,
    catRow,
    el('div.filters-row', {}, [magSel, sortSel, favBtn]),
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
      'aria-label': fav ? 'Remove favourite' : 'Add favourite',
      onclick: (e) => { toggleFavorite(o.id); const b = e.currentTarget; const on = b.classList.toggle('on'); b.textContent = on ? '★' : '☆'; },
    }, fav ? '★' : '☆'),
    el('div.target-main', {}, [
      el('div.target-name', {}, [
        o.m ? el('span.mbadge', {}, `M${o.m}`) : null,
        el('span.tname', {}, o.common || o.name),
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
