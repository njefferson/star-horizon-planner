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
await derive(OG_MASTER, 1200, 630, 'og-image.png');
await browser.close();
