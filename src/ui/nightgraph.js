// =============================================================================
// nightgraph.js — the money shot. A hand-rolled Canvas-2D graph (no chart lib,
// following the photo studio's histogram routine): altitude-vs-time curves for
// your favourite targets, CUT BY YOUR MEASURED HORIZON (bright where the target
// clears your treeline, faded where it's up but blocked), twilight bands shaded
// behind, the Moon's path + phase, sunset/sunrise markers, and a drag scrub
// that reads every target's altitude at a moment.
//
// Two stacked canvases: a base (bands/grid/curves, repainted on data change)
// and a light overlay (just the scrub cursor) so scrubbing stays cheap.
// =============================================================================
import { el, clear } from './dom.js';
import { makeObserver, altitudeCurve, moonAltAz, moonInfo } from '../model/astro.js';
import { makeHorizon, isAbove, isFlat } from '../model/horizon.js';
import { visibility } from '../model/visibility.js';
import { activeInstrument } from '../model/instruments.js';
import { loadCatalog, favoriteIds } from '../model/catalog.js';
import { activeSite } from '../model/sites.js';
import { nightWindow, sampleTwilight } from '../model/night.js';

const H = 320;                    // graph height, CSS px
const M = { l: 32, r: 12, t: 12, b: 24 };
const ALT_MAX = 90;
const STEP_MIN = 4;               // sampling cadence for the curves

// Fixed night-sky palette (the graph is a dark viz in both app themes).
const BAND = { day: '#3a4a63', civil: '#2c3a54', nautical: '#20293f', astronomical: '#161c2e', night: '#0d1018' };
const AXIS = '#8a93ad', GRID = 'rgba(160,170,200,.14)', MOON = '#cfd6e6', SUNMARK = '#f0a94e', INK = '#e9ecf7';
const SERIES = ['#f0a94e', '#c39be8', '#5fae79', '#7fb0da', '#e8795a', '#e0c24e', '#5fd0c0', '#d98cc0'];
const MAX_TARGETS = 8;

export async function renderTonight(app, state, nav) {
  clear(app);
  const site = activeSite();
  if (!site) return app.append(noSiteGate(nav));

  app.append(el('p.empty', {}, 'Loading tonight…'));
  let objects;
  try { objects = await loadCatalog(); } catch { clear(app); app.append(deadEnd('Catalog unavailable', 'Reopen once online to cache it.')); return; }
  if ((location.hash || '#/') !== '#/' && !location.hash.startsWith('#/tonight')) return;

  const favIds = favoriteIds();
  const targets = objects.filter((o) => favIds.has(o.id)).slice(0, MAX_TARGETS);
  clear(app);
  app.append(header(state, nav, site, targets.length, favIds.size));

  if (!targets.length) {
    app.append(deadEnd('No targets picked yet',
      'Star a few objects in Targets and they’ll be plotted here — each curve cut by your measured horizon.',
      { label: 'Go to Targets', onClick: () => nav.go('#/targets') }));
    return;
  }

  const observer = makeObserver(site.lat, site.lon, site.elevation_m || 0);
  const profile = makeHorizon(site.horizon);
  const win = nightWindow(observer, state.night);
  const twilight = sampleTwilight(observer, win.start, win.end, STEP_MIN);

  // Per-target series with per-sample horizon visibility.
  const series = targets.map((t, i) => {
    const curve = altitudeCurve({ ra: t.ra, dec: t.dec }, observer, win.start, win.end, STEP_MIN);
    return {
      target: t, color: SERIES[i % SERIES.length],
      pts: curve.map((c) => ({
        ms: c.time.getTime(), alt: c.altitude,
        vis: isAbove(profile, c.azimuth, c.altitude), up: c.altitude > 0,
      })),
    };
  });
  const moonPts = sampleMoon(observer, win.start, win.end);
  const moonNow = moonInfo(observer, midOf(win));

  const model = buildScales(win);
  const wrap = el('div.ng-wrap');
  const base = document.createElement('canvas'); base.className = 'ng-base';
  const over = document.createElement('canvas'); over.className = 'ng-over';
  wrap.append(base, over);
  const readout = el('div.ng-readout', {}, hintText(profile));
  const legend = buildLegend(series, moonNow);

  const instrument = activeInstrument();
  app.append(wrap, legend, readout,
    visibilitySection(series, observer, profile, win, instrument),
    el('p.settings-foot', {}, win.polar
      ? 'The Sun stays up all “night” at this site/date — showing a fixed window.'
      : `Sunset ${hm(win.sunset)} · sunrise ${hm(win.sunrise)} (device time). Bright = above your horizon; faded = up but behind the treeline.`));

  function draw() {
    const w = wrap.clientWidth || 640;
    model.setWidth(w);
    sizeCanvas(base, w, H); sizeCanvas(over, w, H);
    drawBase(base.getContext('2d'), model, { twilight, series, moonPts, win });
  }
  draw();
  window.addEventListener('resize', draw, { passive: true });

  // Scrub — pointer/drag reads altitudes at a time.
  const octx = over.getContext('2d');
  function scrub(clientX) {
    const r = over.getBoundingClientRect();
    const px = clientX - r.left;
    const ms = model.tOf(px);
    drawScrub(octx, model, ms, series, profile, observer, readout);
  }
  over.addEventListener('pointerdown', (e) => { over.setPointerCapture(e.pointerId); scrub(e.clientX); });
  over.addEventListener('pointermove', (e) => { if (e.pressure > 0 || e.buttons) scrub(e.clientX); });
  // Leave the last reading + cursor on screen after release — on a phone you
  // lift your finger to read the numbers. Hover (no button) also scrubs.
  over.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) scrub(e.clientX); });
}

// --- scales -----------------------------------------------------------------
function buildScales(win) {
  let W = 640;
  const t0 = win.start.getTime(), t1 = win.end.getTime();
  const plotW = () => W - M.l - M.r;
  const plotH = H - M.t - M.b;
  return {
    setWidth(w) { W = w; },
    get W() { return W; },
    x: (ms) => M.l + ((ms - t0) / (t1 - t0)) * plotW(),
    y: (alt) => M.t + (1 - Math.max(0, Math.min(ALT_MAX, alt)) / ALT_MAX) * plotH,
    tOf: (px) => t0 + Math.max(0, Math.min(1, (px - M.l) / plotW())) * (t1 - t0),
    t0, t1, plotH,
  };
}

// --- base render ------------------------------------------------------------
function drawBase(ctx, s, { twilight, series, moonPts }) {
  const W = s.W, plotBottom = M.t + s.plotH;
  ctx.clearRect(0, 0, W, H);

  // Twilight bands: fill contiguous same-band runs.
  for (let i = 0; i < twilight.length - 1; i++) {
    const x0 = s.x(twilight[i].t.getTime()), x1 = s.x(twilight[i + 1].t.getTime());
    ctx.fillStyle = BAND[twilight[i].band] || BAND.night;
    ctx.fillRect(x0, M.t, x1 - x0 + 1, s.plotH);
  }

  // Altitude gridlines + labels.
  ctx.fillStyle = AXIS; ctx.font = '11px ui-monospace, monospace'; ctx.textBaseline = 'middle';
  for (const alt of [0, 30, 60, 90]) {
    const y = s.y(alt);
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(W - M.r, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(`${alt}°`, M.l - 4, y);
  }
  // Hour gridlines + labels.
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let ms = ceilHour(s.t0); ms <= s.t1; ms += 3600000) {
    const x = s.x(ms);
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, plotBottom); ctx.stroke();
    ctx.fillStyle = AXIS; ctx.fillText(hourLabel(ms), x, plotBottom + 4);
  }

  // Moon path (dashed).
  ctx.strokeStyle = MOON; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
  strokeCurve(ctx, s, moonPts.map((p) => ({ ms: p.ms, alt: p.alt, up: p.alt > 0 })), true);
  ctx.setLineDash([]);

  // Target curves: faint where up-but-blocked, bright where above the horizon.
  for (const ser of series) {
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.32; ctx.strokeStyle = ser.color;
    strokeCurve(ctx, s, ser.pts, true);         // full up-portion, faint
    ctx.globalAlpha = 1;
    strokeVisible(ctx, s, ser.pts);              // above-horizon runs, solid
  }
  ctx.globalAlpha = 1;
}

// Stroke a curve through samples with alt>0 (breaking where it sets).
function strokeCurve(ctx, s, pts, upOnly) {
  ctx.beginPath(); let pen = false;
  for (const p of pts) {
    if (upOnly && !p.up) { pen = false; continue; }
    const x = s.x(p.ms), y = s.y(p.alt);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
// Stroke only the runs where the target clears the measured horizon.
function strokeVisible(ctx, s, pts) {
  ctx.beginPath(); let pen = false;
  for (const p of pts) {
    if (!p.vis) { pen = false; continue; }
    const x = s.x(p.ms), y = s.y(p.alt);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// --- scrub overlay ----------------------------------------------------------
function drawScrub(ctx, s, ms, series, profile, observer, readout) {
  const W = s.W;
  ctx.clearRect(0, 0, W, H);
  const x = s.x(ms);
  ctx.strokeStyle = 'rgba(233,236,247,.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, M.t + s.plotH); ctx.stroke();

  const rows = [];
  for (const ser of series) {
    const p = nearest(ser.pts, ms);
    if (!p) continue;
    if (p.up) { ctx.fillStyle = ser.color; ctx.beginPath(); ctx.arc(x, s.y(p.alt), 3.5, 0, 7); ctx.fill(); }
    rows.push({ color: ser.color, name: ser.target.common || ser.target.name, alt: p.alt, vis: p.vis, up: p.up });
  }
  readout.replaceChildren(
    el('div.ng-ro-time', {}, hourLabelFull(ms)),
    ...rows.map((r) => el('div.ng-ro-row', {}, [
      el('span.ng-ro-dot', { style: `background:${r.color}` }),
      el('span.ng-ro-name', {}, r.name),
      el('span.ng-ro-alt', {}, r.up ? `${r.alt.toFixed(0)}°` : 'down'),
      el('span.ng-ro-flag', { class: r.up && r.vis ? 'ok' : 'no' },
        !r.up ? '' : r.vis ? 'clear' : 'behind trees'),
    ])),
  );
}

// --- header / gates / legend ------------------------------------------------
function header(state, nav, site, shown, favCount) {
  const label = site.name || `${site.lat.toFixed(2)}, ${site.lon.toFixed(2)}`;
  return el('div.ng-head', {}, [
    el('div.ng-head-top', {}, [el('h1', {}, 'Tonight')]),
    el('div.ng-datenav', {}, [
      el('button.btn.small', { onclick: () => shiftNight(state, nav, -1) }, '‹ Prev'),
      el('button.btn.small', { onclick: () => { state.night = noonToday(); nav.rerender(); } }, nightLabel(state.night)),
      el('button.btn.small', { onclick: () => shiftNight(state, nav, +1) }, 'Next ›'),
      el('button.chip.ng-site', { onclick: () => nav.go('#/sites') }, `📍 ${label}`),
    ]),
    favCount > shown ? el('p.dim.small', {}, `Showing ${shown} of ${favCount} favourites (first ${MAX_TARGETS}).`) : null,
  ]);
}

function buildLegend(series, moonNow) {
  return el('div.ng-legend', {}, [
    ...series.map((s) => el('span.ng-leg', {}, [
      el('span.ng-leg-dot', { style: `background:${s.color}` }),
      el('span', {}, s.target.common || s.target.name),
    ])),
    el('span.ng-leg', {}, [
      el('span.ng-leg-dot.moon', {}, ''),
      el('span', {}, `Moon · ${moonNow.phaseName} ${Math.round(moonNow.illumination * 100)}%`),
    ]),
  ]);
}

// The visibility table — from the same nightly computation, both the plain
// rise/set and the effective "above MY horizon" window (emphasised), per target.
function visibilitySection(series, observer, profile, win, instrument) {
  const rows = series.map((s) => {
    const v = visibility({ ra: s.target.ra, dec: s.target.dec }, observer, profile,
      { start: win.start, end: win.end, instrument });
    const eff = v.effective.map(fmtIv).join(', ');
    const geo = v.geometric.length ? `${fmtIv(v.geometric[0], v.geometric)} up` : 'never up';
    const flags = [];
    if (v.clipsDeadZone) flags.push('clips zenith');
    if (!isFlat(profile) && v.effective.length && v.geometric.length &&
        totalEff(v.effective) < totalEff(v.geometric)) flags.push('trimmed by horizon');
    return el('div.vis-row', {}, [
      el('span.vis-dot', { style: `background:${s.color}` }),
      el('div.vis-main', {}, [
        el('div.vis-name', {}, s.target.common || s.target.name),
        el('div.vis-sub', {}, [
          el('span.dim', {}, geo),
          v.transit ? el('span.dim', {}, ` · peak ${v.transit.altitude.toFixed(0)}°`) : null,
          ...flags.map((f) => el('span.vis-flag', {}, f)),
        ]),
      ]),
      el('div.vis-eff', {}, v.effective.length
        ? [el('span.vis-eff-label', {}, 'above your horizon'), el('span.vis-eff-win', {}, eff)]
        : [el('span.vis-none', {}, 'not clear tonight')]),
    ]);
  });
  return el('section.vis-section', {}, [
    el('h2', {}, 'Visibility tonight'),
    el('p.dim.small', {}, 'Effective windows are when each target clears your treeline and stays below the mount’s zenith dead-zone — the times you can actually shoot it.'),
    el('div.vis-list', {}, rows),
  ]);
}
const fmtIv = (iv) => `${hm(iv.start)}–${hm(iv.end)}`;
const totalEff = (list) => list.reduce((m, iv) => m + (iv.end - iv.start), 0);

function hintText(profile) {
  return [el('span.dim.small', {}, isFlat(profile)
    ? 'Drag across the graph to read altitudes. Tip: set your horizon so curves get cut by your real treeline.'
    : 'Drag across the graph to read each target’s altitude and whether it clears your horizon.')];
}

function noSiteGate(nav) {
  return deadEndNode('Add an observing site', 'The night graph needs a site — its coordinates place the sky and its horizon cuts the curves.', [
    el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites'),
  ]);
}

// --- helpers ----------------------------------------------------------------
function sampleMoon(observer, start, end) {
  const out = []; const step = STEP_MIN * 60000;
  for (let ms = start.getTime(); ms <= end.getTime() + 1; ms += step) {
    out.push({ ms, alt: moonAltAz(observer, new Date(ms)).altitude });
  }
  return out;
}
function nearest(pts, ms) {
  let best = null, bd = Infinity;
  for (const p of pts) { const d = Math.abs(p.ms - ms); if (d < bd) { bd = d; best = p; } }
  return best;
}
function sizeCanvas(cv, w, h) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
const midOf = (win) => new Date((win.start.getTime() + win.end.getTime()) / 2);
const noonToday = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
function shiftNight(state, nav, days) { const d = new Date(state.night); d.setDate(d.getDate() + days); state.night = d; nav.rerender(); }
function nightLabel(d) {
  const t = noonToday();
  if (sameDay(d, t)) return 'Tonight';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const ceilHour = (ms) => Math.ceil(ms / 3600000) * 3600000;
const hourLabel = (ms) => String(new Date(ms).getHours()).padStart(2, '0');
const hourLabelFull = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hm = (d) => d ? hourLabelFull(d.getTime()) : '—';
function deadEnd(title, body, action) { return deadEndNode(title, body, action ? [el('button.btn.primary', { onclick: action.onClick }, action.label)] : []); }
function deadEndNode(title, body, buttons) {
  return el('div.dead-end', {}, [el('h2', {}, title), el('p', {}, body), el('div.card-actions', {}, buttons)]);
}
