// Generates public/sitemap.xml — the curated (non-ticker) sitemap. Emits one
// <url> per language variant of every public page, each carrying the full set
// of hreflang alternates (ca / es / en + x-default→en). Path-based locale URLs
// (/es/…, /en/…) replaced the old ?lng= querystrings when TrimmTrack moved to
// server-rendered per-language pages. Runs at the start of the build so the file
// lands in dist/. Kept separate from sitemap-tickers.xml (auto-generated,
// hundreds of URLs) so this one stays small and reviewable.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const BASE = "https://www.trimmtrack.com";
const today = new Date().toISOString().slice(0, 10);

const PREFIX = { ca: "", es: "/es", en: "/en" };

// Multilingual public pages: [neutral path, priority, changefreq].
const MULTILANG = [
  ["/", "1.0", "weekly"],
  ["/explore", "0.9", "weekly"],
  ["/research", "0.8", "weekly"],
  ["/radiografia", "0.9", "monthly"],
  ["/calculadora-fifo", "0.8", "monthly"],
  ["/taxes", "0.9", "monthly"],
  ["/forecast", "0.8", "monthly"],
  ["/disclaimer", "0.4", "yearly"],
];

// Research articles (currently Catalan/Spanish/English via the same route).
const ARTICLES = ["/research/netflix", "/research/exor", "/research/meta"];

// English-only SEO tool pages (Phase 1). Self hreflang en + x-default.
const EN_TOOLS = [
  ["/en/dcf-calculator", "0.9"],
  ["/en/reverse-dcf-calculator", "0.9"],
  ["/en/graham-number-calculator", "0.9"],
  ["/en/monte-carlo-stock-simulator", "0.8"],
  ["/en/fifo-capital-gains-calculator", "0.8"],
  ["/en/etf-growth-calculator", "0.8"],
  ["/en/portfolio-tracker", "0.8"],
];

const url = (loc, { alts = [], priority = "0.7", changefreq = "monthly", lastmod } = {}) => {
  const altLines = alts
    .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
    .join("\n");
  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    altLines,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
};

/** Full hreflang set for a language-neutral path. */
function alternates(neutral) {
  const set = ["ca", "es", "en"].map((l) => ({
    hreflang: l,
    href: `${BASE}${PREFIX[l]}${neutral === "/" ? "" : neutral}` || `${BASE}/`,
  }));
  set.push({ hreflang: "x-default", href: `${BASE}${PREFIX.en}${neutral === "/" ? "" : neutral}` });
  // Normalise the Catalan root to a trailing slash.
  return set.map((a) => (a.href === BASE ? { ...a, href: `${BASE}/` } : a));
}

const blocks = [];

for (const [neutral, priority, changefreq] of MULTILANG) {
  const alts = alternates(neutral);
  for (const l of ["ca", "es", "en"]) {
    const loc = `${BASE}${PREFIX[l]}${neutral === "/" ? "" : neutral}` || `${BASE}/`;
    blocks.push(
      url(loc === BASE ? `${BASE}/` : loc, {
        alts,
        priority: l === "ca" ? priority : (Number(priority) - 0.1).toFixed(1),
        changefreq,
        lastmod: neutral === "/" ? today : undefined,
      }),
    );
  }
}

for (const neutral of ARTICLES) {
  const alts = alternates(neutral);
  for (const l of ["ca", "es", "en"]) {
    blocks.push(
      url(`${BASE}${PREFIX[l]}${neutral}`, { alts, priority: "0.7", changefreq: "monthly" }),
    );
  }
}

for (const [loc, priority] of EN_TOOLS) {
  blocks.push(
    url(`${BASE}${loc}`, {
      alts: [
        { hreflang: "en", href: `${BASE}${loc}` },
        { hreflang: "x-default", href: `${BASE}${loc}` },
      ],
      priority,
      changefreq: "monthly",
    }),
  );
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${blocks.join("\n")}
</urlset>
`;

writeFileSync(path.join(root, "public/sitemap.xml"), xml, "utf8");
console.log(`[sitemap] wrote ${blocks.length} URLs to public/sitemap.xml`);
