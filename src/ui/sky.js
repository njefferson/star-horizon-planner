// =============================================================================
// sky.js (UI) — the AR "arcs across the sky" view (v2.0.0). Point the phone at
// the sky and each favourite target + the Moon is projected onto the live
// camera at its current position, with its whole-night ARC drawn over the sky;
// an hour scrubber steps through the night to watch everything move. Every arc
// is CUT BY THE MEASURED HORIZON (only the runs that clear your treeline), so
// the AR view and the Tonight graph agree.
//
// Forked from ui/livecapture.js — same getUserMedia + iOS motion-permission +
// orientation→(az,alt) + rAF pipeline. Where livecapture RECORDS the horizon,
// this only READS the sky, so there's no reticle/marking here.
//
// FALLBACK. No camera (desktop, denied, insecure origin) → a flat azimuth/
// altitude sky chart with the same arcs, markers, scrubber and text list. This
// is also what headless Chromium renders for the a11y/smoke gates.
//
// ACCESSIBILITY. The overlay canvas is decorative (aria-hidden); its content is
// mirrored in a text list — each object's marker shape + name + az/alt at the
// scrubbed time + an above/below-horizon tag (colour is never the sole channel:
// shape + text always present). The scrubber is a native range (full keyboard
// path, visible focus). The 60 Hz camera az/alt readout stays SILENT by design;
// the scrubbed text list announces via aria-live (discrete, not per-frame).
// =============================================================================
import { el, clear, toast } from './dom.js';
import { SERIES, CASE, seriesColor, seriesMark, drawMark, markSvg } from './marks.js';
import { activeSite } from '../model/sites.js';
import { makeObserver, moonInfo } from '../model/astro.js';
import { makeHorizon, sampleAt, isAbove, isFlat } from '../model/horizon.js';
import { nightWindow } from '../model/night.js';
import { declination } from '../model/geomag.js';
import { headingFromAlpha, applyOffset } from '../model/capture.js';
import { DEFAULT_FOV, projectPoint, horizonPolyline } from '../model/arproject.js';
import { loadCatalog, favoriteIds } from '../model/catalog.js';
import { buildSkyScene, positionAt } from '../model/skyview.js';

const STEP_MIN = 5;        // arc sampling cadence
const MAX_TARGETS = 8;     // matches the night graph's cap
const MOON = '#e3e7f3';    // moon glyph fill (light disc; label carries the phase text)
const MOON_DARK = '#0b0e17';

// View-scoped state, rebuilt each mount; the camera/loop reset with it.
let sv = null;
let root = null;
const mounted = () => root && root.isConnected;

function freshState() {
  return {
    mode: 'ar',            // 'ar' (camera overlay) | 'flat' (az/alt chart)
    stream: null, source: null, cam: null, oriAttached: false,
    offset: 0, declination: 0, fov: { ...DEFAULT_FOV }, raf: 0,
    observer: null, profile: null, win: null,
    scene: [], scrubMs: 0,
    arCanvas: null, flatCanvas: null,
  };
}

export async function renderSky(app, state, nav) {
  clear(app);
  stopSky();
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Sky'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'The sky view places targets from a site’s coordinates and cuts their arcs by its measured horizon. Add one first.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }

  let objects = [];
  try { objects = await loadCatalog(); } catch { /* catalog offline → still show the Moon */ }
  if (!location.hash.startsWith('#/sky')) return; // navigated away mid-await

  sv = freshState();
  sv.observer = makeObserver(site.lat, site.lon, site.elevation_m || 0);
  sv.profile = makeHorizon(site.horizon);
  sv.win = nightWindow(sv.observer, state.night);
  sv.declination = declination(site.lat, site.lon);
  sv.offset = sv.declination;

  const favIds = favoriteIds();
  const targets = objects.filter((o) => favIds.has(o.id)).slice(0, MAX_TARGETS);

  sv.scrubMs = clampMs(Date.now());
  sv.scene = buildSkyScene(targets, sv.observer, sv.profile, sv.win, new Date(sv.scrubMs), STEP_MIN);
  assignStyles(sv.scene);

  buildShell(app, site, nav, targets.length);
  window.addEventListener('hashchange', onHashLeave);
  window.addEventListener('resize', onResize, { passive: true });
  enterMode('ar'); // attempts the camera; falls back to 'flat' on failure
}

// Assign each target a colour + marker shape by order (the Moon is special).
function assignStyles(scene) {
  let i = 0;
  for (const e of scene) {
    if (e.isMoon) continue;
    e.color = seriesColor(i); e.mark = seriesMark(i); i++;
  }
}

// --- shell (head, stage, scrubber, controls, text list) ----------------------
function buildShell(app, site, nav, targetCount) {
  root = el('div.lc-root.sky-root');

  const head = el('div.pa-head', {}, [
    el('h1', {}, 'Sky'),
    el('div.row-actions', {}, [el('button.chip.ng-site', {
      onclick: () => { stopSky(); nav.go('#/sites'); }, 'aria-label': `Site: ${site.name} — change`,
    }, [el('span', { 'aria-hidden': 'true' }, `📍 ${site.name}`)])]),
  ]);

  // Actionable notices live ABOVE the stage so they're never hidden under the
  // tall viewfinder (a phone-only trap when they sat in the controls below).
  const notices = el('div.sky-notices', {}, [
    targetCount === 0
      ? el('div.sky-notice', { role: 'status' }, [
          el('span', {}, '⭐ No favourites yet — only the Moon shows. '),
          el('button.linklike', { onclick: () => { stopSky(); nav.go('#/targets'); } }, 'Star some targets'),
          el('span', {}, ' to see them arc across your sky.'),
        ])
      : null,
    isFlat(sv.profile)
      ? el('div.sky-notice', { role: 'status' }, [
          el('span', {}, '📐 Flat horizon — arcs aren’t cut by a treeline yet. '),
          el('button.linklike', { onclick: () => { stopSky(); nav.go('#/capture/live'); } }, 'Measure your horizon'),
          el('span', {}, '.'),
        ])
      : null,
  ]);

  const stage = el('div.lc-stage', { id: 'sky-stage' });

  // Hour scrubber — a native range (keyboard-accessible, visible focus). Its
  // aria-valuetext is the clock time so it never announces raw epoch minutes.
  const min = Math.round(sv.win.start.getTime() / 60000);
  const max = Math.round(sv.win.end.getTime() / 60000);
  const range = el('input.sky-range', {
    type: 'range', min: String(min), max: String(max), step: '5',
    value: String(Math.round(sv.scrubMs / 60000)),
    'aria-label': 'Scrub the night — move each object to its position at a chosen time',
  });
  range.value = String(Math.round(sv.scrubMs / 60000));
  range.setAttribute('aria-valuetext', clock(sv.scrubMs));
  range.addEventListener('input', () => onScrub(Number(range.value) * 60000));

  const scrub = el('div.sky-scrub', {}, [
    el('span.sky-time.mono', { id: 'sky-time' }, clock(sv.scrubMs)),
    range,
    el('button.btn.small', { onclick: () => setScrub(clampMs(Date.now())), 'aria-label': 'Jump to now' }, 'Now'),
  ]);

  const controls = el('div.lc-controls', {}, [
    el('div.lc-btns', {}, [
      el('button.btn', { id: 'sky-mode', onclick: toggleMode }, '🗺 Flat view'),
    ]),
    el('p.dim.small', {}, 'Point at the sky: each favourite and the Moon sits at its live position, its arc traces the whole night. Scrub to step through the hours. Arcs show only where they clear your measured horizon.'),
  ]);

  const list = el('ul.sky-list', { id: 'sky-list', 'aria-live': 'polite' });
  const listSection = el('section.sky-listwrap', {}, [
    el('h2.sky-listhead', {}, 'In the sky at this time'),
    list,
  ]);

  root.append(head, notices, stage, scrub, controls, listSection);
  app.append(root);
  renderList();
}

// --- mode switching ----------------------------------------------------------
function enterMode(mode) {
  if (!sv || !mounted()) return;
  // Tear down the previous mode's live bits.
  if (sv.raf) { cancelAnimationFrame(sv.raf); sv.raf = 0; }
  detachOrientation();
  stopTracks(sv.stream); sv.stream = null; sv.cam = null;
  sv.mode = mode;

  const stage = root.querySelector('#sky-stage');
  clear(stage);
  updateModeButton();

  if (mode === 'ar') {
    stage.classList.remove('sky-flat');
    const video = el('video.lc-video', { autoplay: true, playsinline: true, muted: true, 'aria-hidden': 'true' });
    video.muted = true;
    const canvas = el('canvas.lc-canvas', { 'aria-hidden': 'true' });
    // Prominent on-camera cue to turn the compass on — right over the viewfinder,
    // not buried below it. Visible whenever we're pointing at the sky with no
    // compass fix yet (sv.cam == null); the draw loop hides it once the sky locks.
    const cta = el('div.sky-cta', { id: 'sky-cta' }, [
      el('span.sky-cta-icon', { 'aria-hidden': 'true' }, '🧭'),
      el('p.sky-cta-msg', {}, 'Turn on the compass so the sky lines up with your camera.'),
      el('button.btn.primary', { id: 'sky-cta-btn', onclick: enableMotion, 'aria-label': 'Turn on compass and tilt sensors' }, '🧭 Turn on compass'),
    ]);
    stage.append(
      video, canvas, cta,
      el('div.lc-readout.mono', { id: 'sky-readout' }, 'enabling camera…'),
      el('p.lc-hint.small', { id: 'sky-hint', role: 'status', 'aria-live': 'polite' }, ''),
    );
    sv.arCanvas = canvas;
    startCamera(video, canvas);
    // Non-gated platforms (Android/desktop) can attach immediately; iOS waits for
    // the tap on the CTA so requestPermission() has a user gesture.
    if (!motionIsGated()) attachOrientation();
    toggleCta(!sv.cam);
  } else {
    stage.classList.add('sky-flat');
    const canvas = el('canvas.sky-flatcanvas', { role: 'img', 'aria-label': flatAriaLabel() });
    stage.append(canvas);
    sv.flatCanvas = canvas;
    drawFlat(canvas);
  }
}

function toggleMode() { enterMode(sv.mode === 'ar' ? 'flat' : 'ar'); }
function updateModeButton() {
  const b = root && root.querySelector('#sky-mode');
  if (b) { b.textContent = sv.mode === 'ar' ? '🗺 Flat view' : '📷 Camera'; b.setAttribute('aria-label', sv.mode === 'ar' ? 'Switch to a flat sky chart' : 'Switch to the live camera view'); }
}
function flatAriaLabel() {
  const names = sv.scene.map((e) => e.isMoon ? 'the Moon' : e.name).join(', ');
  return `Flat sky chart: compass azimuth across, altitude up. Plotted at ${clock(sv.scrubMs)}: ${names || 'the Moon'}. The list below gives each in text.`;
}

// --- camera ------------------------------------------------------------------
async function startCamera(video, canvas) {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { cameraFailed('This device has no camera API.'); return; }
  try {
    const stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (!mounted() || sv.mode !== 'ar') { stopTracks(stream); return; }
    sv.stream = stream;
    video.srcObject = stream;
    video.play().catch(() => {});
    sizeCanvasRaw(canvas);
    say('Camera on. Point at the sky; scrub to step through the night.');
    tickDraw(canvas);
  } catch (err) {
    const why = err && err.name === 'NotAllowedError' ? 'Camera permission was denied.'
      : err && err.name === 'NotFoundError' ? 'No camera was found.'
      : 'The camera could not start here (needs a secure https origin).';
    cameraFailed(why);
  }
}
function cameraFailed(why) {
  if (!mounted()) return;
  toast(`${why} Showing a flat sky chart instead.`);
  enterMode('flat');
}

// --- orientation (same pipeline as ui/livecapture.js) ------------------------
function motionIsGated() {
  return typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';
}
// Show/hide the on-camera compass call-to-action. Driven by whether we have a
// compass fix yet (sv.cam); the draw loop keeps it in sync every frame.
function toggleCta(show) {
  const c = root && root.querySelector('#sky-cta');
  if (c) c.hidden = !show;
}
async function enableMotion() {
  try {
    if (motionIsGated()) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { toast('Compass permission was denied — try the flat sky chart instead.'); return; }
    }
  } catch { toast('Could not request compass access here.'); return; }
  attachOrientation();
  say('Compass on — point at the sky.');
}
function attachOrientation() {
  if (!sv || sv.oriAttached) return;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  sv.oriAttached = true;
}
function detachOrientation() {
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  if (sv) sv.oriAttached = false;
}
function onOrientation(e) {
  if (!sv) return;
  let heading = null;
  if (e.webkitCompassHeading != null) { heading = e.webkitCompassHeading; sv.source = 'ios'; }
  else if (e.alpha != null) {
    heading = headingFromAlpha(e.alpha);
    sv.source = (e.absolute || e.type === 'deviceorientationabsolute') ? 'absolute' : 'relative';
  }
  if (heading == null || e.beta == null) return;
  const alt = Math.max(-90, Math.min(90, e.beta - 90)); // camera-pointing model
  sv.cam = { az: applyOffset(heading, sv.offset), alt };
}

// --- scrub -------------------------------------------------------------------
function onScrub(ms) {
  if (!sv) return;
  sv.scrubMs = clampMs(ms);
  recompute(new Date(sv.scrubMs));
  updateTimeUI();
  renderList();
  if (sv.mode === 'flat' && sv.flatCanvas) drawFlat(sv.flatCanvas); // AR redraws via rAF
}
function setScrub(ms) {
  onScrub(ms);
  const range = root && root.querySelector('.sky-range');
  if (range) range.value = String(Math.round(sv.scrubMs / 60000));
}
function updateTimeUI() {
  const t = root && root.querySelector('#sky-time');
  if (t) t.textContent = clock(sv.scrubMs);
  const range = root && root.querySelector('.sky-range');
  if (range) range.setAttribute('aria-valuetext', clock(sv.scrubMs));
}
// Recompute each object's position (and the Moon's phase) at the scrubbed time.
// Arcs are fixed for the night, so only the "now" markers move — cheap.
function recompute(at) {
  for (const e of sv.scene) {
    if (e.isMoon) {
      const mi = moonInfo(sv.observer, at);
      e.now = { azimuth: mi.azimuth, altitude: mi.altitude, aboveHorizon: isAbove(sv.profile, mi.azimuth, mi.altitude) };
      e.phase = { illumination: mi.illumination, phaseName: mi.phaseName, phaseAngle: mi.phaseAngle };
    } else {
      e.now = positionAt(e, sv.observer, sv.profile, at);
    }
  }
}

// --- text list (the accessible + colour-independent channel) -----------------
function renderList() {
  const ul = root && root.querySelector('#sky-list');
  if (!ul) return;
  ul.replaceChildren(...sv.scene.map(listRow));
}
function listRow(e) {
  const p = e.now || {};
  const badge = e.isMoon
    ? el('span.ng-leg-dot.moon', { 'aria-hidden': 'true' }, '')
    : markSvg(e.mark, e.color);
  const name = e.isMoon ? `Moon · ${e.phase.phaseName} ${Math.round(e.phase.illumination * 100)}%` : e.name;
  const pos = (p.altitude != null && p.altitude > -1)
    ? `az ${Math.round(p.azimuth)}° · alt ${Math.round(p.altitude)}°`
    : 'below horizon';
  const tag = p.aboveHorizon
    ? el('span.sky-tag.ok', {}, 'above your horizon')
    : (p.altitude != null && p.altitude > 0)
      ? el('span.sky-tag.no', {}, 'behind horizon')
      : el('span.sky-tag.no', {}, 'down');
  return el('li.sky-li', {}, [
    badge,
    el('span.sky-li-name', {}, name),
    el('span.sky-li-pos.mono', {}, pos),
    tag,
  ]);
}

// --- AR overlay draw ---------------------------------------------------------
function tickDraw(canvas) {
  if (!mounted() || !sv || sv.mode !== 'ar') return;
  drawAR(canvas);
  updateReadout();
  toggleCta(!sv.cam); // show the compass cue until the sky locks on; hide once it does
  sv.raf = requestAnimationFrame(() => tickDraw(canvas));
}
function updateReadout() {
  const r = root && root.querySelector('#sky-readout');
  if (!r) return;
  if (!sv.cam) { r.textContent = 'waiting for compass…'; return; }
  const decl = `· true N (${sv.declination >= 0 ? '+' : ''}${sv.declination.toFixed(1)}° decl)`;
  r.textContent = `pointing az ${sv.cam.az.toFixed(0)}° · alt ${sv.cam.alt.toFixed(0)}° ${decl}`;
}
function drawAR(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  drawReticle(ctx, W, H);
  if (!sv.cam) return;

  const cam = sv.cam, fov = sv.fov;
  const toPx = (p) => [(0.5 + p.x) * W, (0.5 + p.y) * H];

  // Measured horizon (context) — thin white polyline, same as live capture.
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = Math.max(1, W / 360);
  strokePolyPx(ctx, horizonPolyline(sv.profile, sampleAt, cam, fov, 2).map(toPx));

  // Arcs — casing then colour, broken where they leave the frame or wrap.
  const aw = Math.max(2, W / 220);
  for (const e of sv.scene) {
    const color = e.isMoon ? MOON : e.color;
    for (const seg of e.segments) {
      const pts = seg.map((pt) => projectPoint({ az: pt.azimuth, alt: pt.altitude }, cam, fov));
      strokeArcAR(ctx, pts, W, H, CASE, aw + 2);
      strokeArcAR(ctx, pts, W, H, color, aw);
    }
  }

  // Current-position markers + labels for whatever's above the horizon & on screen.
  const fontPx = Math.max(12, Math.round(W / 34));
  const mr = Math.max(4.5, W / 90);
  for (const e of sv.scene) {
    const p = e.now; if (!p || !p.aboveHorizon) continue;
    const q = projectPoint({ az: p.azimuth, alt: p.altitude }, cam, fov);
    if (!q.onScreen) continue;
    const x = (0.5 + q.x) * W, y = (0.5 + q.y) * H;
    if (e.isMoon) {
      drawMoonGlyph(ctx, x, y, Math.max(7, W / 42), e.phase.illumination, e.phase.phaseAngle < 180);
      drawLabelPx(ctx, `Moon`, x + Math.max(10, W / 34), y, MOON, fontPx);
    } else {
      drawMark(ctx, e.mark, x, y, mr + 2, CASE);
      drawMark(ctx, e.mark, x, y, mr, e.color);
      drawLabelPx(ctx, e.name, x + Math.max(8, W / 48), y, e.color, fontPx);
    }
  }
}
function drawReticle(ctx, W, H) {
  const cx = W / 2, cy = H / 2;
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = Math.max(1, W / 500);
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.03, cy); ctx.lineTo(cx + W * 0.03, cy);
  ctx.moveTo(cx, cy - W * 0.03); ctx.lineTo(cx, cy + W * 0.03);
  ctx.stroke();
}
function strokePolyPx(ctx, pts) {
  if (!pts.length) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}
// Draw an arc in normalised screen points, breaking where a point leaves a
// generous frame or the azimuth wraps (a big x jump) so no line streaks across.
function strokeArcAR(ctx, pts, W, H, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false, prev = null;
  const LIM = 0.85;
  for (const p of pts) {
    const on = Math.abs(p.x) <= LIM && Math.abs(p.y) <= LIM;
    const jump = prev && Math.abs(p.x - prev.x) > 0.5;
    prev = p;
    if (!on || jump) { pen = false; continue; }
    const x = (0.5 + p.x) * W, y = (0.5 + p.y) * H;
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
function drawLabelPx(ctx, text, x, y, color, fontPx) {
  ctx.font = `600 ${fontPx}px 'IBM Plex Sans', system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, fontPx / 4); ctx.strokeStyle = CASE; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

// A little Moon disc showing its phase; the label + list carry the phase text so
// the glyph is never the sole channel. The lit area is built as an explicit
// polygon — the outer bright limb (a semicircle on the illuminated side) plus
// the terminator (a half-ellipse whose x-halfwidth is r·(1−2·illum)) — which
// avoids all canvas arc-direction ambiguity: crescent → quarter → full render
// correctly, and `waxing` mirrors the lit side (right when waxing, N hemisphere).
function drawMoonGlyph(ctx, cx, cy, r, illum, waxing) {
  ctx.save();
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.strokeStyle = CASE; ctx.fillStyle = MOON_DARK;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const k = Math.max(0, Math.min(1, illum));
  if (k > 0.01) {
    ctx.fillStyle = MOON;
    const s = waxing ? 1 : -1;      // lit side: +x (right) waxing, −x (left) waning
    const tx = r * (1 - 2 * k);     // terminator x-halfwidth: +r new → 0 quarter → −r full
    const N = 28;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + Math.PI * (i / N); const x = cx + s * r * Math.cos(a), y = cy + r * Math.sin(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    for (let i = 0; i <= N; i++) { const a = Math.PI / 2 - Math.PI * (i / N); ctx.lineTo(cx + s * tx * Math.cos(a), cy + r * Math.sin(a)); }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// --- flat az/alt chart (no-camera fallback + headless render) -----------------
const FM = { l: 34, r: 12, t: 12, b: 24 };
function drawFlat(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(240, Math.round(rect.width || 640));
  const h = Math.max(200, Math.round(rect.height || 300));
  sizeCanvasDpr(canvas, w, h);
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue('--line').trim() || '#2a2d40';
  const dim = css.getPropertyValue('--dim').trim() || '#9aa0bd';
  const ink = css.getPropertyValue('--ink').trim() || '#e9ecf7';
  const accent = css.getPropertyValue('--accent').trim() || '#c39be8';
  const card = css.getPropertyValue('--card').trim() || '#191b28';

  const plotW = w - FM.l - FM.r, plotH = h - FM.t - FM.b;
  const X = (az) => FM.l + (az / 360) * plotW;
  const Y = (alt) => FM.t + (1 - Math.max(0, Math.min(90, alt)) / 90) * plotH;
  const bottom = FM.t + plotH;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = card; ctx.fillRect(FM.l, FM.t, plotW, plotH);

  // Altitude gridlines + labels.
  ctx.font = "11px ui-monospace, monospace"; ctx.textBaseline = 'middle';
  for (const alt of [0, 30, 60, 90]) {
    const y = Y(alt);
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(FM.l, y); ctx.lineTo(w - FM.r, y); ctx.stroke();
    ctx.fillStyle = dim; ctx.textAlign = 'right'; ctx.fillText(`${alt}°`, FM.l - 4, y);
  }
  // Azimuth ticks (compass letters).
  ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  for (const [az, lbl] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']]) {
    const x = X(az);
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(x, FM.t); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = dim; ctx.fillText(lbl, x, bottom + 4);
  }

  // Measured horizon silhouette.
  const hz = [];
  for (let az = 0; az <= 360; az += 2) hz.push([X(az), Y(sampleAt(sv.profile, az))]);
  ctx.beginPath();
  hz.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(X(360), bottom); ctx.lineTo(X(0), bottom); ctx.closePath();
  ctx.fillStyle = 'rgba(120,130,160,.18)'; ctx.fill();
  ctx.strokeStyle = dim; ctx.lineWidth = 1.5;
  ctx.beginPath(); hz.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();

  // Arcs — casing then colour, broken across the 0/360 seam.
  for (const e of sv.scene) {
    const color = e.isMoon ? MOON : e.color;
    for (const seg of e.segments) {
      strokeFlatSeg(ctx, seg, X, Y, CASE, 4);
      strokeFlatSeg(ctx, seg, X, Y, color, 2);
    }
  }

  // Current-position markers + labels.
  ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif";
  for (const e of sv.scene) {
    const p = e.now; if (!p || !p.aboveHorizon) continue;
    const x = X(((p.azimuth % 360) + 360) % 360), y = Y(p.altitude);
    if (e.isMoon) drawMoonGlyph(ctx, x, y, 8, e.phase.illumination, e.phase.phaseAngle < 180);
    else { drawMark(ctx, e.mark, x, y, 6, CASE); drawMark(ctx, e.mark, x, y, 4.5, e.color); }
    const label = e.isMoon ? 'Moon' : e.name;
    const lx = Math.min(x + 8, w - FM.r - ctx.measureText(label).width);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = CASE; ctx.strokeText(label, lx, y - 10);
    ctx.fillStyle = e.isMoon ? ink : e.color; ctx.fillText(label, lx, y - 10);
  }
  // Keep the SR label current (positions change with the scrub).
  canvas.setAttribute('aria-label', flatAriaLabel());
}
function strokeFlatSeg(ctx, seg, X, Y, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false, prevAz = null;
  for (const p of seg) {
    const az = ((p.azimuth % 360) + 360) % 360;
    if (prevAz != null && Math.abs(az - prevAz) > 180) pen = false; // 0/360 seam
    prevAz = az;
    const x = X(az), y = Y(p.altitude);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// --- sizing / helpers --------------------------------------------------------
function sizeCanvasRaw(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
}
function sizeCanvasDpr(cv, w, h) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
function onResize() {
  if (!mounted() || !sv) return;
  if (sv.mode === 'ar' && sv.arCanvas) sizeCanvasRaw(sv.arCanvas);
  if (sv.mode === 'flat' && sv.flatCanvas) drawFlat(sv.flatCanvas);
}
function clampMs(ms) { return Math.max(sv.win.start.getTime(), Math.min(sv.win.end.getTime(), ms)); }
function clock(ms) { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function say(msg) { const n = root && root.querySelector('#sky-hint'); if (n) n.textContent = msg; }

// --- teardown ----------------------------------------------------------------
function onHashLeave() { if (!location.hash.startsWith('#/sky')) stopSky(); }
function stopTracks(stream) { try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ } }
export function stopSky() {
  window.removeEventListener('hashchange', onHashLeave);
  window.removeEventListener('resize', onResize);
  detachOrientation();
  if (sv) {
    if (sv.raf) cancelAnimationFrame(sv.raf);
    stopTracks(sv.stream);
    sv.stream = null; sv.raf = 0;
  }
}
