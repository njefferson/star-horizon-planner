# S50 Horizon Planner — NOTES (source of truth)

Read this before doing anything. It carries the product thesis, the build order,
the reuse map from Noah's existing repos, settled decisions, and the roadmap.
Structure mirrors the two sibling apps (Bird-location-scouting, Jefferson-
Photography-Studio): free, on-device, offline-first PWA on Cloudflare Pages.

## ⭐ NEXT SESSION — AR "arcs across the sky" view (START HERE)
Noah is building this next: an augmented-reality / planetarium view that shows
where each target sits in the sky and its ARC over the night, with an hour
scrubber to step through the night and watch it move. This is "the last missing
piece" the flat time-vs-altitude graph on Tonight can't show. **This is the next
MAJOR version — v2.0.0** (bump package.json accordingly when it lands).

**Everything needed already exists — this is assembly, not new physics:**
- `model/arproject.js` — world (az/alt) → screen projection AND the inverses,
  built for the live-camera overlay. Point the phone at the sky, project each
  target onto the camera image at its current (or scrubbed-hour) az/alt.
- `model/astro.js altitudeCurve(target, observer, start, end, step)` — gives a
  target's (time → alt, az) path over the night; that IS the arc. `altAz()` for
  a single instant (the scrubbed hour).
- `model/geomag.js declination()` — correct the phone heading to true north
  (see the COMPASS note below — same magnetic-vs-true question applies here).
- `ui/livecapture.js` — the working getUserMedia + orientation + canvas-overlay
  harness to fork from (camera stream, iOS motion-permission tap, reticle,
  draw loop). `ui/nightgraph.js` — the scrub/hour-cursor pattern + the twilight
  bands + horizon-cut visibility logic to reuse for the hour selector.
- Cut each arc by the measured horizon exactly as Tonight does (only draw where
  `isAbove(profile, az, alt)`), so AR and graph agree.
Likely new route `#/sky` (or a mode inside live capture). Device-only feel is
NEEDS-HIS-HANDS; keep a no-AR fallback (a flat az/alt sky chart) for desktop.

## COMPASS: magnetic vs true, and can we detect the phone? (settled 2026-07-18)
Q (Noah): can't we detect the phone model and know whether its compass is
already true-north? **Short answer: no — and the model wouldn't help.**
- iOS hides the specific model: every iPhone reports a generic "iPhone" UA
  (Apple policy). Android UA/Client-Hints CAN give a model string, but it's
  being frozen/reduced and gated behind high-entropy hints.
- More important: magnetic-vs-true is a property of the **browser API**, not the
  hardware. Knowing "iPhone 15" tells you nothing about what the API returns.
- What we CAN reliably detect: the PLATFORM (iOS vs Android) from the UA, and
  which orientation event fired (`deviceorientationabsolute` vs iOS
  `webkitCompassHeading`).
- Known API behaviour: **Android `deviceorientationabsolute` α = MAGNETIC
  north** (geomagnetic rotation sensor) → applying WMM declination is CORRECT.
  **iOS `webkitCompassHeading` is AMBIGUOUS** across iOS versions — some builds
  already return a true-north-corrected heading (CoreLocation applies
  declination), which would mean we double-correct by one declination on iOS.
- RESOLUTION (a NEEDS-HIS-HANDS test, do on a real iPhone): stand on a known
  true bearing (e.g. a surveyed street grid or a distant landmark whose true
  azimuth you compute), read `webkitCompassHeading`, and see whether it already
  matches TRUE (skip declination on iOS) or MAGNETIC (keep it). Until then we
  apply declination on all platforms and expose a manual override. If iOS turns
  out to be pre-corrected, branch on `source === 'ios'` in capture to skip it.

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

## Accessibility — owner's standing order (TOP PRIORITY)
Accessibility outranks features. These are FAIL STATES, not style preferences:
- **Meaning carried by color alone.** Color-blind-inconsiderate design fails
  review, full stop. Every encoding pairs color with a second channel — shape,
  text, pattern, weight, position. Any categorical palette (chart series,
  status sets) must PASS a CVD validation run — **computed, never eyeballed** —
  before it ships, with the validator output quoted in the commit message.
- **Contrast below WCAG 2.2 AA** (4.5:1 text, 3:1 non-text/UI). Enforced by
  `node scripts/check-contrast.mjs` in CI; a token change that fails does not
  merge. New color pairs get added to that script's pair list, not waved past.
- **A pointer-only interaction.** Every interaction has a keyboard path and a
  visible focus indicator — including the night-graph scrub (a focusable
  slider: arrows / PageUp-Dn / Home-End) and the horizon points (ARIA sliders).
- **Focus thrown or lost on a repaint.** An in-view state change (toggling a
  chip, stepping the date) must NOT move focus to the heading or `<body>`;
  `nav.rerender()` restores focus to the triggering control by accessible name.
  Focus only moves to the `<h1>` on an actual view navigation.
- **Silent async feedback.** Toasts and discrete readouts announce via
  aria-live/role=status. Continuous 60 Hz streams stay silent BY DESIGN —
  announcing them is its own accessibility failure; give them a textual
  summary instead.
- **Disabled zoom, ignored motion preferences, invisible focus under
  forced-colors.** The viewport stays zoomable; `prefers-reduced-motion` is
  honored; focus rings and selected-state cues survive Windows High Contrast /
  `forced-colors` (never box-shadow/colour alone — a `@media (forced-colors:
  active)` block restores outlines).
Design gate: **every build-order step in this file names its accessibility
consideration before code is written**, and the Verification gates below run
per step. Screen-reader spot checks (VoiceOver on the iPad) join the
NEEDS-HIS-HANDS device pass.

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
  Y-axis is invariant under γ); **magnetic→true correction by WMM declination**
  (see `model/geomag.js`) applied automatically from the site's coordinates,
  with a manual-offset override for strong local iron; sweep session → 1° bin
  medians → gap interpolation → points; coverage metrics (% + widest gap).
  NOTE: the old "sight the Sun (through a filter)" calibration is REMOVED — the
  filter warning was a UX smell and declination is a known, published quantity.
- **9d** `ui/capture.js` — no-camera v1: sight along the phone's top edge
  (PS-Align style; the camera+crosshair preview from the roadmap layers on
  later). iOS `requestPermission()` on a tap / `deviceorientationabsolute` on
  Android; calibrate → sweep → coverage → apply to the active site. SW v9.
  Smoke drives the Android path with synthetic orientation events; the real
  compass/drift feel is NEEDS-HIS-HANDS on staging.

## Capture re-envision — live-camera AR (Noah's vision, 2026-07-17 device pass)
The v1.2 sensor capture works but the aiming model was wrong: it sighted along
the phone's TOP EDGE, so the horizon read 90° and obstructions ABOVE eye level
(the common case — a tree taller than you) couldn't be entered. Fixed in
v1.1.0 to the **camera-pointing** model (altitude = β − 90; point the back
camera at the target, upright = 0° = horizon, tilt up for tall obstructions,
down for a downhill treeline). That is the bridge to Noah's real vision, the
next capture iteration:
- **Live camera preview** (`getUserMedia`, back camera) fills the screen; you
  spin in place and drag a **reticle** along the skyline.
- **AR overlay**: the horizon bar-graph draws OVER the camera image in real
  time as you set each azimuth — you see the profile take shape on the sky.
- **Auto-trace (stretch)**: sky-vs-not-sky segmentation logs the skyline as you
  turn — no manual reticle.
- **Perfect (stretch)**: capture a stitched **horizon panorama image** exported
  alongside the az/alt data, importable into other tools (Stellarium landscape,
  etc.).
Keep the current sensor path as the no-camera fallback. Device-only,
NEEDS-HIS-HANDS. Accessibility note (standing order): the reticle needs a
keyboard/manual-entry equivalent, and the AR bar-graph carries a text/numeric
readout — the camera overlay is never the sole channel.

**Camera is the ONE way in (device pass, 2026-07-17).** "Measure…" (Horizon
editor) now opens the live camera directly; the no-camera sensor sweep and the
manual editor are explicitly the *backups*, reached from inside it. The sweep
**auto-stops at a full circle** — you don't hunt for Stop and a second lap can't
pile on; then you nudge/Mark to fix spots or Save. Sensors must actually switch
OFF (a button, and automatically on leaving the view) so they can't keep running
or hold the motion sensors away from the camera.

## First run — open into the sky, not a wall (device pass, 2026-07-17)
The old flow was backwards: Tonight → "add a site" → a lat/long form → back to
Tonight → "no targets" → Targets. A newcomer hit three walls before seeing a
single star. Fixed to Noah's ordering — **location → sky → (horizon refines) →
tools:**
- A default **"Here"** site is seeded at boot (centre-US placeholder, marked
  `approx`) so there is always an active site and the app opens straight onto
  the night graph. Real users with sites are untouched (seed is a no-op).
- Tonight shows a one-tap **"Use my location"** (geolocation → updates the site
  in place, clears `approx`) right in the header — no trip into Sites, no typing
  coordinates. Sites still has the manual lat/long + geolocation for named spots.
- With nothing favourited yet, Tonight previews **tonight's brightest showpieces
  above the horizon** (via `visibleTonight`) instead of a dead-end, with a link
  to pick your own. Horizon is applied but forgiving; refining it sharpens the
  same view. Everything downstream (favourites, capture, polar) layers on top.

**Build order — STARTED (first increment built, awaiting the on-device pass):**
- **L1** `model/arproject.js` (100% headless): the world↔image-plane projection
  under the overlay. Linear (equirectangular) map — accurate enough for a
  skyline guide over a phone's modest FOV and, unlike gnomonic, trivially
  invertible (the reticle needs the inverse). `projectPoint`, the
  `azimuthAtScreenX`/`altitudeAtScreenY` inverses, `horizonPolyline`. FOV is a
  per-device calibration knob (`DEFAULT_FOV`), never baked into a recorded
  number — the samples still come straight from the sensors, so a wrong FOV
  only skews the GUIDE. Tests: centre identity, sign conventions, exact
  round-trip inversion, frame culling, polyline trace. **BUILT.**
- **L2** `ui/livecapture.js` — `#/capture/live`, entered from a 📷 chip on the
  sensor Measure view. `getUserMedia({facingMode:'environment'})` fills a
  viewfinder; a canvas overlay draws the stored horizon (thin) + the live sweep
  (bold, accent) + a centre reticle every frame, projected via L1 off the same
  orientation pipeline as `ui/capture.js` (identical Sun-calibration + median-
  binned session). Record a continuous sweep OR nudge the reticle up to a
  treetop and **Mark** a point (the keyboard path: ↑/↓ aim, Enter mark). Every
  camera failure (denied / absent / insecure origin) degrades to a clear
  message + links to no-camera mode and the editor. The 60 Hz az/alt readout is
  text (silent by design); discrete actions announce via role=status. SW v12.
  Smoke drives it with a mocked canvas stream + synthetic orientation; axe scans
  the fallback state (8th view). **BUILT.**
- **Still ahead:** drag-the-reticle-by-touch along the skyline (today: centre +
  vertical nudge/Mark); real per-device FOV calibration; auto-trace (sky
  segmentation) and the panorama export (both still stretch). The camera framing,
  FOV accuracy and spin-and-trace feel are the NEEDS-HIS-HANDS half.

## Roadmap (deferred — post-v1, rough order)
- **"Visible from this site tonight" filter** (Targets) — SHIPPED v1.1.0 as a
  first-class filter: the catalog first narrows to what actually clears the
  measured horizon during dark hours at the active site, THEN the type/mag/
  size/fit chips narrow further. This is the app's thesis applied to discovery.
- **Sensor-trace horizon capture** — THE differentiator (see the review: manual
  horizons already exist free; measuring is the moat). Live camera preview +
  crosshair; log (azimuth, altitude) from DeviceOrientation while sweeping the
  treeline; iOS `DeviceOrientationEvent.requestPermission()` on a tap. COMPASS
  TRUTH: `webkitCompassHeading` is **MAGNETIC** north (Android: use
  `deviceorientationabsolute`) — declination runs to ~±15° across the US, more
  than a full 10° bin, so the heading is **corrected to true north by the
  bundled WMM declination model** (`model/geomag.js`), computed from the site's
  coordinates, with a manual-offset override. (Superseded the earlier Sun-sight
  calibration — removed 2026-07-18; filter warning was a UX smell.) Settle
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
- **Weather overlay (Astroweather)** — Noah wants it UNDER the night graph,
  aligned to the same hour axis: Open-Meteo hourly cloud cover (total/low/mid/
  high) shaded per hour beneath the curves, then 7Timer seeing/transparency.
  Cache per site/night. Keyless + CORS-friendly. (Device ask, 2026-07-18.)
- **AR sky view with an hour scrubber (Noah: "the last missing piece")** — the
  time-vs-altitude graph can't show an object's ARC across the sky (its az/alt
  path). Wanted: an augmented-reality / planetarium view that shows where each
  target sits in the sky, with a slider to step through each hour of the night
  and watch it move. Reuse: model/arproject.js (world az/alt → screen) already
  does the projection maths; altAz over the night gives the path; the night
  graph's scrub pattern is the hour selector. Big feature — its own pass.
- **Thumbnails + object details** — STARTED (first cut, `staging`): `model/
  thumbnails.js` builds a CDS hips2fits DSS2-colour cutout URL per object (RA
  hours→deg, FOV framed to the object). A small preview image sits on each
  Targets line and is the tap target for a new **details page**
  (`#/target/<id>`, `ui/targetdetail.js`): larger representative image + facts
  (type/mag/size/RA/Dec) + active-instrument framing + favourite toggle. Plain
  `<img>` (no CORS needed to display); degrades to a labelled placeholder
  offline — never a broken glyph. Cache-API precache-per-object still to come.
  Placement + details layout are being tuned to Noah's screenshots (the Seestar
  look = DSS2 colour). SW v14.
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
- **Accessibility gates (standing order, see above):** `node
  scripts/check-contrast.mjs` (pure Node, runs in CI) must pass; `npm run
  test:a11y` (axe-core over every view × both themes, headless Chromium) must
  report ZERO violations before a release ships; any new categorical palette
  is CVD-validated with the output quoted in the commit. Color decisions are
  computed, never eyeballed.
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

## Releases
- **v2.0.2 — 2026-07-18** (SW cache `horizon-v26`). **New brand art.** AI-generated
  from the brand brief and approved by Noah: glowing gold star over a conifer
  treeline. High-res masters committed under `art/` (never deployed);
  `scripts/gen-assets.mjs` now derives every shipped raster from them
  (icon-512/192, apple-touch-icon 180, og-image 1200×630 with the wordmark +
  tagline baked in), and `icon.svg` (favicon + manifest SVG) was rebuilt by hand
  as a vector rendition of the same scene. Reminder: the GitHub social-preview
  image is a manual upload (Settings → Social preview).
- **v2.0.1 — 2026-07-18** (SW cache `horizon-v25`). **AR pointing fix** from the
  device pass: on iOS the sky flipped ~180° in azimuth once the phone pitched
  past ~45°, because azimuth came straight from `webkitCompassHeading` (only
  trustworthy near level). New `model/capture.js backCameraAzAlt(α,β,γ)` derives
  the camera axis from the full W3C orientation matrix — azimuth is invariant
  under pitch — and iOS uses the compass ONLY as a near-level north anchor
  (|alt| ≤ 35°), held through steep tilts. No-flip regression in unit + smoke.
  118 unit, 50 contrast, 20 smoke, 0 axe (30 scans).
- **v2.0.0 — 2026-07-18** (SW cache `horizon-v24`; v23 was the staging interim).
  **The declared major: AR "arcs across the sky"** (`ui/sky.js`,
  `model/skyview.js`, shared `ui/marks.js`) — point the phone at the sky and
  every favourite + the Moon (with live phase glyph) sits at its position with
  its whole-night arc drawn over the camera, cut by the measured horizon exactly
  as Tonight cuts curves (`aboveHorizonSegments` over `isAbove`); hour scrubber
  (native range, keyboard path); aria-live text list mirrors the overlay; flat
  az/alt chart fallback for desktop/no-camera (what the headless gates render).
  New `astro.js moonCurve()`. Device-pass polish folded in: full-width "View in
  sky" hero CTA on Tonight, on-camera "Turn on compass" overlay cue, notices
  moved above the viewfinder. Reached from Tonight (no 7th tab). 114 unit,
  50 contrast, 20 smoke, 0 axe (30 scans).
- **v1.2.0 — 2026-07-18** (SW cache `horizon-v22`). The second on-device pass —
  a wave of features + fixes iterated live from Noah's phone. **Live-camera AR
  capture** (`ui/livecapture.js` + `model/arproject.js`): back-camera viewfinder,
  the measured horizon drawn over the sky, sweep auto-stops by widest-gap, iOS
  motion-permission tap, trace silhouette + granularity dots. **Sky-first first
  run**: seeded placeholder site so Tonight opens onto the graph; a welcome that
  asks for location; one-tap geolocation AND **city/state/ZIP search**
  (`model/geocode.js`, Open-Meteo). **Target thumbnails + details page**
  (`model/thumbnails.js` hips2fits, `ui/targetdetail.js`): per-row preview → a
  Seestar-style page with a big image, Wikipedia description (`model/describe.js`),
  a tonight altitude curve, and coordinates. **Night graph**: deep-blue twilight
  ramp (no black); curves drawn ONLY where clear of the horizon (behind-horizon
  arcs hidden). **Horizon editor**: records/shows below 0° with an adaptive
  floor. **Compass**: magnetic→true correction by the bundled **WMM2025** model
  (`model/geomag.js`, verified against NOAA test values) — the Sun-sight "special
  filter" calibration is gone. 108 unit, 48 contrast, 19 smoke, 0 axe (28 scans).
- **v1.1.1 — 2026-07-17** (SW cache `horizon-v11`). Accessibility round 2, from
  an independent fresh-eyes audit of v1.1.0 (things axe/contrast structurally
  can't see). Fixes: focus no longer thrown to the heading on in-view repaints
  (WCAG 3.2.2 — restore focus to the triggering control); the night-graph scrub
  is a keyboard slider with an aria-live readout (WCAG 2.1.1); a
  `@media (forced-colors)` block restores focus rings + selected-state cues
  (WCAG 2.4.7); emoji-prefixed buttons get clean aria-labels; horizon points are
  full ARIA sliders (Left/Right/Home/End/PageUp-Dn); the visibility table shows
  transit time + all up-intervals; chip groups get role=group. Prevention: the
  axe gate now opens + scans all five dialogs (caught the graph-slider
  aria-valuenow + About-link contrast, both fixed). Repo: SECURITY.md, issue
  templates, package.json engines, manifest id. 46 contrast pairs, 0 axe across
  24 scans, 83 unit, 16 smoke.
- **v1.1.0 — 2026-07-17** (SW cache `horizon-v10`). Accessibility as a standing
  order + repo presentation, plus the fixes from the first on-device pass.
  **Device-pass bugs:** visibility-window consolidation (jagged real horizons no
  longer spray 2–6 min "windows"); status-bar safe-area padding; horizontal-
  overflow fix; capture aiming corrected to the **camera-pointing** model
  (point the back camera at the treeline; up for tall obstructions); short
  display names. **New:** Targets **"Up tonight"** filter (what clears your
  horizon during dark hours, then filter down). **Accessibility:** night-graph
  palette replaced with a CVD-validated set + per-series **marker shapes** and
  peak labels (identity never colour-alone); `scripts/check-contrast.mjs`
  (WCAG AA, in CI) and `scripts/a11y-scan.mjs` (axe, 7 views × 2 themes, zero
  violations); ARIA state/roles/live-regions, focus management, reduced-motion.
  **Repo:** README, LICENSE (PolyForm-NC-1.0.0), package.json metadata, OG/
  Twitter cards + `og-image.png`, manifest 192/512 maskable icons + screenshots,
  and a deploy allow-list (`dist/`) so internals stop reaching production.
  *Cache-name note:* app version and SW cache diverged early (v9 was labelled
  "v1.2"); from here the Releases entry maps the two — app 1.1.0 = cache v10.
- **v1.0.0 — 2026-07-17** (tag `v1.0.0`, SW cache `horizon-v9`). The first
  version shipment: the full initial capability set. Offline-first PWA with
  bundled OpenNGC catalog + per-instrument FOV/mosaic answers (S50 default,
  S30, custom scopes); multi-site manager with backups; measured horizon —
  36-handle editor, Stellarium I/O, **and sensor-trace capture with
  Sun-azimuth compass calibration** (arbitrary-resolution profiles, model v2);
  night graph cut by the measured horizon with twilight bands + Moon path;
  visibility table with geometric vs effective windows, zenith dead-zone and
  Moon-interference flags; horizon-aware Polar Align. Verified: 76 headless
  unit tests + 13-step Chromium smoke journey. Outstanding at ship time: the
  on-device sensor pass (compass accuracy/drift, sighting feel) — capture is
  verified synthetically only.

## One-time setup (DONE — kept for the record)
1. Create empty GitHub repo `star-horizon-planner` + a Cloudflare Pages project of
   the same name.
2. Set repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (same as the
   other two apps).
3. Start a fresh Claude session with this repo in the source picker; commit this
   file as `NOTES.md`. Build in the order above; ship each step to `staging` for the
   on-device pass before merging to `main`.
