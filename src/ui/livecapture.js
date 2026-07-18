// =============================================================================
// livecapture.js (UI) — the LIVE-CAMERA horizon capture (Noah's AR vision,
// 2026-07-17 device pass). The back camera fills the screen; you spin in place
// and the measured horizon draws OVER the sky in real time as you sweep. A
// centred reticle marks where the camera points; nudging it up reaches a
// treetop above eye level without craning the phone. This is the camera layer
// on TOP of the same sensor pipeline as the no-camera flow (ui/capture.js) —
// identical orientation math, calibration, session and profile output; the
// video + overlay are a viewfinder, never the source of the recorded numbers.
//
// FALLBACK. getUserMedia can be denied, absent (desktop), or refused off a
// secure origin. Every one of those degrades to a clear message with a link to
// the no-camera sensor capture and the manual Horizon editor — the camera is
// never the sole path (accessibility standing order).
//
// ACCESSIBILITY. The overlay is decorative (aria-hidden); its information lives
// in a text/numeric readout beside it. The reticle has a full keyboard path
// (↑/↓ nudge its altitude, Enter marks a point) so a sweep is never pointer-
// only. The 60 Hz az/alt readout stays SILENT by design (announcing every
// frame is its own failure); discrete actions — record, mark, calibrate, save
// — announce via role=status.
//
// DEVICE-ONLY / NEEDS-HIS-HANDS: real camera framing, FOV accuracy and the
// spin-and-trace feel are only assessable on the phone. The smoke pass drives
// the flow with a synthetic stream + synthetic orientation events.
// =============================================================================
import { el, clear, toast } from './dom.js';
import { activeSite, saveSiteHorizon } from '../model/sites.js';
import { makeHorizon, maxAltitude, sampleAt } from '../model/horizon.js';
import { declination, modelExpired } from '../model/geomag.js';
import {
  headingFromAlpha, applyOffset,
  makeSession, addSample, sampleCount, coverage, largestGap, profileFromSession,
} from '../model/capture.js';

// A hand-sweep never touches every 1° bin; the profile interpolates across
// small gaps, so "all the way around" means the widest gap is small — not that
// every degree was individually hit. This is that threshold.
const COMPLETE_GAP_DEG = 6;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
import {
  DEFAULT_FOV, projectPoint, altitudeAtScreenY, horizonPolyline,
} from '../model/arproject.js';

// View-scoped live state. Rebuilt each mount; the camera/session reset with it.
let lc = null;
function freshState() {
  return {
    stream: null,          // MediaStream, stopped on unmount
    source: null,          // 'ios' | 'absolute' | 'relative'
    cam: null,             // { az, alt } true (declination-corrected) camera axis
    offset: 0,             // magnetic→true declination for this site (deg, east +)
    declination: 0,        // the raw declination value, for the readout
    recording: false,
    reticleY: 0,           // normalised [−0.5,0.5] offset from centre (↑ negative)
    session: makeSession(1),
    fov: { ...DEFAULT_FOV },
    raf: 0,
  };
}

let root = null;
const mounted = () => root && root.isConnected;

export function renderLiveCapture(app, state, nav) {
  clear(app);
  stopLive(); // never leave a previous camera running
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Live camera'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'A measured horizon belongs to a site. Add one first.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }

  lc = freshState();
  // Correct the magnetic compass to true north automatically from the site's
  // coordinates via the World Magnetic Model (model/geomag.js).
  lc.declination = declination(site.lat, site.lon);
  lc.offset = lc.declination;
  root = el('div.lc-root');

  const video = el('video.lc-video', { autoplay: true, playsinline: true, muted: true, 'aria-hidden': 'true' });
  video.muted = true; // some engines only honour the property, not the attribute
  const canvas = el('canvas.lc-canvas', { 'aria-hidden': 'true' });

  const stage = el('div.lc-stage', {}, [
    video,
    canvas,
    // Live numeric readout — the overlay's information in text. NOT aria-live:
    // it updates every frame; a continuous stream announced is its own failure.
    el('div.lc-readout.mono', { id: 'lc-readout' }, 'enabling camera…'),
    el('p.lc-hint.small', { id: 'lc-status', role: 'status', 'aria-live': 'polite' }, ''),
  ]);

  const controls = el('div.lc-controls', {}, [
    // iOS gates motion/compass behind a permission prompt that MUST fire from a
    // tap — so it can't be auto-granted on navigation. This button provides that
    // tap; it hides itself once compass data flows (and on platforms that don't
    // gate, where orientation is attached immediately).
    el('button.btn.primary.block', { id: 'lc-motion', hidden: true, onclick: enableMotion, 'aria-label': 'Enable compass and tilt' }, '🧭 Enable compass'),
    el('div.lc-btns', {}, [
      el('button.btn.primary', { id: 'lc-rec', onclick: toggleRecording, 'aria-label': 'Record sweep' }, '● Record'),
      el('button.btn', { id: 'lc-mark', onclick: markPoint, 'aria-label': 'Mark a point at the reticle' }, '＋ Mark'),
      el('button.btn', { onclick: () => nudgeReticle(2), 'aria-label': 'Move reticle up 2 degrees' }, '▲'),
      el('button.btn', { onclick: () => nudgeReticle(-2), 'aria-label': 'Move reticle down 2 degrees' }, '▼'),
    ]),
    el('div.lc-btns', {}, [
      el('button.btn', { onclick: resetSweep }, 'Reset'),
      el('button.btn.primary', { onclick: () => save(site, nav) }, 'Save'),
      el('button.btn', { onclick: () => { stopLive(); nav.go('#/capture'); }, 'aria-label': 'Switch to no-camera sensor capture' }, 'No camera'),
    ]),
    el('p.small.mono', { id: 'lc-cov' }, covText()),
    el('p.dim.small', {}, 'Keep the centre crosshair on the treetops and pan slowly all the way around — the purple trace fills in behind you (about 1° detail). Pan slowly where the outline is busy; go once around and it stops itself. Small gaps fill in automatically; for a tricky spot, nudge the reticle onto it and Mark. Camera off? Use no-camera mode or the Horizon editor.'),
  ]);

  // Reticle keyboard path lives on a focusable region over the video.
  const reticleAria = el('div.lc-reticle-focus', {
    tabindex: '0', role: 'slider',
    'aria-label': 'Reticle altitude — Up/Down to aim above or below the camera centre, Enter to mark',
    'aria-valuemin': '-39', 'aria-valuemax': '39', 'aria-valuenow': '0', 'aria-valuetext': '0° from centre',
    onkeydown: onReticleKey,
  });
  stage.append(reticleAria);

  root.append(
    el('div.pa-head', {}, [
      el('h1', {}, 'Live camera'),
      el('div.row-actions', {}, [el('button.chip.ng-site', { onclick: () => { stopLive(); nav.go('#/sites'); }, 'aria-label': `Site: ${site.name} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${site.name}`)])]),
    ]),
    stage,
    controls,
  );
  app.append(root);

  startCamera(video, canvas);
  // Platforms that don't gate motion (Android/desktop) attach immediately;
  // iOS waits for the Enable-compass tap so requestPermission() has a gesture.
  if (motionIsGated()) showMotionButton(true);
  else attachOrientation();
  // Stop the camera the instant we navigate away (no unmount hook otherwise).
  window.addEventListener('hashchange', onHashLeave);
}

function motionIsGated() {
  return typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';
}
function showMotionButton(show) {
  const b = root && root.querySelector('#lc-motion');
  if (b) b.hidden = !show;
}

// iOS: request motion/compass permission from this tap, then start listening.
async function enableMotion() {
  try {
    if (motionIsGated()) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { toast('Compass permission was denied — you can still Mark points or use no-camera mode.'); return; }
    }
  } catch { toast('Could not request compass access here.'); return; }
  attachOrientation();
  showMotionButton(false);
  say('Compass on — spin slowly to trace your horizon.');
}

// --- camera ------------------------------------------------------------------
async function startCamera(video, canvas) {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { cameraFailed('This device has no camera API.'); return; }
  try {
    const stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (!mounted()) { stopTracks(stream); return; } // navigated away mid-await
    lc.stream = stream;
    video.srcObject = stream;
    video.play().catch(() => {}); // fire-and-forget: awaiting can hang if a frame never paints
    sizeCanvas(canvas, video);
    window.addEventListener('resize', () => sizeCanvas(canvas, video));
    say('Camera on. Spin slowly to trace your horizon.');
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
  const readout = root.querySelector('#lc-readout');
  if (readout) readout.textContent = 'no camera';
  say(`${why} Use no-camera mode or the Horizon editor — both reach the same horizon.`);
  root.querySelector('.lc-stage')?.classList.add('lc-nocam');
}

function sizeCanvas(canvas, video) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
}

// --- orientation (same pipeline as ui/capture.js) ----------------------------
function attachOrientation() {
  if (!lc || lc.oriAttached) return; // idempotent — enableMotion may be tapped twice
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  lc.oriAttached = true;
}
function detachOrientation() {
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  if (lc) lc.oriAttached = false;
}

function onOrientation(e) {
  if (!lc) return;
  let heading = null;
  if (e.webkitCompassHeading != null) { heading = e.webkitCompassHeading; lc.source = 'ios'; }
  else if (e.alpha != null) {
    heading = headingFromAlpha(e.alpha);
    lc.source = (e.absolute || e.type === 'deviceorientationabsolute') ? 'absolute' : 'relative';
  }
  if (heading == null || e.beta == null) return;
  const alt = Math.max(-90, Math.min(90, e.beta - 90)); // camera-pointing model
  lc.cam = { az: applyOffset(heading, lc.offset), alt };
  if (lc.recording) addSample(lc.session, lc.cam.az, alt); // record the axis (reticle at 0)
}

// --- reticle -----------------------------------------------------------------
// The reticle marks an altitude offset from the camera axis; `upDeg` positive
// moves it UP the frame (toward a treetop above eye level). Stored as a
// normalised y offset (up = negative y) so the draw loop and readout share it.
function setReticleUpDeg(upDeg) {
  if (!lc) return;
  const half = lc.fov.vfov / 2;
  const clamped = Math.max(-half, Math.min(half, upDeg));
  lc.reticleY = -clamped / lc.fov.vfov;
  const focus = root && root.querySelector('.lc-reticle-focus');
  if (focus) {
    focus.setAttribute('aria-valuenow', clamped.toFixed(0));
    focus.setAttribute('aria-valuetext', `${clamped >= 0 ? '+' : ''}${clamped.toFixed(0)}° from centre`);
  }
}
function nudgeReticle(upDeg) { setReticleUpDeg(-lc.reticleY * lc.fov.vfov + upDeg); }

function onReticleKey(e) {
  const k = e.key;
  if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); nudgeReticle(2); }
  else if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); nudgeReticle(-2); }
  else if (k === 'Home') { e.preventDefault(); setReticleUpDeg(0); }
  else if (k === 'Enter' || k === ' ') { e.preventDefault(); markPoint(); }
}

// --- record / mark / calibrate / save ----------------------------------------
// Reflect recording state onto the button — shared by the toggle and auto-stop.
function paintRecBtn() {
  const rec = root && root.querySelector('#lc-rec');
  if (rec) {
    rec.textContent = lc.recording ? '■ Stop' : '● Record';
    rec.setAttribute('aria-label', lc.recording ? 'Stop recording' : 'Record sweep');
    rec.classList.toggle('rec', lc.recording);
  }
}

function toggleRecording() {
  if (!lc) return;
  // Arm before the first compass read is fine — samples start when it arrives.
  if (!lc.recording && !lc.cam) say('Armed — recording begins once the compass reads. Enable motion access if nothing happens.');
  lc.recording = !lc.recording;
  paintRecBtn();
  updateCoverage();
  say(lc.recording ? 'Recording — sweep the treeline; it stops itself at a full circle.' : `Stopped. ${covText()}`);
}

// The whole circle is traced once the widest UNSWEPT gap is small enough to
// interpolate — not when every 1° bin is individually hit (a hand-sweep never
// does that). Auto-stop there so you can edit/save and a second lap can't pile on.
function isComplete() {
  const c = coverage(lc.session);
  return c.binsWithData > 30 && c.maxGapDeg <= COMPLETE_GAP_DEG;
}
function maybeAutoStop() {
  if (!lc || !lc.recording) return;
  if (isComplete()) {
    lc.recording = false;
    paintRecBtn();
    say('Full circle traced ✓ — small gaps fill in automatically. Mark to fix a spot, or Save. (Reset to redo.)');
  }
}

function markPoint() {
  if (!lc || !lc.cam) { toast('Waiting for the compass — enable motion access.'); return; }
  const alt = altitudeAtScreenY(lc.reticleY, lc.cam.alt, lc.fov.vfov);
  addSample(lc.session, lc.cam.az, alt);
  updateCoverage();
  say(`Marked ${Math.round(lc.cam.az)}° az at ${alt.toFixed(0)}° alt. ${covText()}`);
}

function resetSweep() {
  if (!lc) return;
  lc.session = makeSession(1);
  lc.recording = false;
  const rec = root.querySelector('#lc-rec');
  if (rec) { rec.textContent = '● Record'; rec.classList.remove('rec'); rec.setAttribute('aria-label', 'Record sweep'); }
  updateCoverage();
  say('Sweep cleared.');
}

function save(site, nav) {
  if (!lc || !lc.session.bins.size) { toast('Nothing recorded yet — Mark a point or Record a sweep.'); return; }
  const profile = profileFromSession(lc.session);
  saveSiteHorizon(site.id, profile);
  toast(`Horizon saved — tallest ${maxAltitude(profile).toFixed(0)}°.`);
  stopLive();
  nav.go('#/horizon');
}

// --- overlay draw loop -------------------------------------------------------
function tickDraw(canvas) {
  if (!mounted() || !lc) return;
  draw(canvas);
  updateReadout();
  updateCoverage(); // keep the numeric coverage live through a sweep
  maybeAutoStop();  // one full loop is enough — stop so you can edit, not keep spinning
  lc.raf = requestAnimationFrame(() => tickDraw(canvas));
}

function updateReadout() {
  const r = root.querySelector('#lc-readout');
  if (!r) return;
  if (!lc.cam) {
    r.textContent = (motionIsGated() && !lc.oriAttached) ? 'tap “Enable compass”' : 'waiting for compass…';
    return;
  }
  const markAlt = altitudeAtScreenY(lc.reticleY, lc.cam.alt, lc.fov.vfov);
  // Show that the compass is corrected to TRUE north by the site's declination.
  const decl = `· true N (${lc.declination >= 0 ? '+' : ''}${lc.declination.toFixed(1)}° decl)`;
  r.textContent = `az ${lc.cam.az.toFixed(0)}° · reticle ${markAlt.toFixed(0)}° alt ${decl}`;
}

function draw(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const toPx = (p) => [(0.5 + p.x) * W, (0.5 + p.y) * H];
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#b07bd6';
  const live = css.getPropertyValue('--live').trim() || '#c0563a';

  // Reticle crosshair (camera axis) + the nudged mark line.
  const cx = W / 2, cy = H / 2;
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = Math.max(1, W / 500);
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.04, cy); ctx.lineTo(cx + W * 0.04, cy);
  ctx.moveTo(cx, cy - W * 0.04); ctx.lineTo(cx, cy + W * 0.04);
  ctx.stroke();
  const my = (0.5 + lc.reticleY) * H;
  ctx.strokeStyle = live;
  ctx.setLineDash([W / 90, W / 90]);
  ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my); ctx.stroke();
  ctx.setLineDash([]);

  if (!lc.cam) return;

  // The stored site horizon (context) drawn thin; the live captured sweep bold.
  const site = activeSite();
  const stored = site ? makeHorizon(site.horizon) : null;
  if (stored) {
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = Math.max(1, W / 360);
    strokePoly(ctx, horizonPolyline(stored, sampleAt, lc.cam, lc.fov, 2).map(toPx));
  }
  if (lc.session.bins.size) {
    const captured = profileFromSession(lc.session);
    const px = horizonPolyline(captured, sampleAt, lc.cam, lc.fov, 2).map(toPx);
    // Filled silhouette so the traced horizon reads as a solid mask forming as
    // you pan — strong feedback that it's actually tracking the treeline.
    if (px.length) {
      ctx.save();
      ctx.globalAlpha = 0.22; ctx.fillStyle = accent;
      ctx.beginPath();
      px.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(px[px.length - 1][0], H); ctx.lineTo(px[0][0], H); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, W / 180);
    strokePoly(ctx, px);
    // Dots at the ACTUAL recorded points in view — makes the ~1° granularity
    // (and any thin spots) visible, so tracing a busy outline is legible.
    ctx.fillStyle = accent;
    const r = Math.max(1.5, W / 320);
    for (const p of captured.points) {
      const q = projectPoint({ az: p.az, alt: p.alt }, lc.cam, lc.fov);
      if (!q.onScreen) continue;
      const x = (0.5 + q.x) * W, y = (0.5 + q.y) * H;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function strokePoly(ctx, pts) {
  if (!pts.length) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

// --- helpers -----------------------------------------------------------------
function covText() {
  const c = coverage(lc.session);
  const n = sampleCount(lc.session);
  if (!c.binsWithData) return 'No points yet · pan slowly along the treetops';
  if (isComplete()) return `Full circle traced ✓ · ${c.binsWithData}° covered, small gaps fill in`;
  const g = largestGap(lc.session);
  return `Tracing… ${c.binsWithData}° of 360° · biggest gap ${c.maxGapDeg}° to the ${compass(g.centerAz)}`;
}
function updateCoverage() {
  const n = root && root.querySelector('#lc-cov');
  if (n) n.textContent = covText();
}
function say(msg) {
  const n = root && root.querySelector('#lc-status');
  if (n) n.textContent = msg;
}

// --- teardown ----------------------------------------------------------------
function onHashLeave() {
  if (!location.hash.startsWith('#/capture/live')) stopLive();
}
function stopTracks(stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ } }
export function stopLive() {
  window.removeEventListener('hashchange', onHashLeave);
  detachOrientation();
  if (lc) {
    if (lc.raf) cancelAnimationFrame(lc.raf);
    if (lc.stream) stopTracks(lc.stream);
    lc.stream = null;
    lc.raf = 0;
  }
}
