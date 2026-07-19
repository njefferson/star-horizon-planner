# Clear Horizons

*(formerly Star Horizon Planner — same app, new home. The old address,
star-horizon-planner.pages.dev, stays up during the transition and shows a
banner: export your backup there, import it here.)*

**Plan your night against your *real* horizon — the actual treeline, measured, not a flat 0°.**

An offline-first astronomy planner for smart telescopes (Seestar S50/S30 and any
custom scope). Every visibility answer is cut by a **custom, per-site,
physically-measured horizon** — the trees and rooftops that actually block your
sky — plus the near-zenith dead-zone an alt-az mount can't track through. No
accounts, no tracking, no network required after first load.

🔭 **Live app:** <https://clear-horizons.pages.dev>

[![CI](https://github.com/njefferson/clear-horizons/actions/workflows/ci.yml/badge.svg)](https://github.com/njefferson/clear-horizons/actions/workflows/ci.yml)
[![License: PolyForm NC 1.0.0](https://img.shields.io/badge/license-PolyForm--NC--1.0.0-blue)](./LICENSE.md)

| Tonight | Measure your horizon | Targets |
|---|---|---|
| ![Tonight — altitude curves cut by the measured horizon](./screenshots/tonight.png) | ![Measure the horizon by sweeping the treeline](./screenshots/measure.png) | ![Targets catalog with fits/mosaic tiers](./screenshots/targets.png) |

## Why this exists

Every individual piece exists free somewhere — catalogs and altitude curves,
weather, a polar reticle, even a hand-entered custom horizon (Telescopius). The
value here is **synergy, offline**, built around the one thing worth measuring:

- **"Above MY horizon" visibility** — a target counts as usable only where it
  clears *your* measured profile, not a textbook 0°.
- **The zenith dead-zone** — an alt-az smart scope can't track through the
  zenith, so effective windows subtract that *second* horizon too. No other
  planner models it.
- **Measuring, not typing** — sweep your treeline with the phone's sensors
  (Sun-calibrated for true north); the manual editor and Stellarium import are
  there too.

## Features

- **Tonight** — hand-rolled altitude-vs-time graph cut by your horizon, twilight
  bands, the Moon's path + phase, a drag-scrub readout, and a visibility table
  showing both geometric rise/set and the **effective** "you can actually shoot
  it" windows, with zenith-dead-zone and Moon-interference flags.
- **Targets** — the bundled OpenNGC catalog with type / magnitude / size filters,
  a fits-vs-mosaic tier computed for the **active instrument**, favourites, and
  an **"Up tonight"** filter that narrows to what actually clears your horizon
  during dark hours before you filter further.
- **Horizon** — a 36-point drag editor (also keyboard-editable) and **sensor
  capture**: point the camera along the treeline and sweep; Stellarium
  import/export.
- **Polar** — horizon-aware polar alignment: where to aim, the pole-star reticle
  clock, and whether the pole is even visible from your site.
- **Sites** — multiple named sites, each with its own coordinates and horizon;
  JSON backup/restore.
- **Settings** — pick the active instrument (S50 / S30 / your own custom scope
  from focal length + sensor); Night Mode.

Install it as a PWA (Add to Home Screen) and it works fully offline.

## Accessibility

Accessibility is a **top priority**, not an afterthought — see the standing order
in [`NOTES.md`](./NOTES.md). Specifically:

- **No information is carried by colour alone.** The night-graph series are
  distinguished by **marker shape** (and direct labels) as well as hue, and the
  categorical palette is **colour-blind-safe by construction** — validated
  computationally (CVD ΔE), never by eye.
- **WCAG 2.2 AA contrast**, enforced by `npm run test:contrast` **in CI** — a
  colour token that fails the ratio can't merge. Every view is scanned with
  axe-core (`npm run test:a11y`) across both themes with zero violations.
- **Keyboard + visible focus** for every interaction; the horizon editor's points
  are ARIA sliders. Async feedback announces via live regions.
- **Respects reduced-motion and zoom**; light + dark themes are both first-class.

Found an accessibility problem? It's treated as a bug — please
[open an issue](https://github.com/njefferson/clear-horizons/issues).

## Data & licensing

- **App code** — [PolyForm Noncommercial 1.0.0](./LICENSE.md). Free to use,
  study, and modify for any noncommercial purpose; **commercial use is not
  granted**.
- **Deep-sky catalog** — derived from [OpenNGC](https://github.com/mattiaverga/OpenNGC),
  CC-BY-SA-4.0 (attribution preserved in the data file).
- **Ephemerides** — [astronomy-engine](https://github.com/cosinekitty/astronomy),
  MIT, vendored under `src/vendor/` (runs on-device).
- **Type** — [IBM Plex](https://github.com/IBM/plex), SIL OFL 1.1.

## Development

No build step — vanilla ES modules, no framework, no bundler. Node 22+.

```bash
node --test              # headless unit tests (models: astro, horizon, visibility, …)
npm run test:contrast    # WCAG contrast gate (pure Node; runs in CI)
npm run test:ui          # headless-Chromium smoke journey  ┐ need playwright-core
npm run test:a11y        # axe-core scan, 7 views × 2 themes ┘ + container Chromium
```

`npm run test:ui` / `test:a11y` need `npm i --no-save playwright-core axe-core`
and use the container's Chromium (`/opt/pw-browsers/chromium`); they skip
cleanly when unavailable, so `node --test` + the contrast gate are the always-on
CI checks.

Regenerate committed assets when the art or UI changes:

```bash
node scripts/gen-assets.mjs        # icon-192/512.png + og-image.png (from icon.svg)
node scripts/gen-screenshots.mjs   # screenshots/*.png (seeded app, phone size)
node scripts/build-catalog.mjs     # rebuild src/data/catalog.json from OpenNGC (--force)
```

### Deploy & branches

Two branches only: **`staging`** and **`main`**. Work lands on `staging` → the
on-device pass → merge to `main`. Both auto-deploy to Cloudflare Pages
(`staging` → a preview URL, `main` → production); deploy publishes an
allow-listed `dist/` (assembled by `scripts/stage-dist.mjs`), so repo internals
never reach the live site. Cut a release by bumping `package.json`, promoting to
`main`, and dispatching the **Tag release** workflow.

<!-- Social / author links — fill in when ready:
Made by [Noah Jefferson](https://…). Photography: [@…](https://…).
-->

## Maintainer notes

GitHub repo metadata isn't in this repo — set it once in the repo settings:

- **Description:** "Offline-first astronomy planner built on your real, measured horizon."
- **Website:** https://clear-horizons.pages.dev
- **Topics:** `astronomy` `astrophotography` `seestar` `smart-telescope` `pwa` `offline-first` `stargazing`
- **Social preview:** upload `og-image.png` (Settings → Social preview).
