# CLAUDE.md — working agreements for this repo

Read `NOTES.md` first (product thesis, build order, accessibility standing
order, releases). This file records how Claude Code should *behave* here.

## Repository metadata is a manual step — call it out, confirm, don't assume

GitHub repo **description**, **website (homepage)**, **topics**, and the
**social-preview image** live on GitHub's servers, not in these files. There is
no API for the social image on any path (`gh` included), and repo settings can't
be edited from the tools available in a Claude Code session. So these are
**manual, web-UI steps the owner performs.**

Standing agreement (owner's instruction, 2026-07-17):

- Whenever this repo — or a new repo being set up — needs those fields set or
  changed (a new project, a rename, a changed tagline, a fresh social card),
  **explicitly list the exact steps and values and ask Noah to confirm each is
  done.** Keep asking until he confirms. **Never** report a repo as "set up",
  "published", or "release-complete" while any of these is unconfirmed —
  assumption is not confirmation.
- Treat it as part of the release ritual (alongside promote → Tag release), not
  an afterthought.

### This repo's canonical values (paste targets)

- **Description:** `Offline-first astronomy planner built on your real, measured horizon — not a flat 0°.`
- **Website:** `https://clear-horizons.pages.dev` (Tier 2 rename, 2026-07-19 —
  the repo is `njefferson/clear-horizons`; the old star-horizon-planner.pages.dev
  origin stays up transitionally with a migration banner)
- **Topics:** `astronomy` `astrophotography` `seestar` `smart-telescope` `pwa` `offline-first` `stargazing`
- **Social preview:** a **branded** card. Keep `og-image.png` committed
  (regenerate with `node scripts/gen-assets.mjs` when the art changes) and
  upload it once via **Settings → General → Social preview**. This upload is the
  one irreducible manual step — flag it every time it's missing or stale.

Where they go in the UI: the **About** gear on the repo's Code page
(description, website, topics); **Settings → Social preview** (image).

## Cross-repo

Noah runs several sibling apps (Bird-location-scouting, Jefferson-Photography-
Studio, …) that deliberately share conventions. This agreement should apply to
all of them: replicate this `CLAUDE.md` block into each repo (or a user-global
`~/.claude/CLAUDE.md`) so the "call it out and confirm" behaviour holds
everywhere, not just here.

## Branches, releases, verification

- **Only `staging` and `main` exist, ever** (see NOTES). Work → `staging` →
  on-device pass → merge to `main`; cut a release by bumping `package.json`,
  promoting, and dispatching the **Tag release** workflow.
- **Just iterate, and NUMBER every release — without asking** (owner, 2026-07-18:
  "I do want releases to have numbers, I just don't wanna have to keep saying it
  every time. I'll tell you when major releases happen."). So on each ship to
  `main`: bump `package.json` (**patch** for fixes, **minor** for features — never
  leave it stale), keep the SW cache comment in sync, and dispatch the **Tag
  release** workflow so the version gets a git tag + GitHub Release. Do NOT prompt
  about any of this. **Major versions are Noah's call** — he declares them; Claude
  *may recommend* one when warranted. Next major is already recorded: the **AR
  "arcs across the sky" view** is v2.0.0. (This does NOT relax the repo-metadata
  "call it out and confirm" rule above — that stays.)
- Before a release, the gates in NOTES' Verification section must pass:
  `node --test`, `npm run test:contrast` (CI), `npm run test:ui`,
  `npm run test:a11y` (zero axe violations). Accessibility is a top priority —
  colour is never the sole channel, and contrast is computed, not eyeballed.
