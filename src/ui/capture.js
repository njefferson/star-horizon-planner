// =============================================================================
// capture.js (UI) — sensor-trace horizon capture, v1: sight along the phone's
// TOP EDGE (portrait, screen vertical, like a gunsight — the camera+crosshair
// preview from the roadmap layers on later). Flow: enable sensors → calibrate
// against the Sun (compass truth: device headings are magnetic and locally
// disturbed) → sweep the treeline while recording → review coverage → save to
// the active site. All math lives in model/capture.js; this file is wiring.
//
// The orientation listener is a module-level singleton: it keeps feeding the
// session while the user peeks at other tabs, and every DOM write checks the
// view is still mounted first. NEEDS-HIS-HANDS: real compass accuracy, drift,
// and the sighting feel are device-only — the smoke pass drives this view
// with synthetic events (Android absolute path) instead.
// =============================================================================
import { el, clear, toast } from './dom.js';
import { activeSite, saveSiteHorizon } from '../model/sites.js';
import { makeObserver } from '../model/astro.js';
import { maxAltitude } from '../model/horizon.js';
import {
  headingFromAlpha, applyOffset, sunCalibration,
  makeSession, addSample, sampleCount, coverage, profileFromSession,
} from '../model/capture.js';

// Session survives tab switches; "Reset sweep" clears it.
const cap = {
  enabled: false,       // listener attached
  source: null,         // 'ios' | 'absolute' | 'relative'
  last: null,           // { heading, altitude } — magnetic/raw
  offset: 0,
  calibrated: false,
  recording: false,
  session: makeSession(1),
};

let root = null; // current mount, or null — DOM writes check this
const mounted = () => root && root.isConnected;

export function renderCapture(app, state, nav) {
  clear(app);
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Measure horizon'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'A measured horizon belongs to a site. Add one first.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }

  root = el('div.cap-root');
  root.append(
    el('div.pa-head', {}, [
      el('h1', {}, 'Measure horizon'),
      el('p.dim.small', {}, 'Hold the phone upright and point the back camera at the treeline, the way you’d photograph it. Tip it up for a tall obstruction, down for a downhill horizon — the altitude readout follows where the camera looks.'),
      el('div.row-actions', {}, [el('button.chip.ng-site', { onclick: () => nav.go('#/sites'), 'aria-label': `Site: ${site.name} — change` },
        [el('span', { 'aria-hidden': 'true' }, `📍 ${site.name}`)])]),
    ]),
    sensorsCard(),
    calibrateCard(site),
    sweepCard(),
    applyCard(site, nav),
  );
  app.append(root);
  repaint();
}

// --- 1 · sensors --------------------------------------------------------------
function sensorsCard() {
  const enableBtn = el('button.btn.primary', { id: 'cap-enable', onclick: enableSensors },
    cap.enabled ? 'Sensors on' : 'Enable compass & tilt');
  return el('section.pa-card', {}, [
    el('h2', {}, '1 · Sensors'),
    el('div.cap-live', {}, [
      el('span.cap-az.mono', { id: 'cap-az' }, '—'),
      el('span.cap-alt.mono', { id: 'cap-alt' }, '—'),
    ]),
    el('p.dim.small', { id: 'cap-src' }, cap.enabled ? sourceNote() : 'Compass and tilt are off until you enable them.'),
    el('div.card-actions', {}, [enableBtn]),
  ]);
}

async function enableSensors() {
  // iOS requires a user-gesture permission grant; Android/desktop just listen.
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { toast('Motion & orientation permission was denied.'); return; }
    }
  } catch { toast('Could not request sensor permission here.'); return; }
  if (!cap.enabled) {
    // Prefer the absolute (compass-referenced) stream where it exists.
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation);
    }
    window.addEventListener('deviceorientation', onOrientation);
    cap.enabled = true;
  }
  toast('Sweep the treeline once sensors read.');
  repaint();
}

function onOrientation(e) {
  let heading = null;
  if (e.webkitCompassHeading != null) { heading = e.webkitCompassHeading; cap.source = 'ios'; }
  else if (e.alpha != null) {
    heading = headingFromAlpha(e.alpha);
    cap.source = (e.absolute || e.type === 'deviceorientationabsolute') ? 'absolute' : 'relative';
  }
  if (heading == null || e.beta == null) return;
  cap.last = { heading, altitude: Math.max(-90, Math.min(90, e.beta - 90)) }; // camera axis
  if (cap.recording) addSample(cap.session, applyOffset(heading, cap.offset), cap.last.altitude);
  schedule();
}

// Sensor events arrive at 30–60 Hz — coalesce repaints to animation frames.
let raf = 0;
function schedule() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; repaint(); });
}

function sourceNote() {
  if (cap.source === 'ios') return 'iOS compass (magnetic — calibrate below).';
  if (cap.source === 'absolute') return 'Absolute compass (magnetic — calibrate below).';
  if (cap.source === 'relative') return 'RELATIVE orientation only: the zero drifts — calibrate below and sweep promptly.';
  return 'Waiting for the first sensor reading…';
}

// --- 2 · calibrate -------------------------------------------------------------
function calibrateCard(site) {
  const manual = el('input.loc-in.cap-offset', {
    type: 'number', step: '0.1', placeholder: '0.0', value: cap.calibrated ? String(cap.offset.toFixed(1)) : '',
    onchange: (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { cap.offset = v; cap.calibrated = true; repaint(); toast('Manual offset set.'); }
    },
  });
  return el('section.pa-card', {}, [
    el('h2', {}, '2 · Calibrate (compass truth)'),
    el('p.dim.small', {}, 'Device headings are magnetic and locally disturbed — up to ~±15° off true north. One sighting of the Sun fixes it: point the camera at the Sun (through a safe filter — never look straight at it), then tap.'),
    el('div.card-actions', {}, [
      el('button.btn.primary', { onclick: () => calibrateFromSun(site) }, '☀ Sighting the Sun — calibrate'),
    ]),
    el('p.small', { id: 'cap-cal', 'aria-live': 'polite' }, calText()),
    el('label.fld', {}, [el('span', {}, 'Manual offset (°, east-positive) — night fallback'), manual]),
  ]);
}

function calibrateFromSun(site) {
  if (!cap.enabled || !cap.last) { toast('Enable sensors first.'); return; }
  const observer = makeObserver(site.lat, site.lon, site.elevation_m || 0);
  const r = sunCalibration(cap.last.heading, observer, new Date());
  if (!r.ok) { toast('The Sun is below the horizon — use the manual offset.'); return; }
  cap.offset = r.offset;
  cap.calibrated = true;
  repaint();
  toast(`Calibrated: compass is ${r.offset.toFixed(1)}° off true.`);
}

function calText() {
  return cap.calibrated
    ? `Offset ${cap.offset.toFixed(1)}° applied to every recorded sample.`
    : 'Not calibrated — recordings would use raw magnetic headings.';
}

// --- 3 · sweep ------------------------------------------------------------------
function sweepCard() {
  return el('section.pa-card', {}, [
    el('h2', {}, '3 · Sweep the treeline'),
    el('p.dim.small', {}, 'Tap Record, then pan the sight along the top of everything blocking your sky, all the way around. Samples land in 1° bins; the median beats hand jitter.'),
    el('div.card-actions', {}, [
      el('button.btn.primary', { id: 'cap-rec', onclick: toggleRecording }, cap.recording ? '■ Stop' : '● Record'),
      el('button.btn', { onclick: resetSweep }, 'Reset sweep'),
    ]),
    el('p.small.mono', { id: 'cap-cov' }, covText()),
    // The numeric coverage above is the real signal; the strip is a glance-aid,
    // so hide it from assistive tech and give filled segments a height + inset
    // difference (not just colour) per the accessibility standing order.
    el('div.cap-cover', { id: 'cap-strip', 'aria-hidden': 'true' }, coverStrip()),
  ]);
}

function toggleRecording() {
  if (!cap.enabled) { toast('Enable sensors first.'); return; }
  if (!cap.recording && !cap.calibrated) toast('Recording with RAW magnetic headings — calibrate for true north.');
  cap.recording = !cap.recording;
  repaint();
}

function resetSweep() {
  cap.session = makeSession(1);
  cap.recording = false;
  repaint();
}

function covText() {
  const c = coverage(cap.session);
  return `${sampleCount(cap.session)} samples · ${c.pct}% of the circle · widest gap ${c.maxGapDeg}°`;
}

// A 36-segment ring-as-strip: filled where that 10° wedge has any samples.
function coverStrip() {
  const c = cap.session;
  return Array.from({ length: 36 }, (_, i) => {
    const covered = [...c.bins.keys()].some((b) => Math.floor(b * c.binDeg / 10) === i);
    return el('span.cap-seg', { class: covered ? 'on' : '' });
  });
}

// --- 4 · apply -------------------------------------------------------------------
function applyCard(site, nav) {
  return el('section.pa-card', {}, [
    el('h2', {}, '4 · Save to this site'),
    el('p.dim.small', { id: 'cap-preview' }, previewText()),
    el('div.card-actions', {}, [
      el('button.btn.primary', { onclick: () => {
        if (!cap.session.bins.size) { toast('Nothing recorded yet.'); return; }
        const profile = profileFromSession(cap.session);
        saveSiteHorizon(site.id, profile);
        toast(`Horizon saved — tallest ${maxAltitude(profile).toFixed(0)}°.`);
        nav.go('#/horizon');
      } }, 'Save measured horizon'),
    ]),
    el('p.dim.small', {}, 'Gaps you didn’t sweep interpolate between neighbours; touch them up afterwards in the Horizon editor.'),
  ]);
}

function previewText() {
  if (!cap.session.bins.size) return 'Record a sweep first.';
  const p = profileFromSession(cap.session);
  return `Preview: ${p.points.length} points, tallest ${maxAltitude(p).toFixed(0)}°. Replaces this site’s current horizon.`;
}

// --- live repaint (targeted writes; the view may be unmounted) -----------------
function repaint() {
  if (!mounted()) return;
  const set = (id, text) => { const n = root.querySelector(`#${id}`); if (n) n.textContent = text; };
  set('cap-az', cap.last ? `az ${applyOffset(cap.last.heading, cap.offset).toFixed(0)}°` : '—');
  set('cap-alt', cap.last ? `alt ${cap.last.altitude.toFixed(0)}°` : '—');
  set('cap-src', cap.enabled ? sourceNote() : 'Compass and tilt are off until you enable them.');
  set('cap-cal', calText());
  set('cap-cov', covText());
  set('cap-preview', previewText());
  const enable = root.querySelector('#cap-enable');
  if (enable) enable.textContent = cap.enabled ? 'Sensors on' : 'Enable compass & tilt';
  const rec = root.querySelector('#cap-rec');
  if (rec) { rec.textContent = cap.recording ? '■ Stop' : '● Record'; rec.classList.toggle('rec', cap.recording); }
  const strip = root.querySelector('#cap-strip');
  if (strip) strip.replaceChildren(...coverStrip());
}
