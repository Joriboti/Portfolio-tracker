// Path-based i18n routing. Catalan (the default) lives at the bare URL ("/",
// "/research"); Spanish and English are mirrored under "/es/…" and "/en/…".
// Each locale therefore has its own crawlable, prerenderable URL — the thing
// query-string variants (?lng=en) could never give us for SEO.
//
// This module is the single source of truth for: the locale list, the prefixes,
// which paths are localizable at all, the per-locale slug of every page whose
// URL is translated, and the canonical URL builder. Components must never
// hand-build a localized path — use withLocale/localeUrl (or the LocaleLink
// wrappers in components/LocaleLink.tsx), so there is exactly one place that
// knows what the Spanish URL of a page is.

export const LOCALES = ["ca", "es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** LOCALES as a plain array, for the many APIs that want `Locale[]`. */
export const ALL_LOCALES: Locale[] = [...LOCALES];

/** URL path prefix for each locale. Catalan is prefixless (root). */
export const PREFIXED_LOCALES = ["es", "en"] as const;

export const DEFAULT_LOCALE: Locale = "ca";

/** Which locale Google should serve when it has no better language match. */
export const X_DEFAULT_LOCALE: Locale = "en";

/** BCP-47 / og:locale value per language. */
export const OG_LOCALE: Record<Locale, string> = {
  ca: "ca_ES",
  es: "es_ES",
  en: "en_US",
};

export const SITE_ORIGIN = "https://www.trimmtrack.com";

// Pages whose URL slug is itself translated. A Spanish visitor searches
// "calculadora DCF", not "dcf calculator", so the slug is part of the
// localization — but the three URLs are still one page in three languages and
// must hreflang-link to each other. Keyed by a stable route id; the values are
// language-neutral-looking paths that only ever differ by locale.
//
// Everything NOT listed here keeps one shared slug across locales (/explore,
// /forecast, /taxes, /radiografia, …) — that was already the convention and
// changing those URLs now would 301-migrate pages Google has already indexed.
export const ROUTE_SLUGS = {
  fifo: {
    ca: "/calculadora-fifo",
    es: "/calculadora-fifo",
    // The English keyword page already existed at this URL as a separate,
    // duplicate landing. Making it *the* English slug of the FIFO page folds
    // the duplicate into the hreflang cluster instead of competing with it.
    en: "/fifo-capital-gains-calculator",
  },
  dcf: {
    ca: "/calculadora-dcf",
    es: "/calculadora-dcf",
    en: "/dcf-calculator",
  },
  reverseDcf: {
    ca: "/dcf-invers",
    es: "/dcf-inverso",
    en: "/reverse-dcf-calculator",
  },
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
} as const satisfies Record<string, Record<Locale, string>>;

export type RouteId = keyof typeof ROUTE_SLUGS;

/** Every slug of every translated route, mapped back to its route id. */
const SLUG_TO_ROUTE: Record<string, RouteId> = Object.fromEntries(
  (Object.keys(ROUTE_SLUGS) as RouteId[]).flatMap((id) =>
    LOCALES.map((l) => [ROUTE_SLUGS[id][l], id] as const),
  ),
);

// Paths that must NOT carry a locale prefix: the authenticated app, the auth
// flow and the per-person verify links. They are Disallow-ed in robots.txt or
// noindex'd, so a per-language URL would buy nothing and only split the routes.
const UNLOCALIZED_PREFIXES = [
  "/dashboard",
  "/upload",
  "/account",
  "/auth",
  "/debug",
  "/verify",
  "/how-to-prepare",
];

/**
 * Whether a language-neutral path is a public page that exists in every locale.
 * Absolute non-app URLs (mailto:, https://) and hash/query-only links are not.
 */
export function isLocalizable(path: string): boolean {
  if (!path.startsWith("/")) return false;
  const clean = path.split(/[?#]/)[0];
  return !UNLOCALIZED_PREFIXES.some(
    (p) => clean === p || clean.startsWith(`${p}/`),
  );
}

/** Read the locale encoded in a pathname ("/en/foo" → "en", "/foo" → "ca"). */
export function localeFromPath(pathname: string): Locale {
  const seg = pathname.split("/")[1];
  return (PREFIXED_LOCALES as readonly string[]).includes(seg)
    ? (seg as Locale)
    : DEFAULT_LOCALE;
}

/** Strip any locale prefix, returning the path as written ("/en/x" → "/x"). */
export function stripLocale(pathname: string): string {
  const seg = pathname.split("/")[1];
  if ((PREFIXED_LOCALES as readonly string[]).includes(seg)) {
    const rest = pathname.slice(seg.length + 1); // drop "/en"
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

/**
 * Translate a page's slug into `locale`, leaving untranslated routes alone.
 * Accepts the slug in ANY locale, so it round-trips: the Spanish URL of the
 * page currently shown at /en/dcf-calculator is /es/calculadora-dcf.
 */
function translateSlug(unprefixed: string, locale: Locale): string {
  const [pathOnly, suffix] = splitSuffix(unprefixed);
  const id = SLUG_TO_ROUTE[pathOnly];
  if (id) return ROUTE_SLUGS[id][locale] + suffix;
  return unprefixed;
}

/** Split "/a/b?x=1#y" into ["/a/b", "?x=1#y"] so query/hash survive rewriting. */
function splitSuffix(path: string): [string, string] {
  const i = path.search(/[?#]/);
  return i === -1 ? [path, ""] : [path.slice(0, i), path.slice(i)];
}

/**
 * The URL of `pathname` in `locale`. Handles the locale prefix AND the
 * per-locale slug, preserves query string and hash, and returns app/auth paths
 * untouched (they are deliberately language-neutral).
 *
 * Accepts a path in any locale, so it is safe to call on the current location.
 */
export function withLocale(pathname: string, locale: Locale): string {
  const stripped = stripLocale(pathname);
  if (!isLocalizable(stripped)) return stripped;
  const base = translateSlug(stripped, locale);
  if (locale === DEFAULT_LOCALE) return base;
  const [pathOnly, suffix] = splitSuffix(base);
  return pathOnly === "/"
    ? `/${locale}${suffix}`
    : `/${locale}${pathOnly}${suffix}`;
}

/** Absolute canonical URL for a path (given in any locale) in `locale`. */
export function localeUrl(path: string, locale: Locale): string {
  const p = withLocale(path, locale);
  return `${SITE_ORIGIN}${p === "/" ? "/" : p.replace(/\/$/, "")}`;
}
