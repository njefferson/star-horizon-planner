# S50 Horizon Planner — NOTES (source of truth)

Read this before doing anything. It carries the product thesis, the build order,
the reuse map from Noah's existing repos, settled decisions, and the roadmap.
Structure mirrors the two sibling apps (Bird-location-scouting, Jefferson-
Photography-Studio): free, on-device, offline-first PWA on Cloudflare Pages.

## Product thesis — synergy + one new capability
Every individual feature already exists free (Telescopius = catalog/curves/
thumbnails AND a manual per-location custom horizon with CSV import — see
REVIEW-2026-07-17.md; Astrospheric/Clear Outside = weather/seeing; Polar Scope
Align = polar reticle; the Seestar app = rise/set). This app's value is
**synergy** — one tool tying site + horizon + targets + alignment together,
offline — **plus the one thing no free tool does: physically MEASURING the
horizon** (sensor-trace capture of the real treeline from the actual yard —
the roadmap's top item) and applying it everywhere, including the zenith
dead-zone nobody else models. Every visibility answer reflects what you can
really see, not a 0° horizon.

Two novel capabilities anchor everything:
1. **Measured horizon mask** — walk into the yard, capture the treeline, get a
   real azimuth→altitude profile.
2. **"Above MY horizon" visibility** — a target (or the celestial pole) counts as
   usable only where its altitude clears the measured profile at its azimuth.

Settled decisions: **Balanced core** v1 scope · **no-build vanilla ES modules**
(mirror the bird app, not the Vite/TS photo studio) · Cloudflare Pages with a
`staging` on-device gate before `main`.

**Future direction — instrument-agnostic.** The horizon capability has nothing to
do with the S50 specifically; it applies to any telescope. This app will grow from
the S50 default to the **S30, other smart telescopes (Dwarf, Vaonis Vespera, etc.),
and fully custom sensor/focal-length profiles for planning ANY telescope**. So the
field-of-view is modeled as a **first-class per-instrument profile from day one**
(v1 ships the S50 as the default), NOT a hardcoded constant — every "does it fit /
how many mosaic panels / framing overlay" answer reads from the active instrument.
(Done: the repo is `star-horizon-planner`, and storage standardized on a
neutral `horizon.*` prefix in the scaffold — NOT `s50.*` as first drafted.)

## Reuse map — copy from `Bird-location-scouting/frame/`
The bird app is the structural template. Reuse near-verbatim:
- **`src/ui/dom.js`** — `el()` (null-safe hyperscript), `clear()`, `toast()` (Undo
  action). Copy wholesale (v1.1 pruned the bird-only `scoreScale()`/`sparkline()`).
  GOTCHA: native
  `replaceChildren/append/prepend` are NOT null-safe — only pass `.filter(Boolean)`
  arrays to them (`el()` itself is null-safe).
- **`src/ui/panzoom.js`** — domain-agnostic pinch/pan over an SVG+viewBox (Pointer
  Events, rAF-batched viewBox writes, `elementFromPoint`-in-`pointerup` tap
  resolution because SVG pointer-capture eats native clicks). Reuse for the **night
  graph** scrub and the **horizon editor**. Drop `controls()` if unwanted.
  **v1 outcome: went unused** — the night graph hand-rolled a simpler pointer
  scrub and the editor drags SVG handles directly; pruned in v1.1 (recover from
  the bird app if a future feature needs real pinch/pan).
- **`sw.js`** — hand-written SW: versioned cache (`horizon-vN`), per-asset precache via
  `Promise.allSettled` (never `addAll` — one flaky asset breaks offline), `activate`
  that **carries forward** runtime-cached data across version bumps,
  stale-while-revalidate + network-first navigations. Change `CACHE` + `ASSETS`.
  Cache 200s only; `clone()` before `respondWith`.
- **`index.html`** boot shape — pre-paint theme IIFE reading `horizon.theme` before
  first paint, apple PWA metas, `viewport-fit=cover`, single `<script type=module>`
  entry, hash routing.
- **`.github/workflows/deploy.yml`** — Cloudflare Pages via `wrangler-action@v3`;
  `--branch=main` = production, any other branch = a preview URL. That's the whole
  `staging` gate. Change `--project-name`. **No `functions/` proxy needed** —
  Open-Meteo + astronomy-engine are keyless and CORS-friendly (unlike eBird).
- **`scripts/build-counties.mjs`** + **`gen-basemap.mjs`** — the curation pattern
  for the OpenNGC catalog builder: `#!/usr/bin/env node` ESM, subcommand dispatch,
  polite fetch, filter/round, write a committed generated file with an
  "AUTO-GENERATED" header + `builtAt` stamp, incremental `--force`, `validate` CI
  gate.
- Conventions: `horizon.*` localStorage keys with inline `try/catch`; `#/import?...`
  share-links for export/import; `:root` CSS tokens + `[data-theme="dark"]` (never
  hex-in-place); IBM Plex, mono for every number; release = SW cache version bumped
  with the changelog. **Branches: ONLY `staging` and `main` exist — ever** (owner's
  standing order, 2026-07-17). Work lands on `staging` → on-device go → merge to
  `main`; never create any other branch. (Parallel sessions must therefore pull
  `staging` before pushing — the Step 8 collision is the cautionary tale.)

The **night graph** follows the photo studio's one hand-rolled viz routine,
`Jefferson-Photography-Studio/src/histogram.ts` (Canvas 2D, closure-based `x()/y()`
scales, filled areas + stroked outline, cheap repaint). No chart library anywhere
in Noah's work — hand-roll on canvas.

## Layout (`star-horizon-planner/`) — as built
```
index.html  sw.js  manifest.webmanifest  icon.svg  apple-touch-icon.png
src/
  main.js                     bootstrap, state, hash routing, SW register
  styles.css                  :root tokens + [data-theme="dark"]
  ui/  dom.js                 (copied) + nightgraph.js horizoneditor.js polar.js
       sites.js targets.js settings.js theme.js about.js
  model/ astro.js             astronomy-engine wrappers: alt/az(t), sun/moon, twilight
         night.js             night window (dusk→dawn) + twilight sampling
         polar.js             horizon-aware polar alignment (NCP/SCP, reticle clock)
         horizon.js           profile model + Stellarium import/export + sample-at-az
         visibility.js        curve ∩ horizon → effective windows (+ geometric)
         instruments.js       FOV/mosaic model + custom-scope registry; active = horizon.instrument
         sites.js             named sites w/ per-site horizon (horizon.sites) + backup bundle
         catalog.js           load bundled catalog, filters, framing, favorites (horizon.favorites)
  data/  catalog.json         AUTO-GENERATED (OpenNGC → mag ≤ 12 subset)
         instruments.js       bundled presets (S50 = IMX462, S30 = IMX662)
  vendor/ astronomy.js        astronomy-engine ESM, vendored (offline, no CDN)
scripts/ build-catalog.mjs    OpenNGC → filtered committed JSON + validate
test/                         node --test headless suites for every model module
.github/workflows/           ci.yml (test + validate) deploy.yml purge-deployments.yml
```
(Planned `model/targets.js` was folded into `catalog.js`; `model/location.js`
was absorbed by `sites.js` in v1.1.)

## Astronomy & data
- **astronomy-engine** (MIT, ~100 KB, no network) — vendored as a local ESM in
  `src/vendor/`. Alt/az of any RA/Dec vs. time; Sun altitude → twilight bands; Moon
  altitude + phase; Polaris/NCP for the polar-align roadmap item.
- **Instrument profiles** (`model/instruments.js`, `data/instruments.js`): each is
  `{ name, focalLength_mm, sensor: {w_mm,h_mm} | {w_px,h_px,pixel_um}, fov: {w_deg,
  h_deg} (computed if absent), mount: { altAz: bool, eqCapable: bool,
  zenithDeadZone_deg } }`. v1 bundles the **S50** (fov ≈ 1.29° × 0.73°) as the
  default and the **S30** (wider — shorter focal length; compute from its specs, do
  NOT guess). Active instrument in `horizon.instrument`; user-added customs in
  `horizon.instruments`. **Every FOV/mosaic/framing decision reads the active
  profile — never a hardcoded constant.**
- **Catalog**: OpenNGC (CC-BY-SA) → `build-catalog.mjs` filters to a broad,
  instrument-neutral subset (Messier + Caldwell + NGC/IC brighter than ~mag 12).
  Store RA/Dec, type, mag, **raw** angular size, common name — do NOT bake a
  `mosaic` flag; **fit-vs-mosaic (and panel count) is computed at runtime against
  the active instrument's FOV**, so the same catalog serves the S50, S30, and any
  custom scope. Few hundred KB.
- **Deferred to roadmap (all keyless):** thumbnails via CDS hips2fits; weather via
  Open-Meteo hourly cloud cover (total/low/mid/high) + 7Timer ASTRO for
  seeing/transparency (7Timer is the only keyless seeing source and is flaky —
  degrade gracefully). Cache per site per night in the Cache API.

## Build order — Balanced core (v1)
1. **Scaffold**: copy `dom.js`, `panzoom.js`, `sw.js`, `index.html`, `deploy.yml`;
   wire hash routing + tabs + theme; vendor astronomy-engine. Deploy an empty shell
   to `staging` to prove the pipeline before features.
2. **`model/astro.js`**: alt/az(target, lat/lon, t); Sun-altitude twilight
   (civil/nautical/astro); Moon altitude + phase. Headless Node unit tests.
3. **Catalog + instruments**: `build-catalog.mjs` → `data/catalog.json`;
   `model/catalog.js` + `model/instruments.js` (S50 default, S30 bundled) + filter
   UI (type, magnitude, size, and a **fits-the-active-instrument / mosaic-N×M**
   tier; favorites in `horizon.favorites`). Instrument switcher in Settings.
4. **Horizon model + manual editor FIRST** (`model/horizon.js`,
   `ui/horizoneditor.js`): 36-row (10° azimuth) table, direct-manipulation drag to
   set each altitude, Stellarium horizon-file import/export. 100% headless-testable —
   de-risks the whole data model before any device-sensor work.
5. **Night graph** (`ui/nightgraph.js`): hand-rolled canvas — altitude-vs-time
   curves for selected targets, **the site horizon applied as the cutoff**, twilight
   bands, sun/moon markers + phase. Scrub via a light pointer handler (the
   planned `panzoom.js` reuse proved unnecessary).
6. **Visibility table** (`model/visibility.js`): from the same computation, show
   **both** geometric rise/set **and** effective "above MY horizon" windows
   (effective emphasized). Subtract the near-zenith dead-zone too (see S50 notes).
7. **Sites manager** (`model/sites.js`, `ui/sites.js`): multiple named sites
   (lat/lon + own horizon profile), switcher, JSON export/import.

## v1.1 — polish accepted from the plan review (REVIEW-2026-07-17.md)
Lands on `staging` — the on-device gate v1 skipped; USE IT from now on
(`staging` → device pass → merge to `main`).
- [x] Prune vestigial bird-app code (`panzoom.js`, `scoreScale`/`sparkline`,
      the superseded location store) + SW v7
- [x] About: correct the novelty claim; visible OpenNGC (CC-BY-SA-4.0) +
      astronomy-engine (MIT) attribution; drop stale scaffold copy
- [x] Settings: custom telescope editor (name + focal + sensor px/µm →
      computed FOV) on the existing model registry
- [x] Moon interference on the visibility table (separation + illumination,
      flagged when close & bright)
- [x] `navigator.storage.persist()` once real data exists (a measured horizon
      is precious data in evictable storage)
- [x] Headless-Chromium smoke script (`scripts/ui-smoke.mjs`) — first cut at
      the UI-test gap
- [x] **Step 8 Polar Align merged in** — built in a parallel session on
      `staging` (model/polar.js + horizon-aware Polar tab + tests, both
      hemispheres); exactly the review's "ship the computable half early".
      The live "point to the pole" aid still waits for the capture stack.
- [ ] On-device NEEDS-HIS-HANDS pass on staging: PWA install, offline, iPad
      drag feel, first-run journey (now incl. Polar + custom-scope UI)
The v1.1 open decision (horizon storage resolution) is settled at the top of
v1.2 below, per the review's ordering.

## v1.2 — sensor-trace capture (the moat)

**Settled first — horizon storage v2.** A profile is now an
arbitrary-resolution list of (azimuth, altitude) points (sorted, wrap-aware
interpolation, ≥1 point), not a fixed 36-bin array:
- capture bins sensor sweeps at 1° (median per bin — robust to hand jitter);
  Stellarium import keeps the file's own density instead of resampling away
  detail; legacy 36-arrays (sites, backups, horizon.profile) convert on load.
- altitudes may go BELOW 0° (hilltop/balcony sites; floor −30°) — only capture
  and import produce negatives; the manual editor still drags in [0, 90].
- the 36-handle editor stays as the manual-entry VIEW: handles read
  `sampleAt(az)`, and dragging one replaces the stored points within ±5° of
  that azimuth — hand-correcting a captured wedge coarsens just that wedge.
- `sampleAt`/`isAbove` keep their signatures, so visibility, the night graph
  and polar are untouched. Sites/backups store `[[az, alt], …]` pairs; old
  backups import unchanged.

**Build order (each step → staging, tests first culture) — 9a–9d BUILT,
awaiting the on-device pass (compass accuracy/drift and sighting feel are the
NEEDS-HIS-HANDS half; the smoke pass drives the whole flow synthetically):**
- **9a** `model/horizon.js` v2 + `model/sites.js` storage — points model,
  legacy conversion, density-preserving Stellarium I/O, negative-alt clamp;
  rewrite horizon tests, prune the dead standalone `loadHorizon`/`saveHorizon`.
- **9b** `ui/horizoneditor.js` on v2 — the curve draws from `sampleAt` at fine
  steps so captured detail is visible; handles keep today's drag/keyboard UX.
- **9c** `model/capture.js` (100% headless): top-edge pointing math from
  device Euler angles — heading = (360 − α) % 360 and altitude = β hold
  EXACTLY for the sighting axis under the W3C Z-X′-Y″ convention (the device
  Y-axis is invariant under γ); **Sun-azimuth calibration** (offset = true −
  measured, wrapped; fixes magnetic declination + local interference in one
  sighting) with manual-offset fallback; sweep session → 1° bin medians → gap
  interpolation → points; coverage metrics (% + widest gap).
- **9d** `ui/capture.js` — no-camera v1: sight along the phone's top edge
  (PS-Align style; the camera+crosshair preview from the roadmap layers on
  later). iOS `requestPermission()` on a tap / `deviceorientationabsolute` on
  Android; calibrate → sweep → coverage → apply to the active site. SW v9.
  Smoke drives the Android path with synthetic orientation events; the real
  compass/drift feel is NEEDS-HIS-HANDS on staging.

## Roadmap (deferred — post-v1, rough order)
- **Sensor-trace horizon capture** — THE differentiator (see the review: manual
  horizons already exist free; measuring is the moat). Live camera preview +
  crosshair; log (azimuth, altitude) from DeviceOrientation while sweeping the
  treeline; iOS `DeviceOrientationEvent.requestPermission()` on a tap. COMPASS
  TRUTH: `webkitCompassHeading` is **MAGNETIC** north (Android: use
  `deviceorientationabsolute`) — declination runs to ~±15° across the US, more
  than a full 10° bin, so **calibration against the Sun's computed azimuth is
  the PRIMARY flow** (one sighting corrects declination + local interference; a
  bright star works at night), bundled declination model as fallback. Settle
  horizon storage resolution first (sensor sweeps outresolve the 36-row grid).
  **Device-only — not headless-testable; a NEEDS-HIS-HANDS feature.**
- **Polar-alignment tools** (Noah's ask; the synergy showcase):
  - Compute the **NCP** (alt ≈ latitude, az = true north) and **Polaris' live
    reticle clock position** via astronomy-engine.
  - **Horizon-aware** — the novel part vs. Polar Scope Align / PS Align Pro (which
    already nail the reticle for free): use the site horizon mask to warn when the
    pole is **behind the north treeline** from this site.
  - **"Point to the pole" live aid** reusing the sensor-trace DeviceOrientation +
    compass-calibration stack. Framed for **S50 EQ mode** (aim the tripod tilt axis
    at the NCP for longer exposures).
- **Multi-instrument + custom sensor** (the instrument model is built in v1; this is
  the fuller UX on top): a preset library (S30, Dwarf II/3, Vespera, …) plus a
  **custom-scope editor** (enter focal length + sensor mm or px + pixel size → FOV)
  so anyone can plan for any telescope — *the px+µm editor shipped in v1.1; mm
  entry + a preset library remain*. A **framing overlay** draws the active FOV
  rectangle (+ mosaic grid) over the object thumbnail. Presets ship in
  `data/instruments.js`; customs persist in `horizon.instruments` and
  export/import with sites so they aren't trapped in one browser.
- **Weather overlay** — Open-Meteo cloud cover shaded behind the night graph on the
  same time axis, then 7Timer seeing/transparency. Cache per site/night.
- **Thumbnails** — hips2fits per object, on demand, Cache-API cached.
- **Map-pin terrain horizon** (Noah's "10° in 360°" scaling idea): drop pins on a
  **keyless** satellite map (Leaflet + free Esri imagery — NOT Google Maps, which
  needs an API key + billing) + a free elevation API to estimate a **terrain**
  horizon. Caveat to bake in: elevation data has **no trees**, so map-pins only
  model distant ridgelines; the physical sensor-trace stays the only accurate
  capture for a tree-ringed yard. Feeds the *same* 36-row model — clean to add.
- **Sky-segmentation capture (v2 stretch)** — daylight panned-video skyline
  threshold → alt/az. Hard parts: per-phone FOV calibration, compass drift.

## Instrument notes (bake in, don't rediscover)
- **Custom horizon is the whole point** — never silently fall back to 0° rise/set.
- **FOV is per-instrument, never a constant.** S50 (IMX462) ≈ 1.28° × 0.72°; the
  S30 uses the **IMX662** — a different chip with identical 1920×1080 @ 2.9 µm
  geometry — ≈ 2.13° × 1.20° (ZWO's published 2.46° diagonal confirms the
  computation); customs come from focal length + sensor size. Fit-vs-mosaic and
  any framing overlay read the **active** instrument's FOV.
- **Near-zenith dead-zone** is a per-mount trait (`mount.zenithDeadZone_deg`): an
  alt-az smart scope suffers fast field rotation / tracking trouble near the zenith
  (S50 ~≥85°). Effective visibility subtracts this high-altitude exclusion as well
  as the low treeline — a *second* horizon competitors don't model. EQ-capable
  scopes (S50 EQ mode) can relax it.
- **Mosaics changed "too big"**: don't drop oversized objects — compute how many
  panels they need for the active instrument and label the tier.

## Honest novelty map (alert if re-cloning)
| Feature | Exists free | Our novel angle |
|---|---|---|
| Catalog + type/mag filters | Telescopius, Stellarium | substrate for the horizon mask; bundled/offline |
| Alt-vs-time curves | Telescopius (respects its horizon) | offline; **dead-zone-aware**; per-site horizons |
| Rise/set table | Seestar app | **effective** "above my treeline" windows |
| Custom horizon profile | **Telescopius** (manual per-location, CSV import) | **sensor-MEASURED capture** (roadmap top item); offline; feeds every answer |
| Zenith dead-zone windows | *(nobody models it)* | the alt-az smart-scope "second horizon" |
| Weather/seeing | Astrospheric, Clear Outside | shaded on the *same* night-graph axis |
| Polar reticle | Polar Scope Align, PS Align Pro | **horizon-aware** ("can I see the pole?") + unified |

## Verification (owner culture: verify before claiming fixed)
- **Node headless unit tests** for `astro.js`, `horizon.js`, `visibility.js` (alt/az
  vs. known ephemeris; horizon sample-at-azimuth interpolation; window intersection
  incl. wrap-around midnight). Make each test **fail once** before trusting it.
- **Headless Chromium** (`npm i --no-save esbuild playwright-core`, browser at
  `/opt/pw-browsers/chromium`) for night-graph render, horizon-editor drag, filters,
  both themes — poll **synchronous DOM** (Playwright `waitForFunction` does NOT await
  Promise predicates; a Promise is truthy, so such a poll "passes" instantly).
- **NEEDS-HIS-HANDS (device-only, state plainly):** DeviceOrientation permission
  flow, compass accuracy/drift, camera preview + crosshair sweep, the polar-align
  "point to pole" aid, iPad pinch/scroll feel, PWA install + offline.
- Walk the full first-run journey (no sites yet) before any handoff; honest dead-end
  when no site/horizon exists.

## One-time setup (DONE — kept for the record)
1. Create empty GitHub repo `star-horizon-planner` + a Cloudflare Pages project of
   the same name.
2. Set repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (same as the
   other two apps).
3. Start a fresh Claude session with this repo in the source picker; commit this
   file as `NOTES.md`. Build in the order above; ship each step to `staging` for the
   on-device pass before merging to `main`.
