// =============================================================================
// targetdetail.js (UI) — the per-object details page reached by tapping a
// target's preview image or name. A larger representative image (same hips2fits
// source as the list thumbnail, bigger and wider-field), the object's facts,
// how the ACTIVE instrument frames it (fits vs mosaic), and a favourite toggle.
// The big image degrades to a labelled placeholder offline — never a broken
// glyph — so the facts always stand on their own.
//
// FIRST PASS: layout and fields will be tuned to Noah's details-page example.
// =============================================================================
import { el, clear, toast } from './dom.js';
import { loadCatalog, shortName, framing, isFavorite, toggleFavorite } from '../model/catalog.js';
import { activeInstrument } from '../model/instruments.js';
import { thumbUrl } from '../model/thumbnails.js';

function idFromHash() {
  // '#/target/NGC1952' → 'NGC1952' (tolerate a trailing query/hash).
  const raw = (location.hash.split('/')[2] || '').split('?')[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export async function renderTargetDetail(app, state, nav) {
  clear(app);
  const id = idFromHash();
  app.append(el('p.empty', {}, 'Loading…'));
  let objects;
  try { objects = await loadCatalog(); }
  catch { clear(app); app.append(el('h1', {}, 'Target'), deadEnd('Catalog unavailable', 'Reopen once online to cache it.', nav)); return; }
  if (!location.hash.startsWith('#/target/')) return; // navigated away mid-load

  const o = objects.find((x) => x.id === id);
  clear(app);
  if (!o) { app.append(el('h1', {}, 'Not found'), deadEnd('No such object', 'That target isn’t in the catalog.', nav)); return; }

  const inst = activeInstrument();
  const fr = framing(o, inst);

  const subtitle = o.common && o.name !== shortName(o) ? o.name : null;
  // Native .append() stringifies null — build the child list and filter first.
  app.append(...[
    el('div.td-head', {}, [
      el('button.btn.small', { onclick: () => nav.go('#/targets'), 'aria-label': 'Back to Targets' }, '‹ Targets'),
    ]),
    el('h1', {}, shortName(o)),
    subtitle ? el('p.dim', {}, subtitle) : null,
    bigImage(o),
    el('div.td-actions', {}, [favButton(o), el('button.btn', { onclick: () => nav.go('#/') }, 'See in Tonight')]),
    factGrid(o, inst, fr),
    el('p.dim.small', {}, 'Image: DSS2 colour survey via CDS hips2fits (loads when online).'),
  ].filter(Boolean));
}

function bigImage(o) {
  const wrap = el('div.td-image');
  const img = el('img.td-img', {
    decoding: 'async', alt: `Representative survey image of ${shortName(o)}`,
    src: thumbUrl(o, { width: 640, height: 480, fovDeg: Math.min(3, Math.max(0.3, thumbFov(o))) }),
  });
  img.addEventListener('error', () => {
    wrap.classList.add('broken');
    wrap.replaceChildren(el('div.td-img-ph', {}, [
      el('span.td-img-ph-mark', { 'aria-hidden': 'true' }, '★'),
      el('span.dim.small', {}, 'Image needs a connection.'),
    ]));
  });
  wrap.append(img);
  return wrap;
}
// A slightly wider field than the list thumb so the object sits in context.
function thumbFov(o) { const maj = o.size && o.size.maj ? o.size.maj / 60 : 0.15; return maj * 3; }

function factGrid(o, inst, fr) {
  const rows = [
    ['Type', o.typeLabel || o.type || '—'],
    ['Magnitude', o.mag != null ? o.mag.toFixed(1) : '—'],
    ['Apparent size', o.size ? `${sizeStr(o.size.maj)} × ${sizeStr(o.size.min ?? o.size.maj)}` : '—'],
    ['Right ascension', raStr(o.ra)],
    ['Declination', decStr(o.dec)],
    [`Framing · ${inst.name}`, fr.fits ? 'Fits in one frame' : `Mosaic ${fr.cols}×${fr.rows} (${fr.panels} panels)`],
  ];
  return el('dl.td-facts', {}, rows.flatMap(([k, v]) => [
    el('dt', {}, k), el('dd.mono', {}, String(v)),
  ]));
}

function favButton(o) {
  const on = isFavorite(o.id);
  const b = el('button.btn.primary', {
    'aria-pressed': on ? 'true' : 'false',
    onclick: () => {
      const now = toggleFavorite(o.id);
      b.setAttribute('aria-pressed', now ? 'true' : 'false');
      b.textContent = now ? '★ Favourited' : '☆ Add favourite';
      toast(now ? 'Added to favourites — it’ll plot on Tonight.' : 'Removed from favourites.');
    },
  }, on ? '★ Favourited' : '☆ Add favourite');
  return b;
}

function deadEnd(title, body, nav) {
  return el('div.dead-end', {}, [
    el('h2', {}, title), el('p', {}, body),
    el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/targets') }, 'Back to Targets')]),
  ]);
}

// --- formatting --------------------------------------------------------------
function sizeStr(arcmin) { return arcmin >= 60 ? `${(arcmin / 60).toFixed(1)}°` : `${arcmin.toFixed(arcmin < 10 ? 1 : 0)}′`; }
function raStr(hours) {
  const h = Math.floor(hours); const m = Math.round((hours - h) * 60);
  return `${h}h ${String(m === 60 ? 0 : m).padStart(2, '0')}m`;
}
function decStr(deg) {
  const s = deg < 0 ? '−' : '+'; const a = Math.abs(deg);
  const d = Math.floor(a); const m = Math.round((a - d) * 60);
  return `${s}${d}° ${String(m === 60 ? 0 : m).padStart(2, '0')}′`;
}
