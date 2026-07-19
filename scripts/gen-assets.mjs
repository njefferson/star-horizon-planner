#!/usr/bin/env node
// =============================================================================
// gen-assets.mjs — one-shot generator for the committed image assets that a
// no-build static site can't produce at request time. Since v2.0.2 the brand
// art lives as high-res raster MASTERS in art/ (AI-generated from the brand
// brief, approved by Noah): art/icon-master.png (square) and art/og-master.png
// (~1.9:1). This script derives every shipped raster from those masters with a
// Chromium canvas (high-quality downscale / cover-fit):
//
//   icon-512.png, icon-192.png   — PWA icons (any + maskable)
//   apple-touch-icon.png (180)   — iOS home screen
//   og-image.png (1200×630)      — social link-preview card
//
// icon.svg is maintained BY HAND as a vector rendition of the same art (it's
// the favicon + manifest SVG icon) — this script does not touch it. The art/
// masters are never deployed (stage-dist's allow-list excludes art/).
// Re-run only when the masters change; the outputs are committed.
//
// og-image.png is a COMPOSITE: og-master.png is now a text-free star-trail
// photograph (approved 2026-07-19), and the wordmark + tagline are laid over
// it here in code (so a copy change or a new photo is a one-line/one-file edit,
// never a re-baked wordmark). It reads the IBM Plex faces from the same web
// font the app uses.
//
//   node scripts/gen-assets.mjs        (needs playwright-core + container Chromium)
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('need: npm i --no-save playwright-core'); process.exit(1); }

const b64 = (p) => `data:image/png;base64,${readFileSync(join(ROOT, p)).toString('base64')}`;
const ICON_MASTER = b64('art/icon-master.png');
const OG_MASTER = b64('art/og-master.png');

const browser = await chromium.launch({ executablePath: CHROMIUM });

// Draw a master into an exactly-sized canvas, cover-fit (centre-crop any aspect
// mismatch), and screenshot it. imageSmoothingQuality:'high' gives a clean
// multi-step-free downscale at these ratios.
async function derive(masterDataUrl, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <canvas id="c" width="${w}" height="${h}"></canvas>
    <script>
      const img = new Image();
      img.onload = () => {
        const ctx = document.getElementById('c').getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        const scale = Math.max(${w} / img.width, ${h} / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (${w} - dw) / 2, (${h} - dh) / 2, dw, dh);
        document.title = 'done';
      };
      img.src = ${JSON.stringify(masterDataUrl)};
    </script>
  </body></html>`);
  await page.waitForFunction(() => document.title === 'done');
  await page.screenshot({ path: join(ROOT, out), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log('wrote', out, `${w}x${h}`);
}

await derive(ICON_MASTER, 512, 512, 'icon-512.png');
await derive(ICON_MASTER, 192, 192, 'icon-192.png');
await derive(ICON_MASTER, 180, 180, 'apple-touch-icon.png');

// og-image.png — the star-trail photo cover-fit to 1200×630 with the wordmark
// laid into the open lower-left over a soft scrim (a corner + bottom gradient
// so the type reads cleanly on the quiet dark sky there).
async function deriveOgCard(masterDataUrl, out) {
  const W = 1200, H = 630;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400&display=swap">
    <style>
      * { margin:0; box-sizing:border-box; }
      body { width:${W}px; height:${H}px; position:relative; overflow:hidden; }
      canvas { position:absolute; inset:0; }
      .scrim { position:absolute; inset:0;
        background: linear-gradient(105deg, rgba(9,8,26,.86) 0%, rgba(9,8,26,.6) 34%, rgba(9,8,26,.12) 55%, rgba(9,8,26,0) 70%),
                    linear-gradient(0deg, rgba(9,8,26,.7) 0%, rgba(9,8,26,.18) 22%, rgba(9,8,26,0) 40%); }
      .text { position:absolute; left:64px; bottom:52px; width:760px; }
      h1 { font-family:'IBM Plex Serif',serif; font-weight:600; font-size:82px; letter-spacing:.5px; color:#f4f2fb; text-shadow:0 2px 20px rgba(0,0,0,.55); }
      .tag { font-family:'IBM Plex Sans',sans-serif; font-weight:400; font-size:32px; line-height:1.3; color:#e4e1f2; margin-top:18px; text-shadow:0 1px 12px rgba(0,0,0,.6); }
      .tag b { font-weight:500; color:#f5b52e; }
      .chips { font-family:'IBM Plex Mono',monospace; font-size:23px; color:#c9c5e0; margin-top:22px; text-shadow:0 1px 10px rgba(0,0,0,.6); }
    </style></head><body>
    <canvas id="c" width="${W}" height="${H}"></canvas>
    <div class="scrim"></div>
    <div class="text">
      <h1>Clear Horizons</h1>
      <div class="tag">Plan your night against your <b>real</b> horizon&nbsp;&mdash;<br>the actual treeline, measured, not a flat&nbsp;0&deg;.</div>
      <div class="chips">offline &middot; instrument-agnostic &middot; free</div>
    </div>
    <script>
      const img = new Image();
      img.onload = async () => {
        const ctx = document.getElementById('c').getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        const scale = Math.max(${W}/img.width, ${H}/img.height);
        const dw = img.width*scale, dh = img.height*scale;
        ctx.drawImage(img, (${W}-dw)/2, (${H}-dh)/2, dw, dh);
        try { await document.fonts.ready; } catch {}
        await new Promise(r => setTimeout(r, 400));
        document.title = 'done';
      };
      img.src = ${JSON.stringify(masterDataUrl)};
    </script>
  </body></html>`);
  await page.waitForFunction(() => document.title === 'done', { timeout: 30000 });
  await page.screenshot({ path: join(ROOT, out), clip: { x: 0, y: 0, width: W, height: H } });
  await page.close();
  console.log('wrote', out, `${W}x${H}`);
}
await deriveOgCard(OG_MASTER, 'og-image.png');
await browser.close();
