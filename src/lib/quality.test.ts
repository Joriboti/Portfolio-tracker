import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ca from "@/locales/ca.json";
import es from "@/locales/es.json";
import en from "@/locales/en.json";
import manifest from "@/data/research-articles.json";
import { normalizeArticleLink, isBadInternalLink } from "@/lib/article-links";
import { OG_IMAGE, SAME_AS, X_URL, shareOnX } from "@/lib/brand";
import { ROUTE_SLUGS, localeUrl } from "@/lib/locale";
import { buildHeaders } from "../../scripts/gen-vercel.mjs";

// Quality gates for the things a human reviewer keeps having to re-check:
// translation parity, language leaks, internal-link hygiene, the brand's one
// official profile, and the edge headers. Everything here is source- or
// config-level, so it runs in a plain `npm test` with no build.

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/**
 * Source with comments stripped. Several of these gates forbid a shape that the
 * code comments legitimately name while explaining why it is forbidden, so
 * matching raw text would make an accurate comment fail the build.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

type Json = Record<string, unknown>;
function flatten(o: Json, prefix = ""): [string, string][] {
  return Object.entries(o).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Json, key)
      : ([[key, String(v)]] as [string, string][]);
  });
}
const placeholders = (s: string) => (s.match(/\{\{[^}]+\}\}/g) ?? []).sort().join(",");

const FLAT = {
  ca: new Map(flatten(ca as Json)),
  es: new Map(flatten(es as Json)),
  en: new Map(flatten(en as Json)),
};

describe("locale parity", () => {
  it.each(["es", "en"] as const)("%s has exactly the keys ca has", (lng) => {
    const missing = [...FLAT.ca.keys()].filter((k) => !FLAT[lng].has(k));
    const extra = [...FLAT[lng].keys()].filter((k) => !FLAT.ca.has(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it.each(["es", "en"] as const)("%s uses the same interpolations as ca", (lng) => {
    const mismatched = [...FLAT.ca.entries()]
      .filter(([k, v]) => FLAT[lng].has(k) && placeholders(v) !== placeholders(FLAT[lng].get(k)!))
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it("never leaves a value empty", () => {
    for (const lng of ["ca", "es", "en"] as const) {
      const blank = [...FLAT[lng].entries()].filter(([, v]) => v.trim() === "").map(([k]) => k);
      expect(blank, `${lng} has empty strings`).toEqual([]);
    }
  });
});

describe("no hardcoded UI copy left in the components", () => {
  // The literals an audit found rendered in the wrong language. Each one moved
  // into the locale files; this fails if one is pasted back into a component.
  const BANNED: { file: string; literals: string[] }[] = [
    {
      file: "src/pages/home.tsx",
      literals: [
        "La meva cartera",
        "Valor total",
        "P&L no realitzat",
        "TIR anual",
        "Anàlisis recents",
        "Veure totes les anàlisis",
      ],
    },
    {
      file: "src/components/tools/calculators.tsx",
      literals: [
        'label="Forward EPS',
        'label="Annual growth"',
        'label="Fair value today"',
        'label="Required return"',
        'label="Exit P/E multiple"',
        'label="Current price"',
        'label="Expected growth"',
        "P50 (median fair value)",
      ],
    },
  ];

  it.each(BANNED)("$file renders no hardcoded label", ({ file, literals }) => {
    const src = read(file);
    for (const lit of literals) {
      expect(src.includes(lit), `${file} still hardcodes "${lit}"`).toBe(false);
    }
  });

  // Matched as patterns rather than raw substrings on purpose: the first
  // attempt at the footer fix used "\n" against a CRLF file, silently replaced
  // nothing, and shipped — a substring assertion written the same way would
  // have passed too.
  const BANNED_PATTERNS: { file: string; patterns: RegExp[] }[] = [
    { file: "src/components/Layout.tsx", patterns: [/>\s*Disclaimer\s*</] },
    {
      file: "src/pages/upload.tsx",
      patterns: [/<th>\s*Ticker\s*<\/th>/, /<th>\s*Shares\s*<\/th>/, /<th>\s*Buy price\s*<\/th>/],
    },
    { file: "src/pages/dashboard.tsx", patterns: [/<td>\s*Total\s*<\/td>/] },
    {
      file: "src/components/CompanyOverview.tsx",
      patterns: [/aria-label="Close"/],
    },
    { file: "src/pages/taxes.tsx", patterns: [/aria-label="progress"/] },
  ];

  it.each(BANNED_PATTERNS)("$file renders no hardcoded text node", ({ file, patterns }) => {
    const src = read(file);
    for (const re of patterns) {
      expect(re.test(src), `${file} still hardcodes ${re}`).toBe(false);
    }
  });

  it("keeps the six-tool count honest in every language", () => {
    // The showcase renders six cards; the copy used to say five.
    const cards = [...read("src/pages/home.tsx").matchAll(/key: "(\w+)", to:/g)].length;
    expect(cards).toBe(6);
    expect(FLAT.ca.get("home.tools.intro")).toContain("Sis");
    expect(FLAT.es.get("home.tools.intro")).toContain("Seis");
    expect(FLAT.en.get("home.tools.intro")).toContain("Six");
  });

  it("has the calculator vocabulary in all three languages", () => {
    const calcKeys = [...FLAT.ca.keys()].filter((k) => k.startsWith("calc."));
    expect(calcKeys.length).toBeGreaterThan(25);
    for (const k of calcKeys) {
      expect(FLAT.es.get(k), `${k} missing in es`).toBeTruthy();
      expect(FLAT.en.get(k), `${k} missing in en`).toBeTruthy();
      // A translation that is identical in ca and es is usually an untranslated
      // paste; allow it only for the handful that genuinely coincide.
      const same = FLAT.ca.get(k) === FLAT.es.get(k);
      if (same) expect(["calc.fields.years", "calc.stats.p90"]).toContain(k);
    }
  });
});

describe("qualitative commentary never falls back to Catalan", () => {
  const core = read("api/_research-core.ts");
  const component = read("src/components/CompanyInsights.tsx");

  it("reads per-locale Notion columns", () => {
    expect(core).toContain("INSIGHT_SUFFIX");
    expect(core).toMatch(/ca:\s*""/);
    expect(core).toMatch(/es:\s*"Es"/);
    expect(core).toMatch(/en:\s*"En"/);
  });

  it("asks for the reader's locale and reports whether Catalan exists", () => {
    expect(core).toContain("hasCatalan");
    expect(read("src/lib/research.ts")).toContain("locale=");
    expect(component).toContain("getInsights(ticker, locale)");
  });

  it("renders a localized notice instead of the Catalan text", () => {
    expect(component).toContain("insights.unavailable");
    expect(component).toContain("insights.viewCatalan");
    expect(FLAT.es.get("insights.unavailable")).toMatch(/español/i);
    expect(FLAT.en.get("insights.unavailable")).toMatch(/English/i);
  });

  it("never renders the Catalan original under another locale", () => {
    // The component must not reach for a ca-scoped fetch as a fallback.
    expect(component).not.toMatch(/getInsights\([^)]*["']ca["']/);
  });
});

describe("article cards", () => {
  type Entry = {
    slug: string;
    locales: string[];
    preview?: Record<string, { title: string; excerpt: string }>;
  };
  const entries = manifest as Entry[];

  it("translates the card for every language the article is not written in", () => {
    for (const e of entries) {
      for (const l of ["ca", "es", "en"]) {
        if (e.locales.includes(l)) continue;
        // English is the language every current article is written in; the ca/es
        // cards must be translated so a reader knows what they are clicking.
        if (l === "en") continue;
        expect(e.preview?.[l], `${e.slug} has no ${l} card copy`).toBeTruthy();
        expect(e.preview![l].title.length).toBeGreaterThan(5);
        expect(e.preview![l].excerpt.length).toBeGreaterThan(40);
      }
    }
  });

  it("never carries card copy for the language the article is written in", () => {
    for (const e of entries) {
      for (const l of e.locales) {
        expect(e.preview?.[l], `${e.slug} duplicates its ${l} CMS copy`).toBeFalsy();
      }
    }
  });

  it("labels the language the reader is about to land in", () => {
    for (const lng of ["ca", "es"] as const) {
      expect(FLAT[lng].get("research.availableIn")).toContain("{{lang}}");
    }
    for (const page of ["src/pages/home.tsx", "src/pages/research.tsx"]) {
      expect(read(page)).toContain("research.availableIn");
    }
  });
});

describe("internal links", () => {
  it("rewrites the links production reported", () => {
    expect(normalizeArticleLink("http://trimmtrack.com/explore")).toBe("/explore");
    expect(normalizeArticleLink("https://www.trimmtrack.com/explore")).toBe("/explore");
    expect(normalizeArticleLink("https://trimmtrack.com/es/explore")).toBe("/explore");
    expect(normalizeArticleLink("/en/research/meta")).toBe("/research/meta");
  });

  it("drops the legacy language parameter", () => {
    expect(normalizeArticleLink("https://www.trimmtrack.com/research?lng=es")).toBe("/research");
    expect(normalizeArticleLink("/taxes?lng=en&x=1")).toBe("/taxes?x=1");
  });

  it("leaves genuinely external links alone", () => {
    for (const href of [
      "https://finance.yahoo.com/quote/AAPL",
      "https://x.com/trimmtrack",
      "mailto:someone@example.com",
    ]) {
      expect(normalizeArticleLink(href)).toBeNull();
    }
  });

  it("does not rewrite static files", () => {
    expect(normalizeArticleLink("https://www.trimmtrack.com/og.png")).toBeNull();
    expect(normalizeArticleLink("/sitemap.xml")).toBeNull();
  });

  it("recognises the shapes that cost a redirect", () => {
    expect(isBadInternalLink("http://trimmtrack.com/explore")).toBe(true);
    expect(isBadInternalLink("https://trimmtrack.com/")).toBe(true);
    expect(isBadInternalLink("https://www.trimmtrack.com/explore?lng=es")).toBe(true);
    expect(isBadInternalLink("https://www.trimmtrack.com/en/explore")).toBe(false);
  });

  it("keeps ?lng= out of the source tree's own links", () => {
    const files = ["src/pages", "src/components"].flatMap((dir) =>
      readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => path.join(dir, f)),
    );
    const offenders = files.filter((f) => {
      const src = readCode(f);
      return /(to|href)=["'`][^"'`]*\?lng=/.test(src) || /http:\/\/(www\.)?trimmtrack/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe("brand identity", () => {
  it("has exactly one official profile", () => {
    expect(X_URL).toBe("https://x.com/trimmtrack");
    expect(SAME_AS).toEqual([X_URL]);
  });

  it("is linked from the footer with rel=me", () => {
    const layout = read("src/components/Layout.tsx");
    expect(layout).toContain("X_URL");
    expect(layout).toMatch(/rel="me noopener noreferrer"/);
    expect(layout).toContain("footer.xAria");
    for (const lng of ["ca", "es", "en"] as const) {
      expect(FLAT[lng].get("footer.xAria")).toContain("X");
    }
  });

  it("is declared as sameAs on the global Organization node", () => {
    const html = read("index.html");
    const graph = html.slice(html.indexOf('"@type": "Organization"'));
    expect(graph).toContain('"sameAs": ["https://x.com/trimmtrack"]');
  });

  it("builds share intents without any third-party script", () => {
    const url = localeUrl("/research/meta", "en");
    const intent = shareOnX(url, "Meta");
    expect(intent.startsWith("https://x.com/intent/post?")).toBe(true);
    expect(decodeURIComponent(intent)).toContain(url);
    expect(read("index.html")).not.toContain("platform.twitter.com");
  });
});

describe("article images stay on our own domain", () => {
  const src = read("src/pages/research-article.tsx");

  it("uses one self-hosted OG image", () => {
    expect(OG_IMAGE).toBe("https://www.trimmtrack.com/og.png");
    expect(src).toContain("image: OG_IMAGE");
    // The Notion cover may be an expiring S3 URL or a press site's image; it
    // renders in the page but must never be the OG/Schema image.
    expect(src).not.toMatch(/image:\s*article\.coverImage/);
    expect(src).not.toMatch(/image:\s*article\?\.coverImage/);
  });

  it("names the editorial author and the publisher", () => {
    expect(src).toContain("editorialName(locale)");
    expect(src).toContain("sameAs: SAME_AS");
    expect(src).toContain('"@type": "ImageObject"');
  });

  it("claims no modification date it cannot prove", () => {
    expect(readCode("src/pages/research-article.tsx")).not.toContain("dateModified");
  });
});

describe("edge headers", () => {
  const headers = buildHeaders();
  const find = (source: string) => headers.find((h) => h.source === source);

  it("noindexes every private route", () => {
    for (const p of ["auth", "dashboard", "upload", "account", "debug", "verify"]) {
      for (const source of [`/${p}`, `/${p}/:path*`]) {
        const rule = find(source);
        expect(rule, `${source} has no header rule`).toBeTruthy();
        expect(rule!.headers).toContainEqual({
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive",
        });
      }
    }
  });

  it("caches fingerprinted assets immutably", () => {
    expect(find("/assets/:path*")!.headers).toContainEqual({
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    });
  });

  it("sets the baseline security headers site-wide", () => {
    const keys = find("/(.*)")!.headers.map((h) => h.key);
    expect(keys).toEqual([
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "X-Frame-Options",
    ]);
  });

  it("is what vercel.json actually ships", () => {
    const vercel = JSON.parse(read("vercel.json")) as { headers: unknown };
    expect(vercel.headers).toEqual(headers);
  });

  it("no longer hides the private routes from robots.txt", () => {
    // A Disallow-ed URL is one Google may not fetch, so it can never read the
    // X-Robots-Tag that is now doing the work.
    const robots = read("public/robots.txt");
    for (const p of ["/dashboard", "/upload", "/account", "/debug"]) {
      expect(robots).not.toContain(`Disallow: ${p}`);
    }
    expect(robots).toContain("Sitemap: https://www.trimmtrack.com/sitemap.xml");
  });
});

describe("trust pages", () => {
  it("are routed in all three languages from one slug table", () => {
    for (const id of ["about", "privacy", "terms"] as const) {
      for (const l of ["ca", "es", "en"] as const) {
        expect(ROUTE_SLUGS[id][l].startsWith("/")).toBe(true);
      }
    }
    const app = read("src/App.tsx");
    for (const id of ["about", "privacy", "terms"]) {
      expect(app).toContain(`ROUTE_SLUGS.${id}[locale]`);
    }
  });

  it("carry no serverless function", () => {
    const routes = readdirSync(path.join(ROOT, "api")).filter(
      (f) => f.endsWith(".ts") && !f.startsWith("_") && !f.endsWith(".test.ts"),
    );
    // Vercel's Hobby plan caps a deployment at 12 functions; the trust pages are
    // static prose precisely so this number does not move.
    expect(routes).toHaveLength(12);
  });

  it("describe only behaviour that exists in the code", () => {
    const trust = readCode("src/pages/trust.tsx");
    // Guard against the boilerplate a privacy page usually accretes: none of
    // these can be demonstrated from this repository.
    for (const claim of ["GDPR", "RGPD", "ISO 27001", "end-to-end encrypt", "Supabase", "Sentry"]) {
      expect(trust.includes(claim), `trust.tsx claims "${claim}"`).toBe(false);
    }
    expect(read("src/pages/trust.tsx")).toContain("LEGAL REVIEW REQUIRED");
  });

  it("link the official profile as the contact channel", () => {
    const trust = read("src/pages/trust.tsx");
    expect(trust).toContain("X_URL");
    expect((trust.match(/Equip editorial|Equipo editorial|Editorial Team/g) ?? []).length).toBe(3);
  });
});
