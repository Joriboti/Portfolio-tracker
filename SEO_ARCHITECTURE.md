# Multilingual SEO architecture

How TrimmTrack serves three languages, and the rules that must hold. Written
because `vercel.json` is JSON and cannot carry comments, and because the failure
modes here are silent: nothing crashes, Google just quietly stops indexing.

## The model

Catalan is the default and lives at the bare path (`/`, `/explore`). Spanish and
English are mirrored under `/es/…` and `/en/…`. Every locale variant is a real
URL with its own prerendered HTML, its own `<html lang>`, its own
self-referencing canonical and a reciprocal hreflang cluster. `x-default` points
at English.

## Single sources of truth

| Concern | Owner |
| --- | --- |
| Locales, prefixes, per-locale slugs, URL building | `src/lib/locale.ts` |
| Locale-preserving links (`<LocaleLink>`, `useLocale`) | `src/components/LocaleLink.tsx` |
| Which URLs exist / are indexable (build time) | `scripts/routes.mjs` |
| Which languages each research article is written in | `src/data/research-articles.json` |
| Curated ticker + comparison pages | `src/data/tickers.json`, `src/data/compare-pairs.json` |
| ca/es tool-landing copy | `src/pages/tools-localized.tsx` |
| English tool-landing copy | `src/pages/en-tools.tsx` |

`scripts/routes.mjs` restates `ROUTE_SLUGS` because the sitemap generators and
the prerenderer are plain `.mjs`. **`src/lib/locale.test.ts` asserts the two are
identical** — that test is the only thing preventing the duplication from
rotting, so do not delete it.

## Rules that must hold

1. **Never hand-build a localized path.** Use `<LocaleLink>` / `withLocale()`.
   A bare `<Link to="/explore">` on a Spanish page points at the Catalan URL and
   leaks internal authority out of the `/es` tree.
2. **Anything in a sitemap must be prerendered, in its own language.** Both come
   from `allIndexableUrls()` / `allPrerenderRoutes()`, so this holds by
   construction; `src/lib/sitemap.test.ts` proves it.
3. **A page must exist in a language before hreflang claims it.** Pass
   `alternates` to `useSeo()` for anything not available in all three.
4. **Adding a public page** means: a route in `App.tsx` (via `publicRoutes`), an
   entry in `MULTILANG`/`EN_ONLY` in `scripts/routes.mjs`, a slug in the
   `vercel.json` rewrites if it is a new top-level path, and `useSeo()` with
   `seo.*` keys at three-locale parity.

## vercel.json, annotated

**Redirects** (all `permanent: true` = 301):

- `?lng=es|en` → the path-prefixed URL. Google discovered URLs like
  `/research?lng=es` from the pre-2026-07 query-param scheme. Vercel forwards the
  query string to the destination, so the source pattern carries a negative
  lookahead (`/:path((?!es/|en/|es$|en$).*)`) — without it, `/es/research?lng=es`
  would match again and loop. `?lng=ca` is deliberately not redirected: it was
  never published, a redirect for it could not be made loop-safe the same way,
  and the self-referencing canonical already consolidates it.
- `/en/calculadora-fifo` → `/en/fifo-capital-gains-calculator`. One intent had
  two English URLs; the keyword slug is now the English slug of that page.
- The six `/research/*` and `/es/research/*` article paths → `/en/research/*`.
  See "Research translations" below.

**Rewrites** are enumerated rather than a catch-all. The old
`/((?!api).*) → /app.html` answered *every* unknown URL with `200` and a generic
Catalan shell. Now a path matching no rewrite and no prerendered file falls
through to `dist/404.html` with a real `404`. The rewrites still list every public
route pattern, so if a prerender ever fails the page degrades to the SPA shell
instead of 404ing. **Vercel matches static files before rewrites**, so the
prerendered pages are unaffected by any of this.

`/research/:slug` must stay in the rewrites: an article published in Notion has
to work without a redeploy.

## Research translations

The Notion CMS has no language dimension — one row per article, fetched by slug.
All three articles (`netflix`, `exor`, `meta`) are authored in **English**, and
the routes were mirrored across all three locales, so `/research/netflix`,
`/es/research/netflix` and `/en/research/netflix` served the same English body
with translated chrome, each claiming via hreflang to be a translation of the
others. Google reads that as a fake translation.

`src/data/research-articles.json` is now the source of truth for which languages
each article exists in. It drives the hreflang set, both sitemaps and the
prerender list; the non-existent variants 301 to the real one.

**To publish a real translation:** write it in Notion, add the locale to that
manifest, and delete the matching redirect from `vercel.json`. Nothing else
changes. (A per-locale Notion row keyed by `Slug` + a `Locale` column is the
natural next step if translations become routine — `_research-core.ts` would
filter on it.)

Note: the company-dashboard **Insights** (Pros/Risks/Thesis on `/explore/:ticker`)
are also single-language Notion text. They are a section inside an otherwise
localized page, not a URL claiming to be a translation, so they are not a
hreflang problem — but they do read as untranslated content to a Spanish visitor.

## Deliberate non-localizations

- `/en/portfolio-tracker` and `/en/etf-growth-calculator` stay English-only. The
  ca/es **home page** already targets "portfolio tracker from Excel" and
  `/forecast` already targets ETF projection in all three languages; a localized
  copy would compete with a page that already owns the intent.
- App and auth routes (`/dashboard`, `/upload`, `/account`, `/auth`, `/verify`,
  `/debug`) are language-neutral by design — `Disallow`-ed or `noindex`, so a
  per-language URL would buy nothing. `isLocalizable()` encodes this list.
- `/explore/:ticker` resolves *any* symbol via the live API, so it can mint
  unlimited URLs. Only the curated `tickers.json` list is indexable; everything
  else renders normally but `noindex`.

## Tests

```bash
npm test          # unit + sitemap invariants (fast, no build)
npm run test:seo  # production build, then assert the real dist/ HTML
```

`src/lib/prerendered-html.test.ts` reads `dist/` and checks, for a sample of URLs
and without executing JavaScript: status-bearing file exists, `html lang`, a
specific non-shell title, a specific meta description, exactly one
self-referencing canonical, a complete self-including hreflang set, an `<h1>` and
non-empty `#root`, locale-preserving internal links, no `?lng=`, and
canonical↔sitemap agreement across *every* indexable URL. It skips itself when
`dist/` is absent so `npm test` stays fast.
