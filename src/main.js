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
import { renderPolarAim } from './ui/polaraim.js';
import { renderCapture } from './ui/capture.js';
import { renderLiveCapture } from './ui/livecapture.js';
import { renderSky } from './ui/sky.js';
import { renderTargetDetail } from './ui/targetdetail.js';
import { loadSites, requestPersistence, ensureDefaultSite } from './model/sites.js';
import { loadCatalog, favoriteIds } from './model/catalog.js';
import { sweepFavorites } from './model/precache.js';
import { maybeWelcome } from './ui/location.js';

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
  go(hash) { if (location.hash === hash) render(true); else location.hash = hash; },
  // An in-view repaint must NOT throw focus to the heading (WCAG 3.2.2): capture
  // the focused control's identity before the rebuild and restore it after, so
  // toggling a chip or stepping the date keeps you on that control.
  rerender() { render(false, focusKey()); },
};

// A rebuild-stable identity for the focused control: tag + role + accessible
// label (aria-label, else trimmed text). Chips/selects/date buttons keep their
// label across a rerender, so this re-finds the same control.
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body || !app.contains(a)) return null;
  const label = (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 80);
  return `${a.tagName}#${a.getAttribute('role') || ''}#${label}`;
}
function restoreFocus(key) {
  if (!key) return;
  for (const el of app.querySelectorAll('button, input, select, textarea, a[href], [role="slider"], [tabindex]')) {
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80);
    if (`${el.tagName}#${el.getAttribute('role') || ''}#${label}` === key) { el.focus({ preventScroll: true }); return; }
  }
}

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
  tabsRoot.replaceChildren(...TABS.map((t) => {
    const active = h === t.hash || (t.hash === '#/' && !TABS.some((x) => x.hash !== '#/' && h.startsWith(x.hash)));
    return el('button.tab', {
      class: active ? 'active' : '',
      // aria-current marks the active view for screen readers (colour + the
      // active class alone don't convey "you are here").
      'aria-current': active ? 'page' : null,
      onclick: () => nav.go(t.hash),
    }, [el('span.tab-icon', { html: t.icon }), el('span.tab-label', {}, t.label)]);
  }));
}

// On a tab navigation, move focus to the new view's heading so keyboard and
// screen-reader users land in the content. Skipped on first paint — booting
// shouldn't steal focus.
let booted = false;
function focusHeading() {
  const h1 = app.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
}

// navigated=true → a view change (focus the heading); false → an in-view
// repaint (restore focus to the control identified by `key`).
function render(navigated = true, key = null) {
  const h = location.hash || '#/';
  renderTabs();
  window.scrollTo(0, 0);
  const after = () => { if (!booted) return; navigated ? focusHeading() : restoreFocus(key); };
  // Live views own their rendering into `app`; async views (Tonight, Targets)
  // settle their focus once the first paint lands.
  const done = (p) => { (p && typeof p.then === 'function') ? p.then(after) : after(); };
  if (h.startsWith('#/target/')) return done(renderTargetDetail(app, state, nav)); // per-object details, no tab
  if (h.startsWith('#/targets')) return done(renderTargets(app, state, nav));
  if (h.startsWith('#/sky')) return done(renderSky(app, state, nav)); // AR arcs-across-the-sky view (no tab; from Tonight)
  if (h.startsWith('#/capture/live')) return done(renderLiveCapture(app, state, nav)); // live-camera AR capture
  if (h.startsWith('#/capture')) return done(renderCapture(app, state, nav)); // sub-view of Horizon, no tab
  if (h.startsWith('#/horizon')) return done(renderHorizonEditor(app, state, nav));
  if (h.startsWith('#/polar/aim')) return done(renderPolarAim(app, state, nav)); // live pole-aim aid (sub-view of Polar, no tab)
  if (h.startsWith('#/polar')) return done(renderPolar(app, state, nav));
  if (h.startsWith('#/sites')) return done(renderSites(app, state, nav));
  if (h.startsWith('#/settings')) return done(renderSettings(app, state, nav));
  return done(renderTonight(app, state, nav)); // '#/' and anything else
}

window.addEventListener('hashchange', () => render(true));

// Boot.
(function boot() {
  mountAbout();        // floating "about" button, available everywhere
  mountThemeToggle();  // floating moon/sun Night Mode toggle, everywhere
  ensureDefaultSite(); // always have an active site → open into the sky, not a wall
  render();
  booted = true;       // subsequent navigations move focus to the view heading
  maybeWelcome(nav);   // first run: explain the app and get a real location

  // Existing data (sites/horizons predating this call) deserves protection
  // from storage eviction too — new writes re-request it in model/sites.js.
  if (loadSites().length) requestPersistence();

  // Idle sweep: reconcile the offline-image cache with the favourite set —
  // warms favourites from before precaching existed and retries past failures.
  // Idle so it never competes with first paint; fail-soft by design.
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 3000));
  idle(() => {
    loadCatalog().then((objs) => sweepFavorites(objs, favoriteIds())).catch(() => {});
  });
})();

// Register the service worker for offline / installable PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
