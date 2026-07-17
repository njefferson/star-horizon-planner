// =============================================================================
// horizoneditor.js — draw and directly edit the measured horizon. An SVG plot
// of azimuth (0–360, N/E/S/W) vs obstruction altitude (0–90°); each of the 36
// rows is a handle you drag to match the real treeline. Import/export
// Stellarium horizon files. Changes persist immediately (per-site in Step 7).
// =============================================================================
import { el, clear, toast } from './dom.js';
import {
  N, azForIndex, indexForAz, setAltitudeAt, sampleAt, maxAltitude,
  makeHorizon, toStellarium, fromStellarium,
} from '../model/horizon.js';
import { activeSite, saveSiteHorizon } from '../model/sites.js';

// Plot geometry (SVG user units). Altitude grows upward; azimuth left→right.
const VB = { w: 720, h: 250 };
const M = { l: 30, r: 10, t: 10, b: 26 };
const PW = VB.w - M.l - M.r;
const PH = VB.h - M.t - M.b;
const ALT_MAX = 90;

const xOf = (az) => M.l + (az / 360) * PW;
const yOf = (alt) => M.t + (1 - alt / ALT_MAX) * PH;
const CARDINALS = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']];

// 8-point compass label for an azimuth — used in the slider handles' spoken value.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirLabel = (az) => COMPASS[Math.round(((az % 360) + 360) % 360 / 45) % 8];

export function renderHorizonEditor(app, state, nav) {
  clear(app);
  const site = activeSite();
  if (!site) {
    app.append(
      el('h1', {}, 'Horizon'),
      el('div.dead-end', {}, [
        el('h2', {}, 'No site yet'),
        el('p', {}, 'A horizon belongs to a site. Add one first, then draw its skyline here.'),
        el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
      ]));
    return;
  }
  // Edit a live copy of THIS site's horizon; every change writes back to it.
  const profile = makeHorizon(site.horizon);
  const persist = () => saveSiteHorizon(site.id, profile);

  const svgns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
  svg.setAttribute('class', 'hz-svg');
  // A group (not img) — it contains focusable slider handles, which an img
  // subtree would hide from assistive tech.
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Measured horizon — obstruction altitude at each of 36 compass directions. Focus a point and use the arrow keys to raise or lower it.');

  const mk = (tag, attrs) => { const n = document.createElementNS(svgns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  // Gridlines + labels ------------------------------------------------------
  for (const alt of [0, 30, 60, 90]) {
    svg.append(mk('line', { x1: M.l, y1: yOf(alt), x2: VB.w - M.r, y2: yOf(alt), class: 'hz-grid' }));
    const al = mk('text', { x: 2, y: yOf(alt) + 3, class: 'hz-axlabel' });
    al.textContent = `${alt}°`; svg.append(al);
  }
  for (const [az, label] of CARDINALS) {
    svg.append(mk('line', { x1: xOf(az), y1: M.t, x2: xOf(az), y2: M.t + PH, class: 'hz-grid' }));
    const t = mk('text', { x: xOf(az), y: VB.h - 8, class: 'hz-azlabel', 'text-anchor': 'middle' });
    t.textContent = label; svg.append(t);
  }

  const area = mk('path', { class: 'hz-area' });
  const line = mk('path', { class: 'hz-line' });
  svg.append(area, line);

  // Draggable handles — each an ARIA slider over 0–90° obstruction altitude.
  const handles = [];
  for (let i = 0; i < N; i++) {
    const h = mk('circle', {
      r: 6, class: 'hz-handle', 'data-i': i, tabindex: 0,
      role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': 90,
      'aria-label': `Obstruction altitude ${dirLabel(azForIndex(i))} (${azForIndex(i)}°)`,
    });
    handles.push(h); svg.append(h);
  }
  const setHandleValue = (i) => {
    const alt = Math.round(sampleAt(profile, azForIndex(i)));
    handles[i].setAttribute('aria-valuenow', alt);
    handles[i].setAttribute('aria-valuetext', `${alt}° at ${azForIndex(i)}° ${dirLabel(azForIndex(i))}`);
  };

  // aria-live so keyboard nudges announce the new "az · alt" value.
  const readout = el('span.hz-readout', { 'aria-live': 'polite' }, '');

  function redraw() {
    // The curve samples the profile finely (2°) so captured/imported detail
    // between the 36 handles is visible; below-0° stretches clip to the plot
    // floor (the editor's drag range stays 0–90).
    let d = '';
    for (let az = 0; az <= 360; az += 2) {
      const alt = Math.max(0, sampleAt(profile, az));
      d += `${az ? 'L' : 'M'}${xOf(az).toFixed(1)} ${yOf(alt).toFixed(1)} `;
    }
    line.setAttribute('d', d);
    area.setAttribute('d', `${d}L${xOf(360).toFixed(1)} ${yOf(0)} L${xOf(0).toFixed(1)} ${yOf(0)} Z`);
    for (let i = 0; i < N; i++) {
      handles[i].setAttribute('cx', xOf(azForIndex(i)));
      handles[i].setAttribute('cy', yOf(Math.max(0, sampleAt(profile, azForIndex(i)))));
      setHandleValue(i);
    }
    header.querySelector('.hz-max').textContent = `tallest ${maxAltitude(profile).toFixed(0)}°`;
  }

  // clientY → altitude (clamped); clientX → nearest row index.
  function altFromEvent(e) {
    const r = svg.getBoundingClientRect();
    const svgY = ((e.clientY - r.top) / r.height) * VB.h;
    const alt = (1 - (svgY - M.t) / PH) * ALT_MAX;
    return Math.max(0, Math.min(ALT_MAX, alt));
  }
  function indexFromEvent(e) {
    const r = svg.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * VB.w;
    const az = ((svgX - M.l) / PW) * 360;
    return indexForAz(az);
  }

  let dragging = null;
  function apply(i, alt) {
    setAltitudeAt(profile, i, alt);
    persist();
    redraw();
    readout.textContent = `${azForIndex(i)}° · ${sampleAt(profile, azForIndex(i)).toFixed(0)}°`;
  }
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const onHandle = e.target.classList?.contains('hz-handle');
    dragging = onHandle ? Number(e.target.dataset.i) : indexFromEvent(e);
    svg.setPointerCapture(e.pointerId);
    apply(dragging, altFromEvent(e));
  });
  svg.addEventListener('pointermove', (e) => { if (dragging != null) apply(dragging, altFromEvent(e)); });
  const endDrag = () => { dragging = null; };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  // Keyboard nudge for accessibility.
  svg.addEventListener('keydown', (e) => {
    const i = Number(e.target.dataset?.i);
    if (Number.isNaN(i)) return;
    const cur = sampleAt(profile, azForIndex(i));
    if (e.key === 'ArrowUp') { apply(i, cur + 1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { apply(i, cur - 1); e.preventDefault(); }
  });

  // Header + actions --------------------------------------------------------
  const header = el('div.hz-head', {}, [
    el('h1', {}, 'Horizon'),
    el('span.hz-max.mono', {}, ''),
  ]);
  const actions = el('div.hz-actions', {}, [
    el('button.chip.ng-site', { onclick: () => nav.go('#/sites'), 'aria-label': `Site: ${site.name} — change` },
      [el('span', { 'aria-hidden': 'true' }, `📍 ${site.name}`)]),
    el('button.btn.primary', { onclick: () => nav.go('#/capture'), 'aria-label': 'Measure horizon with the phone sensors' }, '📡 Measure…'),
    el('button.btn', { onclick: () => { if (confirm('Reset the horizon to a flat 0°?')) { profile.points = [{ az: 0, alt: 0 }]; persist(); redraw(); toast('Horizon reset to flat.'); } } }, 'Reset'),
    el('button.btn', { onclick: () => openImport(profile, redraw, persist) }, 'Import…'),
    el('button.btn', { onclick: () => exportStellarium(profile, site.name) }, 'Export'),
    readout,
  ]);

  app.append(
    header,
    el('p.dim.small', {}, `Drag each point to the top of the trees or hills blocking that direction from ${site.name}. Everything above this line is what you can actually see.`),
    el('div.hz-wrap', {}, [svg]),
    actions,
    el('p.settings-foot', {}, 'Saved to this site. Measure… sweeps the real treeline with the phone’s sensors.'),
  );
  redraw();
}

function exportStellarium(profile, siteName) {
  const text = toStellarium(profile);
  try {
    const slug = (siteName || 'horizon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'horizon';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `horizon-${slug}.txt` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported horizon.txt (Stellarium format).');
  } catch {
    toast('Export not available here.');
  }
}

function openImport(profile, redraw, persist) {
  document.querySelector('.hz-dialog')?.remove();
  const ta = el('textarea.hz-import', {
    placeholder: 'Paste a Stellarium horizon list:\n0 12\n90 5\n180 20\n…', rows: 8,
    'aria-label': 'Stellarium horizon list — azimuth altitude pairs, one per line',
  });
  const file = el('input', {
    type: 'file', accept: '.txt,text/plain', 'aria-label': 'Choose a Stellarium horizon file',
    onchange: async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); },
  });
  const dlg = el('dialog.hz-dialog', { 'aria-labelledby': 'hz-import-title' }, [
    el('h2', { id: 'hz-import-title' }, 'Import horizon'),
    el('p.dim.small', {}, 'Load a Stellarium horizon file, or paste azimuth/altitude pairs. Every point in the file is kept.'),
    file,
    ta,
    el('div.hz-dialog-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancel'),
      el('button.btn.primary', { onclick: () => {
        try {
          const imported = fromStellarium(ta.value);
          Object.assign(profile, imported);
          persist(); redraw(); dlg.close();
          toast('Horizon imported.');
        } catch { toast('Could not parse that — expected “azimuth altitude” lines.'); }
      } }, 'Import'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}
