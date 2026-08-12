// Generates public/sitemap.xml — the curated (non-programmatic) sitemap. One
// <url> per language variant of every public page, each self-referencing and
// carrying the full reciprocal hreflang cluster. The URL inventory comes from
// scripts/routes.mjs, shared with gen-ticker-sitemap.mjs and prerender.mjs, so a
// URL cannot appear here without also being rendered.
//
// Runs at the start of the build so the file lands in dist/.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { curatedUrls } from "./routes.mjs";
import { renderSitemap } from "./sitemap-xml.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);

const urls = curatedUrls({ lastmod: today });
writeFileSync(path.join(root, "public/sitemap.xml"), renderSitemap(urls), "utf8");

const byLocale = urls.reduce((acc, u) => {
  acc[u.locale] = (acc[u.locale] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `[sitemap] wrote ${urls.length} URLs to public/sitemap.xml ` +
    `(${Object.entries(byLocale).map(([l, n]) => `${l} ${n}`).join(", ")})`,
);
