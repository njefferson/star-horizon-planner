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
import { SERIES, CASE, seriesMark, drawMark, markSvg } from './marks.js';
import { makeObserver, altitudeCurve, moonAltAz, moonInfo, moonSeparation } from '../model/astro.js';
import { makeHorizon, isAbove, isFlat } from '../model/horizon.js';
import { visibility, visibleTonight } from '../model/visibility.js';
import { activeInstrument } from '../model/instruments.js';
import { loadCatalog, favoriteIds, shortName } from '../model/catalog.js';
import { activeSite } from '../model/sites.js';
import { nightWindow, darkWindow, sampleTwilight } from '../model/night.js';
import { useMyLocation, openLocationSearch } from './location.js';

const HIGHLIGHTS = 6; // brightest targets to preview when nothing is favourited yet

const H = 320;                    // graph height, CSS px
const M = { l: 32, r: 12, t: 12, b: 24 };
const ALT_MAX = 90;
const STEP_MIN = 4;               // sampling cadence for the curves

// Fixed night-sky palette (the graph is a dark viz in both app themes). The
// twilight ramp stays BLUE all the way down — deepest night is a deep navy,
// not black, like a real dark sky.
const BAND = { day: '#2e4a72', civil: '#243c5e', nautical: '#1b2e4c', astronomical: '#13233d', night: '#0d1b31' };
const AXIS = '#8a93ad', GRID = 'rgba(160,170,200,.14)', MOON = '#cfd6e6';
// The categorical series palette + marker shapes live in ui/marks.js (shared
// with the AR sky view so a target reads identically in both). SERIES, CASE,
// seriesMark, drawMark and markSvg are imported above.
const MAX_TARGETS = 8;

export async function renderTonight(app, state, nav) {
  clear(app);
  const site = activeSite();
  if (!site) { app.append(el('h1', {}, 'Tonight'), noSiteGate(nav)); return; }

  app.append(el('p.empty', {}, 'Loading tonight…'));
  let objects;
  try { objects = await loadCatalog(); } catch { clear(app); app.append(el('h1', {}, 'Tonight'), deadEnd('Catalog unavailable', 'Reopen once online to cache it.')); return; }
  if ((location.hash || '#/') !== '#/' && !location.hash.startsWith('#/tonight')) return;

  const observer = makeObserver(site.lat, site.lon, site.elevation_m || 0);
  const profile = makeHorizon(site.horizon);
  const win = nightWindow(observer, state.night);

  const favIds = favoriteIds();
  let targets = objects.filter((o) => favIds.has(o.id)).slice(0, MAX_TARGETS);

  // The whole point of opening the app is "what's up above me tonight" — so
  // even before you've starred anything, preview tonight's brightest showpieces
  // that clear your horizon during dark hours. Starring your own supersedes it.
  let previewing = false;
  if (!targets.length) {
    const upIds = visibleTonight(objects, observer, profile, { window: darkWindow(observer, state.night), instrument: activeInstrument() });
    const up = objects.filter((o) => upIds.has(o.id) && o.mag != null).sort((a, b) => a.mag - b.mag);
    targets = (up.length ? up : objects.filter((o) => o.mag != null).sort((a, b) => a.mag - b.mag)).slice(0, HIGHLIGHTS);
    previewing = targets.length > 0;
  }

  clear(app);
  app.append(header(state, nav, site, targets.length, favIds.size, previewing));

  // The premier v2.0.0 feature — an unmissable full-width call-to-action at the
  // top of Tonight, sitting below the header so the fixed corner buttons never
  // overlap it. Leads straight into the AR arcs-across-the-sky view.
  app.append(el('button.ng-sky-hero', {
    onclick: () => nav.go('#/sky'),
    'aria-label': 'View in sky — watch tonight’s targets arc across the sky in augmented reality',
  }, [
    el('span.ng-sky-hero-icon', { 'aria-hidden': 'true' }, '🔭'),
    el('span.ng-sky-hero-text', {}, [
      el('span.ng-sky-hero-title', {}, 'View in sky'),
      el('span.ng-sky-hero-sub', {}, 'Watch tonight’s targets arc overhead'),
    ]),
    el('span.ng-sky-hero-arrow', { 'aria-hidden': 'true' }, '→'),
  ]));

  // Without a measured horizon the curves can't be "cut" — everything above 0°
  // reads as clear, so there's nothing grey. Say so, and offer to fix it.
  if (isFlat(profile)) {
    app.append(el('div.ng-flat', { role: 'status' }, [
      el('span.dim.small', {}, 'Flat horizon — curves aren’t cut by your treeline yet, so nothing shows as blocked.'),
      el('button.btn.small.primary', { onclick: () => nav.go('#/capture/live') }, '📷 Measure horizon'),
    ]));
  }

  if (!targets.length) { // only if the catalog itself is empty — a real dead end
    app.append(deadEnd('Catalog is empty', 'Reopen once online to cache the object catalog.'));
    return;
  }

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
  // The scrub is a time cursor over the night — expose it as a keyboard slider
  // (arrows/Home/End) so reading "altitude at time" isn't pointer-only.
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-label', 'Scrub the night — read each target’s altitude at a time');
  wrap.setAttribute('aria-valuemin', Math.round(win.start.getTime() / 60000));
  wrap.setAttribute('aria-valuemax', Math.round(win.end.getTime() / 60000));
  // A slider must always carry aria-valuenow; start it mid-night (no cursor is
  // drawn until the user scrubs, but the value must be present from the first paint).
  const midMs = Math.round((win.start.getTime() + win.end.getTime()) / 2);
  wrap.setAttribute('aria-valuenow', Math.round(midMs / 60000));
  wrap.setAttribute('aria-valuetext', hourLabelFull(midMs));
  wrap.append(base, over);
  // aria-live so keyboard scrubbing announces the readout values.
  const readout = el('div.ng-readout', { 'aria-live': 'polite' }, hintText(profile));
  const legend = buildLegend(series, moonNow);

  const instrument = activeInstrument();
  app.append(wrap, legend, readout,
    visibilitySection(series, observer, profile, win, instrument),
    el('p.settings-foot', {}, win.polar
      ? 'The Sun stays up all “night” at this site/date — showing a fixed window.'
      : `Sunset ${hm(win.sunset)} · sunrise ${hm(win.sunrise)} (device time). Each curve shows only while the target is clear of your horizon.`));

  function draw() {
    const w = wrap.clientWidth || 640;
    model.setWidth(w);
    sizeCanvas(base, w, H); sizeCanvas(over, w, H);
    drawBase(base.getContext('2d'), model, { twilight, series, moonPts, win });
  }
  draw();
  window.addEventListener('resize', draw, { passive: true });

  // Scrub — pointer/drag AND keyboard read altitudes at a time.
  const octx = over.getContext('2d');
  let scrubMs = null;
  function scrubTo(ms) {
    scrubMs = Math.max(model.t0, Math.min(model.t1, ms));
    wrap.setAttribute('aria-valuenow', Math.round(scrubMs / 60000));
    wrap.setAttribute('aria-valuetext', hourLabelFull(scrubMs));
    drawScrub(octx, model, scrubMs, series, profile, observer, readout);
  }
  const scrub = (clientX) => scrubTo(model.tOf(clientX - over.getBoundingClientRect().left));
  over.addEventListener('pointerdown', (e) => { over.setPointerCapture(e.pointerId); scrub(e.clientX); });
  over.addEventListener('pointermove', (e) => { if (e.pressure > 0 || e.buttons) scrub(e.clientX); });
  // Leave the last reading + cursor on screen after release — on a phone you
  // lift your finger to read the numbers. Hover (no button) also scrubs.
  over.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) scrub(e.clientX); });

  // Keyboard time cursor: ←/→ step 15 min, PageUp/Down 1 h, Home/End the ends.
  const SPAN = model.t1 - model.t0;
  wrap.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -15, ArrowRight: 15, PageUp: 60, PageDown: -60 };
    let ms = scrubMs ?? model.t0 + SPAN / 2;
    if (e.key in step) ms += step[e.key] * 60000;
    else if (e.key === 'Home') ms = model.t0;
    else if (e.key === 'End') ms = model.t1;
    else return;
    e.preventDefault();
    scrubTo(ms);
  });
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

  // Target curves are drawn ONLY where the target clears your horizon — the
  // behind-the-treeline portions simply aren't shown (nothing to observe there).
  // A dark casing under the bright run keeps every colour legible across the
  // twilight bands, and a marker shape carries identity without colour.
  const labelPeaks = series.length <= 4; // direct labels only when uncluttered
  ctx.globalAlpha = 1;
  for (const ser of series) {
    ctx.strokeStyle = CASE; ctx.lineWidth = 4;
    strokeVisible(ctx, s, ser.pts);              // casing under the visible run
    ctx.strokeStyle = ser.color; ctx.lineWidth = 2;
    strokeVisible(ctx, s, ser.pts);              // above-horizon runs only, solid
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
function header(state, nav, site, shown, favCount, previewing) {
  const label = site.approx ? 'Here (approx)' : (site.name || `${site.lat.toFixed(2)}, ${site.lon.toFixed(2)}`);
  return el('div.ng-head', {}, [
    el('div.ng-head-top', {}, [el('h1', {}, 'Tonight')]),
    el('div.ng-datenav', {}, [
      el('button.btn.small', { onclick: () => shiftNight(state, nav, -1), 'aria-label': 'Previous night' }, '‹ Prev'),
      el('button.btn.small', { onclick: () => { state.night = noonToday(); nav.rerender(); } }, nightLabel(state.night)),
      el('button.btn.small', { onclick: () => shiftNight(state, nav, +1), 'aria-label': 'Next night' }, 'Next ›'),
      el('button.chip.ng-site', { onclick: () => nav.go('#/sites'), 'aria-label': `Site: ${label} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${label}`)]),
    ]),
    // Approximate seeded location → make setting the real one a one-tap job,
    // right here, instead of a trip into Sites and a lat/long form.
    site.approx ? el('div.ng-approx', { role: 'status' }, [
      el('span.dim.small', {}, 'Placeholder location. For your real sky:'),
      el('button.btn.small.primary', { onclick: () => useMyLocation(nav) }, '📍 Use my location'),
      el('button.btn.small', { onclick: () => openLocationSearch(nav) }, '🔎 City or ZIP'),
    ]) : null,
    previewing
      ? el('p.dim.small', {}, ['Tonight’s brightest showpieces above your horizon. ',
          el('button.linklike', { onclick: () => nav.go('#/targets') }, 'Pick your own in Targets'), '.'])
      : (favCount > shown ? el('p.dim.small', {}, `Showing ${shown} of ${favCount} favourites (first ${MAX_TARGETS}).`) : null),
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
    // Show every geometric interval (a target up in two chunks reads as both),
    // not just the first.
    const geo = v.geometric.length ? `${v.geometric.map(fmtIv).join(', ')} up` : 'never up';
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
          v.transit ? el('span.dim', {}, ` · peak ${v.transit.altitude.toFixed(0)}° at ${hm(v.transit.time)}`) : null,
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
    ? 'Drag across the graph to read altitudes. Tip: measure your horizon so curves show only while a target clears your real treeline.'
    : 'Drag across the graph to read each target’s altitude; curves appear only while the target is clear of your horizon.')];
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
