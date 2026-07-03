import { useEffect } from "react";
import i18n from "@/lib/i18n";

/** Languages exposed as indexable variants (?lng=…). ca is the default URL. */
const LANGS = ["ca", "es", "en"] as const;

function langUrl(url: string, lng: string): string {
  if (lng === "ca") return url;
  return `${url}${url.includes("?") ? "&" : "?"}lng=${lng}`;
}

// Per-route SEO for the CSR app: upserts <title>, meta description, canonical,
// Open Graph / Twitter tags and an optional JSON-LD <script>. Googlebot renders
// JS, so these are picked up on crawl. Everything is restored/cleaned on unmount
// so tags from one route don't leak into the next.

type SeoInput = {
  title: string;
  description?: string;
  url?: string;
  image?: string;
  jsonLd?: Record<string, unknown>;
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

export function useSeo({ title, description, url, image, jsonLd }: SeoInput) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const tags: HTMLElement[] = [];
    const set = (
      selector: string,
      attr: "name" | "property",
      key: string,
      content: string,
    ) => {
      const el = upsertMeta(selector, attr, key);
      el.setAttribute("content", content);
      tags.push(el);
    };

    if (description) {
      set('meta[name="description"]', "name", "description", description);
      set('meta[property="og:description"]', "property", "og:description", description);
      set('meta[name="twitter:description"]', "name", "twitter:description", description);
    }
    set('meta[property="og:title"]', "property", "og:title", title);
    set('meta[name="twitter:title"]', "name", "twitter:title", title);
    if (url) set('meta[property="og:url"]', "property", "og:url", url);
    if (image) {
      set('meta[property="og:image"]', "property", "og:image", image);
      set('meta[name="twitter:image"]', "name", "twitter:image", image);
    }

    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    const prevCanonical = canonical?.getAttribute("href") ?? null;
    const alternates: HTMLLinkElement[] = [];
    if (url) {
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.setAttribute("rel", "canonical");
        document.head.appendChild(canonical);
      }
      // Each language variant is its own indexable page: canonical is
      // self-referencing (…?lng=es canonicalises to itself, not to ca).
      const current = (i18n.language ?? "ca").slice(0, 2);
      canonical.setAttribute(
        "href",
        langUrl(url, LANGS.includes(current as (typeof LANGS)[number]) ? current : "ca"),
      );
      // hreflang alternates so Google serves the right language per query.
      for (const l of [...LANGS, "x-default"] as const) {
        const link = document.createElement("link");
        link.setAttribute("rel", "alternate");
        link.setAttribute("hreflang", l);
        link.setAttribute("href", langUrl(url, l === "x-default" ? "ca" : l));
        document.head.appendChild(link);
        alternates.push(link);
      }
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
      if (ld) ld.remove();
      for (const a of alternates) a.remove();
      if (canonical && prevCanonical) canonical.setAttribute("href", prevCanonical);
    };
  }, [title, description, url, image, jsonLd]);
}
