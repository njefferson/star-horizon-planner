// Horizon Planner service worker — offline-first for the whole static app.
// No network APIs are contacted in v1 (astronomy-engine is vendored and runs
// on-device; Open-Meteo / hips2fits land on the roadmap). Bump CACHE on release.
const CACHE = 'horizon-v19'; // WIP: night-graph blocked runs grey+dashed, flat-horizon prompt (unreleased)
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png',
  './src/styles.css', './src/main.js',
  './src/ui/dom.js', './src/ui/theme.js', './src/ui/about.js',
  './src/ui/targets.js', './src/ui/settings.js', './src/ui/horizoneditor.js', './src/ui/nightgraph.js', './src/ui/sites.js', './src/ui/polar.js', './src/ui/capture.js', './src/ui/livecapture.js', './src/ui/targetdetail.js', './src/ui/location.js',
  './src/model/astro.js', './src/model/instruments.js', './src/model/catalog.js', './src/model/horizon.js',
  './src/model/night.js', './src/model/visibility.js', './src/model/sites.js', './src/model/polar.js', './src/model/capture.js', './src/model/arproject.js', './src/model/thumbnails.js', './src/model/describe.js', './src/model/geocode.js',
  './src/data/instruments.js', './src/data/catalog.json',
  './src/vendor/astronomy.js',
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
  // Cross-origin Google Fonts (the IBM Plex faces — every number in the app):
  // their responses are opaque (res.ok is false), so the generic branch below
  // would never cache them and offline would lose the fonts entirely. Cache the
  // opaque response so the offline-first promise holds after one online load.
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');

  // Everything else: stale-while-revalidate — serve the cache instantly for
  // offline/speed, but ALWAYS refetch in the background so a deployed change
  // reaches installed clients on their next load, without waiting for a
  // service-worker version bump.
  e.respondWith(caches.match(e.request).then((hit) => {
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
