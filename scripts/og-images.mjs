// Per-page Open Graph cards, rendered at build time into dist/og/*.png.
//
// Every share of a TrimmTrack link used to show the same generic og.png, so a
// shared /explore/nvda looked identical to a shared /forecast. These give each
// programmatic page its own card with the company (or matchup) named on it.
//
// Rendered with the SAME headless browser the prerender already launches — no
// rasteriser dependency (@resvg and friends), no second Chromium download, and
// it works in Vercel's build image for free because that wiring already exists.
//
// The page is loaded ONCE and then mutated per card: a setContent() per card
// re-requests the webfont every time and, at ~116 cards, wedges the run (one
// card in six minutes, measured). Loading once also guarantees every card gets
// the same font rather than whichever one happened to have arrived.
//
// Deliberately no live figures: a price baked into a card that social platforms
// cache for weeks would be stale the day after the deploy. The company name and
// branding are what the reader needs, and they don't rot.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const W = 1200;
const H = 630;

// Warm brand palette, matching the landing (see the tailwind brand ramp).
const INK = "#14100d";
const CREAM = "#f3ead9";
const ORANGE = "#e76b1c";
const MUTED = "#b3a793";

const TEMPLATE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${W}px; height: ${H}px;
    background: radial-gradient(120% 120% at 15% 0%, #4a3320 0%, ${INK} 60%);
    color: ${CREAM};
    font-family: Fredoka, ui-rounded, system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 64px 72px;
    overflow: hidden;
  }
  .glow {
    position: absolute; right: -160px; top: -160px;
    width: 620px; height: 620px; border-radius: 50%;
    background: radial-gradient(circle, rgba(231,107,28,.28) 0%, rgba(231,107,28,0) 70%);
  }
  .chip {
    display: inline-block; align-self: flex-start;
    border: 2px solid rgba(243,234,217,.28); border-radius: 999px;
    padding: 8px 22px; font-size: 26px; font-weight: 600;
    letter-spacing: .08em; color: ${CREAM};
  }
  h1 { font-weight: 700; line-height: 1.06; margin-top: 26px; }
  .sub { margin-top: 22px; font-size: 30px; font-weight: 500; color: ${MUTED}; }
  footer { display: flex; align-items: center; justify-content: space-between; }
  .brand { font-size: 34px; font-weight: 700; }
  .brand em { font-style: normal; color: ${ORANGE}; }
  .bars { display: flex; align-items: flex-end; gap: 9px; height: 64px; }
  .bars i { width: 22px; border-radius: 3px; background: ${ORANGE}; opacity: .85; }
</style></head><body>
  <div class="glow"></div>
  <div>
    <span class="chip" id="chip"></span>
    <h1 id="title"></h1>
    <p class="sub" id="sub"></p>
  </div>
  <footer>
    <span class="brand">Trimm<em>Track</em></span>
    <span class="bars">
      <i style="height:28%"></i><i style="height:46%"></i><i style="height:38%"></i>
      <i style="height:66%"></i><i style="height:54%"></i><i style="height:86%"></i>
      <i style="height:100%"></i>
    </span>
  </footer>
</body></html>`;

// Long company names have to stay on the card: shrink the type rather than let
// "Berkshire Hathaway vs JPMorgan Chase" run off the edge.
function titleSize(text) {
  const n = text.length;
  if (n <= 18) return 96;
  if (n <= 28) return 78;
  if (n <= 40) return 62;
  return 50;
}

/**
 * Render one card per spec into dist/og/<name>.png, reusing `browser`.
 * Best-effort by design: the caller treats a throw as "keep the generic og.png".
 */
export async function generateOgImages(browser, dist, specs) {
  const outDir = path.join(dist, "og");
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  let ok = 0;
  try {
    await page.setContent(TEMPLATE, { waitUntil: "load", timeout: 20000 });
    // If the webfont never arrives (offline build image), the stack falls back
    // to a rounded system font and the cards still render — just less on-brand.
    await page
      .evaluate(() => document.fonts.ready.then(() => undefined))
      .catch(() => {});

    for (const spec of specs) {
      try {
        await page.evaluate(
          (s, size) => {
            document.getElementById("chip").textContent = s.chip;
            const h1 = document.getElementById("title");
            h1.textContent = s.title;
            h1.style.fontSize = `${size}px`;
            document.getElementById("sub").textContent = s.subtitle;
          },
          spec,
          titleSize(spec.title),
        );
        const buf = await page.screenshot({ type: "png" });
        await writeFile(path.join(outDir, `${spec.name}.png`), buf);
        ok++;
      } catch (err) {
        console.warn(`[og] ! ${spec.name}: ${err?.message || err}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  console.log(`[og] ${ok}/${specs.length} cards → dist/og/`);
  return ok;
}
