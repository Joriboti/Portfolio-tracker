# TrimmTrack — Company dashboard ("fitxa d'empresa") plan

Goal: a Qualtrim-style company overview on the per-ticker pages — stat panels
(Valuation / Cash Flow / Margins & Growth / Balance / Dividend), a grid of
quarterly financial charts (Revenue, EBITDA, Net Income, FCF, EPS, Cash & Debt,
Dividends, Buybacks, Shares Outstanding), and optionally the "Insights" text
sections (Competitive Advantages / Investment Risks).

**Where it lives:** the just-shipped `/explore/:ticker` pages (~80 of them).
The dashboard renders ABOVE the valuation panel as tabs: **Resum** (new) |
**Valoració** (existing 6 models). This makes every programmatic SEO page far
richer — more content per page = better ranking + engagement, and the reference
UI is exactly what visitors landing on "Valoración de Apple" expect to see.

---

## Data availability (verified live against Yahoo, 2026-07-06)

### Stat panels — from `quoteSummary` (infra already exists)
Most fields are already cached in the `fundamentals` table. Missing ones are
one-line additions to the existing pick in `_fundamentals-core.ts` / the
`?quote=` live mode:

| Panel | Field | Source | Status |
|---|---|---|---|
| Valuation | Market cap, PE (TTM), forward PE, P/B | summaryDetail / keyStats | ✅ already cached |
| Valuation | P/S, EV/EBITDA | summaryDetail.priceToSalesTrailing12Months, keyStats.enterpriseToEbitda | ➕ add |
| Valuation | PE "next year" (à la 2027) | earningsTrend +1y avg EPS estimate | ➕ add |
| Cash Flow | FCF/share, FCF yield | financialData.freeCashflow / shares / price | ✅ have inputs |
| Cash Flow | SBC-adjusted FCF yield | quarterly `stockBasedCompensation` (TTM sum) | ➕ from statements |
| Margins | Profit margin, operating margin | financialData | ✅ / ➕ operatingMargins |
| Growth | Quarterly earnings/revenue YoY | computed from statements | ➕ computed |
| Balance | Cash, debt, net | financialData.totalCash/totalDebt | ✅ already cached |
| Dividend | Yield, payout ratio, payout date | summaryDetail + calendarEvents | ✅ / ➕ ratio+date |

### Charts — from `fundamentalsTimeSeries` (verified: all keys present)
- `financials` (quarterly): `totalRevenue`, `EBITDA`, `netIncome`, `dilutedEPS`,
  `operatingIncome`, `grossProfit`, `researchAndDevelopment`,
  `sellingGeneralAndAdministration` (→ Expenses chart)
- `balance-sheet` (quarterly): `totalDebt`, `cashAndCashEquivalents`/`cashFinancial`,
  `ordinarySharesNumber` (→ Cash & Debt, Shares Outstanding)
- `cash-flow` (quarterly): `freeCashFlow` (direct!), `operatingCashFlow`,
  `capitalExpenditure`, `stockBasedCompensation`, `cashDividendsPaid`,
  `repurchaseOfCapitalStock` (→ FCF, SBC, Return of Capital = div + buybacks)
- Price chart: `chart()` daily 1y (already used in 2 API files).

### ⚠️ Measured depth constraint
Yahoo free returns only the **last 5 quarters** and **last 5 annual years**,
whatever period you request. Consequences, in order:
1. Day-1 charts show 5 quarterly bars + a **quarterly/annual toggle** (annual
   gives the 5-year long-trend view, like the reference's yearly Revenue chart).
2. We **cache every quarter permanently in Neon** (append-only upsert) → the
   weekly cron accumulates history; a year from now the charts show 9 quarters,
   and depth grows forever.
3. (Later, optional) **SEC EDGAR companyfacts** (free JSON, US filers only) can
   backfill full multi-year quarterly history in one go — that's how the
   reference gets 16 quarters.

### Not available from Yahoo (phase-later or skip)
- **Revenue by Segment** and custom KPIs ("People Served") — these come from
  SEC XBRL segment data. Only via the EDGAR phase, US-only. Skip in v1.
- **Insights (Competitive Advantages / Investment Risks)** — two options:
  a) **Author in the Notion research CMS** (recommended first): add optional
     `InsightsPros`/`InsightsRisks` fields (or a tagged page) keyed by Ticker;
     the article endpoint already exists; zero new cost, high quality, doubles
     as unique SEO text (AI-generated boilerplate is exactly what Google
     devalues). Start with your ~20 holdings.
  b) Generate with the Claude API, cached in Neon per ticker (needs an API key,
     costs per ticker, quality varies). Can be added later behind the same UI.

---

## Architecture (respecting the house constraints)

- **⛔ 12-function Vercel Hobby cap — NO new route.** New mode folded into the
  existing endpoint: `fundamentals-get?statements=TICKER` returns
  `{ panels, quarters[], annual[] }`. Same fold pattern as `?quote=`/`?search=`
  /`?research=`/`?live=`.
- **New Neon table** `financial_statements(ticker, period_end DATE,
  period_type 'q'|'a', data JSONB, fetched_at)` PK (ticker, period_end,
  period_type). Upsert `ON CONFLICT` → append-only accumulation (the whole
  point given the 5-quarter window). Additive `schema.sql` change.
- **Refresh policy:** stale-first, same pattern as fundamentals — serve DB rows
  immediately; if newest row is older than ~7 days, fetch the 3 modules
  (financials + balance-sheet + cash-flow ≈ 3 Yahoo calls), upsert, return
  fresh. Also folded into the Saturday cron with a time budget (try/catch
  isolated, like `_fundamentals-core`). CDN `s-maxage=86400` + SWR on the
  response (public data, same for every user).
- **Pure lib** `src/lib/statements.ts` (+ vitest): shapes rows into chart
  series, computes YoY growth, TTM sums (SBC, FCF), FCF/share, payout ratio
  fallbacks. All display math testable without the API.
- **Charts: hand-rolled SVG** (house style — HistoryChart, DividendsCard bars,
  MC histogram; no chart lib). One reusable `<QuarterlyBars>` (bars +
  negative-value support + hover value + quarterly/annual toggle) + one
  `<StatPanel>` (label/value rows like the reference's Valuation box). An
  expand-to-modal can reuse the `PieChartModal` pattern later.
- **Currency:** statements arrive in the filing currency (`financialCurrency`),
  which for our single-listing tickers == quote currency; label every chart
  with its currency; remember the GBp sub-unit gotcha if LSE names get added.
- **i18n:** new `company.*` block, ca/es/en at full parity, same as always.
- **SEO note:** the tab must render server-visible static parts (headings) but
  the numbers are CSR like the valuation panel — fine, same as today; the
  per-ticker H1/meta already carry the page.

## Phases

**Phase 1 — data layer + stat panels — ✅ DONE (2026-07-07, commit `5e82d26`,
deployed & live-verified on /explore/aapl).** `?statements=` mode in
`api/_statements-core.ts` (still 12 routes), `financial_statements` Neon table
(append-only accumulation), `src/lib/statements.ts` + 17 vitest cases, five
stat panels incl. PE TTM|NTM|+1y, P/S, EV/EBITDA, FCF yield + SBC-adjusted,
payout ratio/date, next-year EPS from earningsTrend.

**Phase 2 — chart grid — ✅ DONE (same commit).** `<QuarterlyBars>` SVG
component (1–2 series, grouped/stacked, negatives); grid: Revenue, EBITDA, Net
Income, FCF, EPS, Cash & Debt (grouped), Return of Capital (stacked
div+buybacks), Shares, SBC, Expenses (R&D/SG&A stacked). Quarterly/annual
toggle (auto-picks annual while the quarterly cache is young). 1y price chart
with change badge. Tabs Resum | Valoració on /explore/:ticker (share links
open on Valoració). Live-verified: 13 SVGs, 65 bars, real AAPL figures.

**Phase 3 — later, pick as needed**
- SEC EDGAR backfill: deep quarterly history + revenue segments (US-only).
- Insights via Notion CMS fields (a), later optionally Claude-generated (b).
- Expand-chart modal, estimates overlay (earningsTrend next-quarter markers).
- Show the "Resum" tab for portfolio holdings on the dashboard expandable rows
  (component is reusable by design).

## Open decisions (answer before Phase 1)
1. **Placement OK?** Tabs "Resum | Valoració" on `/explore/:ticker` (my
   recommendation), or a separate page?
2. **Insights source:** Notion-authored (a) first, or skip Insights entirely in v1?
3. **Priority:** build this next, or start the weekly research-article cadence
   first (GROWTH_PLAN phase 2) and do this after? They compete for the same
   sessions.
