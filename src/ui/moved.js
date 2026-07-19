// =============================================================================
// moved.js — the Tier 2 rename moved the app's home from
// star-horizon-planner.pages.dev to clear-horizons.pages.dev. Origins do not
// share localStorage, so nobody's saved sites/horizons can follow
// automatically: users on the OLD origin must carry a backup across (Sites →
// Export backup → import at the new address). This banner renders ONLY on the
// old origin and says exactly that. Deliberately not dismissible — it goes
// away by migrating, or when the old project is retired.
// =============================================================================
import { el } from './dom.js';

export const OLD_HOST = 'star-horizon-planner.pages.dev';
export const NEW_ORIGIN = 'https://clear-horizons.pages.dev';

/** True only on the pre-rename origin. Pure — hostname injected for tests. */
export function movedAway(hostname) {
  return hostname === OLD_HOST;
}

/** Boot hook: mount the migration banner on the old origin; no-op elsewhere. */
export function mountMovedNotice(hostname = location.hostname) {
  if (!movedAway(hostname) || document.getElementById('moved-note')) return;
  const note = el('div.sky-notice.moved-note', { id: 'moved-note' }, [
    el('span', {}, '🏠 '),
    el('strong', {}, 'This app has moved to '),
    el('a', { href: NEW_ORIGIN }, 'clear-horizons.pages.dev'),
    el('strong', {}, '.'),
    el('span.dim.small', {}, ' Saved sites and horizons live only in this browser, so they can’t follow on their own: open Sites → Export backup here, then import it at the new address and install the app there.'),
  ]);
  document.body.prepend(note);
}
