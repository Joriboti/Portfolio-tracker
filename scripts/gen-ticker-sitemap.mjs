// Generates public/sitemap-tickers.xml — every programmatic page, with ca/es/en
// hreflang alternates: one /explore/:ticker per src/data/tickers.json entry, plus
// one /explore/compare/:pair per src/data/compare-pairs.json entry. Runs at the
// start of the build so the file is picked up into dist/. Referenced from
// robots.txt as a second sitemap (kept separate from the curated sitemap.xml so
// that one stays small and hand-editable).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = "https://www.trimmtrack.com";
// Path-based locale prefixes (were ?lng= querystrings). Catalan is the bare
// path; x-default points at English (the prioritized market).
const LANGS = [
  ["ca", ""],
  ["es", "/es"],
  ["en", "/en"],
  ["x-default", "/en"],
];

const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const tickers = read("src/data/tickers.json");
const pairs = read("src/data/compare-pairs.json");

// Build date as <lastmod>: the pages carry live financials + accumulating EDGAR
// history that refresh with each weekly deploy, so a fresh lastmod on every
// build tells Google to recrawl the updated content.
const today = new Date().toISOString().slice(0, 10);

function entry(slug, priority) {
  const alts = LANGS.map(
    ([l, prefix]) =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${BASE}${prefix}${slug}"/>`,
  ).join("\n");
  return `  <url>\n    <loc>${BASE}${slug}</loc>\n${alts}\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

// Only the curated direction of each pair is listed; the reverse slug redirects
// to it, so advertising both would be asking to index a duplicate.
const urls = [
  ...tickers.map(({ symbol }) => entry(`/explore/${symbol.toLowerCase()}`, "0.7")),
  ...pairs.map(({ a, b }) =>
    entry(`/explore/compare/${a.toLowerCase()}-vs-${b.toLowerCase()}`, "0.6"),
  ),
].join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

writeFileSync(path.join(root, "public/sitemap-tickers.xml"), xml, "utf8");
console.log(
  `[sitemap] wrote ${tickers.length} ticker + ${pairs.length} comparison URLs to public/sitemap-tickers.xml`,
);
