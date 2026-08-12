// Types for scripts/routes.mjs — the build-time URL inventory. The module is
// plain .mjs because the sitemap generators and the prerenderer run under node
// without a TS step; this declaration lets the test suite consume it type-safely
// (src/lib/locale.test.ts asserts it agrees with src/lib/locale.ts).

export type Locale = "ca" | "es" | "en";

export type Alternate = {
  /** "ca" | "es" | "en" | "x-default" */
  hreflang: string;
  href: string;
};

export type IndexableUrl = {
  /** Absolute URL of this language variant. */
  loc: string;
  locale: Locale;
  /** The page's slug as written in ROUTE_SLUGS (or the shared slug). */
  neutral: string;
  /** Full reciprocal cluster, including this URL itself and one x-default. */
  alternates: Alternate[];
  priority: string;
  changefreq: string;
  lastmod?: string;
};

export type PrerenderRoute = {
  /** Path to visit, e.g. "/es/explore/aapl". */
  path: string;
  locale: Locale;
  /** Wait for API-driven charts to paint before snapshotting. */
  awaitCharts?: boolean;
  /** This is the 404 page; also written to dist/404.html. */
  notFound?: boolean;
};

export type TickerEntry = { symbol: string; name: string };
export type PairEntry = { a: string; b: string };
/** Which languages each research article is actually written in. */
export type ArticleEntry = { slug: string; locales: Locale[] };

export const ARTICLES: ArticleEntry[];

export const BASE: string;
export const LOCALES: Locale[];
export const X_DEFAULT: Locale;
export const PREFIX: Record<Locale, string>;
export const ROUTE_SLUGS: Record<string, Record<Locale, string>>;
export const TICKER_DATA: TickerEntry[];
export const PAIR_DATA: PairEntry[];

export function localePath(neutral: string, locale: Locale): string;
export function absolute(p: string): string;
export function allIndexableUrls(opts?: { lastmod?: string }): IndexableUrl[];
export function curatedUrls(opts?: { lastmod?: string }): IndexableUrl[];
export function programmaticUrls(opts?: { lastmod?: string }): IndexableUrl[];
export function allPrerenderRoutes(): PrerenderRoute[];
