// =============================================================================
// Horizon Planner — app bootstrap, state, hash routing. Six live tabs:
// Tonight (night graph + visibility), Targets (catalog), Horizon (editor),
// Polar (horizon-aware alignment), Sites (manager), Settings (instruments).
// =============================================================================
import { el } from './ui/dom.js';
import { mountAbout } from './ui/about.js';
import { mountThemeToggle } from './ui/theme.js';
import { renderTargets } from './ui/targets.js';
import { renderSettings } from './ui/settings.js';
import { renderHorizonEditor } from './ui/horizoneditor.js';
import { renderTonight } from './ui/nightgraph.js';
import { renderSites } from './ui/sites.js';
import { renderPolar } from './ui/polar.js';

const state = {
  // default = tonight; the night graph will hang off this once it lands.
  night: startOfTonight(),
};

// Local date at ~noon today → the app treats "tonight" as the night that
// begins this evening. Kept trivial for the scaffold; astro.js refines it.
function startOfTonight() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

const app = document.getElementById('app');
const tabsRoot = document.getElementById('tabs');

const nav = {
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
  rerender() { render(); },
};

// 22px line icons, stroke=currentColor so the tab's colour (--tab-ink / active
// --tab-ink-active) drives them. Tonight = altitude curve, Targets = star,
// Horizon = ridgeline, Sites = pin, Settings = two sliders.
const svgIcon = (paths) =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const TABS = [
  { hash: '#/', label: 'Tonight', icon: svgIcon('<path d="M3 17c3-8 5-11 6-11s2 3 3 6 2 5 3 5 2-2 3-5"/><line x1="3" y1="20" x2="21" y2="20"/>') },
  { hash: '#/targets', label: 'Targets', icon: svgIcon('<path d="M12 3l2.5 5.9 6.5.5-4.9 4.2 1.5 6.4L12 16.9 6.9 20l1.5-6.4L3.5 9.4l6.5-.5z"/>') },
  { hash: '#/horizon', label: 'Horizon', icon: svgIcon('<path d="M3 18l4-6 3 3 4-7 3 5 4-3"/><line x1="3" y1="21" x2="21" y2="21"/>') },
  { hash: '#/polar', label: 'Polar', icon: svgIcon('<circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="1.5"/>') },
  { hash: '#/sites', label: 'Sites', icon: svgIcon('<path d="M12 21s-6-5.686-6-10a6 6 0 0 1 12 0c0 4.314-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>') },
  { hash: '#/settings', label: 'Settings', icon: svgIcon('<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.5"/><circle cx="15" cy="16" r="2.5"/>') },
];

function renderTabs() {
  const h = location.hash || '#/';
  tabsRoot.replaceChildren(...TABS.map((t) =>
    el('button.tab', {
      class: h === t.hash ? 'active' : '',
      onclick: () => nav.go(t.hash),
    }, [el('span.tab-icon', { html: t.icon }), el('span.tab-label', {}, t.label)])));
}

function render() {
  const h = location.hash || '#/';
  renderTabs();
  window.scrollTo(0, 0);
  // Live views own their rendering into `app`.
  if (h.startsWith('#/targets')) return renderTargets(app, state, nav);
  if (h.startsWith('#/horizon')) return renderHorizonEditor(app, state, nav);
  if (h.startsWith('#/polar')) return renderPolar(app, state, nav);
  if (h.startsWith('#/sites')) return renderSites(app, state, nav);
  if (h.startsWith('#/settings')) return renderSettings(app, state, nav);
  return renderTonight(app, state, nav); // '#/' and anything else
}

window.addEventListener('hashchange', render);

// Boot.
(function boot() {
  mountAbout();        // floating "about" button, available everywhere
  mountThemeToggle();  // floating moon/sun Night Mode toggle, everywhere
  render();
})();

// Register the service worker for offline / installable PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
