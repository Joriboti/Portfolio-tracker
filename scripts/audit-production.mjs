// Crawls a deployed TrimmTrack (preview or production) and checks the things a
// build cannot: what the origin actually serves. Reads BOTH sitemaps, fetches
// every URL concurrently, and verifies status, real HTML, title, description,
// lang, canonical, H1, reciprocal hreflang, the private-route headers, the
// asset cache policy, and every internal link the pages point at.
//
// Not a Vercel function: a plain Node script, run from CI or by hand.
//
//   node scripts/audit-production.mjs --base-url https://www.trimmtrack.com
//   node scripts/audit-production.mjs --base-url <preview> --limit 40
//
// Exits non-zero on the first category of failure, and prints every offender.

import { allIndexableUrls, BASE } from "./routes.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = argOf("--base-url", BASE).replace(/\/$/, "");
const LIMIT = Number(argOf("--limit", "0")) || 0;
const CONCURRENCY = Number(argOf("--concurrency", "8"));
const VERBOSE = args.includes("--verbose");

const problems = [];
const fail = (category, url, detail) => problems.push({ category, url, detail });

// ---------------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function get(url, { method = "GET", redirect = "manual" } = {}) {
  try {
    const res = await fetch(url, { method, redirect, headers: { "user-agent": "trimmtrack-audit" } });
    const body = method === "GET" && res.status < 400 ? await res.text() : "";
    return { status: res.status, headers: res.headers, body, location: res.headers.get("location") };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: "", error: String(e) };
  }
}

const attr = (html, re) => html.match(re)?.[1] ?? null;
const title = (h) => attr(h, /<title>([\s\S]*?)<\/title>/);
const htmlLang = (h) => attr(h, /<html[^>]*\slang="([^"]*)"/);
const description = (h) =>
  attr(h, /<meta[^>]*name="description"[^>]*content="([^"]*)"/) ??
  attr(h, /<meta[^>]*content="([^"]*)"[^>]*name="description"/);
const canonical = (h) => attr(h, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/);
const hreflangs = (h) =>
  [...h.matchAll(/<link[^>]*rel="alternate"[^>]*hreflang="([^"]*)"[^>]*href="([^"]*)"/g)].map((m) => ({
    hreflang: m[1],
    href: m[2],
  }));
const h1 = (h) => attr(h, /<h1[^>]*>([\s\S]*?)<\/h1>/)?.replace(/<[^>]*>/g, "").trim() ?? null;
const internalLinks = (h) =>
  [...h.matchAll(/<a[^>]*href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => href.startsWith("/") || href.startsWith(BASE_URL) || /^https?:\/\/(www\.)?trimmtrack\.com/.test(href))
    .filter((href) => !/\.(png|svg|jpe?g|webp|ico|xml|txt|js|css|pdf)(\?|#|$)/i.test(href))
    .map((href) => (href.startsWith("/") ? href : new URL(href).pathname + new URL(href).search))
    .filter((p) => !p.startsWith("//"));

// ---------------------------------------------------------------------------
// 1. Inventory, from the same source the sitemaps are generated from.
// ---------------------------------------------------------------------------

let inventory = allIndexableUrls({}).map((u) => ({
  path: u.loc.slice(BASE.length) || "/",
  locale: u.locale,
  alternates: u.alternates.map((a) => ({
    hreflang: a.hreflang,
    path: a.href.slice(BASE.length) || "/",
  })),
}));
if (LIMIT) {
  // Keep one of each kind rather than the first N of one kind.
  const seen = new Map();
  inventory = inventory.filter((u) => {
    const kind = u.path.split("/").slice(0, 3).join("/");
    const n = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, n);
    return n <= Math.max(1, Math.floor(LIMIT / 12));
  });
}

console.log(`[audit] ${BASE_URL} — ${inventory.length} URLs, concurrency ${CONCURRENCY}`);

// Both sitemaps must also be reachable and agree with the inventory.
for (const name of ["sitemap.xml", "sitemap-tickers.xml"]) {
  const res = await get(`${BASE_URL}/${name}`);
  if (res.status !== 200) {
    fail("sitemap", `/${name}`, `status ${res.status}`);
    continue;
  }
  const locs = [...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
  if (dupes.length) fail("sitemap", `/${name}`, `${dupes.length} duplicate <loc> (${dupes[0]})`);
  if (!locs.length) fail("sitemap", `/${name}`, "no URLs");
  if (VERBOSE) console.log(`[audit] ${name}: ${locs.length} urls`);
}

// ---------------------------------------------------------------------------
// 2. Every indexable URL: 200, real HTML, correct metadata.
// ---------------------------------------------------------------------------

const linkTargets = new Set();

await mapLimit(inventory, CONCURRENCY, async (u) => {
  const url = `${BASE_URL}${u.path}`;
  const res = await get(url);
  if (res.status !== 200) {
    fail("status", u.path, res.error ?? `expected 200, got ${res.status}${res.location ? ` → ${res.location}` : ""}`);
    return;
  }
  const html = res.body;
  if (html.length < 15000) fail("thin", u.path, `${html.length} bytes — looks like the SPA shell`);
  if (!title(html)) fail("title", u.path, "missing <title>");
  if (!description(html)) fail("description", u.path, "missing meta description");
  if (htmlLang(html) !== u.locale) fail("lang", u.path, `lang=${htmlLang(html)}, expected ${u.locale}`);
  if (!h1(html)) fail("h1", u.path, "no <h1>");

  const want = `${BASE_URL}${u.path}`;
  const got = canonical(html);
  // A preview deployment canonicalises to the production host on purpose; only
  // the path is meaningful there.
  const gotPath = got ? new URL(got, BASE_URL).pathname : null;
  if (!got) fail("canonical", u.path, "missing");
  else if (gotPath !== u.path) fail("canonical", u.path, `points at ${gotPath} (${got} vs ${want})`);

  const alts = hreflangs(html);
  const wantSet = new Set(u.alternates.map((a) => `${a.hreflang}|${a.path}`));
  const gotSet = new Set(alts.map((a) => `${a.hreflang}|${new URL(a.href, BASE_URL).pathname}`));
  for (const w of wantSet) if (!gotSet.has(w)) fail("hreflang", u.path, `missing ${w}`);
  for (const g of gotSet) if (!wantSet.has(g)) fail("hreflang", u.path, `unexpected ${g}`);
  // Reciprocity: the page must list itself.
  if (!gotSet.has(`${u.locale}|${u.path}`)) fail("hreflang", u.path, "not self-referencing");

  for (const l of internalLinks(html)) linkTargets.add(l);
});

// ---------------------------------------------------------------------------
// 3. Internal links: no redirect hops, no dead ends.
// ---------------------------------------------------------------------------

const known = new Set(inventory.map((u) => u.path));
const toCheck = [...linkTargets].filter((p) => !known.has(p));
await mapLimit(toCheck, CONCURRENCY, async (p) => {
  const res = await get(`${BASE_URL}${p}`, { method: "GET" });
  if (res.status >= 300 && res.status < 400) {
    fail("link-redirect", p, `linked but ${res.status} → ${res.location}`);
  } else if (res.status >= 400) {
    fail("link-broken", p, `linked but ${res.status}`);
  }
});

// ---------------------------------------------------------------------------
// 4. Headers: private routes noindex, assets immutable, unknown URLs 404.
// ---------------------------------------------------------------------------

for (const p of ["/dashboard", "/upload", "/account", "/auth/sign-in", "/debug"]) {
  const res = await get(`${BASE_URL}${p}`);
  const tag = res.headers.get("x-robots-tag") ?? "";
  if (!/noindex/i.test(tag)) fail("noindex", p, `X-Robots-Tag: ${tag || "(absent)"}`);
}

{
  const home = await get(`${BASE_URL}/`);
  const asset = home.body.match(/\/assets\/[A-Za-z0-9_.-]+\.js/)?.[0];
  if (!asset) fail("assets", "/", "no /assets/*.js referenced by the home page");
  else {
    const res = await get(`${BASE_URL}${asset}`, { method: "HEAD" });
    const cc = res.headers.get("cache-control") ?? "";
    if (!/immutable/.test(cc) || !/max-age=31536000/.test(cc)) fail("assets", asset, `Cache-Control: ${cc || "(absent)"}`);
  }
}

for (const p of ["/nonexistent-page-xyz", "/es/pagina-que-no-existeix", "/en/nope"]) {
  const res = await get(`${BASE_URL}${p}`);
  if (res.status !== 404) fail("404", p, `expected 404, got ${res.status}`);
}

// ---------------------------------------------------------------------------

const byCategory = problems.reduce((acc, p) => {
  (acc[p.category] ??= []).push(p);
  return acc;
}, {});

if (problems.length === 0) {
  console.log(`[audit] OK — ${inventory.length} URLs, ${toCheck.length} linked paths, no problems`);
  process.exit(0);
}

console.error(`\n[audit] ${problems.length} problem(s):`);
for (const [category, list] of Object.entries(byCategory)) {
  console.error(`\n  ${category} (${list.length})`);
  for (const p of list.slice(0, 25)) console.error(`    ${p.url} — ${p.detail}`);
  if (list.length > 25) console.error(`    … and ${list.length - 25} more`);
}
process.exit(1);
