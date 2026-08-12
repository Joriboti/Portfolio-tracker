import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildRedirects, buildRewrites } from "../../scripts/gen-vercel.mjs";
import { ARTICLES, LOCALES, PREFIX, ROUTE_SLUGS } from "../../scripts/routes.mjs";

// Tests for the edge config: which URLs redirect, which reach the app, and
// which must 404. The bug these lock down: a locale/slug pair that is not a
// page (/es/dcf-calculator — Spanish prefix, English slug) matched a rewrite
// and answered 200 with the 5 kB generic Catalan shell.

const ROOT = path.resolve(__dirname, "../..");
const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  redirects: { source: string; destination: string; permanent?: boolean; has?: { type: string; key: string; value: string }[] }[];
  rewrites: { source: string; destination: string }[];
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
        wrong.push({ url: `${PREFIX[l]}${slug}`, expected: `${PREFIX[l]}${byLocale[l]}` });
      }
    }
  }

  it("covers the combinations reported from production", () => {
    const urls = wrong.map((w) => w.url);
    for (const u of [
      "/es/dcf-calculator",
      "/en/calculadora-dcf",
      "/es/reverse-dcf-calculator",
      "/en/dcf-inverso",
      "/es/graham-number-calculator",
      "/en/simulador-monte-carlo",
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
      for (const p of ["", "/es"]) {
        const r = follow(`${p}${slug}`);
        expect(r.status, `${p}${slug} should 404`).toBe(404);
      }
      expect(follow(`/en${slug}`).status).toBe(200);
    },
  );
});

describe("legacy ?lng= redirects", () => {
  const cases = [
    { from: "/research?lng=es", to: "/es/research" },
    { from: "/research?lng=en", to: "/en/research" },
    { from: "/explore/aapl?lng=en", to: "/en/explore/aapl" },
    { from: "/explore/aapl?lng=es", to: "/es/explore/aapl" },
    { from: "/taxes?lng=en", to: "/en/taxes" },
    { from: "/?lng=es", to: "/es" },
    { from: "/?lng=en", to: "/en" },
    // An article with no translation must reach its real language directly,
    // not via the locale it was asked for.
    { from: "/research/netflix?lng=es", to: "/en/research/netflix" },
    { from: "/research/exor?lng=es", to: "/en/research/exor" },
  ];

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
    const r = follow("/en/research/some-new-article");
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
