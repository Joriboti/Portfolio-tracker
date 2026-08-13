import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BASE, allIndexableUrls } from "../../scripts/routes.mjs";

// Asserts what a crawler that does NOT run JavaScript actually receives for a
// representative sample of URLs — read straight out of dist/ after a build.
//
// This is the suite that would have caught the production bug: /es/explore/aapl
// answered with a 5 kB Catalan SPA shell (lang="ca", generic title, no
// canonical, no content) while /explore/aapl served 90 kB of prerendered HTML.
//
// Requires a build. `npm run test:seo` does both; a plain `npm test` skips this
// file rather than failing on a missing dist/, so unit tests stay fast.

const DIST = path.resolve(__dirname, "../../dist");
const built = existsSync(path.join(DIST, "index.html"));

/** The file Vercel serves for `urlPath`, or null if nothing is prerendered. */
function fileFor(urlPath: string): string | null {
  const rel = urlPath === "/" ? "index.html" : path.join(urlPath, "index.html");
  const p = path.join(DIST, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

const attr = (html: string, re: RegExp) => html.match(re)?.[1] ?? null;
const title = (h: string) => attr(h, /<title>([\s\S]*?)<\/title>/);
const htmlLang = (h: string) => attr(h, /<html[^>]*\slang="([^"]*)"/);
const description = (h: string) =>
  attr(h, /<meta[^>]*name="description"[^>]*content="([^"]*)"/) ??
  attr(h, /<meta[^>]*content="([^"]*)"[^>]*name="description"/);
const canonicals = (h: string) => [
  ...h.matchAll(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/g),
].map((m) => m[1]);
const hreflangs = (h: string) =>
  [...h.matchAll(/<link[^>]*rel="alternate"[^>]*hreflang="([^"]*)"[^>]*href="([^"]*)"/g)].map(
    (m) => ({ hreflang: m[1], href: m[2] }),
  );
const h1s = (h: string) =>
  [...h.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );
/** Internal hrefs, excluding assets and external links. */
const internalLinks = (h: string) =>
  [...h.matchAll(/<a[^>]*href="(\/[^"]*)"/g)]
    .map((m) => m[1])
    .filter((l) => !/\.(png|svg|jpg|webp|ico|xml|txt|js|css)$/.test(l));

// The generic Catalan shell's title — its presence under /es or /en is the
// signature of the bug.
const SHELL_TITLE_FRAGMENT = "Seguidor de cartera i calculadores";

// A representative sample: the URLs the audit named, plus one of each kind.
const SAMPLE = [
  { url: "/", lang: "ca" },
  { url: "/es", lang: "es" },
  { url: "/en", lang: "en" },
  { url: "/explore/aapl", lang: "ca" },
  { url: "/es/explore/aapl", lang: "es" },
  { url: "/en/explore/aapl", lang: "en" },
  { url: "/es/explore/jpm", lang: "es" },
  { url: "/en/explore/jpm", lang: "en" },
  { url: "/explore/compare/aapl-vs-msft", lang: "ca" },
  { url: "/es/explore/compare/aapl-vs-msft", lang: "es" },
  { url: "/en/explore/compare/aapl-vs-msft", lang: "en" },
  { url: "/en/research/netflix", lang: "en" },
  { url: "/calculadora-dcf", lang: "ca" },
  { url: "/es/calculadora-dcf", lang: "es" },
  { url: "/en/dcf-calculator", lang: "en" },
  { url: "/es/taxes", lang: "es" },
  { url: "/en/fifo-capital-gains-calculator", lang: "en" },
];

describe.skipIf(!built)("prerendered HTML (no JavaScript)", () => {
  it.each(SAMPLE)("$url is prerendered, not the SPA shell", ({ url }) => {
    const html = fileFor(url);
    expect(html, `${url} has no prerendered file — it would serve the SPA shell`).toBeTruthy();
    // The shell is ~5 kB; a real page is an order of magnitude larger.
    expect(html!.length).toBeGreaterThan(15000);
  });

  it.each(SAMPLE)("$url declares lang=$lang", ({ url, lang }) => {
    expect(htmlLang(fileFor(url)!)).toBe(lang);
  });

  it.each(SAMPLE)("$url has a specific, non-shell title", ({ url }) => {
    const t = title(fileFor(url)!);
    expect(t, `${url} has no <title>`).toBeTruthy();
    expect(t!.length).toBeGreaterThan(10);
    expect(t, `${url} is serving the generic Catalan shell title`).not.toContain(
      SHELL_TITLE_FRAGMENT,
    );
  });

  it.each(SAMPLE)("$url has a specific meta description", ({ url }) => {
    const d = description(fileFor(url)!);
    expect(d, `${url} has no meta description`).toBeTruthy();
    expect(d!.length).toBeGreaterThan(30);
  });

  it.each(SAMPLE)("$url has exactly one self-referencing canonical", ({ url }) => {
    const found = canonicals(fileFor(url)!);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(`${BASE}${url === "/" ? "/" : url}`);
  });

  it.each(SAMPLE)("$url has a complete, self-including hreflang set", ({ url, lang }) => {
    const alts = hreflangs(fileFor(url)!);
    expect(alts.length).toBeGreaterThanOrEqual(2); // at least self + x-default
    const self = alts.find((a) => a.hreflang === lang);
    expect(self?.href, `${url} does not name itself in hreflang`).toBe(
      `${BASE}${url === "/" ? "/" : url}`,
    );
    expect(alts.filter((a) => a.hreflang === "x-default")).toHaveLength(1);
    for (const a of alts) expect(a.href.startsWith(`${BASE}/`)).toBe(true);
  });

  it.each(SAMPLE)("$url has an H1 and body content", ({ url }) => {
    const html = fileFor(url)!;
    const heads = h1s(html);
    expect(heads.length, `${url} has no <h1>`).toBeGreaterThanOrEqual(1);
    expect(heads[0].length).toBeGreaterThan(2);
    const root = html.match(/<div id="root">([\s\S]*)<\/div>/)?.[1] ?? "";
    expect(root.length, `${url} has an empty #root`).toBeGreaterThan(2000);
  });

  it.each(SAMPLE.filter((s) => s.lang !== "ca"))(
    "$url keeps its language in internal links",
    ({ url, lang }) => {
      const links = internalLinks(fileFor(url)!);
      expect(links.length).toBeGreaterThan(3);
      // Public links must carry the prefix; app/auth links deliberately do not.
      const APP = /^\/(dashboard|upload|account|auth|debug|verify|how-to-prepare)(\/|$|\?)/;
      // The one legitimate cross-language link: a research article that exists
      // only in English. Pointing a Spanish reader at /es/research/netflix would
      // just bounce them through a 301 to the English original, so the listing
      // links straight to the language the article is actually written in.
      const ARTICLE = /^\/(es|en)?\/?research\/[^/]+$/;
      const leaked = links.filter(
        (l) => !APP.test(l) && !ARTICLE.test(l) && !l.startsWith(`/${lang}`),
      );
      expect(leaked, `${url} links to other-language URLs: ${leaked.join(", ")}`).toEqual([]);
    },
  );

  it.each(SAMPLE.filter((s) => s.lang !== "ca"))(
    "$url never links to a Catalan-root public page",
    ({ url, lang }) => {
      // The narrower, unambiguous half of the rule above: no link may drop the
      // prefix entirely and land on the ca tree. This is the leak that used to
      // send every /es and /en page's authority to the Catalan URLs.
      const APP = /^\/(dashboard|upload|account|auth|debug|verify|how-to-prepare)(\/|$|\?)/;
      const bare = internalLinks(fileFor(url)!).filter(
        (l) => !APP.test(l) && !/^\/(es|en)(\/|$)/.test(l),
      );
      expect(bare, `${url} links to unprefixed (Catalan) URLs: ${bare.join(", ")}`).toEqual([]);
      expect(lang).not.toBe("ca");
    },
  );

  it.each(SAMPLE)("$url has no ?lng= link", ({ url }) => {
    expect(fileFor(url)!).not.toContain("lng=");
  });

  it("hreflang in the HTML agrees with the sitemap, for every URL", () => {
    // Canonical ↔ sitemap ↔ requested URL must be one and the same.
    const bySitemap = allIndexableUrls({});
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const u of bySitemap) {
      const p = u.loc.slice(BASE.length) || "/";
      const html = fileFor(p);
      if (!html) {
        missing.push(p);
        continue;
      }
      if (canonicals(html)[0] !== u.loc) mismatched.push(p);
      const alts = hreflangs(html)
        .map((a) => `${a.hreflang}=${a.href}`)
        .sort();
      const want = u.alternates.map((a) => `${a.hreflang}=${a.href}`).sort();
      if (alts.join("|") !== want.join("|")) mismatched.push(`${p} (hreflang)`);
    }
    expect(missing, "sitemapped URLs with no prerendered file").toEqual([]);
    expect(mismatched.slice(0, 20), "canonical/hreflang disagree with the sitemap").toEqual([]);
  });

  it("serves a 404 body for unknown URLs, and never indexes it", () => {
    const p = path.join(DIST, "404.html");
    expect(existsSync(p), "dist/404.html is required for Vercel to answer 404").toBe(true);
    const html = readFileSync(p, "utf8");
    expect(html).toMatch(/name="robots"[^>]*content="noindex/);
    expect(title(html)).not.toContain(SHELL_TITLE_FRAGMENT);
    expect(h1s(html).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the SPA shell itself clean and free of a canonical", () => {
    // app.html is the fallback for client-only routes; if it carried a canonical
    // it would claim to be whatever page it was serving. That was the 2026-07-14
    // bug where every non-prerendered URL claimed to be the homepage.
    const shell = readFileSync(path.join(DIST, "app.html"), "utf8");
    expect(canonicals(shell)).toEqual([]);
    expect(shell.length).toBeLessThan(15000);
  });
});

// ---------------------------------------------------------------------------
// Language leaks
// ---------------------------------------------------------------------------
// A page can be perfectly canonicalised and still ship the wrong language in
// its body: hardcoded Catalan on the /es landing, English calculator labels on
// /calculadora-dcf. These read the built HTML — the exact bytes a crawler gets —
// and fail on any marker that belongs to another language.

/** Markers that can only be Catalan / English UI copy, never a proper noun. */
const CATALAN_MARKERS = [
  "La meva cartera",
  "Anàlisis recents",
  "Veure totes les anàlisis",
  "P&L no realitzat",
  "Sis eines",
  "Comprovant el símbol",
];
const ENGLISH_MARKERS = [
  "Forward EPS / FCF per share",
  "Fair value today",
  "Exit P/E multiple",
  "Required return",
  "Annual growth",
  "Upside vs. price",
  "Graham number (intrinsic value)",
  "P50 (median fair value)",
];

/** Pages that render the shared calculator widgets, per locale. */
const CALCULATOR_URLS: Record<"es" | "en", string[]> = {
  es: ["/es/calculadora-dcf", "/es/dcf-inverso", "/es/numero-de-graham", "/es/simulador-monte-carlo"],
  en: ["/en/dcf-calculator", "/en/reverse-dcf-calculator", "/en/graham-number-calculator"],
};

describe.skipIf(!built)("no language leaks in the built HTML", () => {
  const SPANISH_PAGES = ["/es", "/es/research", ...CALCULATOR_URLS.es];
  const ENGLISH_PAGES = ["/en", "/en/research", ...CALCULATOR_URLS.en];

  it.each(SPANISH_PAGES)("%s ships no Catalan UI copy", (url) => {
    const html = fileFor(url);
    expect(html, `${url} is not prerendered`).toBeTruthy();
    const found = CATALAN_MARKERS.filter((m) => html!.includes(m));
    expect(found, `${url} leaks Catalan`).toEqual([]);
  });

  it.each(ENGLISH_PAGES)("%s ships no Catalan UI copy", (url) => {
    const html = fileFor(url);
    expect(html, `${url} is not prerendered`).toBeTruthy();
    const found = CATALAN_MARKERS.filter((m) => html!.includes(m));
    expect(found, `${url} leaks Catalan`).toEqual([]);
  });

  it.each(CALCULATOR_URLS.es)("%s ships no English calculator labels", (url) => {
    const html = fileFor(url);
    expect(html, `${url} is not prerendered`).toBeTruthy();
    const found = ENGLISH_MARKERS.filter((m) => html!.includes(m));
    expect(found, `${url} leaks English`).toEqual([]);
  });

  it("still renders the calculators in the language of the URL", () => {
    // Guard against "fixed the leak by deleting the widget".
    expect(fileFor("/es/calculadora-dcf")).toContain("Valor razonable hoy");
    expect(fileFor("/calculadora-dcf")).toContain("Valor raonable avui");
    expect(fileFor("/en/dcf-calculator")).toContain("Fair value today");
  });

  it("localises the landing's dashboard preview", () => {
    expect(fileFor("/")).toContain("La meva cartera");
    expect(fileFor("/es")).toContain("Mi cartera");
    expect(fileFor("/en")).toContain("My portfolio");
  });
});

describe.skipIf(!built)("trust pages", () => {
  const PAGES = [
    { url: "/sobre-trimmtrack", lang: "ca" },
    { url: "/es/sobre-trimmtrack", lang: "es" },
    { url: "/en/about", lang: "en" },
    { url: "/privacitat", lang: "ca" },
    { url: "/es/privacidad", lang: "es" },
    { url: "/en/privacy", lang: "en" },
    { url: "/termes", lang: "ca" },
    { url: "/es/terminos", lang: "es" },
    { url: "/en/terms", lang: "en" },
  ];

  it.each(PAGES)("$url is real prerendered HTML in $lang", ({ url, lang }) => {
    const html = fileFor(url);
    expect(html, `${url} is not prerendered`).toBeTruthy();
    expect(htmlLang(html!)).toBe(lang);
    expect(title(html!)).not.toContain(SHELL_TITLE_FRAGMENT);
    expect(h1s(html!).length).toBeGreaterThanOrEqual(1);
    expect(canonicals(html!)).toEqual([`${BASE}${url}`]);
    // Reciprocal hreflang: three languages plus x-default.
    expect(hreflangs(html!).map((a) => a.hreflang).sort()).toEqual([
      "ca",
      "en",
      "es",
      "x-default",
    ]);
  });

  it("is linked from every page's footer", () => {
    const html = fileFor("/en/about")!;
    expect(internalLinks(html)).toEqual(expect.arrayContaining(["/en/about", "/en/privacy", "/en/terms"]));
    expect(html).toContain('href="https://x.com/trimmtrack"');
    expect(html).toContain('rel="me noopener noreferrer"');
  });
});
