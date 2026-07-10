// Generates public/sitemap-tickers.xml from src/data/tickers.json — one URL per
// programmatic /explore/:ticker page, with ca/es/en hreflang alternates. Runs at
// the start of the build so the file is picked up into dist/. Referenced from
// robots.txt as a second sitemap (kept separate from the curated sitemap.xml so
// that one stays small and hand-editable).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = "https://www.trimmtrack.com";
const LANGS = [
  ["ca", ""],
  ["es", "?lng=es"],
  ["en", "?lng=en"],
];

const tickers = JSON.parse(
  readFileSync(path.join(root, "src/data/tickers.json"), "utf8"),
);

// Build date as <lastmod>: the pages carry live financials + accumulating EDGAR
// history that refresh with each weekly deploy, so a fresh lastmod on every
// build tells Google to recrawl the updated content.
const today = new Date().toISOString().slice(0, 10);

const urls = tickers
  .map(({ symbol }) => {
    const loc = `${BASE}/explore/${symbol.toLowerCase()}`;
    const alts = LANGS.map(
      ([l, q]) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${loc}${q}"/>`,
    ).join("\n");
    return `  <url>\n    <loc>${loc}</loc>\n${alts}\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

writeFileSync(path.join(root, "public/sitemap-tickers.xml"), xml, "utf8");
console.log(
  `[sitemap] wrote ${tickers.length} ticker URLs to public/sitemap-tickers.xml`,
);
