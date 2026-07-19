// Clear Horizons service worker — offline-first for the whole static app.
// No network APIs are contacted in v1 (astronomy-engine is vendored and runs
// on-device; Open-Meteo / hips2fits land on the roadmap). Bump CACHE on release.
const CACHE = 'horizon-v48'; // app v2.16.0 — Tier 2 rename: new home clear-horizons.pages.dev; old origin gets the moved banner (og-image wordmark still pending new art)
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png',
  './src/styles.css', './src/main.js',
  './src/ui/dom.js', './src/ui/theme.js', './src/ui/about.js', './src/ui/marks.js',
  './src/ui/targets.js', './src/ui/settings.js', './src/ui/horizoneditor.js', './src/ui/nightgraph.js', './src/ui/sites.js', './src/ui/polar.js', './src/ui/capture.js', './src/ui/livecapture.js', './src/ui/sky.js', './src/ui/polaraim.js', './src/ui/terrainmap.js', './src/ui/install.js', './src/ui/moved.js', './src/ui/targetdetail.js', './src/ui/location.js',
  './src/model/astro.js', './src/model/instruments.js', './src/model/catalog.js', './src/model/horizon.js',
  './src/model/night.js', './src/model/visibility.js', './src/model/sites.js', './src/model/polar.js', './src/model/capture.js', './src/model/arproject.js', './src/model/skyview.js', './src/model/thumbnails.js', './src/model/precache.js', './src/model/describe.js', './src/model/geocode.js', './src/model/geomag.js', './src/model/weather.js', './src/model/terrain.js', './src/model/panorama.js', './src/model/zip.js',
  './src/data/instruments.js', './src/data/catalog.json',
  './src/vendor/astronomy.js', './src/vendor/leaflet.js', './src/vendor/leaflet.css',
];

const PRECACHED = new Set(ASSETS.map((u) => new URL(u, self.registration.scope).href));

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Precache each asset INDIVIDUALLY. cache.addAll is atomic — one flaky
    // request rejects the whole batch, leaving the new cache empty while
    // activate deletes the old one, permanently breaking offline. allSettled
    // keeps whatever succeeded; the rest self-heal via the fetch handler.
    await Promise.allSettled(ASSETS.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const k of await caches.keys()) {
      if (k === CACHE) continue;
      // The page-managed favourite-image cache (model/precache.js THUMBS_CACHE)
      // is version-independent — never delete it on an app-version bump.
      if (k.startsWith('horizon-thumbs')) continue;
      // Carry forward runtime-cached data (fonts, and later per-site/night
      // weather + thumbnails) so a version bump doesn't force a re-download of
      // offline data. App code is NOT carried over — the new precache already
      // holds the current version, so the module graph stays consistent.
      const old = await caches.open(k);
      for (const req of await old.keys()) {
        if (PRECACHED.has(req.url)) continue;
        if (!(await c.match(req))) {
          const res = await old.match(req);
          if (res) await c.put(req, res);
        }
      }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Navigations: network-first so deploys update, fall back to cached shell.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // Map tiles BYPASS the SW entirely: their responses are opaque (never
  // cacheable by the 200s-only rule), so interception adds nothing — and
  // piping opaque cross-origin images through a SW is a known iOS WebKit
  // breakage vector (2026-07-18 device pass: production tiles failed with the
  // SW in the path while Chromium rendered the same code perfectly).
  if (url.hostname.endsWith('arcgisonline.com') || url.hostname.endsWith('.tile.opentopomap.org')) return;

  // Cross-origin Google Fonts (the IBM Plex faces — every number in the app):
  // their responses are opaque (res.ok is false), so the generic branch below
  // would never cache them and offline would lose the fonts entirely. Cache the
  // opaque response so the offline-first promise holds after one online load.
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');

  // Everything else: stale-while-revalidate — serve the cache instantly for
  // offline/speed, but ALWAYS refetch in the background so a deployed change
  // reaches installed clients on their next load, without waiting for a
  // service-worker version bump. NB: caches.match here is GLOBAL — it also
  // serves the page-managed horizon-thumbs cache, which is how favourited
  // objects' images render offline with no dedicated code path.
  // ignoreVary: a cached cutout stored from a page fetch() must still match
  // the <img>'s no-cors request even if the origin server sends Vary: Origin.
  e.respondWith(caches.match(e.request, { ignoreVary: true }).then((hit) => {
    const refresh = fetch(e.request).then((res) => {
      if (res && (res.ok || (isFont && res.type === 'opaque'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    });
    if (hit) {
      e.waitUntil(refresh.catch(() => {})); // offline → keep the cached copy
      return hit;
    }
    return refresh.catch(() => hit);
  }));
});
