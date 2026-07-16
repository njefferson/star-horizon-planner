// =============================================================================
// settings.js — the Settings view. v1: pick the active instrument (its FOV
// drives every fit/mosaic/framing answer app-wide) and toggle the theme. The
// custom-scope editor and export/import are on the roadmap.
// =============================================================================
import { el, clear } from './dom.js';
import { allInstruments, activeInstrument, setActiveInstrument, fovOf, pixelScale } from '../model/instruments.js';
import { isDark, setTheme } from './theme.js';

export function renderSettings(app, state, nav) {
  clear(app);
  app.append(
    el('h1', {}, 'Settings'),
    instrumentSection(nav),
    themeSection(),
    el('p.settings-foot', {}, 'Custom scopes, sites, and export/import arrive in later steps.'),
  );
}

function instrumentSection(nav) {
  const active = activeInstrument();
  const cards = allInstruments().map((inst) => {
    const fov = fovOf(inst);
    const ps = pixelScale(inst);
    const on = inst.id === active.id;
    return el('button.inst-card', {
      class: on ? 'active' : '', 'aria-pressed': on ? 'true' : 'false',
      onclick: () => { if (setActiveInstrument(inst.id)) nav.rerender(); },
    }, [
      el('div.inst-card-head', {}, [
        el('span.inst-name', {}, inst.name),
        on ? el('span.inst-active', {}, 'active') : null,
      ]),
      el('div.inst-specs', {}, [
        spec('FOV', `${fov.w_deg.toFixed(2)}° × ${fov.h_deg.toFixed(2)}°`),
        spec('Focal', `${inst.focalLength_mm} mm`),
        inst.aperture_mm ? spec('Aperture', `${inst.aperture_mm} mm`) : null,
        ps ? spec('Scale', `${ps.toFixed(2)}″/px`) : null,
        spec('Zenith dead-zone', inst.mount?.zenithDeadZone_deg ? `≥ ${inst.mount.zenithDeadZone_deg}°` : 'none'),
      ]),
    ]);
  });
  return el('section.settings-block', {}, [
    el('h2', {}, 'Instrument'),
    el('p.dim.small', {}, 'The active instrument’s field of view drives every fit / mosaic / framing answer across the app.'),
    el('div.inst-grid', {}, cards),
  ]);
}

function spec(label, value) {
  return el('div.spec', {}, [el('span.spec-k', {}, label), el('span.spec-v', {}, value)]);
}

function themeSection() {
  const cb = el('input.theme-checkbox', {
    type: 'checkbox', checked: isDark() ? '' : null,
    onchange: (e) => setTheme(e.target.checked),
  });
  return el('section.settings-block', {}, [
    el('h2', {}, 'Appearance'),
    el('label.toggle-row', {}, [cb, el('span', {}, 'Night Mode (dark)')]),
  ]);
}
