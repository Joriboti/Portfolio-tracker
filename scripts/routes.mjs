// The single list of public URLs, shared by the two sitemap generators and the
// prerenderer. Before this existed each of the three kept its own copy of the
// route list, and they drifted: sitemap-tickers.xml advertised /es and /en
// alternates for 116 programmatic pages that the prerenderer only ever rendered
// in Catalan, so Google was pointed at 232 URLs that answered with the generic
// Catalan SPA shell.
//
// Anything indexable must come from allIndexableUrls(); anything prerendered
// must come from allPrerenderRoutes(). They are built from the same data, so a
// URL cannot be in a sitemap without also being rendered.
//
// This file mirrors ROUTE_SLUGS in src/lib/locale.ts (the app's own source of
// truth). src/lib/locale.test.ts asserts the two agree, so the duplication
// cannot silently rot.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(ROOT, f), "utf8"));

export const BASE = "https://www.trimmtrack.com";
export const LOCALES = ["ca", "es", "en"];
export const X_DEFAULT = "en";
/** Catalan is prefixless; the other two live under their code. */
export const PREFIX = { ca: "", es: "/es", en: "/en" };

/** Mirror of ROUTE_SLUGS in src/lib/locale.ts — pages whose slug is translated. */
export const ROUTE_SLUGS = {
  fifo: {
    ca: "/calculadora-fifo",
    es: "/calculadora-fifo",
    en: "/fifo-capital-gains-calculator",
  },
  dcf: { ca: "/calculadora-dcf", es: "/calculadora-dcf", en: "/dcf-calculator" },
  reverseDcf: { ca: "/dcf-invers", es: "/dcf-inverso", en: "/reverse-dcf-calculator" },
  graham: {
    ca: "/numero-de-graham",
    es: "/numero-de-graham",
    en: "/graham-number-calculator",
  },
  monteCarlo: {
    ca: "/simulador-monte-carlo",
    es: "/simulador-monte-carlo",
    en: "/monte-carlo-stock-simulator",
  },
};

/** The path of a page in one locale. `neutral` may be written in any locale. */
export function localePath(neutral, locale) {
  const id = Object.keys(ROUTE_SLUGS).find((k) =>
    LOCALES.some((l) => ROUTE_SLUGS[k][l] === neutral),
  );
  const slug = id ? ROUTE_SLUGS[id][locale] : neutral;
  if (slug === "/") return PREFIX[locale] || "/";
  return `${PREFIX[locale]}${slug}`;
}

export function absolute(p) {
  return `${BASE}${p === "/" ? "/" : p.replace(/\/$/, "")}`;
}

// ---------------------------------------------------------------------------
// Page inventory
// ---------------------------------------------------------------------------

/** Pages that exist in all three languages. [neutral, priority, changefreq] */
const MULTILANG = [
  ["/", "1.0", "weekly"],
  ["/explore", "0.9", "weekly"],
  ["/research", "0.8", "weekly"],
  ["/radiografia", "0.9", "monthly"],
  ["/taxes", "0.9", "monthly"],
  ["/forecast", "0.8", "monthly"],
  [ROUTE_SLUGS.fifo.ca, "0.8", "monthly"],
  [ROUTE_SLUGS.dcf.ca, "0.9", "monthly"],
  [ROUTE_SLUGS.reverseDcf.ca, "0.9", "monthly"],
  [ROUTE_SLUGS.graham.ca, "0.8", "monthly"],
  [ROUTE_SLUGS.monteCarlo.ca, "0.8", "monthly"],
  ["/disclaimer", "0.4", "yearly"],
];

// English-only landings. Kept English-only on purpose: a ca/es "ETF growth"
// page would cannibalise /forecast, and a ca/es "portfolio tracker" page would
// cannibalise the home page, which already own those intents in those languages.
const EN_ONLY = [
  ["/etf-growth-calculator", "0.8"],
  ["/portfolio-tracker", "0.8"],
];

// Research articles, with the locales each one is ACTUALLY written in. All three
// are authored in English today, so only /en/research/:slug is indexable and the
// ca/es paths 301 to it (see vercel.json). Publishing a real translation = add
// the locale here and drop that redirect; nothing else needs touching.
const ARTICLES = read("src/data/research-articles.json");

const TICKERS = read("src/data/tickers.json");
const PAIRS = read("src/data/compare-pairs.json");

export const TICKER_DATA = TICKERS;
export const PAIR_DATA = PAIRS;

const tickerPath = ({ symbol }) => `/explore/${symbol.toLowerCase()}`;
const pairPath = ({ a, b }) =>
  `/explore/compare/${a.toLowerCase()}-vs-${b.toLowerCase()}`;

// ---------------------------------------------------------------------------
// Derived URL sets
// ---------------------------------------------------------------------------

/**
 * Reciprocal hreflang cluster for one page. Every member links to itself AND to
 * every sibling, and x-default points at English when English exists (else the
 * first available locale) — so a cluster is never one-directional and never
 * advertises a variant that does not exist.
 */
function cluster(neutral, locales) {
  const alts = locales.map((l) => ({
    hreflang: l,
    href: absolute(localePath(neutral, l)),
  }));
  const xd = locales.includes(X_DEFAULT) ? X_DEFAULT : locales[0];
  alts.push({ hreflang: "x-default", href: absolute(localePath(neutral, xd)) });
  return alts;
}

/**
 * Every indexable URL on the site, one entry per language variant. The entry is
 * self-referencing: `loc` is always a member of its own `alternates`.
 */
export function allIndexableUrls({ lastmod } = {}) {
  const out = [];
  const push = (neutral, locales, priority, changefreq, mod) => {
    const alts = cluster(neutral, locales);
    for (const l of locales) {
      out.push({
        loc: absolute(localePath(neutral, l)),
        locale: l,
        neutral,
        alternates: alts,
        // A page's non-default language variants are a shade less important
        // than the original, which is what the priority hint is for.
        priority: l === "ca" ? priority : (Number(priority) - 0.1).toFixed(1),
        changefreq,
        lastmod: mod,
      });
    }
  };

  for (const [neutral, priority, changefreq] of MULTILANG) {
    push(neutral, LOCALES, priority, changefreq, neutral === "/" ? lastmod : undefined);
  }
  for (const [neutral, priority] of EN_ONLY) {
    push(neutral, ["en"], priority, "monthly", undefined);
  }
  for (const { slug, locales } of ARTICLES) {
    if (!locales.length) continue;
    push(`/research/${slug}`, locales, "0.7", "monthly", undefined);
  }
  for (const t of TICKERS) {
    push(tickerPath(t), LOCALES, "0.7", "weekly", lastmod);
  }
  // Only the curated direction of each pair: the reverse slug redirects to it,
  // so advertising both would be asking to index a duplicate.
  for (const p of PAIRS) {
    push(pairPath(p), LOCALES, "0.6", "weekly", lastmod);
  }
  return out;
}

/** The curated (small, reviewable) sitemap: everything except the programmatic pages. */
export function curatedUrls(opts) {
  return allIndexableUrls(opts).filter(
    (u) => !u.neutral.startsWith("/explore/"),
  );
}

/** The programmatic sitemap: per-ticker and comparison pages, all languages. */
export function programmaticUrls(opts) {
  return allIndexableUrls(opts).filter((u) => u.neutral.startsWith("/explore/"));
}

/**
 * Routes the prerenderer must snapshot: every indexable URL, plus the 404 page
 * (which needs a static body for Vercel to serve with a 404 status) — as
 * {path, locale} with the locale to render in.
 */
export function allPrerenderRoutes() {
  const routes = allIndexableUrls().map((u) => ({
    path: u.loc.slice(BASE.length) || "/",
    locale: u.locale,
    // API-driven pages wait for their charts to paint before snapshotting.
    awaitCharts: u.neutral.startsWith("/explore/"),
  }));
  for (const l of LOCALES) {
    routes.push({ path: localePath("/404", l), locale: l, notFound: true });
  }
  return routes;
}
