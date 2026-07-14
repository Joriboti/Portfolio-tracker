// Copies the freshly built dist/index.html — the clean, empty SPA shell — to
// dist/app.html, which vercel.json rewrites every non-prerendered route to.
//
// Why this is its own build step and not part of prerender.mjs: that script is
// deliberately non-fatal (it swallows any failure and exits 0 so a missing
// Chromium can't break the deploy), and it overwrites dist/index.html with the
// prerendered homepage. If the shell copy lived there and prerendering bailed,
// dist/app.html would be missing and the rewrite would 404 the entire site.
// Running here — right after vite build, before prerender — keeps the fallback
// guaranteed: the only way to reach this step is a successful build.

import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");
const src = path.join(DIST, "index.html");
const dest = path.join(DIST, "app.html");

if (!existsSync(src)) {
  console.error("[shell] dist/index.html not found — run vite build first");
  process.exit(1);
}

copyFileSync(src, dest);
console.log("[shell] dist/index.html → dist/app.html (SPA fallback)");
