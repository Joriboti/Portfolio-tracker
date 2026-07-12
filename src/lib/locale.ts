// Path-based i18n routing. Catalan (the default) lives at the bare URL ("/",
// "/research"); Spanish and English are mirrored under "/es/…" and "/en/…".
// Each locale therefore has its own crawlable, prerenderable URL — the thing
// query-string variants (?lng=en) could never give us for SEO.

export const LOCALES = ["ca", "es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

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

/** Read the locale encoded in a pathname ("/en/foo" → "en", "/foo" → "ca"). */
export function localeFromPath(pathname: string): Locale {
  const seg = pathname.split("/")[1];
  return (PREFIXED_LOCALES as readonly string[]).includes(seg)
    ? (seg as Locale)
    : DEFAULT_LOCALE;
}

/** Strip any locale prefix, returning the language-neutral path ("/en/x" → "/x"). */
export function stripLocale(pathname: string): string {
  const seg = pathname.split("/")[1];
  if ((PREFIXED_LOCALES as readonly string[]).includes(seg)) {
    const rest = pathname.slice(seg.length + 1); // drop "/en"
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

/** Add the prefix for `locale` onto a language-neutral path. ca → unchanged. */
export function withLocale(pathname: string, locale: Locale): string {
  const base = stripLocale(pathname);
  if (locale === DEFAULT_LOCALE) return base;
  return base === "/" ? `/${locale}` : `/${locale}${base}`;
}

/** Absolute canonical URL for a language-neutral path in a given locale. */
export function localeUrl(neutralPath: string, locale: Locale): string {
  const path = withLocale(neutralPath, locale);
  return `${SITE_ORIGIN}${path === "/" ? "/" : path.replace(/\/$/, "")}`;
}
