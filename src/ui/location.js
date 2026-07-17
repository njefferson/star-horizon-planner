// =============================================================================
// location.js (UI) — everything about telling the app WHERE you are, in the
// easy ways people expect: a one-tap "use my location", or type a city / state
// / ZIP and pick from matches. Latitude & longitude stay available in Sites as
// the manual fallback, but nobody should need them.
//
// A first-run welcome nudges this before anything else, because the whole app —
// "what's up above me tonight" — is meaningless without a location. Until it's
// set, the seeded site is a clearly-labelled placeholder ("Somewhere, USA").
// =============================================================================
import { el, clear, toast } from './dom.js';
import { activeSite, updateSite } from '../model/sites.js';
import { geocode } from '../model/geocode.js';

const WELCOMED_KEY = 'horizon.welcomed';
function seen() { try { return localStorage.getItem(WELCOMED_KEY) === '1'; } catch { return true; } }
function markSeen() { try { localStorage.setItem(WELCOMED_KEY, '1'); } catch { /* private mode */ } }

/** Write a chosen place onto the active site and repaint. */
function applyPlace(place, nav) {
  const s = activeSite();
  if (s) updateSite(s.id, { name: place.label || place.name || 'My location', lat: place.lat, lon: place.lon, approx: false });
  toast(`Location set: ${place.label || place.name}.`);
  nav.rerender();
}

/** One-tap geolocation → active site. */
export function useMyLocation(nav) {
  if (!navigator.geolocation) { toast('Location isn’t available on this device — type a city or ZIP instead.'); return; }
  toast('Locating…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const s = activeSite();
      if (s) updateSite(s.id, { lat: pos.coords.latitude, lon: pos.coords.longitude, approx: false, name: s.approx ? 'My location' : s.name });
      toast('Location set — showing your sky.');
      nav.rerender();
    },
    () => toast('Location permission denied — type a city or ZIP instead.'),
    { maximumAge: 600000, timeout: 8000 },
  );
}

/** Dialog: type a city / state / ZIP, pick a match. */
export function openLocationSearch(nav, { onPicked } = {}) {
  document.querySelector('.loc-dialog')?.remove();
  const pick = onPicked || ((p) => applyPlace(p, nav));

  const input = el('input.loc-in', { type: 'text', placeholder: 'City, state, or ZIP', 'aria-label': 'Search a city, state, or ZIP', autocomplete: 'off' });
  const status = el('p.small.dim', { id: 'geo-status', role: 'status', 'aria-live': 'polite' }, '');
  const results = el('ul.geo-results', { 'aria-label': 'Matches' });

  let token = 0;
  async function run() {
    const q = input.value.trim();
    results.replaceChildren();
    if (!q) { status.textContent = 'Type a place, then Search.'; return; }
    status.textContent = 'Searching…';
    const mine = ++token;
    const matches = await geocode(q);
    if (mine !== token) return; // a newer search superseded this one
    if (!matches.length) { status.textContent = 'No matches — try “City, State”, or use latitude/longitude in Sites.'; return; }
    status.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}:`;
    results.replaceChildren(...matches.map((m) => el('li', {}, [
      el('button.btn.geo-hit', { onclick: () => { dlg.close(); pick(m); } }, [
        el('span.geo-name', {}, m.label),
        el('span.geo-coord.mono.dim.small', {}, `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}`),
      ]),
    ])));
  }

  const dlg = el('dialog.loc-dialog', { 'aria-labelledby': 'geo-title' }, [
    el('h2', { id: 'geo-title' }, 'Find your location'),
    el('p.dim.small', {}, 'Type where you are — a city, “City, State”, or a ZIP code.'),
    el('div.geo-row', {}, [
      input,
      el('button.btn.primary', { onclick: run }, 'Search'),
    ]),
    status,
    results,
    el('div.hz-dialog-foot', {}, [el('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancel')]),
  ]);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  input.focus();
}

/** First-run welcome: explain the app and get a location, once. */
export function maybeWelcome(nav) {
  if (seen()) return;
  const s = activeSite();
  if (!s || !s.approx) { markSeen(); return; } // real location already set — don't nag
  document.querySelector('.welcome-dialog')?.remove();
  const dlg = el('dialog.loc-dialog.welcome-dialog', { 'aria-labelledby': 'welcome-title' }, [
    el('h2', { id: 'welcome-title' }, 'Welcome — let’s find your sky'),
    el('p', {}, 'Star Horizon Planner shows what’s up above you tonight, from your real location and horizon. First, where are you?'),
    el('p.dim.small', {}, 'Until you set it, the app uses a placeholder location (“Somewhere, USA”), so numbers won’t match your sky.'),
    el('div.welcome-actions', {}, [
      el('button.btn.primary.block', { onclick: () => { markSeen(); dlg.close(); useMyLocation(nav); } }, '📍 Use my location'),
      el('button.btn.block', { onclick: () => { markSeen(); dlg.close(); openLocationSearch(nav); } }, '🔎 Enter a city or ZIP'),
      el('button.btn.ghost', { onclick: () => { markSeen(); dlg.close(); } }, 'Not now'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
