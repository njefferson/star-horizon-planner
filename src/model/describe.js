// =============================================================================
// describe.js — a short prose description per object for the details page, from
// Wikipedia's REST summary API (keyless, CORS-friendly). The catalog carries
// coordinates and sizes, not prose, so this fills the "what is this thing"
// paragraph the Seestar details page shows.
//
// SAFE BY DESIGN: purely additive. It never blocks the page — the facts and the
// image stand on their own — and it fails closed (offline, no article, or a
// disambiguation page → no prose, no error surfaced). Title choice favours the
// least-ambiguous name we hold: the common name, else "Messier N", else the
// NGC/IC designation. Obscure bare-catalogue objects simply won't have an
// article, which is fine.
// =============================================================================

const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

/** The most reliable Wikipedia title for an object, given what the catalog holds. */
export function wikiTitle(o) {
  if (o.common && o.common.trim()) return o.common.trim();
  if (o.m) return `Messier ${o.m}`;
  return (o.name || '').trim();
}

/**
 * Fetch a short description. Resolves to { title, extract, url } or null when
 * there's nothing usable (offline, missing article, disambiguation). Never
 * throws for the caller — a network/parse failure resolves to null.
 * @param opts { signal, fetchImpl } — fetchImpl for tests.
 */
export async function fetchDescription(o, { signal, fetchImpl } = {}) {
  const title = wikiTitle(o);
  if (!title) return null;
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return null;
  try {
    const res = await f(`${SUMMARY}${encodeURIComponent(title)}?redirect=true`, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || j.type === 'disambiguation' || !j.extract) return null;
    return { title: j.title || title, extract: j.extract, url: j.content_urls?.desktop?.page || null };
  } catch { return null; } // offline / aborted / bad JSON — degrade to no prose
}
