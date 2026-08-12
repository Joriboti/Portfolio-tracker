import { useEffect } from "react";
import {
  LOCALES,
  OG_LOCALE,
  SITE_ORIGIN,
  X_DEFAULT_LOCALE,
  type Locale,
  localeFromPath,
  localeUrl,
  stripLocale,
} from "@/lib/locale";

// Per-route SEO for the CSR app: upserts <title>, meta description, canonical,
// per-language hreflang alternates, Open Graph / Twitter tags and an optional
// JSON-LD <script>. Canonical + hreflang + og:locale are derived from the URL's
// locale prefix (/en/…, /es/…, or the bare Catalan root), so each language has a
// self-referencing canonical and the whole set cross-links via hreflang. The
// prerender step snapshots these into the static HTML for every language URL.

type SeoInput = {
  title: string;
  description?: string;
  /** Optional explicit language-neutral path ("/calculadora-fifo"). Defaults to
   *  the current location, with any locale prefix stripped. */
  path?: string;
  image?: string;
  jsonLd?: Record<string, unknown>;
  /** Languages this page actually exists in, for the hreflang set. Defaults to
   *  all three. English-only pages (the /en tool pages) pass ["en"] so we don't
   *  advertise ca/es alternates that would 404. */
  alternates?: Locale[];
  /** Keep this URL out of the index. For pages that render one person's data
   *  under a shared link — a verified portfolio card, say — where the route
   *  itself is public but each instance is somebody's business alone. */
  noindex?: boolean;
};

function upsertMeta(selector: string, attr: "name" | "property", key: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

export function useSeo({
  title,
  description,
  path,
  image,
  jsonLd,
  alternates: hreflangLocales,
  noindex,
}: SeoInput) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const pathname =
      typeof window !== "undefined" ? window.location.pathname : "/";
    const currentLocale = localeFromPath(pathname);
    const neutralPath = path ?? stripLocale(pathname);
    const canonicalHref = localeUrl(neutralPath, currentLocale);

    // Keep <html lang> accurate per URL so each prerendered snapshot declares
    // its real language (index.html hardcodes lang="ca").
    const prevLang = document.documentElement.lang;
    document.documentElement.lang = currentLocale;

    const created: HTMLElement[] = [];
    const set = (
      selector: string,
      attr: "name" | "property",
      key: string,
      content: string,
    ) => {
      const el = upsertMeta(selector, attr, key);
      el.setAttribute("content", content);
      created.push(el);
    };

    if (description) {
      set('meta[name="description"]', "name", "description", description);
      set('meta[property="og:description"]', "property", "og:description", description);
      set('meta[name="twitter:description"]', "name", "twitter:description", description);
    }
    set('meta[property="og:title"]', "property", "og:title", title);
    set('meta[name="twitter:title"]', "name", "twitter:title", title);
    set('meta[property="og:url"]', "property", "og:url", canonicalHref);
    // og:locale reflects the language actually served at this URL (was hardcoded
    // ca_ES in index.html for every language).
    set('meta[property="og:locale"]', "property", "og:locale", OG_LOCALE[currentLocale]);
    if (image) {
      set('meta[property="og:image"]', "property", "og:image", image);
      set('meta[name="twitter:image"]', "name", "twitter:image", image);
    }

    // Canonical: self-referencing per language.
    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    const prevCanonical = canonical?.getAttribute("href") ?? null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", canonicalHref);

    // Remove any hreflang alternates a previous route left behind, then emit a
    // fresh set for this page (ca / es / en + x-default).
    document.head
      .querySelectorAll('link[rel="alternate"][hreflang]')
      .forEach((el) => el.remove());
    const alternates: HTMLLinkElement[] = [];
    const addAlt = (hreflang: string, locale: Locale) => {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("hreflang", hreflang);
      link.setAttribute("href", localeUrl(neutralPath, locale));
      document.head.appendChild(link);
      alternates.push(link);
    };
    const langs = hreflangLocales ?? LOCALES;
    for (const l of langs) addAlt(l, l);
    // x-default → en when the page exists in en, else the first available.
    addAlt("x-default", langs.includes(X_DEFAULT_LOCALE) ? X_DEFAULT_LOCALE : langs[0]);

    // Added and removed per route rather than upserted, so leaving a noindex
    // page cannot leave the tag behind on the next one.
    let robots: HTMLMetaElement | null = null;
    if (noindex) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      robots.setAttribute("content", "noindex, nofollow");
      document.head.appendChild(robots);
    }

    let ld: HTMLScriptElement | null = null;
    if (jsonLd) {
      ld = document.createElement("script");
      ld.type = "application/ld+json";
      ld.text = JSON.stringify(jsonLd);
      document.head.appendChild(ld);
    }

    return () => {
      document.title = prevTitle;
      document.documentElement.lang = prevLang;
      if (ld) ld.remove();
      if (robots) robots.remove();
      for (const a of alternates) a.remove();
      if (canonical && prevCanonical) canonical.setAttribute("href", prevCanonical);
    };
  }, [title, description, path, image, jsonLd, hreflangLocales, noindex]);
}

export { SITE_ORIGIN };
