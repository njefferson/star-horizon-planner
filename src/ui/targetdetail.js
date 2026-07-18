// =============================================================================
// targetdetail.js (UI) — the per-object details page reached by tapping a
// target's preview image or name. Modelled on the Seestar object page: a large
// representative image, the object's name, a prose description, a tonight
// altitude curve with the current altitude, the coordinates (RA/Dec + live
// Alt/Az), and a prominent primary action.
//
// Everything network is additive and fails closed: the hips2fits image and the
// Wikipedia description each degrade to a placeholder / nothing when offline,
// while the curve, coordinates and framing are computed on-device from the
// active site and always render. The altitude curve is the app's own value —
// it reflects THIS site, and the readout notes where the object clears the
// measured horizon.
// =============================================================================
import { el, clear, toast } from './dom.js';
import { loadCatalog, shortName, framing, isFavorite, toggleFavorite } from '../model/catalog.js';
import { activeInstrument, fovOf, mosaicLayout } from '../model/instruments.js';
import { activeSite } from '../model/sites.js';
import { makeObserver, altAz, altitudeCurve } from '../model/astro.js';
import { makeHorizon, isAbove } from '../model/horizon.js';
import { nightWindow } from '../model/night.js';
import { thumbUrl, detailImageSpec } from '../model/thumbnails.js';
import { fetchDescription } from '../model/describe.js';
import { warmObject, pruneObject } from '../model/precache.js';

function idFromHash() {
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
  const site = activeSite();
  const subtitle = o.common && o.name !== shortName(o) ? o.name : null;

  const desc = el('div.td-desc', {}, [el('p.dim.small', { id: 'td-desc-status' }, 'Loading description…')]);

  app.append(...[
    el('div.td-head', {}, [
      el('button.btn.small', { onclick: () => nav.go('#/targets'), 'aria-label': 'Back to Targets' }, '‹ Targets'),
    ]),
    bigImage(o, inst, fr),
    frameCaption(o, inst, fr),
    el('h1', {}, shortName(o)),
    subtitle ? el('p.dim.td-sub', {}, subtitle) : null,
    el('p.td-tags.mono', {}, [
      el('span.ttype', {}, o.typeLabel || o.type || '—'),
      o.mag != null ? el('span.tnum', {}, `mag ${o.mag.toFixed(1)}`) : null,
      el('span.tier', { class: fr.fits ? 'fits' : 'mosaic' }, fr.fits ? 'fits' : `${fr.cols}×${fr.rows}`),
    ].filter(Boolean)),
    desc,
    site ? visibilitySection(o, site) : null,
    coordinatesSection(o, site),
    el('p.dim.tiny', {}, 'Image: DSS2 colour via CDS hips2fits. Description: Wikipedia. Both load when online.'),
    el('div.td-cta', {}, [
      el('button.btn.primary.block', { onclick: () => { if (!isFavorite(o.id)) { toggleFavorite(o.id); void warmObject(o); } nav.go('#/'); } }, 'See in Tonight ›'),
      favButton(o),
    ]),
  ].filter(Boolean));

  // Prose is best-effort: fill it when it arrives, drop the line if there's no
  // article or we're offline. Never blocks the page.
  fetchDescription(o).then((d) => {
    if (!location.hash.startsWith('#/target/') || !desc.isConnected) return;
    if (!d) { desc.remove(); return; }
    desc.replaceChildren(...[
      el('p.td-prose', {}, d.extract),
      d.url ? el('p.tiny', {}, [el('a.linklike', { href: d.url, target: '_blank', rel: 'noopener' }, 'More on Wikipedia →')]) : null,
    ].filter(Boolean));
  });
}

// --- big image + framing overlay ---------------------------------------------
// The image URL and the overlay geometry both read detailImageSpec(o) — ONE
// spec, so the FOV rectangle cannot drift from the pixels behind it. The
// instrument only changes in Settings (a different view); this page re-renders
// on every navigation, so no live redraw is needed.
function bigImage(o, inst, fr) {
  const spec = detailImageSpec(o);
  const wrap = el('div.td-image');
  const img = el('img.td-img', {
    decoding: 'async', alt: `Representative survey image of ${shortName(o)}`,
    src: thumbUrl(o, spec),
  });
  const overlay = el('canvas.td-frame', { 'aria-hidden': 'true' });
  img.addEventListener('error', () => {
    wrap.classList.add('broken');
    // replaceChildren drops the overlay too — no frame on a placeholder; the
    // caption below the image survives (framing is on-device data).
    wrap.replaceChildren(el('div.td-img-ph', {}, [
      el('span.td-img-ph-mark', { 'aria-hidden': 'true' }, '★'),
      el('span.dim.small', {}, 'Image needs a connection.'),
    ]));
  });
  wrap.append(img, overlay);
  requestAnimationFrame(() => drawFrame(overlay, inst, fr, spec)); // needs a measured width
  return wrap;
}

// The instrument frame is wider than the image in both axes → nothing visible
// to draw; the caption says so instead. (One axis over: draw, the canvas clips.)
function frameTooWide(inst, spec) {
  const fov = fovOf(inst);
  return fov.w_deg >= spec.fovDeg && fov.h_deg >= spec.fovDeg * (spec.height / spec.width);
}

// The overlay's accessible twin — same framing() data, always rendered, even
// when the image errors. The canvas itself is decorative (aria-hidden).
function frameCaption(o, inst, fr) {
  const spec = detailImageSpec(o);
  const shape = fr.fits ? 'fits in one frame' : `${fr.cols}×${fr.rows} mosaic (${Math.round(fr.overlap * 100)}% overlap)`;
  const wide = frameTooWide(inst, spec) ? ' · frame wider than this image' : '';
  return el('p.td-frame-cap.dim.small.mono', {}, `${inst.name} frame · ${shape}${wide}`);
}

// FOV rectangle(s) over the image: hips2fits' fov = the WIDTH of this 800×500
// cutout, so one px-per-degree scale serves both axes (TAN ≤3° ≈ linear).
// Casing-then-white strokes, visible on any sky (the sky/polaraim style).
function drawFrame(canvas, inst, fr, spec) {
  if (!canvas.isConnected || frameTooWide(inst, spec)) return;
  const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 320;
  const cssH = canvas.clientHeight || Math.round(cssW * spec.height / spec.width);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.scale(dpr, dpr);
  const scale = cssW / spec.fovDeg;                  // px per degree
  const fov = fovOf(inst);
  const rw = fov.w_deg * scale, rh = fov.h_deg * scale;
  const panels = mosaicLayout(fr, fov);
  const weight = fr.fits ? 2 : 1.5;                  // single frame slightly heavier
  for (const p of panels) {
    const cx = cssW / 2 + p.dx_deg * scale;
    const cy = cssH / 2 - p.dy_deg * scale;          // dy_deg is "up"; screen y grows down
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = weight + 1.5;
    ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = weight;
    ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
  }
}

// --- visibility (tonight altitude curve + current altitude) ------------------
function visibilitySection(o, site) {
  const observer = makeObserver(site.lat, site.lon, site.elevation_m || 0);
  const profile = makeHorizon(site.horizon);
  const now = new Date();
  const win = nightWindow(observer, now);
  const target = { ra: o.ra, dec: o.dec };
  const curve = altitudeCurve(target, observer, win.start, win.end, 6);
  const nowAA = altAz(target, observer, now);
  const above = isAbove(profile, nowAA.azimuth, nowAA.altitude) && nowAA.altitude > 0;
  const status = nowAA.altitude <= 0 ? 'below the horizon now'
    : above ? 'up and clear of your horizon now' : 'up but behind your horizon now';

  const canvas = el('canvas.td-curve', { role: 'img',
    'aria-label': `Altitude of ${shortName(o)} through tonight at ${site.name}. Current altitude ${nowAA.altitude.toFixed(0)} degrees — ${status}.` });
  const sec = el('section.td-sec', {}, [
    el('h2', {}, 'Visibility'),
    el('p.td-curnow.mono', {}, [
      el('span.td-curalt', {}, `${nowAA.altitude.toFixed(0)}°`),
      el('span.dim.small', {}, `current altitude · ${status}`),
    ]),
    el('div.td-curve-wrap', {}, [canvas]),
  ]);
  // Draw after it's in the DOM (needs a measured width). rAF is enough here.
  requestAnimationFrame(() => drawCurve(canvas, curve, profile, win, now));
  return sec;
}

function drawCurve(canvas, curve, profile, win, now) {
  if (!canvas.isConnected) return;
  const cssW = canvas.clientWidth || 320, cssH = 150;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.scale(dpr, dpr);
  const M = { l: 30, r: 8, t: 8, b: 18 };
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#222';
  const dim = css.getPropertyValue('--dim').trim() || '#888';
  const grid = css.getPropertyValue('--line').trim() || '#ccc';
  const accent = css.getPropertyValue('--accent').trim() || '#b07bd6';
  const t0 = win.start.getTime(), t1 = win.end.getTime();
  const x = (ms) => M.l + (cssW - M.l - M.r) * (ms - t0) / (t1 - t0);
  const y = (alt) => M.t + (cssH - M.t - M.b) * (1 - Math.max(0, Math.min(90, alt)) / 90);

  ctx.strokeStyle = grid; ctx.fillStyle = dim; ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
  for (const a of [0, 30, 60, 90]) {
    const yy = y(a); ctx.beginPath(); ctx.moveTo(M.l, yy); ctx.lineTo(cssW - M.r, yy); ctx.stroke();
    ctx.fillText(`${a}°`, 2, yy);
  }
  // Above-horizon segments brighter than below — the app's horizon cut, on one
  // object's curve (identity is not colour-alone: below-horizon is also dashed).
  const seg = (filter, style, dash) => {
    ctx.strokeStyle = style; ctx.lineWidth = 2; ctx.setLineDash(dash); ctx.beginPath();
    let pen = false;
    for (const c of curve) {
      const on = filter(c);
      if (!on) { pen = false; continue; }
      const px = x(c.time.getTime()), py = y(c.altitude);
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  const clears = (c) => c.altitude > 0 && isAbove(profile, c.azimuth, c.altitude);
  seg(() => true, dim, [3, 3]);          // full curve, faint dashed (up-but-blocked baseline)
  seg(clears, accent, []);               // solid accent where it clears the measured horizon

  // Current-time marker.
  const nx = x(Math.max(t0, Math.min(t1, now.getTime())));
  ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(nx, M.t); ctx.lineTo(nx, cssH - M.b); ctx.stroke(); ctx.globalAlpha = 1;
  const nowAlt = sampleCurve(curve, now.getTime());
  if (nowAlt != null) { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(nx, y(nowAlt), 3.5, 0, Math.PI * 2); ctx.fill(); }
}
function sampleCurve(curve, ms) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    const ta = a.time.getTime(), tb = b.time.getTime();
    if (ms >= ta && ms <= tb) { const f = (ms - ta) / (tb - ta || 1); return a.altitude + f * (b.altitude - a.altitude); }
  }
  return null;
}

// --- coordinates -------------------------------------------------------------
function coordinatesSection(o, site) {
  const rows = [['RA', raHMS(o.ra)], ['Dec', dmsDeg(o.dec, true)]];
  if (site) {
    const aa = altAz({ ra: o.ra, dec: o.dec }, makeObserver(site.lat, site.lon, site.elevation_m || 0), new Date());
    rows.push(['Alt', dmsDeg(aa.altitude, true)], ['Az', dmsDeg(aa.azimuth, false)]);
  }
  return el('section.td-sec', {}, [
    el('h2', {}, 'Coordinates'),
    el('dl.td-facts', {}, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd.mono', {}, v)])),
    el('p.dim.small', {}, `Apparent size ${o.size ? `${sizeStr(o.size.maj)} × ${sizeStr(o.size.min ?? o.size.maj)}` : '—'} · framing on ${activeInstrument().name}.`),
  ]);
}

function favButton(o) {
  const on = isFavorite(o.id);
  const b = el('button.btn', {
    'aria-pressed': on ? 'true' : 'false',
    onclick: () => {
      const now = toggleFavorite(o.id);
      b.setAttribute('aria-pressed', now ? 'true' : 'false');
      b.textContent = now ? '★ Favourited' : '☆ Favourite';
      // Fire-and-forget: warm (or drop) this object's offline images. Never
      // blocks the click; failures stay silent (model/precache.js doctrine).
      void (now ? warmObject(o) : pruneObject(o));
      toast(now ? 'Added to favourites.' : 'Removed from favourites.');
    },
  }, on ? '★ Favourited' : '☆ Favourite');
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
function pad2(n) { return String(n).padStart(2, '0'); }
function raHMS(hours) {
  let h = Math.floor(hours); let rem = (hours - h) * 60;
  let m = Math.floor(rem); let s = Math.round((rem - m) * 60);
  if (s === 60) { s = 0; m += 1; } if (m === 60) { m = 0; h = (h + 1) % 24; }
  return `${h}h ${pad2(m)}m ${pad2(s)}s`;
}
// Degrees → ±DD° MM′ SS″ (signed) or DDD° MM′ SS″ (unsigned, for azimuth).
function dmsDeg(deg, signed) {
  const sign = deg < 0 ? '−' : '+'; const a = Math.abs(deg);
  let d = Math.floor(a); let rem = (a - d) * 60;
  let m = Math.floor(rem); let s = Math.round((rem - m) * 60);
  if (s === 60) { s = 0; m += 1; } if (m === 60) { m = 0; d += 1; }
  return `${signed ? sign : ''}${d}° ${pad2(m)}′ ${pad2(s)}″`;
}
