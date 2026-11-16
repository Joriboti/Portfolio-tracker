import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildHeaders, buildRedirects, buildRewrites } from "../../scripts/gen-vercel.mjs";
import {
  ARTICLES,
  DEFAULT,
  LOCALES,
  PAIR_DATA,
  PREFIX,
  RENAMED_TICKERS,
  ROUTE_SLUGS,
  TICKER_DATA,
} from "../../scripts/routes.mjs";

// Tests for the edge config: which URLs redirect, which reach the app, and
// which must 404. The bug these lock down: a locale/slug pair that is not a
// page (/es/dcf-calculator — Spanish prefix, English slug) matched a rewrite
// and answered 200 with the 5 kB generic Catalan shell.
//
// Since 2026-09 English owns the bare path and Catalan lives under /ca; the
// "root swap" suite pins the 301s that carry every old URL to its new home.

/** Catalan slugs that used to live at the root and now 301 to /ca/<slug>. */
const LEGACY_CA_SLUGS = new Set(
  Object.values(ROUTE_SLUGS)
    .map((s) => s.ca)
    .filter((ca) => !Object.values(ROUTE_SLUGS).some((s) => s.en === ca)),
);

const ROOT = path.resolve(__dirname, "../..");
const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  redirects: { source: string; destination: string; permanent?: boolean; has?: { type: string; key: string; value: string }[] }[];
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

// --- a small resolver for Vercel's static routing ---------------------------
// Enough of path-to-regexp to evaluate the rules we actually write: literal
// paths, /:name(a|b) groups, /:rest* tails and one /:path(<regex>) capture.
function toRegExp(source: string): RegExp {
  let re = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch !== ":") {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
      continue;
    }
    i++; // past ':'
    let name = "";
    while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) name += source[i++];
    let pattern = "[^/]+";
    if (source[i] === "(") {
      let depth = 0;
      let raw = "";
      do {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") depth--;
        raw += source[i++];
      } while (i < source.length && depth > 0);
      pattern = raw.slice(1, -1);
    }
    if (source[i] === "*") {
      i++;
      re = re.replace(/\/$/, "");
      re += `(?:/(?<${name}>.*))?`;
    } else {
      re += `(?<${name}>${pattern})`;
    }
  }
  return new RegExp(`^${re}$`);
}

function fill(destination: string, groups: Record<string, string | undefined>): string {
  return destination.replace(/:([A-Za-z0-9_]+)\*?/g, (_m, n) => groups[n] ?? "");
}

type Res = { status: number; location?: string };

/** One pass of the redirect table over a path + query. */
function redirectOnce(pathname: string, query: Record<string, string>): Res | null {
  for (const r of vercel.redirects) {
    if (r.has?.some((h) => h.type !== "query" || query[h.key] !== h.value)) continue;
    const m = toRegExp(r.source).exec(pathname);
    if (!m) continue;
    let loc = fill(r.destination, m.groups ?? {}).replace(/\/{2,}/g, "/");
    if (loc === "") loc = "/";
    // Vercel copies the request's query string onto the Location.
    const qs = new URLSearchParams(query).toString();
    return { status: r.permanent ? 308 : 307, location: qs ? `${loc}?${qs}` : loc };
  }
  return null;
}

const matchesRewrite = (pathname: string) =>
  vercel.rewrites.some((r) => toRegExp(r.source).test(pathname));

/** The X-Robots-Tag the edge attaches to a path, if any. */
const xRobots = (pathname: string): string | null => {
  let value: string | null = null;
  for (const h of vercel.headers) {
    if (!toRegExp(h.source).test(pathname)) continue;
    for (const { key, value: v } of h.headers) if (key === "X-Robots-Tag") value = v;
  }
  return value;
};

/** Static files the build writes, i.e. every prerendered indexable page. */
const prerendered = new Set<string>();
{
  const { allIndexableUrls, BASE } = await import("../../scripts/routes.mjs");
  for (const u of allIndexableUrls({})) prerendered.add(u.loc.slice(BASE.length) || "/");
  for (const l of LOCALES) prerendered.add(`${PREFIX[l]}/404` || "/404");
}

/** Follow the chain the way a browser would, capped so a loop is detectable. */
function follow(url: string, max = 6) {
  const hops: string[] = [];
  let current = url;
  for (let n = 0; n <= max; n++) {
    const [p, q = ""] = current.split("?");
    const query = Object.fromEntries(new URLSearchParams(q));
    const r = redirectOnce(p, query);
    if (!r) {
      // No redirect: a static file (200), a rewrite to the SPA shell (200), or
      // nothing at all — which is Vercel's 404.html with a 404 status.
      const status = prerendered.has(p) ? 200 : matchesRewrite(p) ? 200 : 404;
      return { hops, final: current, status, servedByShell: !prerendered.has(p) && status === 200 };
    }
    hops.push(r.location!);
    current = r.location!;
  }
  return { hops, final: current, status: -1, servedByShell: false };
}

// ---------------------------------------------------------------------------

describe("vercel.json is generated, not hand-kept", () => {
  it("matches what scripts/gen-vercel.mjs produces", () => {
    // Run `node scripts/gen-vercel.mjs` after changing ROUTE_SLUGS or the
    // article manifest.
    expect(vercel.redirects).toEqual(buildRedirects());
    expect(vercel.rewrites).toEqual(buildRewrites());
    expect(vercel.headers).toEqual(buildHeaders());
  });
});

describe("wrong locale/slug combinations", () => {
  // Every slug of a translated page, under every locale it does NOT belong to.
  const wrong: { url: string; expected: string }[] = [];
  for (const id of Object.keys(ROUTE_SLUGS)) {
    const byLocale = ROUTE_SLUGS[id];
    for (const l of LOCALES) {
      for (const slug of new Set(Object.values(byLocale))) {
        if (slug === byLocale[l]) continue;
        // An old Catalan root slug is a migration redirect now (see below).
        if (l === DEFAULT && LEGACY_CA_SLUGS.has(slug)) continue;
        wrong.push({ url: `${PREFIX[l]}${slug}`, expected: `${PREFIX[l]}${byLocale[l]}` });
      }
    }
  }

  it("covers the combinations reported from production", () => {
    const urls = wrong.map((w) => w.url);
    for (const u of [
      "/es/dcf-calculator",
      "/ca/dcf-calculator",
      "/es/reverse-dcf-calculator",
      "/dcf-inverso",
      "/es/graham-number-calculator",
      "/ca/monte-carlo-stock-simulator",
    ]) {
      expect(urls, `${u} must be covered`).toContain(u);
    }
    expect(wrong.length).toBeGreaterThanOrEqual(18);
  });

  it.each(wrong)("$url → $expected in one hop", ({ url, expected }) => {
    const r = follow(url);
    expect(r.hops).toEqual([expected]);
    expect(r.status).toBe(200);
    expect(r.servedByShell, `${url} landed on the generic shell`).toBe(false);
  });

  it("never answers a wrong combination with a 200", () => {
    for (const { url } of wrong) {
      expect(matchesRewrite(url), `${url} still matches a rewrite → 200 shell`).toBe(false);
    }
  });
});

describe("English-only landings have no ca/es URL", () => {
  it.each(["/etf-growth-calculator", "/portfolio-tracker"])(
    "%s 404s under ca and es",
    (slug) => {
      for (const p of ["/ca", "/es"]) {
        const r = follow(`${p}${slug}`);
        expect(r.status, `${p}${slug} should 404`).toBe(404);
      }
      expect(follow(slug).status).toBe(200);
    },
  );
});

describe("legacy ?lng= redirects", () => {
  const cases = [
    { from: "/research?lng=es", to: "/es/research" },
    { from: "/research?lng=ca", to: "/ca/research" },
    { from: "/explore/aapl?lng=ca", to: "/ca/explore/aapl" },
    { from: "/explore/aapl?lng=es", to: "/es/explore/aapl" },
    { from: "/taxes?lng=ca", to: "/ca/taxes" },
    { from: "/?lng=es", to: "/es" },
    { from: "/?lng=ca", to: "/ca" },
  ];

  // An article with no translation is already at its real language on the
  // bare path: asking for ?lng=es must not bounce it through /es and back.
  it.each(["/research/netflix?lng=es", "/research/exor?lng=ca"])(
    "%s stays on the English article",
    (from) => {
      const r = follow(from);
      expect(r.hops).toEqual([]);
      expect(r.status).toBe(200);
    },
  );

  it.each(cases)("$from → $to in exactly one hop", ({ from, to }) => {
    const r = follow(from);
    expect(r.hops).toHaveLength(1);
    expect(r.hops[0].split("?")[0]).toBe(to);
    expect(r.status).toBe(200);
    expect(r.servedByShell).toBe(false);
  });

  it("never loops", () => {
    for (const { from } of cases) {
      const r = follow(from);
      expect(r.status, `${from} did not settle`).not.toBe(-1);
      expect(new Set(r.hops).size).toBe(r.hops.length);
    }
  });

  it("documents that Vercel copies ?lng= onto the Location", () => {
    // Not the behaviour we want, and not expressible in static config: the only
    // ways to drop a query param are a named `has` capture (which puts the value
    // back into the destination) or Middleware. It is inert for indexing — the
    // destination's canonical is clean and self-referencing — but if this ever
    // becomes strippable, this test is the one to flip.
    const r = follow("/research?lng=es");
    expect(r.hops[0]).toBe("/es/research?lng=es");
    const canonicalTarget = r.hops[0].split("?")[0];
    expect(prerendered.has(canonicalTarget)).toBe(true);
  });
});

describe("no route answers 200 with the generic shell", () => {
  it("every indexable URL is a real prerendered file", () => {
    for (const p of prerendered) {
      const r = follow(p);
      expect(r.hops, `${p} should not redirect`).toEqual([]);
      expect(r.status).toBe(200);
      expect(r.servedByShell, `${p} is served by the SPA shell`).toBe(false);
    }
  });

  it("unknown paths 404 instead of falling back to the shell", () => {
    for (const p of [
      "/nonexistent-page-xyz",
      "/es/pagina-que-no-existeix",
      "/en/nope",
      "/ca/nope",
      "/en/etf-growth",
      "/calculadora",
      "/es/radiografia-completa",
      // NOTE: /es/dcf-invers is NOT here — a ca slug under /es is a wrong
      // locale/slug pair, and those redirect (see the suite above) rather than
      // 404, because the visitor clearly wanted that page in Spanish.
    ]) {
      expect(follow(p).status, `${p} should 404`).toBe(404);
    }
  });

  it("keeps the client-only app routes reachable", () => {
    for (const p of ["/dashboard", "/upload", "/auth/sign-in", "/verify/abc", "/account"]) {
      const r = follow(p);
      expect(r.status, `${p} must reach the app`).toBe(200);
    }
  });

  it("keeps /research/:slug reachable for articles published since the deploy", () => {
    // A new Notion article must work without a redeploy.
    const r = follow("/research/some-new-article");
    expect(r.status).toBe(200);
  });
});

describe("article redirects", () => {
  it.each(ARTICLES)(
    "$slug redirects every language it is not written in",
    ({ slug, locales }) => {
      const target = locales.includes("en") ? "en" : locales[0];
      for (const l of LOCALES) {
        const url = `${PREFIX[l]}/research/${slug}`;
        const r = follow(url);
        if (locales.includes(l)) {
          expect(r.hops, `${url} is written in ${l} and must not redirect`).toEqual([]);
        } else {
          expect(r.hops).toEqual([`${PREFIX[target]}/research/${slug}`]);
        }
      }
    },
  );
});

describe("root swap (ca at / → en at /)", () => {
  // Every URL of the old layout reaches the same page, in the same language,
  // in ONE hop — so the signals Google collected for it move with it.
  it.each([
    ["/en", "/"],
    ["/en/dcf-calculator", "/dcf-calculator"],
    ["/en/research", "/research"],
    ["/en/research/netflix", "/research/netflix"],
    ["/en/explore/aapl", "/explore/aapl"],
    ["/en/fifo-capital-gains-calculator", "/fifo-capital-gains-calculator"],
    ["/en/portfolio-tracker", "/portfolio-tracker"],
    ["/calculadora-dcf", "/ca/calculadora-dcf"],
    ["/calculadora-fifo", "/ca/calculadora-fifo"],
    ["/dcf-invers", "/ca/dcf-invers"],
    ["/sobre-trimmtrack", "/ca/sobre-trimmtrack"],
    ["/privacitat", "/ca/privacitat"],
    ["/termes", "/ca/termes"],
  ])("%s → %s", (from, to) => {
    const r = follow(from);
    expect(r.hops).toEqual([to]);
    expect(r.status).toBe(200);
    expect(r.servedByShell, `${to} landed on the generic shell`).toBe(false);
  });

  it("covers every old Catalan root slug", () => {
    for (const slug of LEGACY_CA_SLUGS) {
      expect(follow(slug).hops).toEqual([`/ca${slug}`]);
    }
  });

  it("serves the Spanish tree unchanged", () => {
    for (const p of ["/es", "/es/calculadora-dcf", "/es/explore/aapl", "/es/taxes"]) {
      expect(follow(p).hops, `${p} must not move`).toEqual([]);
    }
  });
});

describe("pages below a leaf page do not exist", () => {
  // `/:seg(...)/:rest*` used to answer 200 with the shell for ANY path under
  // any page: a soft 404 carrying the home page's title.
  it.each([
    "/taxes/foo",
    "/dcf-calculator/foo",
    "/es/calculadora-dcf/x",
    "/ca/radiografia/extra",
    "/explore/aapl/extra",
    "/explore/compare/aapl-vs-msft/extra",
    "/research/netflix/extra",
    "/portfolio-tracker/x",
  ])("%s is a 404", (p) => {
    expect(follow(p).status).toBe(404);
  });

  it("still resolves any ticker, any pair and any article slug", () => {
    for (const p of [
      "/explore/zzzz",
      "/es/explore/zzzz",
      "/explore/compare/aapl-vs-zzzz",
      "/ca/explore/compare/zzzz-vs-aapl",
      "/research/some-new-article",
    ]) {
      expect(follow(p).status, `${p} must reach the app`).toBe(200);
    }
  });
});

describe("open-ended routes are noindex unless curated", () => {
  // /explore/:ticker and /explore/compare/:pair resolve any symbol. Only the
  // curated ones are prerendered; the rest are the SPA shell, whose HTML is a
  // 200 with the home page's title until JavaScript adds a noindex. The header
  // puts that in the response.
  const tickers = TICKER_DATA.map((t) => t.symbol.toLowerCase());
  const pairs = PAIR_DATA.map((p) => `${p.a.toLowerCase()}-vs-${p.b.toLowerCase()}`);

  it("never marks an indexable URL noindex", () => {
    for (const p of prerendered) {
      if (/\/404$/.test(p)) continue;
      expect(xRobots(p), `${p} is indexable but carries X-Robots-Tag`).toBeNull();
    }
  });

  it("covers every curated ticker and pair, dotted symbols included", () => {
    for (const l of LOCALES) {
      for (const t of tickers) expect(xRobots(`${PREFIX[l]}/explore/${t}`)).toBeNull();
      for (const p of pairs) expect(xRobots(`${PREFIX[l]}/explore/compare/${p}`)).toBeNull();
      expect(xRobots(`${PREFIX[l]}/explore/compare`), "the hub is a page").toBeNull();
      expect(xRobots(`${PREFIX[l]}/explore`)).toBeNull();
    }
    expect(tickers).toContain("air.pa");
  });

  it.each([
    "/explore/zzzz",
    "/explore/AAPL", // matching is case-sensitive; the app redirects to /explore/aapl
    "/explore/airxpa", // the dot in air.pa must be literal, not "any character"
    "/explore/aapl2",
    "/es/explore/zzzz",
    "/ca/explore/AIR.PA",
    "/explore/compare/msft-vs-aapl", // the reverse of a curated pair
    "/explore/compare/aapl-vs-zzzz",
    "/es/explore/compare/zzzz-vs-aapl",
  ])("%s is served noindex", (p) => {
    expect(follow(p).status).toBe(200);
    expect(xRobots(p)).toBe("noindex");
  });

  it("leaves the rest of the site alone", () => {
    for (const p of ["/", "/ca", "/es/taxes", "/research", "/research/netflix", "/dcf-calculator"]) {
      expect(xRobots(p)).toBeNull();
    }
    expect(xRobots("/dashboard")).toBe("noindex, nofollow, noarchive");
  });
});

describe("retired ticker symbols", () => {
  it.each(Object.entries(RENAMED_TICKERS))("%s → %s in every language, one hop", (from, to) => {
    for (const l of LOCALES) {
      const r = follow(`${PREFIX[l]}/explore/${from.toLowerCase()}`);
      expect(r.hops).toEqual([`${PREFIX[l]}/explore/${to.toLowerCase()}`]);
      expect(r.status).toBe(200);
      expect(r.servedByShell).toBe(false);
    }
  });
});

describe("/how-to-prepare", () => {
  it("is a real redirect to /upload, not a client-side one", () => {
    expect(follow("/how-to-prepare").hops).toEqual(["/upload"]);
  });
});
