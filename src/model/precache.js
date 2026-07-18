// =============================================================================
// precache.js — deliberate Cache-API warming of favourited objects' sky images
// (the roadmap's "Cache-API precache-per-object"). A favourite gets BOTH its
// cutouts — the Targets-row 96×96 preview and the details page's 800×500 image
// — fetched into a STABLE cache so the field works offline. URLs come from the
// same shared specs the pages render with (model/thumbnails.js), so what's
// warmed is byte-for-byte what's requested.
//
// CACHE NAME CONTRACT: sw.js's activate step deletes every cache except the
// current app version, but SKIPS names starting 'horizon-thumbs' — this cache
// survives version bumps. The SW's fetch handler serves via the GLOBAL
// caches.match, which searches this cache too, so offline <img> loads Just
// Work with no SW code path of their own.
//
// DOCTRINE: warming is fire-and-forget and fail-soft — it never throws, never
// toasts, never blocks a click. Failures are counted, not surfaced; an object
// that was never warmed keeps its honest ★ placeholder. Only res.ok responses
// are stored (hips2fits is CORS-enabled, so page fetches aren't opaque).
//
// Dependency-injected (cachesApi/fetchFn) because Node has no Cache API — the
// unit suite hands in fakes; in the browser the defaults apply and every entry
// point no-ops safely when the Cache API is absent.
// =============================================================================
import { thumbUrl, detailImageSpec, listImageSpec } from './thumbnails.js';
import { requestPersistence } from './sites.js';

export const THUMBS_CACHE = 'horizon-thumbs-v1'; // sw.js activate skips the 'horizon-thumbs' prefix — keep in sync

const defaults = () => ({
  cachesApi: typeof caches !== 'undefined' ? caches : null,
  fetchFn: typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
  concurrency: 3,
});

/** The two URLs kept warm for a favourite: list preview + detail image. */
export function precacheUrls(o) {
  return [thumbUrl(o, listImageSpec()), thumbUrl(o, detailImageSpec(o))];
}

// Fetch one URL into the cache if missing. Returns 'warmed' | 'had' | 'failed'.
async function warmUrl(cache, url, fetchFn) {
  try {
    // ignoreVary: hips2fits may send Vary headers; we key purely by URL.
    if (await cache.match(url, { ignoreVary: true })) return 'had';
    const res = await fetchFn(url);
    if (!res || !res.ok) return 'failed';
    await cache.put(url, res.clone ? res.clone() : res);
    return 'warmed';
  } catch { return 'failed'; }
}

// A tiny worker pool: run `jobs` (thunks) at most `n` at a time.
async function pool(jobs, n) {
  const results = [];
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) { const j = jobs[i++]; results.push(await j()); }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, jobs.length)) }, worker));
  return results;
}

/** Warm one object's images (on favourite). Fire-and-forget; never throws. */
export async function warmObject(o, deps = {}) {
  const { cachesApi, fetchFn, concurrency } = { ...defaults(), ...deps };
  if (!cachesApi || !fetchFn || !o) return { warmed: 0, failed: 0 };
  try {
    const cache = await cachesApi.open(THUMBS_CACHE);
    const res = await pool(precacheUrls(o).map((u) => () => warmUrl(cache, u, fetchFn)), concurrency);
    const warmed = res.filter((r) => r === 'warmed').length;
    if (warmed) requestPersistence(); // cached field images are worth protecting
    return { warmed, failed: res.filter((r) => r === 'failed').length };
  } catch { return { warmed: 0, failed: 1 }; }
}

/** Drop one object's images (on unfavourite). Never throws. */
export async function pruneObject(o, deps = {}) {
  const { cachesApi } = { ...defaults(), ...deps };
  if (!cachesApi || !o) return;
  try {
    const cache = await cachesApi.open(THUMBS_CACHE);
    for (const u of precacheUrls(o)) await cache.delete(u, { ignoreVary: true });
  } catch { /* fail-soft */ }
}

let sweepInFlight = false;

/**
 * Reconcile the whole cache with the favourite set: warm every favourite's
 * missing images, delete everything else (which also self-heals URLs left by
 * older spec versions). Overlapping sweeps coalesce. Returns counts.
 */
export async function sweepFavorites(objects, favIds, deps = {}) {
  const { cachesApi, fetchFn, concurrency } = { ...defaults(), ...deps };
  if (!cachesApi || !fetchFn || sweepInFlight) return { warmed: 0, pruned: 0, failed: 0 };
  sweepInFlight = true;
  try {
    const cache = await cachesApi.open(THUMBS_CACHE);
    const wanted = new Map(); // url → true, across all favourites
    for (const o of objects) {
      if (!favIds.has(o.id)) continue;
      for (const u of precacheUrls(o)) wanted.set(u, true);
    }
    let pruned = 0;
    for (const req of await cache.keys()) {
      if (!wanted.has(req.url)) { await cache.delete(req); pruned++; }
    }
    const res = await pool([...wanted.keys()].map((u) => () => warmUrl(cache, u, fetchFn)), concurrency);
    const warmed = res.filter((r) => r === 'warmed').length;
    if (warmed) requestPersistence();
    return { warmed, pruned, failed: res.filter((r) => r === 'failed').length };
  } catch {
    return { warmed: 0, pruned: 0, failed: 1 };
  } finally { sweepInFlight = false; }
}
