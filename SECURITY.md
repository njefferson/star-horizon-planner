# Security & privacy

Clear Horizons is a static, offline-first web app. It has **no backend, no
accounts, and no analytics** — everything (your sites, horizons, favourites,
custom instruments) is stored locally in your browser and never leaves your
device. The only network requests are for the app's own files and the IBM Plex
web fonts; the astronomy engine and catalog are bundled and run on-device.

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead,
report it privately via GitHub's
[private vulnerability reporting](https://github.com/njefferson/clear-horizons/security/advisories/new)
(Security → Report a vulnerability). I'll acknowledge within a few days.

Please include what you found, how to reproduce it, and the impact you expect.

## Scope

In scope: this repository's app code and its GitHub Actions workflows.
Out of scope: the bundled third-party components under their own licenses
(astronomy-engine, OpenNGC data, IBM Plex) — report those upstream.
