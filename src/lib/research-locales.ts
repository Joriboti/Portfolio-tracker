import manifest from "@/data/research-articles.json";
import { DEFAULT_LOCALE, LOCALES, X_DEFAULT_LOCALE, type Locale } from "@/lib/locale";

// Which languages each research article is ACTUALLY written in.
//
// The article bodies live in Notion, which has no language dimension: one row
// per article, fetched by slug. The routes were mirrored across all three
// locales anyway, so /research/netflix, /es/research/netflix and
// /en/research/netflix each served the same English body — the ca and es ones
// under <html lang="ca">/<lang="es"> with translated chrome around English
// prose, and all three claiming to be translations of each other via hreflang.
// That is the pattern Google reads as a fake translation.
//
// This manifest is the source of truth instead: a variant exists only if its
// locale is listed. It drives the hreflang set here, the sitemap and the
// prerender list (via scripts/routes.mjs, which reads the same JSON), and the
// 301s in vercel.json point the non-existent variants at the real one.
//
// To publish a real translation: write it in Notion, add the locale here, and
// remove that path's redirect from vercel.json. Nothing else needs changing.

type Entry = { slug: string; locales: string[] };

const BY_SLUG: Record<string, Locale[]> = Object.fromEntries(
  (manifest as Entry[]).map((e) => [
    e.slug,
    e.locales.filter((l): l is Locale => (LOCALES as readonly string[]).includes(l)),
  ]),
);

/**
 * Locales this article genuinely exists in. An unknown slug — an article
 * published in Notion since the last deploy — returns an empty list: we don't
 * know its language, so the page advertises no alternates rather than claiming
 * translations that may not exist.
 */
export function articleLocales(slug: string): Locale[] {
  return BY_SLUG[slug] ?? [];
}

/** True when this slug is declared in the manifest at all. */
export function isKnownArticle(slug: string): boolean {
  return slug in BY_SLUG;
}

/**
 * The locale a reader asking for `wanted` should actually be served, or null if
 * `wanted` is fine. Prefers the requested language, then English (where most
 * articles are authored), then Catalan, then whatever exists.
 */
export function resolveArticleLocale(slug: string, wanted: Locale): Locale | null {
  const available = articleLocales(slug);
  if (!available.length || available.includes(wanted)) return null;
  for (const pref of [X_DEFAULT_LOCALE, DEFAULT_LOCALE]) {
    if (available.includes(pref)) return pref;
  }
  return available[0];
}
