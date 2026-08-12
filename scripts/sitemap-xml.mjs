// Sitemap XML rendering, shared by both generators so the two files cannot end
// up with different escaping or a different alternate-link shape.

/** XML-escape a URL or text node. Ampersands in query strings are the live case. */
export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderUrl(u) {
  const alts = (u.alternates ?? []).map(
    (a) =>
      `    <xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}"/>`,
  );
  return [
    "  <url>",
    `    <loc>${esc(u.loc)}</loc>`,
    ...alts,
    // lastmod only when it reflects a real change: the programmatic pages carry
    // live financials that refresh every deploy, the static copy pages do not,
    // and a fake lastmod on an unchanged page just burns crawl budget.
    u.lastmod ? `    <lastmod>${esc(u.lastmod)}</lastmod>` : null,
    u.changefreq ? `    <changefreq>${esc(u.changefreq)}</changefreq>` : null,
    u.priority ? `    <priority>${esc(u.priority)}</priority>` : null,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderSitemap(urls) {
  const seen = new Set();
  for (const u of urls) {
    if (seen.has(u.loc)) throw new Error(`duplicate <loc> in sitemap: ${u.loc}`);
    seen.add(u.loc);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map(renderUrl).join("\n")}
</urlset>
`;
}
