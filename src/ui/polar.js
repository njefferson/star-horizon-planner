// =============================================================================
// polar.js (view) — Polar Align. The synergy showcase: where to aim the mount's
// polar axis, the live Polaris/σ-Octantis reticle clock, and — the part no free
// polar tool does — a **horizon-aware** verdict that reads the site's measured
// treeline to tell you whether you can even SEE the pole from here.
//
// Reticle is a hand-rolled SVG clock (no chart library, per NOTES). "Now" drives
// the reticle position; a Refresh button re-reads the clock. The device-only
// "point to the pole" live aid (DeviceOrientation + compass) is on the roadmap
// and is stated plainly rather than faked.
// =============================================================================
import { el, clear } from './dom.js';
import { activeSite } from '../model/sites.js';
import { isFlat } from '../model/horizon.js';
import { polarAlignment } from '../model/polar.js';

const CARD = { r: 92, R: 70 };    // reticle svg half-size, dial radius

export function renderPolar(app, state, nav) {
  clear(app);
  const site = activeSite();
  if (!site) {
    app.append(el('h1', {}, 'Polar Align'), noSiteGate(nav));
    return;
  }

  const now = new Date();
  const p = polarAlignment(site, now);
  const flat = isFlat({ altitudes: normalize(site.horizon) });

  app.append(
    header(site, nav),
    verdictBanner(p, flat, nav),
    aimCard(p),
    reticleCard(p, site, nav),
    starCard(p),
    el('p.settings-foot', {}, [
      'Reticle shows the sky in a correct-image, naked-eye view (12 o’clock = straight up). ',
      'Most polar scopes invert or mirror — rotate the clock to match your reticle. ',
      'A live “point to the pole” aid using the phone’s compass is on the roadmap.',
    ]),
  );
}

// --- header ------------------------------------------------------------------
function header(site, nav) {
  const label = site.name || `${site.lat.toFixed(2)}, ${site.lon.toFixed(2)}`;
  return el('div.pa-head', {}, [
    el('h1', {}, 'Polar Align'),
    el('p.dim.small', {}, 'Aim the mount’s polar axis at the celestial pole. Numbers update from your site and the current time.'),
    el('div.row-actions', {}, [
      el('button.chip.ng-site', { onclick: () => nav.go('#/sites') }, `📍 ${label}`),
      el('button.btn.small', { onclick: () => nav.rerender() }, '↻ Refresh'),
    ]),
  ]);
}

// --- the horizon-aware verdict (the novel headline) --------------------------
function verdictBanner(p, flat, nav) {
  if (!p.usable && p.pole.altitude <= 0.5) {
    return banner('warn', 'The pole is on your horizon',
      `At ${Math.abs(p.pole.altitude).toFixed(1)}° altitude the ${p.hemisphere} celestial pole sits right at the horizon — polar alignment isn’t practical this close to the equator.`);
  }
  if (!p.poleAboveHorizon) {
    return banner('warn', `Your ${p.hemisphere} pole is behind the treeline`,
      `The pole is ${p.pole.altitude.toFixed(1)}° up, but your measured horizon due ${p.hemisphere} rises to ${p.horizonAltitudeAtPole.toFixed(1)}° — it’s blocked by ${Math.abs(p.poleClearance).toFixed(1)}°. Move to a spot with a clear ${p.hemisphere} view, or re-measure your horizon.`,
      { label: 'Edit horizon', onClick: () => nav.go('#/horizon') });
  }
  if (flat) {
    return banner('ok', 'Pole is up — horizon not measured yet',
      `The ${p.hemisphere} pole is ${p.pole.altitude.toFixed(1)}° above a flat horizon. Measure your real treeline in Horizon so this can warn you when the pole is actually blocked.`,
      { label: 'Measure horizon', onClick: () => nav.go('#/horizon') });
  }
  return banner('ok', 'Your pole is clear',
    `The ${p.hemisphere} pole clears your measured horizon by ${p.poleClearance.toFixed(1)}° — you can see it from this site.`);
}

function banner(kind, title, body, action) {
  return el(`div.pa-banner.${kind}`, {}, [
    el('div.pa-banner-title', {}, title),
    el('p.pa-banner-body', {}, body),
    action ? el('div.card-actions', {}, [el('button.btn.small', { onclick: action.onClick }, action.label)]) : null,
  ]);
}

// --- where to aim ------------------------------------------------------------
function aimCard(p) {
  const compass = p.pole.azimuth === 0 ? 'true north' : 'true south';
  return el('section.pa-card', {}, [
    el('h2', {}, 'Where to aim'),
    el('div.pa-specs', {}, [
      spec('Altitude', `${p.pole.altitude.toFixed(1)}°`, 'tilt the polar axis up this much'),
      spec('Azimuth', `${p.pole.azimuth}° · ${compass}`, 'swing it to this bearing'),
      spec('Hemisphere', p.hemisphere, p.pole.azimuth === 0 ? 'north celestial pole' : 'south celestial pole'),
    ]),
    el('p.dim.small', {}, 'Altitude equals your latitude; the pole is due north (or due south below the equator). For the S50 in EQ mode, this is where the tripod tilt axis points.'),
  ]);
}

// --- the reticle clock -------------------------------------------------------
function reticleCard(p, site, nav) {
  return el('section.pa-card', {}, [
    el('h2', {}, `${p.star.name} reticle`),
    el('div.pa-reticle', {}, [
      el('div.pa-dial', { html: reticleSvg(p) }),
      el('div.pa-reticle-info', {}, [
        readout('Clock position', p.reticle.clockLabel),
        readout('Separation from pole', `${p.separationDeg.toFixed(2)}° (${Math.round(p.separationArcmin)}′)`),
        readout('Hour angle', `${fmtHA(p.hourAngle)}`),
        el('p.dim.small', {}, `Put ${p.star.name} at the ${p.reticle.clockLabel} mark on your polar-scope reticle, ${Math.round(p.separationArcmin)}′ out from centre.`),
      ]),
    ]),
  ]);
}

// Hand-rolled SVG dial: outer circle, 12 hour ticks, centre cross (the pole),
// and the pole star as a dot on the circle at its clock angle (clockwise from
// top). A faint radial line connects the centre to the star.
function reticleSvg(p) {
  const { r, R } = CARD, c = r;
  const th = (p.reticle.clockAngleDeg * Math.PI) / 180;
  const sx = (c + R * Math.sin(th)).toFixed(1);
  const sy = (c - R * Math.cos(th)).toFixed(1);
  const ticks = [];
  for (let h = 0; h < 12; h++) {
    const a = (h * 30 * Math.PI) / 180;
    const inner = h % 3 === 0 ? R - 12 : R - 6;
    ticks.push(`<line x1="${(c + inner * Math.sin(a)).toFixed(1)}" y1="${(c - inner * Math.cos(a)).toFixed(1)}" x2="${(c + R * Math.sin(a)).toFixed(1)}" y2="${(c - R * Math.cos(a)).toFixed(1)}" class="pa-tick${h % 3 === 0 ? ' major' : ''}"/>`);
  }
  return `<svg viewBox="0 0 ${r * 2} ${r * 2}" width="${r * 2}" height="${r * 2}" role="img" aria-label="${p.star.name} at ${p.reticle.clockLabel}, ${Math.round(p.separationArcmin)} arcminutes from the pole">
    <circle cx="${c}" cy="${c}" r="${R}" class="pa-ring"/>
    <text x="${c}" y="${c - R + 14}" class="pa-12" text-anchor="middle">12</text>
    ${ticks.join('')}
    <line x1="${c}" y1="${c}" x2="${sx}" y2="${sy}" class="pa-radial"/>
    <line x1="${c - 5}" y1="${c}" x2="${c + 5}" y2="${c}" class="pa-cross"/>
    <line x1="${c}" y1="${c - 5}" x2="${c}" y2="${c + 5}" class="pa-cross"/>
    <circle cx="${sx}" cy="${sy}" r="5" class="pa-star"/>
  </svg>`;
}

// --- pole star position ------------------------------------------------------
function starCard(p) {
  const up = p.star.aboveHorizon;
  return el('section.pa-card', {}, [
    el('h2', {}, 'Find the pole star'),
    el('div.pa-specs', {}, [
      spec('Star', `${p.star.name} (${p.star.designation})`, up ? 'visible now' : 'below your horizon now'),
      spec('Altitude', `${p.star.altitude.toFixed(1)}°`, null),
      spec('Azimuth', `${p.star.azimuth.toFixed(1)}°`, null),
    ]),
    up
      ? el('p.dim.small', {}, `${p.star.name} is up — sight it near azimuth ${p.star.azimuth.toFixed(0)}°, altitude ${p.star.altitude.toFixed(0)}°, then centre the pole with the reticle above.`)
      : el('p.pa-flag', {}, `${p.star.name} is behind your horizon right now — wait, or align on the pole’s position directly.`),
  ]);
}

// --- little pieces -----------------------------------------------------------
function spec(k, v, hint) {
  return el('div.pa-spec', {}, [
    el('span.pa-spec-k', {}, k),
    el('span.pa-spec-v', {}, v),
    hint ? el('span.pa-spec-hint', {}, hint) : null,
  ]);
}
function readout(k, v) {
  return el('div.pa-ro', {}, [el('span.pa-ro-k', {}, k), el('span.pa-ro-v', {}, v)]);
}

function noSiteGate(nav) {
  return el('div.dead-end', {}, [
    el('h2', {}, 'Add an observing site'),
    el('p', {}, 'Polar alignment needs a site — its latitude sets the pole’s altitude and its horizon says whether the pole is clear.'),
    el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => nav.go('#/sites') }, 'Go to Sites')]),
  ]);
}

const fmtHA = (h) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
function normalize(arr) {
  const out = new Array(36).fill(0);
  if (Array.isArray(arr)) for (let i = 0; i < 36; i++) { const v = Number(arr[i]); if (Number.isFinite(v)) out[i] = v; }
  return out;
}
