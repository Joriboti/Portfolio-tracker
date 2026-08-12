// Generates public/sitemap-tickers.xml — the programmatic pages: one
// /explore/:ticker per src/data/tickers.json entry and one
// /explore/compare/:pair per src/data/compare-pairs.json entry, EACH IN EVERY
// LANGUAGE as its own <url>.
//
// It used to emit one <url> per base page whose <loc> was the Catalan URL, with
// the /es and /en variants mentioned only as xhtml:link alternates. Google reads
// <loc> as "the URL I am submitting" and an alternate as a hint about a page it
// must discover some other way, so the 232 localized variants were never
// submitted — and, because the prerenderer skipped them too, they answered with
// the Catalan shell when Google did reach them. Both halves are fixed: the URL
// inventory now comes from scripts/routes.mjs, which the prerenderer reads as
// well.
//
// Runs at the start of the build so the file lands in dist/. Referenced from
// robots.txt as a second sitemap, kept separate from the curated sitemap.xml so
// that one stays small and reviewable.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAIR_DATA, TICKER_DATA, programmaticUrls } from "./routes.mjs";
import { renderSitemap } from "./sitemap-xml.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Build date as <lastmod>: these pages carry live financials plus accumulating
// EDGAR history that genuinely change with each weekly deploy, so a fresh
// lastmod is a truthful recrawl signal here (unlike the static copy pages).
const today = new Date().toISOString().slice(0, 10);

const urls = programmaticUrls({ lastmod: today });
writeFileSync(
  path.join(root, "public/sitemap-tickers.xml"),
  renderSitemap(urls),
  "utf8",
);

const base = TICKER_DATA.length + PAIR_DATA.length;
console.log(
  `[sitemap] wrote ${urls.length} URLs to public/sitemap-tickers.xml ` +
    `(${TICKER_DATA.length} tickers + ${PAIR_DATA.length} comparisons = ${base} pages × 3 languages)`,
);
