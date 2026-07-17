// =============================================================================
// About — an unobtrusive floating "ⓘ" button + modal explaining what the app
// does. Mounted once at boot, it sits in the top-right corner on every screen
// (small, low-opacity, never in the way) and opens a native <dialog> with
// Esc / backdrop-click to close.
// =============================================================================
import { el } from './dom.js';

const ABOUT_HTML = `
  <h2>Horizon Planner — why this app exists</h2>
  <p>Most of this exists free somewhere — catalogs and altitude curves, weather
  and seeing, a polar reticle, rise/set times, even a hand-entered custom
  horizon. The value here is <strong>synergy, offline</strong>: one installable
  tool tying your site, your horizon, your targets and your alignment together,
  built around <strong>a per-site horizon profile of the real trees and
  obstructions in your actual yard</strong> and applying it to every answer.</p>

  <h3>The novel ideas</h3>
  <p>1. <strong>"Above MY horizon" visibility</strong> — a target counts as
  usable only where it clears your horizon profile, not a flat 0&deg; horizon.<br>
  2. <strong>The zenith dead-zone</strong> — an alt-az smart scope can't track
  through the zenith, so effective windows subtract that <em>second</em> horizon
  too. No other planner models it.<br>
  3. <strong>Measuring, not typing</strong> — sensor-trace capture (sweep your
  treeline with the phone) is the roadmap's top item; today's editor is
  drag-to-set with Stellarium import/export.</p>

  <h3>Instrument-agnostic from day one</h3>
  <p>The field-of-view is a first-class per-instrument profile. This build ships
  the Seestar S50 as the default and the S30 alongside it, and Settings can add
  any telescope from focal length + sensor specs. Every "does it fit / how many
  mosaic panels / framing overlay" answer reads the <em>active</em> instrument —
  never a hardcoded constant.</p>

  <h3>Data &amp; credits</h3>
  <p class="about-credits">Deep-sky catalog derived from
  <a href="https://github.com/mattiaverga/OpenNGC" target="_blank" rel="noopener">OpenNGC</a>
  (CC&#8209;BY&#8209;SA&#8209;4.0). Ephemerides computed on-device by
  <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener">astronomy-engine</a>
  (MIT). Type set in
  <a href="https://github.com/IBM/plex" target="_blank" rel="noopener">IBM Plex</a>
  (OFL&nbsp;1.1). Free, no accounts, no tracking — everything stays on this
  device.</p>
`;

export function mountAbout() {
  if (document.getElementById('about-btn')) return;
  const btn = el('button.about-btn', {
    id: 'about-btn',
    title: 'About this app',
    'aria-label': 'About this app',
    onclick: openAbout,
  }, 'ⓘ');
  document.body.append(btn);
}

function openAbout() {
  document.querySelector('.about-dialog')?.remove();
  const dlg = el('dialog.about-dialog', { 'aria-label': 'About Horizon Planner' }, [
    el('div.about-body', { html: ABOUT_HTML }),
    el('div.about-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Close'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  // Backdrop click closes.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}
