import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ROUTE_SLUGS,
  isLocalizable,
  localeFromPath,
  localeUrl,
  stripLocale,
  withLocale,
  type Locale,
} from "./locale";
import { ROUTE_SLUGS as SCRIPT_SLUGS, localePath } from "../../scripts/routes.mjs";

// Unit tests for the URL layer. Every localized link, canonical, hreflang,
// sitemap entry and router path is derived from these functions, so a bug here
// is a site-wide SEO bug — which is exactly what happened before: the ticker
// pages' /es and /en URLs were advertised but never built.

describe("localeFromPath", () => {
  it("reads the prefix, defaulting to Catalan", () => {
    expect(localeFromPath("/")).toBe("ca");
    expect(localeFromPath("/explore/aapl")).toBe("ca");
    expect(localeFromPath("/es")).toBe("es");
    expect(localeFromPath("/es/explore/aapl")).toBe("es");
    expect(localeFromPath("/en/research/netflix")).toBe("en");
  });

  it("does not mistake a page whose slug starts like a locale", () => {
    // "/esquema" must not read as Spanish.
    expect(localeFromPath("/esquema")).toBe("ca");
    expect(localeFromPath("/entrada")).toBe("ca");
  });
});

describe("stripLocale", () => {
  it("removes only a real prefix", () => {
    expect(stripLocale("/es/taxes")).toBe("/taxes");
    expect(stripLocale("/en")).toBe("/");
    expect(stripLocale("/es")).toBe("/");
    expect(stripLocale("/taxes")).toBe("/taxes");
    expect(stripLocale("/entrada")).toBe("/entrada");
  });
});

describe("withLocale", () => {
  it("prefixes non-default locales and leaves Catalan bare", () => {
    expect(withLocale("/explore", "ca")).toBe("/explore");
    expect(withLocale("/explore", "es")).toBe("/es/explore");
    expect(withLocale("/explore", "en")).toBe("/en/explore");
    expect(withLocale("/", "ca")).toBe("/");
    expect(withLocale("/", "es")).toBe("/es");
  });

  it("is idempotent and round-trips between locales", () => {
    expect(withLocale("/es/explore/aapl", "en")).toBe("/en/explore/aapl");
    expect(withLocale("/en/explore/aapl", "ca")).toBe("/explore/aapl");
    expect(withLocale("/es/taxes", "es")).toBe("/es/taxes");
  });

  it("translates slugs that differ per locale, in either direction", () => {
    expect(withLocale("/calculadora-dcf", "en")).toBe("/en/dcf-calculator");
    expect(withLocale("/en/dcf-calculator", "es")).toBe("/es/calculadora-dcf");
    expect(withLocale("/dcf-invers", "es")).toBe("/es/dcf-inverso");
    expect(withLocale("/es/dcf-inverso", "ca")).toBe("/dcf-invers");
    // The FIFO page: one page, an English keyword slug and a Catalan one.
    expect(withLocale("/calculadora-fifo", "en")).toBe(
      "/en/fifo-capital-gains-calculator",
    );
    expect(withLocale("/en/fifo-capital-gains-calculator", "ca")).toBe(
      "/calculadora-fifo",
    );
  });

  it("leaves app and auth paths language-neutral", () => {
    for (const p of ["/dashboard", "/upload", "/account", "/auth/sign-in", "/verify/abc"]) {
      expect(withLocale(p, "es")).toBe(p);
      expect(withLocale(p, "en")).toBe(p);
    }
  });

  it("preserves the query string and hash", () => {
    expect(withLocale("/explore/aapl?s=abc", "es")).toBe("/es/explore/aapl?s=abc");
    expect(withLocale("/taxes#report", "en")).toBe("/en/taxes#report");
    expect(withLocale("/auth/sign-in?next=/dashboard", "es")).toBe(
      "/auth/sign-in?next=/dashboard",
    );
  });
});

describe("localeUrl", () => {
  it("builds absolute, trailing-slash-free canonicals", () => {
    expect(localeUrl("/", "ca")).toBe("https://www.trimmtrack.com/");
    expect(localeUrl("/", "es")).toBe("https://www.trimmtrack.com/es");
    expect(localeUrl("/explore/aapl", "en")).toBe(
      "https://www.trimmtrack.com/en/explore/aapl",
    );
  });

  it("is self-referencing: the canonical of a URL is that URL", () => {
    for (const p of ["/", "/explore", "/es/taxes", "/en/explore/aapl", "/es/calculadora-dcf"]) {
      const locale = localeFromPath(p);
      expect(localeUrl(p, locale)).toBe(
        `https://www.trimmtrack.com${p === "/" ? "/" : p}`,
      );
    }
  });
});

describe("isLocalizable", () => {
  it("separates public content from the app", () => {
    expect(isLocalizable("/explore")).toBe(true);
    expect(isLocalizable("/research/netflix")).toBe(true);
    expect(isLocalizable("/dashboard")).toBe(false);
    expect(isLocalizable("/auth/sign-in")).toBe(false);
    expect(isLocalizable("/verify/xyz")).toBe(false);
  });

  it("does not treat a public slug as an app path by prefix collision", () => {
    // "/uploads-guide" is not "/upload".
    expect(isLocalizable("/uploads-guide")).toBe(true);
    expect(isLocalizable("/accounting")).toBe(true);
  });
});

describe("the build scripts agree with the app", () => {
  // scripts/routes.mjs has to restate the slug table because the sitemap
  // generators and the prerenderer are plain .mjs and cannot import the .ts
  // module. This test is what keeps the copy honest — the drift it guards
  // against is precisely the class of bug being fixed.
  it("scripts/routes.mjs mirrors ROUTE_SLUGS exactly", () => {
    expect(SCRIPT_SLUGS).toEqual(ROUTE_SLUGS);
  });

  it("localePath() agrees with withLocale() for every route slug", () => {
    const locales: Locale[] = ["ca", "es", "en"];
    const neutrals = [
      "/",
      "/explore",
      "/research",
      "/taxes",
      "/forecast",
      "/radiografia",
      "/disclaimer",
      "/explore/aapl",
      "/explore/compare/aapl-vs-msft",
      ...Object.values(ROUTE_SLUGS).flatMap((m) => Object.values(m)),
    ];
    for (const n of neutrals) {
      for (const l of locales) {
        expect(localePath(n, l)).toBe(withLocale(n, l));
      }
    }
  });

  it("vercel.json rewrites cover every localized slug", () => {
    const vercel = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"),
    );
    const sources: string = vercel.rewrites.map((r: { source: string }) => r.source).join(" ");
    // A slug missing from the rewrite list 404s the moment its prerender fails.
    for (const byLocale of Object.values(ROUTE_SLUGS)) {
      for (const slug of Object.values(byLocale)) {
        expect(sources).toContain(slug.slice(1));
      }
    }
  });

  it("vercel.json ?lng= redirects cannot loop", () => {
    const vercel = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"),
    );
    const lng = vercel.redirects.filter((r: { has?: { key: string }[] }) =>
      r.has?.some((h) => h.key === "lng"),
    );
    expect(lng.length).toBeGreaterThan(0);
    for (const r of lng) {
      expect(r.permanent).toBe(true);
      // Vercel forwards the query string to the destination, so the source must
      // exclude the destination's own prefix or the redirect matches itself.
      const target = r.destination.split("/")[1];
      if (r.source !== "/") {
        expect(r.source).toContain(`(?!`);
        expect(r.source).toContain(`${target}/`);
      }
    }
  });
});
