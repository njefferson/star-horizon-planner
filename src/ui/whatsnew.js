// =============================================================================
// whatsnew.js — release notes live IN the app, never a link out to the repo.
// The notes show two ways: as a section in the ⓘ About dialog, and as a
// one-time popup the first time a RETURNING user loads a build whose notes are
// new to them. Brand-new users (who get the first-run welcome) don't see the
// popup — the welcome is their intro; we just record the notes as "seen".
//
// WHATSNEW_ID is a content id, not the app version: bump it ONLY when
// whatsNewBody() changes, and returning users who haven't seen that id get the
// popup once. (Decoupled from package.json so routine patch releases don't
// re-nag.)
// =============================================================================
import { el } from './dom.js';

export const WHATSNEW_ID = '1';
const SEEN_KEY = 'horizon.whatsNewSeen';
const WELCOMED_KEY = 'horizon.welcomed';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** The notes themselves (no heading) — shared by About and the popup. */
export function whatsNewBody() {
  return `
  <p><strong>A fresh name and look.</strong> The app is now
  <strong>Clear Horizons</strong> — same tool, same address — with a new
  star-trail icon and link card. <strong>If you added it to your home screen
  before this update, remove it and add it again</strong> to pick up the new
  icon (installed icons are cached and don&rsquo;t refresh on their own).</p>`;
}

/**
 * Boot hook: pop the notes ONCE for returning users on a build whose notes are
 * new to them. Records the id regardless, so it shows at most once, and never
 * stacks on the first-run welcome.
 */
export function maybeWhatsNew() {
  const seen = get(SEEN_KEY);
  if (seen === WHATSNEW_ID) return;               // already saw these notes
  const returning = get(WELCOMED_KEY) === '1';    // been here before this build
  set(SEEN_KEY, WHATSNEW_ID);                      // record regardless
  if (returning && !document.querySelector('.welcome-dialog')) openWhatsNew();
}

/** Open the What's-new dialog (also usable as a manual trigger). */
export function openWhatsNew() {
  document.querySelector('.whatsnew-dialog')?.remove();
  const dlg = el('dialog.about-dialog.whatsnew-dialog', { 'aria-label': 'What’s new in Clear Horizons' }, [
    el('div.about-body', { html: `<h2>What&rsquo;s new</h2>${whatsNewBody()}` }),
    el('div.about-foot', {}, [
      el('button.btn.primary', { onclick: () => dlg.close() }, 'Got it'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}
