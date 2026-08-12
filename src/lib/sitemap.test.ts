import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BASE,
  LOCALES,
  allIndexableUrls,
  allPrerenderRoutes,
  curatedUrls,
  programmaticUrls,
  TICKER_DATA,
  PAIR_DATA,
} from "../../scripts/routes.mjs";
import { renderSitemap } from "../../scripts/sitemap-xml.mjs";

// Invariants of the URL inventory the sitemaps and the prerenderer share.
// Each of these encodes a bug that was live in production.

type Url = ReturnType<typeof allIndexableUrls>[number];

const urls: Url[] = allIndexableUrls({ lastmod: "2026-08-12" });

describe("sitemap inventory", () => {
  it("has no duplicate URLs", () => {
    const locs = urls.map((u) => u.loc);
    const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
    expect(dupes).toEqual([]);
  });

  it("uses absolute https URLs on the canonical host", () => {
    for (const u of urls) {
      expect(u.loc.startsWith(`${BASE}/`)).toBe(true);
      expect(u.loc).not.toMatch(/\s/);
      // No trailing slash except the root, and no double slashes.
      expect(u.loc.replace(`${BASE}/`, "")).not.toMatch(/\/$/);
      expect(u.loc.slice("https://".length)).not.toContain("//");
    }
  });

  it("carries no ?lng= parameter anywhere", () => {
    for (const u of urls) {
      expect(u.loc).not.toContain("lng=");
      for (const a of u.alternates) expect(a.href).not.toContain("lng=");
    }
  });

  it("every entry is self-referencing", () => {
    // The bug this catches: a <loc> whose hreflang cluster does not include
    // itself, which tells Google the URL it just submitted is not canonical.
    for (const u of urls) {
      const hrefs = u.alternates.map((a) => a.href);
      expect(hrefs).toContain(u.loc);
      const selfTag = u.alternates.find((a) => a.hreflang === u.locale);
      expect(selfTag?.href).toBe(u.loc);
    }
  });

  it("every hreflang cluster is reciprocal", () => {
    // For each variant A that names B, B must exist as its own <url> and name A.
    const byLoc = new Map(urls.map((u) => [u.loc, u]));
    for (const u of urls) {
      for (const alt of u.alternates) {
        if (alt.hreflang === "x-default") continue;
        const sibling = byLoc.get(alt.href);
        expect(sibling, `${alt.href} is advertised by ${u.loc} but is not itself in the sitemap`).toBeTruthy();
        expect(sibling!.alternates.map((a) => a.href)).toContain(u.loc);
      }
    }
  });

  it("declares exactly one x-default per cluster, pointing at a real variant", () => {
    for (const u of urls) {
      const xd = u.alternates.filter((a) => a.hreflang === "x-default");
      expect(xd).toHaveLength(1);
      const real = u.alternates.filter((a) => a.hreflang !== "x-default").map((a) => a.href);
      expect(real).toContain(xd[0].href);
    }
  });

  it("uses only known hreflang codes", () => {
    for (const u of urls) {
      for (const a of u.alternates) {
        expect([...LOCALES, "x-default"]).toContain(a.hreflang);
      }
    }
  });

  it("never advertises a variant that does not exist", () => {
    // English-only pages must not claim ca/es siblings, and English-only
    // research articles must not claim a Catalan translation.
    const locs = new Set(urls.map((u) => u.loc));
    for (const u of urls) {
      for (const a of u.alternates) expect(locs.has(a.href)).toBe(true);
    }
  });

  it("lists every programmatic page once per language", () => {
    // 116 base pages × 3 languages. The old generator emitted 116 <loc> total.
    const expected = (TICKER_DATA.length + PAIR_DATA.length) * LOCALES.length;
    expect(programmaticUrls({}).length).toBe(expected);
    expect(programmaticUrls({}).length).toBe(348);
  });

  it("splits cleanly between the two sitemap files", () => {
    expect(curatedUrls({}).length + programmaticUrls({}).length).toBe(urls.length);
    for (const u of curatedUrls({})) expect(u.neutral.startsWith("/explore/")).toBe(false);
  });

  it("only sets lastmod where content really changes per deploy", () => {
    // The programmatic pages carry live financials; a static copy page that has
    // not changed must not claim it has, or the recrawl signal means nothing.
    for (const u of curatedUrls({ lastmod: "2026-08-12" })) {
      if (u.neutral !== "/") expect(u.lastmod).toBeUndefined();
    }
    for (const u of programmaticUrls({ lastmod: "2026-08-12" })) {
      expect(u.lastmod).toBe("2026-08-12");
    }
  });
});

describe("sitemap XML", () => {
  it("is well-formed and escapes its URLs", () => {
    const xml = renderSitemap(urls);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    // Balanced tags.
    const count = (re: RegExp) => (xml.match(re) ?? []).length;
    expect(count(/<url>/g)).toBe(urls.length);
    expect(count(/<\/url>/g)).toBe(urls.length);
    expect(count(/<loc>/g)).toBe(urls.length);
    // No raw ampersands left unescaped.
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("refuses to emit a duplicate loc", () => {
    const dup = [urls[0], urls[0]];
    expect(() => renderSitemap(dup)).toThrow(/duplicate/i);
  });
});

describe("prerender coverage", () => {
  it("renders every indexable URL, in its own language", () => {
    // The production bug: 232 localized ticker/comparison URLs were sitemapped
    // but only ever rendered in Catalan, so they served the generic ca shell.
    const rendered = new Map(
      allPrerenderRoutes().map((r) => [r.path, r.locale]),
    );
    for (const u of urls) {
      const p = u.loc.slice(BASE.length) || "/";
      expect(rendered.has(p), `${u.loc} is in a sitemap but never prerendered`).toBe(true);
      expect(rendered.get(p), `${u.loc} would be prerendered in the wrong language`).toBe(u.locale);
    }
  });

  it("renders the localized dynamic pages that regressed", () => {
    const paths = new Set(allPrerenderRoutes().map((r) => r.path));
    for (const p of [
      "/explore/aapl",
      "/es/explore/aapl",
      "/en/explore/aapl",
      "/es/explore/jpm",
      "/en/explore/jpm",
      "/explore/compare/aapl-vs-msft",
      "/es/explore/compare/aapl-vs-msft",
      "/en/explore/compare/aapl-vs-msft",
    ]) {
      expect(paths.has(p), `${p} must be prerendered`).toBe(true);
    }
  });

  it("renders a 404 page so unknown URLs can answer 404", () => {
    expect(allPrerenderRoutes().some((r) => r.notFound)).toBe(true);
  });

  it("does not prerender a page that is not indexable", () => {
    // Everything rendered is either in a sitemap or the 404 page — no orphan
    // snapshots that Google could discover but no sitemap admits to.
    const indexable = new Set(urls.map((u) => u.loc.slice(BASE.length) || "/"));
    for (const r of allPrerenderRoutes()) {
      if (r.notFound) continue;
      expect(indexable.has(r.path), `${r.path} is prerendered but not in any sitemap`).toBe(true);
    }
  });
});

describe("research articles", () => {
  it("does not publish a variant in a language it is not written in", () => {
    // All four articles are authored in English; ca/es variants 301 to it.
    const articleUrls = urls.filter((u) => u.neutral.startsWith("/research/"));
    expect(articleUrls.length).toBeGreaterThan(0);
    for (const u of articleUrls) {
      expect(u.locale).toBe("en");
      expect(u.loc).toContain("/en/research/");
    }
  });

  it("301s every language an article is NOT written in", () => {
    // The contract that keeps the manifest and the edge in step: if an article
    // does not exist in a locale, that URL must redirect rather than render the
    // wrong language (or 404 a link Google already knows). Adding an article
    // without its redirects fails here.
    const manifest = JSON.parse(
      readFileSync(path.resolve(__dirname, "../data/research-articles.json"), "utf8"),
    ) as { slug: string; locales: string[] }[];
    const vercel = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"),
    ) as { redirects: { source: string; destination: string; permanent?: boolean }[] };

    for (const { slug, locales } of manifest) {
      const target = locales.includes("en") ? "en" : locales[0];
      for (const l of LOCALES) {
        if (locales.includes(l)) continue;
        const from = l === "ca" ? `/research/${slug}` : `/${l}/research/${slug}`;
        const rule = vercel.redirects.find((r) => r.source === from);
        expect(rule, `${from} is not written in ${l} and has no redirect`).toBeTruthy();
        expect(rule!.destination).toBe(
          target === "ca" ? `/research/${slug}` : `/${target}/research/${slug}`,
        );
        expect(rule!.permanent).toBe(true);
      }
      // …and the language it IS written in must never redirect.
      for (const l of locales) {
        const self = l === "ca" ? `/research/${slug}` : `/${l}/research/${slug}`;
        expect(vercel.redirects.some((r) => r.source === self)).toBe(false);
      }
    }
  });
});
