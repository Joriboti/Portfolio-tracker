import { useEffect } from "react";

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
    if (url) {
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.setAttribute("rel", "canonical");
        document.head.appendChild(canonical);
      }
      canonical.setAttribute("href", url);
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
      if (canonical && prevCanonical) canonical.setAttribute("href", prevCanonical);
    };
  }, [title, description, url, image, jsonLd]);
}
