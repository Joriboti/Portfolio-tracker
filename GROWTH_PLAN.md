# TrimmTrack — Growth Plan (traffic)

Baseline (Vercel Analytics, 7 days as of 2026-07-03): **17 visitors · 103 views · 59% bounce**.
Goal: sustained growth in weekly unique visitors, then signups.

The technical SEO base is already good (public landing/explore/forecast/research,
sitemap + hreflang ca/es/en, JSON-LD, og.png, robots.txt). The three real gaps:

1. **Too few indexable pages** (~4 URLs × 3 languages) — nothing for Google to rank.
2. **No content cadence** — 2 research articles total.
3. **Zero distribution** — nobody is being told the site exists.

---

## Phase 0 — Measure (this week, ~1h, no code)

- [x] **Google Search Console**: DONE (2026-07-05). Domain verified, `sitemap.xml`
      submitted 3 Jul, last read 5 Jul, status "Correcta", 14 pages discovered, no
      indexing errors flagged.
- [ ] **Bing Webmaster Tools**: same (free traffic, imports GSC config).
- [ ] Define the KPI loop: weekly check of GSC impressions/clicks + Vercel visitors.
      Monthly: look at queries where you rank position 8–20 and write content for them.

## Phase 1 — Multiply indexable pages (1–2 weeks of dev, highest SEO leverage)

The tools are strong but hidden behind 1 URL each. Turn them into many keyword-targeted URLs:

- [ ] **Per-ticker explore pages**: `/explore/aapl`, `/explore/msft`, … as real routes
      with unique `useSeo` title/description ("Valoració DCF d'Apple (AAPL) — calculadora
      gratuïta") + JSON-LD, generated for a curated list (~100 popular tickers + your
      holdings), all added to sitemap. This is the classic programmatic-SEO play for
      finance tools.
- [ ] **Standalone calculator landing pages** — each one targets a real search:
      - [x] `/calculadora-fifo` — DONE (2026-07-05). Standalone public page shipped:
        reuses the existing `<FifoCalculator>` + SEO copy (what/how/example), a 4-Q
        FAQ with FAQPage JSON-LD (rich-result eligible), ca/es/en via i18n, in the
        sitemap with hreflang, and a footer link so it's not orphaned. Build + tsc +
        key-parity all green; live-verified in preview. **Not yet committed/deployed.**
      - `/calculadora-dcf` — the Simple DCF as a standalone page (Explore stays as-is).
      - `/calculadora-interes-compost` — thin wrapper/alias view of /forecast targeting
        the compound-interest query (huge volume in ES).
- [ ] **Prerender public pages at build time**. The app is CSR (Vite SPA): Google *can*
      render JS but it's slow and unreliable for ranking; Bing/social scrapers barely do.
      A build-step prerender (e.g. puppeteer snapshot or vite prerender plugin) that emits
      static HTML for `/`, `/forecast`, `/research`, `/research/:slug`, calculators and
      per-ticker pages fixes this **without any serverless function** (12-fn Hobby cap
      untouched). This is the single biggest technical SEO item left.

## Phase 2 — Content engine (ongoing; compounds over months)

The Notion CMS is already built — use it. Content is what wins in a niche where you can't
outspend anyone, and CA/ES finance long-tail is genuinely under-served.

- [ ] Cadence: **1 article per week** minimum (Notion → auto-published, zero deploy).
- [ ] Two article types, alternating:
      1. *Company analyses* (like EXOR/Netflix) — end each with a CTA to `/explore/<ticker>`.
      2. *Evergreen how-tos targeting queries*: "com calcular la rendibilitat de la teva
         cartera", "què és el DCF explicat fàcil", "FIFO per a la declaració de la renda",
         "TER: per què importa", "interès compost amb aportacions mensuals". Each links to
         the matching tool.
- [ ] **Split the ETF guide** (6 cards inside /forecast) into indexable guide pages
      (`/guia/ter`, `/guia/dca`, …) or one `/guia` hub — right now that SEO copy is
      trapped inside a tool page.
- [ ] Write in ES primarily (10× the search volume of CA), with CA/EN via the existing i18n.

## Phase 3 — Distribution (traffic *this month*, no waiting for Google)

- [ ] **Launches** (one-off spikes + backlinks, which feed SEO):
      - Product Hunt launch (prep: og.png ✓, tagline, 3–4 screenshots).
      - Show HN ("Show HN: I built a free portfolio tracker with 6 valuation models").
      - Indie Hackers post (the build story).
- [ ] **Communities where the audience already is** (share tools/articles, don't spam):
      - Reddit: r/SpainFIRE, r/eupersonalfinance, r/ETFs_Europe.
      - Rankia + Forocoches (bolsa) — dominant ES retail-investor forums.
      - X/Twitter fintwit in Spanish: post one valuation per week as a chart/screenshot
        using the **shareable valuation links** already shipped.
- [ ] **Dynamic OG images per shared valuation** (nice-to-have): a shared `/explore?s=…`
      link currently previews the generic og.png. A per-ticker OG card (price, fair value,
      upside) makes shares self-marketing. Needs `@vercel/og` — check Edge vs the 12
      serverless-fn cap before building; skip if it forces a trade-off.

## Phase 4 — Retention (once weekly visitors > ~200)

Deliberately deferred earlier ("no users to retain") — revisit when Phase 1–3 move the needle:

- [ ] Watchlist for logged-in users.
- [ ] Weekly email digest (portfolio P&L summary + new research article) — email is the
      only channel that brings people *back* without them searching.

---

## Suggested order of execution

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | GSC + Bing setup | 1h, no code | Prereq for everything |
| 2 | `/calculadora-fifo` standalone page | small | Quick win, real query |
| 3 | Build-time prerender of public pages | medium | Unblocks all SEO |
| 4 | Per-ticker `/explore/:ticker` pages | medium | Biggest page-count multiplier |
| 5 | Weekly article habit (Notion) | recurring, no code | Compounds forever |
| 6 | PH / Show HN / community launches | 1 day prep | Immediate spike + backlinks |
| 7 | ETF guide → indexable pages | small | Frees existing copy |
| 8 | Dynamic OG cards | medium | Share loop |
| 9 | Watchlist + email digest | large | Later, retention |

Open questions to settle before implementing:
- Is Google Search Console already set up? (Suggested on 2026-07-03; unknown if done.)
- Primary content language: ES-first with CA/EN translations, or keep CA-first?
- Curated ticker list for the programmatic pages: top-100 US + IBEX + your holdings?
