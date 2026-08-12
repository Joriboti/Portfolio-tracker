// Regenerates the `redirects` and `rewrites` blocks of vercel.json from the
// route inventory in scripts/routes.mjs.
//
// Why generated: vercel.json is static (Vercel reads it at build START, so it
// cannot be written by the build), yet it has to agree with ROUTE_SLUGS on
// every locale/slug pair. Hand-maintaining that meant /es/dcf-calculator and
// /en/calculadora-dcf — locale-and-slug combinations that are not pages —
// matched the catch-all rewrite and answered 200 with the 5 kB Catalan shell.
//
// Run `node scripts/gen-vercel.mjs` after touching ROUTE_SLUGS or the article
// manifest. `src/lib/vercel-config.test.ts` fails if the committed file differs
// from what this would produce, so it cannot drift.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARTICLES, LOCALES, PREFIX, ROUTE_SLUGS } from "./routes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "vercel.json");

/** Language-neutral public paths that exist under every locale, same slug. */
const SHARED = ["explore", "research", "forecast", "taxes", "radiografia", "disclaimer", "404"];

/** English-only landings (no ca/es equivalent — those locales must 404). */
const EN_ONLY = ["etf-growth-calculator", "portfolio-tracker"];

/** The authenticated app + auth flow: deliberately language-neutral. */
const APP = ["dashboard", "upload", "account", "auth", "debug", "verify", "how-to-prepare"];

const seg = (s) => s.replace(/^\//, "");

export function buildRedirects() {
  const out = [];

  // 1. Articles first, so a legacy ?lng= URL on an article reaches its real
  //    language in ONE hop instead of bouncing through the locale redirect.
  //    (/research/netflix?lng=es → /en/research/netflix, not → /es/… → /en/….)
  for (const { slug, locales } of ARTICLES) {
    const target = locales.includes("en") ? "en" : locales[0];
    for (const l of LOCALES) {
      if (locales.includes(l)) continue;
      out.push({
        source: `${PREFIX[l]}/research/${slug}`,
        destination: `${PREFIX[target]}/research/${slug}`,
        permanent: true,
      });
    }
  }

  // 2. Wrong locale/slug combinations → the same page's slug in the locale the
  //    visitor asked for. /es/dcf-calculator is Spanish + an English slug, so
  //    the honest answer is /es/calculadora-dcf, not a 404 and certainly not a
  //    Catalan shell.
  for (const id of Object.keys(ROUTE_SLUGS)) {
    const byLocale = ROUTE_SLUGS[id];
    const allSlugs = [...new Set(Object.values(byLocale))];
    for (const l of LOCALES) {
      for (const wrong of allSlugs) {
        if (wrong === byLocale[l]) continue;
        out.push({
          source: `${PREFIX[l]}${wrong}`,
          destination: `${PREFIX[l]}${byLocale[l]}`,
          permanent: true,
        });
      }
    }
  }

  // 3. Legacy ?lng= language switches → the path-prefixed URL. The negative
  //    lookahead stops the rule matching its own destination (Vercel copies the
  //    request's query string onto the Location, so without it /es/research?lng=es
  //    would match again and loop).
  //
  //    KNOWN LIMITATION: that same copying means the Location still carries
  //    ?lng=. Vercel's static config has no way to drop a query parameter — the
  //    only mechanisms are a named `has` capture (which puts the value back into
  //    the destination) or Middleware. The parameter is inert for indexing: the
  //    destination's canonical is clean and self-referencing (verified in
  //    production: /es/research?lng=es canonicalises to /es/research), which is
  //    what Google consolidates on. See SEO_ARCHITECTURE.md.
  for (const l of ["es", "en"]) {
    out.push({
      source: "/",
      has: [{ type: "query", key: "lng", value: l }],
      destination: PREFIX[l],
      permanent: true,
    });
    out.push({
      source: `/:path((?!es/|en/|es$|en$).*)`,
      has: [{ type: "query", key: "lng", value: l }],
      destination: `${PREFIX[l]}/:path`,
      permanent: true,
    });
  }

  return out;
}

export function buildRewrites() {
  const group = (locale) => {
    const slugs = [
      ...SHARED,
      ...Object.keys(ROUTE_SLUGS).map((id) => seg(ROUTE_SLUGS[id][locale])),
      ...(locale === "en" ? EN_ONLY : []),
    ];
    return [...new Set(slugs)].join("|");
  };

  const rules = [
    { source: "/", destination: "/app.html" },
    { source: "/:locale(es|en)", destination: "/app.html" },
  ];
  // One group PER LOCALE, listing only that locale's own slugs. A shared
  // "(es|en)" group would make /es/dcf-calculator a 200 again.
  for (const l of LOCALES) {
    const p = PREFIX[l];
    rules.push({ source: `${p}/:seg(${group(l)})`, destination: "/app.html" });
    rules.push({ source: `${p}/:seg(${group(l)})/:rest*`, destination: "/app.html" });
  }
  rules.push({ source: `/:seg(${APP.join("|")})`, destination: "/app.html" });
  rules.push({ source: `/:seg(${APP.join("|")})/:rest*`, destination: "/app.html" });
  return rules;
}

export function buildConfig(current) {
  return { ...current, redirects: buildRedirects(), rewrites: buildRewrites() };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const current = JSON.parse(readFileSync(FILE, "utf8"));
  const next = buildConfig(current);
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(
    `[vercel] ${next.redirects.length} redirects, ${next.rewrites.length} rewrites → vercel.json`,
  );
}
