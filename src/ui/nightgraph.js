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
import { makeObserver, altitudeCurve, moonAltAz, moonInfo, moonSeparation } from '../model/astro.js';
import { makeHorizon, isAbove, isFlat } from '../model/horizon.js';
import { visibility } from '../model/visibility.js';
import { activeInstrument } from '../model/instruments.js';
import { loadCatalog, favoriteIds, shortName } from '../model/catalog.js';
import { activeSite } from '../model/sites.js';
import { nightWindow, sampleTwilight } from '../model/night.js';

const H = 320;                    // graph height, CSS px
const M = { l: 32, r: 12, t: 12, b: 24 };
const ALT_MAX = 90;
const STEP_MIN = 4;               // sampling cadence for the curves

// Fixed night-sky palette (the graph is a dark viz in both app themes).
const BAND = { day: '#3a4a63', civil: '#2c3a54', nautical: '#20293f', astronomical: '#161c2e', night: '#0d1018' };
const AXIS = '#8a93ad', GRID = 'rgba(160,170,200,.14)', MOON = '#cfd6e6';
// Colour-blind-safe categorical order (accessibility standing order). Validated
// against the graph surface #0d1018 with the dataviz CVD validator — PASS on
// all five checks, worst adjacent ΔE 8.4 protan (vs the FAILING previous set:
// 5.2 deutan, 14.9 normal). Re-run the validator before changing these:
//   node <dataviz-skill>/scripts/validate_palette.js "<hexes>" --mode dark --surface "#0d1018"
const SERIES = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];
// Identity is NEVER carried by colour alone — each series also gets a distinct
// marker shape, drawn on the curve and mirrored in the legend, table and scrub.
const MARKS = ['circle', 'square', 'triangle', 'diamond', 'plus', 'cross', 'downtri', 'pentagon'];
const CASE = '#0d1018';           // dark casing stroked under bright curve runs
const MAX_TARGETS = 8;
const seriesMark = (i) => MARKS[i % MARKS.length];

export async function renderTonight(app, state, nav) {
  clear(app);
  const site = activeSite();
  if (!site) { app.append(el('h1', {}, 'Tonight'), noSiteGate(nav)); return; }

  app.append(el('p.empty', {}, 'Loading tonight…'));
  let objects;
  try { objects = await loadCatalog(); } catch { clear(app); app.append(el('h1', {}, 'Tonight'), deadEnd('Catalog unavailable', 'Reopen once online to cache it.')); return; }
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
      target: t, color: SERIES[i % SERIES.length], mark: seriesMark(i),
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
  // The canvas is the graph; assistive tech gets a summary + a pointer to the
  // text visibility table below, which carries the same data row by row.
  base.setAttribute('role', 'img');
  base.setAttribute('aria-label',
    `Altitude-versus-time graph for ${targets.map((t) => shortName(t)).join(', ')}, cut by your measured horizon. The visibility table below lists each target's windows in text.`);
  over.setAttribute('aria-hidden', 'true');
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
  // A dark casing under the bright run keeps every colour legible across all
  // twilight bands, and a marker shape carries identity without colour.
  const labelPeaks = series.length <= 4; // direct labels only when uncluttered
  for (const ser of series) {
    ctx.globalAlpha = 0.32; ctx.strokeStyle = ser.color; ctx.lineWidth = 2;
    strokeCurve(ctx, s, ser.pts, true);          // full up-portion, faint
    ctx.globalAlpha = 1;
    ctx.strokeStyle = CASE; ctx.lineWidth = 4;
    strokeVisible(ctx, s, ser.pts);              // casing
    ctx.strokeStyle = ser.color; ctx.lineWidth = 2;
    strokeVisible(ctx, s, ser.pts);              // above-horizon runs, solid
    drawMarksAlong(ctx, s, ser);                 // shape markers on the visible run
    if (labelPeaks) drawPeakLabel(ctx, s, ser);
  }
  ctx.globalAlpha = 1;
}

// Place the series' marker shape along its visible run, ~every 45 min, plus one
// at the peak. Markers are the colour-independent identity channel.
function drawMarksAlong(ctx, s, ser) {
  const vis = ser.pts.filter((p) => p.vis);
  if (!vis.length) return;
  const stepMs = 45 * 60000;
  let nextAt = vis[0].ms, peak = vis[0];
  for (const p of vis) {
    if (p.alt > peak.alt) peak = p;
    if (p.ms >= nextAt) { drawMark(ctx, ser.mark, s.x(p.ms), s.y(p.alt), 4, ser.color); nextAt = p.ms + stepMs; }
  }
  drawMark(ctx, ser.mark, s.x(peak.ms), s.y(peak.alt), 4.5, ser.color);
}

function drawPeakLabel(ctx, s, ser) {
  const vis = ser.pts.filter((p) => p.vis);
  if (!vis.length) return;
  const peak = vis.reduce((a, b) => (b.alt > a.alt ? b : a), vis[0]);
  const label = shortName(ser.target);
  ctx.font = '600 11px ' + LABEL_FONT; ctx.textBaseline = 'bottom';
  // Keep the label inside the plot: left/right-align near the edges so it
  // never clips off the canvas.
  const half = ctx.measureText(label).width / 2;
  const x = peak.ms, px = s.x(x);
  ctx.textAlign = px - half < M.l ? 'left' : px + half > s.W - M.r ? 'right' : 'center';
  const lx = ctx.textAlign === 'left' ? M.l : ctx.textAlign === 'right' ? s.W - M.r : px;
  const y = s.y(peak.alt) - 9;
  ctx.lineWidth = 3; ctx.strokeStyle = CASE; ctx.strokeText(label, lx, y); // casing for legibility
  ctx.fillStyle = ser.color; ctx.fillText(label, lx, y);
}
const LABEL_FONT = "'IBM Plex Sans', system-ui, sans-serif";

// Draw one marker shape centred at (x,y). Shapes are visually distinct at r≈4.
function drawMark(ctx, shape, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath();
  switch (shape) {
    case 'square': ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.fill(); break;
    case 'triangle': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.fill(); break;
    case 'downtri': ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y - r); ctx.closePath(); ctx.fill(); break;
    case 'diamond': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); break;
    case 'plus': ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); break;
    case 'cross': ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); break;
    case 'pentagon':
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; const px = x + r * Math.cos(a), py = y + r * Math.sin(a); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill(); break;
    default: ctx.arc(x, y, r, 0, 7); ctx.fill(); // circle
  }
  ctx.restore();
}

// The DOM twin of drawMark — the same shape as an inline SVG for the legend,
// visibility table and scrub readout, so identity matches the canvas exactly.
function markSvg(shape, color) {
  const c = 7, r = 5;
  let inner;
  switch (shape) {
    case 'square': inner = `<rect x="${c - r}" y="${c - r}" width="${2 * r}" height="${2 * r}" fill="${color}"/>`; break;
    case 'triangle': inner = `<polygon points="${c},${c - r} ${c + r},${c + r} ${c - r},${c + r}" fill="${color}"/>`; break;
    case 'downtri': inner = `<polygon points="${c},${c + r} ${c + r},${c - r} ${c - r},${c - r}" fill="${color}"/>`; break;
    case 'diamond': inner = `<polygon points="${c},${c - r} ${c + r},${c} ${c},${c + r} ${c - r},${c}" fill="${color}"/>`; break;
    case 'plus': inner = `<path d="M${c - r} ${c}H${c + r}M${c} ${c - r}V${c + r}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`; break;
    case 'cross': inner = `<path d="M${c - r} ${c - r}L${c + r} ${c + r}M${c + r} ${c - r}L${c - r} ${c + r}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`; break;
    case 'pentagon': {
      const pts = [];
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 5; pts.push(`${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`); }
      inner = `<polygon points="${pts.join(' ')}" fill="${color}"/>`; break;
    }
    default: inner = `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/>`;
  }
  return el('span.ng-mark', { html: `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${inner}</svg>` });
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
    if (p.up) drawMark(ctx, ser.mark, x, s.y(p.alt), 4.5, ser.color);
    rows.push({ color: ser.color, mark: ser.mark, name: shortName(ser.target), alt: p.alt, vis: p.vis, up: p.up });
  }
  readout.replaceChildren(
    el('div.ng-ro-time', {}, hourLabelFull(ms)),
    ...rows.map((r) => el('div.ng-ro-row', {}, [
      markSvg(r.mark, r.color),
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
      el('button.chip.ng-site', { onclick: () => nav.go('#/sites'), 'aria-label': `Site: ${label} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${label}`)]),
    ]),
    favCount > shown ? el('p.dim.small', {}, `Showing ${shown} of ${favCount} favourites (first ${MAX_TARGETS}).`) : null,
  ]);
}

function buildLegend(series, moonNow) {
  return el('div.ng-legend', {}, [
    ...series.map((s) => el('span.ng-leg', {}, [
      markSvg(s.mark, s.color),
      el('span', {}, shortName(s.target)),
    ])),
    el('span.ng-leg', {}, [
      el('span.ng-leg-dot.moon', { 'aria-hidden': 'true' }, ''),
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
    if (v.effectiveDropped > 0) flags.push(`${v.effectiveDropped} brief peek${v.effectiveDropped === 1 ? '' : 's'} dropped`);

    // Moon interference, judged at the moment you'd actually shoot: the middle
    // of the first effective window (else transit, else mid-night). Shown only
    // while the Moon is up; flagged when close AND bright — < 25° separation
    // with ≥ 40% illumination is the usual wash-out rule of thumb.
    const ref = v.effective.length
      ? new Date((v.effective[0].start.getTime() + v.effective[0].end.getTime()) / 2)
      : (v.transit ? v.transit.time : midOf(win));
    const mi = moonInfo(observer, ref);
    let moonChip = null;
    if (mi.altitude > 0) {
      const sep = moonSeparation({ ra: s.target.ra, dec: s.target.dec }, observer, ref);
      const washed = sep < 25 && mi.illumination >= 0.4;
      // The warning must not ride on color alone: add "· close" text so the
      // caution reads without seeing the colour (accessibility standing order).
      moonChip = el('span.vis-moon', {
        class: washed ? 'warn' : '',
        title: `Moon ${Math.round(mi.illumination * 100)}% lit, ${Math.round(sep)}° from this target at ${hm(ref)}`,
      }, [el('span', { 'aria-hidden': 'true' }, '☾ '), `${Math.round(sep)}°${washed ? ' · close' : ''}`]);
    }
    return el('li.vis-row', {}, [
      markSvg(s.mark, s.color),
      el('div.vis-main', {}, [
        el('div.vis-name', {}, shortName(s.target)),
        el('div.vis-sub', {}, [
          el('span.dim', {}, geo),
          v.transit ? el('span.dim', {}, ` · peak ${v.transit.altitude.toFixed(0)}°`) : null,
          ...flags.map((f) => el('span.vis-flag', {}, f)),
          moonChip,
        ]),
      ]),
      el('div.vis-eff', {}, v.effective.length
        ? [el('span.vis-eff-label', {}, 'above your horizon'), el('span.vis-eff-win', {}, eff)]
        : [el('span.vis-none', {}, 'not clear tonight')]),
    ]);
  });
  return el('section.vis-section', {}, [
    el('h2', {}, 'Visibility tonight'),
    el('p.dim.small', {}, 'Effective windows are when each target clears your treeline and stays below the mount’s zenith dead-zone — the times you can actually shoot it. ☾ is the Moon’s distance from the target while the Moon is up, flagged when close and bright.'),
    el('ul.vis-list', {}, rows),
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
