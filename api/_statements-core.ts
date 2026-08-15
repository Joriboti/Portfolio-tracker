import type { VercelRequest, VercelResponse } from "@vercel/node";

// Quarterly/annual financial statements for the company dashboard ("Resum" tab
// on /explore/:ticker). NOT a route (underscore prefix) — dispatched from
// fundamentals-get behind `?statements=TICKER` to stay under the Hobby plan's
// 12-function limit.
//
// Yahoo's free fundamentalsTimeSeries only returns the LAST ~5 quarters and
// ~5 annual years regardless of the requested period, so every fetched period
// is cached permanently in Neon (`financial_statements`, append-only upsert):
// history accumulates with each weekly refresh and chart depth grows over time.
//
// Response also carries `panel` (live quoteSummary extras the stat panels need
// beyond the shared Fundamentals shape), `prices` (5y weekly closes for the
// price and P/E charts) and `fx` (the weekly filing→quote rate, present only
// for the ADRs where those differ). All best-effort: any Yahoo failure degrades
// to null/[] — this endpoint never 500s over a partial payload.

type ModuleOpts = { validateResult?: boolean };
type TsRow = Record<string, unknown> & { date?: Date | string };
type YahooStatementsClient = {
  fundamentalsTimeSeries: (
    symbol: string,
    opts: { period1: string; period2?: string; type: string; module: string },
    m?: ModuleOpts,
  ) => Promise<TsRow[]>;
  quoteSummary: (
    symbol: string,
    opts: { modules: string[] },
    m?: ModuleOpts,
  ) => Promise<Record<string, Record<string, unknown> | undefined>>;
  chart: (
    symbol: string,
    opts: { period1: Date; period2: Date; interval: string },
    m?: ModuleOpts,
  ) => Promise<{ quotes?: Array<{ date?: Date | string; close?: number | null }> }>;
  setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
};

async function makeYahoo(): Promise<YahooStatementsClient> {
  const yfMod = await import("yahoo-finance2");
  const YahooFinance = yfMod.default as unknown as new (opts?: {
    suppressNotices?: string[];
  }) => YahooStatementsClient;
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  yahoo.setGlobalConfig?.({ validation: { logErrors: false } });
  return yahoo;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    return num((v as Record<string, unknown>).raw);
  }
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Slim, stable metric schema stored in the JSONB `data` column. Values keep
// Yahoo's filing sign convention (capex/dividends/buybacks are negative
// outflows); the display layer decides how to present them.
export type StatementMetrics = {
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
  eps: number | null;
  operatingIncome: number | null;
  grossProfit: number | null;
  rnd: number | null;
  sga: number | null;
  shares: number | null;
  totalDebt: number | null;
  cash: number | null;
  fcf: number | null;
  ocf: number | null;
  capex: number | null;
  sbc: number | null;
  dividendsPaid: number | null;
  buybacks: number | null;
};

// Merge the three module rows for one period into the slim schema. Tolerant
// pickers: Yahoo key availability varies per company/period.
function toMetrics(m: Record<string, unknown>): StatementMetrics {
  const ocf = num(m.operatingCashFlow);
  const capex = num(m.capitalExpenditure); // negative outflow
  const cashParts =
    num(m.cashAndCashEquivalents) ??
    num(m.cashCashEquivalentsAndShortTermInvestments) ??
    (num(m.cashFinancial) != null || num(m.cashEquivalents) != null
      ? (num(m.cashFinancial) ?? 0) + (num(m.cashEquivalents) ?? 0)
      : null);
  return {
    revenue: num(m.totalRevenue),
    ebitda: num(m.EBITDA) ?? num(m.normalizedEBITDA),
    netIncome: num(m.netIncome),
    eps: num(m.dilutedEPS) ?? num(m.basicEPS),
    operatingIncome: num(m.operatingIncome),
    grossProfit: num(m.grossProfit),
    rnd: num(m.researchAndDevelopment),
    sga: num(m.sellingGeneralAndAdministration),
    shares:
      num(m.ordinarySharesNumber) ??
      num(m.shareIssued) ??
      num(m.dilutedAverageShares) ??
      num(m.basicAverageShares),
    totalDebt: num(m.totalDebt),
    cash: cashParts ?? num(m.endCashPosition),
    fcf: num(m.freeCashFlow) ?? (ocf != null && capex != null ? ocf + capex : null),
    ocf,
    capex,
    sbc: num(m.stockBasedCompensation),
    dividendsPaid: num(m.cashDividendsPaid),
    buybacks: num(m.repurchaseOfCapitalStock),
  };
}

const TS_MODULES = ["financials", "balance-sheet", "cash-flow"] as const;

// Fetch + merge the three statement modules for one period type. Returns a map
// period_end(ISO date) → metrics. Modules are fetched serially (gentler on
// Yahoo's rate limits; 3 calls take ~2s).
async function fetchPeriods(
  yahoo: YahooStatementsClient,
  ticker: string,
  type: "quarterly" | "annual",
): Promise<Map<string, StatementMetrics>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const module of TS_MODULES) {
    try {
      const rows = await yahoo.fundamentalsTimeSeries(
        ticker,
        // Ask wide; Yahoo caps the answer at ~5 periods anyway.
        { period1: "2016-01-01", type, module },
        { validateResult: false },
      );
      for (const row of rows) {
        const d = isoDate(row.date);
        if (!d) continue;
        merged.set(d, { ...(merged.get(d) ?? {}), ...row });
      }
    } catch {
      /* module unavailable for this symbol → whatever we merged still counts */
    }
  }
  const out = new Map<string, StatementMetrics>();
  for (const [d, m] of merged) out.set(d, toMetrics(m));
  return out;
}

// Live quoteSummary extras the stat panels need beyond the shared Fundamentals
// shape (P/S, EV/EBITDA, operating margin, payout, next-year EPS estimate).
async function fetchPanel(yahoo: YahooStatementsClient, ticker: string) {
  try {
    const qs = await yahoo.quoteSummary(
      ticker,
      {
        modules: [
          "summaryDetail",
          "defaultKeyStatistics",
          "financialData",
          "calendarEvents",
          "earningsTrend",
          "earningsHistory",
          "price",
        ],
      },
      { validateResult: false },
    );
    const sd = qs.summaryDetail ?? {};
    const ks = qs.defaultKeyStatistics ?? {};
    const fd = qs.financialData ?? {};
    const ce = qs.calendarEvents ?? {};
    const pr = qs.price ?? {};
    // earningsTrend.trend: rows keyed by period ("0q","+1q","0y","+1y").
    const trend = Array.isArray((qs.earningsTrend as Record<string, unknown>)?.trend)
      ? ((qs.earningsTrend as Record<string, unknown>).trend as Array<
          Record<string, unknown>
        >)
      : [];
    const nextYear = trend.find((t) => t.period === "+1y");
    const nextYearEps = num(
      (nextYear?.earningsEstimate as Record<string, unknown> | undefined)?.avg,
    );

    // Consensus for the fiscal years not yet reported ("0y", "+1y"), which is
    // what carries the forward-P/E line from the last reported year up to
    // today.
    //
    // earningsTrend does not state its currency and is not consistent about
    // it: TSM and SAP come back per quoted share in USD, ASML and NVO in the
    // euros and kroner they file in — two Nasdaq-quoted European companies,
    // opposite conventions. Rather than guess, measure. Yahoo's own forwardPE
    // is price over the +1y estimate and it gets the conversion right, so the
    // ratio between the two says what unit the estimates are in, and the same
    // factor puts every one of them into the quote currency. No forwardPE to
    // measure against means no estimates: a forward line ending at the last
    // reported year is honest, one off by a factor of thirty is not.
    const forwardPe = num(sd.forwardPE) ?? num(ks.forwardPE);
    const price = num(pr.regularMarketPrice);
    const estScale =
      forwardPe != null && forwardPe > 0 && price != null && nextYearEps != null && nextYearEps > 0
        ? price / forwardPe / nextYearEps
        : null;
    const annualEstimates =
      estScale == null
        ? []
        : trend
            .filter((t) => t.period === "0y" || t.period === "+1y")
            .map((t) => ({
              periodEnd: isoDate(t.endDate),
              eps: num(
                (t.earningsEstimate as Record<string, unknown> | undefined)?.avg,
              ),
            }))
            .filter(
              (e): e is { periodEnd: string; eps: number } =>
                e.periodEnd != null && e.eps != null,
            )
            .map((e) => ({ periodEnd: e.periodEnd, eps: e.eps * estScale }))
            .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    // Consensus for the upcoming quarters, feeding the dashed "estimate" bars on
    // the Revenue/EPS charts. Both forward rows are returned: whether "0q" is
    // still unreported or already filed depends on where in the earnings cycle
    // the company is, so the display layer picks by period end rather than
    // trusting either label. endDate is required — a row we cannot place on the
    // quarterly axis is useless to us.
    const estimates = trend
      .filter((t) => t.period === "0q" || t.period === "+1q")
      .map((t) => ({
        periodEnd: isoDate(t.endDate),
        eps: num((t.earningsEstimate as Record<string, unknown> | undefined)?.avg),
        revenue: num((t.revenueEstimate as Record<string, unknown> | undefined)?.avg),
      }))
      .filter(
        (e): e is { periodEnd: string; eps: number | null; revenue: number | null } =>
          e.periodEnd != null && (e.eps != null || e.revenue != null),
      )
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

    // The consensus in full, for the forecast charts: not just the average but
    // the range analysts span and how many of them there are. A single average
    // is a forecast presented as a fact; the low-to-high whisker is what makes
    // it read as an opinion with a width, which is what it is.
    const band = (o: unknown) => {
      const r = (o ?? {}) as Record<string, unknown>;
      const avg = num(r.avg);
      if (avg == null) return null;
      return {
        avg,
        low: num(r.low),
        high: num(r.high),
        analysts: num(r.numberOfAnalysts),
        growth: num(r.growth),
      };
    };
    const FORECAST_PERIODS = ["0q", "+1q", "0y", "+1y"];
    const periods = trend
      .filter((t) => FORECAST_PERIODS.includes(String(t.period)))
      .map((t) => ({
        period: String(t.period),
        periodEnd: isoDate(t.endDate),
        eps: band(t.earningsEstimate),
        revenue: band(t.revenueEstimate),
      }))
      .filter(
        (p): p is {
          period: string;
          periodEnd: string;
          eps: ReturnType<typeof band>;
          revenue: ReturnType<typeof band>;
        } => p.periodEnd != null && (p.eps != null || p.revenue != null),
      )
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

    // The long-term growth consensus ("+5y"), which is the only thing published
    // about the years past the next one. Analysts put out a revenue and EPS
    // number for this fiscal year and the following one and nothing further, so
    // a five-year forecast chart cannot be drawn from estimates alone. This
    // rate is what lets the display layer carry the last consensus year forward
    // — clearly as a projection, never as a consensus.
    const longTermGrowth = num(trend.find((t) => t.period === "+5y")?.growth);

    // What the last four quarters were expected to earn, and what they did.
    //
    // The reported EPS here is NOT the one in the statements above: consensus
    // is quoted on an adjusted basis and Yahoo answers it in kind, while the
    // income statement reports GAAP. Drawing an adjusted estimate against a
    // GAAP bar invents misses that never happened — Alphabet's Q3 2025 was
    // 2.87 adjusted and 2.12 reported — so the beat/miss markers are drawn
    // against THIS actual, from the same dataset as the estimate beside it.
    const history = Array.isArray(
      (qs.earningsHistory as Record<string, unknown>)?.history,
    )
      ? ((qs.earningsHistory as Record<string, unknown>).history as Array<
          Record<string, unknown>
        >)
      : [];
    const epsHistory = history
      .map((h) => ({
        periodEnd: isoDate(h.quarter),
        actual: num(h.epsActual),
        estimate: num(h.epsEstimate),
      }))
      .filter(
        (h): h is { periodEnd: string; actual: number; estimate: number | null } =>
          h.periodEnd != null && h.actual != null,
      )
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

    return {
      priceToSales: num(sd.priceToSalesTrailing12Months),
      evToEbitda: num(ks.enterpriseToEbitda),
      operatingMargin: num(fd.operatingMargins),
      grossMargin: num(fd.grossMargins),
      payoutRatio: num(sd.payoutRatio),
      dividendDate: isoDate(ce.dividendDate) ?? isoDate(sd.exDividendDate),
      nextYearEps,
      estimates,
      /** Already in the quote currency — see estScale above. */
      annualEstimates,
      forecast: { epsScale: estScale, longTermGrowth, periods, epsHistory },
      // The currency the statements below are actually filed in. Usually the
      // quote currency, but NOT for ADRs: TSM quotes in USD and reports in TWD,
      // TM in JPY, NVO in DKK. Anything comparing or converting these figures
      // has to read this rather than assume the quote currency.
      financialCurrency:
        typeof fd.financialCurrency === "string" ? fd.financialCurrency : null,
      // The currency `prices` below are quoted in. Anything that divides a
      // price by a per-share figure needs both: TSM's P/E was being drawn as
      // 425 USD over 431 TWD — a plausible-looking 1.0× that meant nothing.
      quoteCurrency: typeof pr.currency === "string" ? pr.currency : null,
    };
  } catch {
    return null;
  }
}

// 5y of weekly closes for the price chart. Live (not cached in Neon —
// historical_prices only covers portfolio tickers) but CDN-cached via the
// response's s-maxage.
async function fetchPrices(yahoo: YahooStatementsClient, ticker: string) {
  try {
    // Five years, not one. Weekly closes are cheap (~260 points) and the P/E
    // history is drawn from this series — a single year of it shows a company's
    // rating without enough of its own past to say whether that rating is high.
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 5 * 366 * 24 * 3600 * 1000);
    const r = await yahoo.chart(
      ticker,
      { period1, period2, interval: "1wk" },
      { validateResult: false },
    );
    return (r.quotes ?? [])
      .map((q) => ({ date: isoDate(q.date), close: num(q.close) }))
      .filter((p): p is { date: string; close: number } => !!p.date && p.close != null);
  } catch {
    return [];
  }
}

// Weekly {from}→{to} rate over the same five years as the prices, so a P/E
// built from a filing-currency EPS and a quote-currency price is right at every
// week rather than only at today's rate. Five years of EUR/USD spans 1.18 to
// 1.05; pinning the whole history to the spot rate would tilt the line by a
// tenth of its own range. Empty on any failure — the caller then declines to
// draw a series it cannot state honestly.
async function fetchFx(
  yahoo: YahooStatementsClient,
  from: string,
  to: string,
): Promise<Array<{ date: string; rate: number }>> {
  try {
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 5 * 366 * 24 * 3600 * 1000);
    const r = await yahoo.chart(
      `${from}${to}=X`,
      { period1, period2, interval: "1wk" },
      { validateResult: false },
    );
    return (r.quotes ?? [])
      .map((q) => ({ date: isoDate(q.date), rate: num(q.close) }))
      .filter((p): p is { date: string; rate: number } => !!p.date && p.rate != null);
  } catch {
    return [];
  }
}

type NeonSql = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<Array<Record<string, unknown>>>;

const STALE_MS = 7 * 24 * 3600 * 1000;

export async function handleStatements(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.statements;
  const ticker = (Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().toUpperCase();
  if (!ticker) {
    res.status(200).end(JSON.stringify({ ok: true, ticker: null }));
    return;
  }

  const yahoo = await makeYahoo();

  // DB is optional: without DATABASE_URL we serve live-only (no accumulation).
  let sql: NeonSql | null = null;
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const mod = await import("@neondatabase/serverless");
      sql = mod.neon(dbUrl) as unknown as NeonSql;
      await sql`
        CREATE TABLE IF NOT EXISTS financial_statements (
          ticker      TEXT NOT NULL,
          period_end  DATE NOT NULL,
          period_type TEXT NOT NULL,
          data        JSONB NOT NULL,
          fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (ticker, period_end, period_type)
        )
      `;
    } catch {
      sql = null;
    }
  }

  // Cached rows + freshness.
  let cached: Array<{ period_end: string; period_type: string; data: StatementMetrics }> =
    [];
  // What a &backfill=edgar run actually did, echoed in the response so a bulk
  // run can be checked without querying the database. `epsRatio` is the share
  // ratio it measured (5 for a TSM-style ADS, null when unmeasurable) and
  // `skipped` says why nothing was written, which is the difference between a
  // ticker EDGAR has never heard of and one we declined to merge.
  let backfilled: {
    inserted: number;
    enriched: number;
    epsRatio: number | null;
    skipped: string | null;
  } | null = null;
  let epsRatio: number | null = null;
  let skipped: string | null = null;
  let newestFetch = 0;
  if (sql) {
    try {
      const rows = await sql`
        SELECT period_end::text AS period_end, period_type, data,
               EXTRACT(EPOCH FROM fetched_at) * 1000 AS fetched_ms
        FROM financial_statements
        WHERE ticker = ${ticker}
        ORDER BY period_end
      `;
      cached = rows.map((r) => ({
        period_end: String(r.period_end),
        period_type: String(r.period_type),
        data: r.data as StatementMetrics,
      }));
      newestFetch = rows.reduce(
        (mx, r) => Math.max(mx, Number(r.fetched_ms) || 0),
        0,
      );
    } catch {
      cached = [];
    }
  }

  const stale = cached.length === 0 || Date.now() - newestFetch > STALE_MS;

  if (stale) {
    // Refresh from Yahoo; on total failure the stale cache still serves.
    const [q, a] = [
      await fetchPeriods(yahoo, ticker, "quarterly"),
      await fetchPeriods(yahoo, ticker, "annual"),
    ];
    const fresh: Array<{ period_end: string; period_type: string; data: StatementMetrics }> =
      [];
    for (const [d, m] of q) fresh.push({ period_end: d, period_type: "q", data: m });
    for (const [d, m] of a) fresh.push({ period_end: d, period_type: "a", data: m });

    if (fresh.length > 0) {
      if (sql) {
        for (const row of fresh) {
          try {
            await sql`
              INSERT INTO financial_statements (ticker, period_end, period_type, data, fetched_at)
              VALUES (${ticker}, ${row.period_end}, ${row.period_type}, ${JSON.stringify(row.data)}::jsonb, NOW())
              ON CONFLICT (ticker, period_end, period_type)
              DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()
            `;
          } catch {
            /* one bad row must not sink the rest */
          }
        }
        // Re-read so accumulated history (older cached periods) is included.
        try {
          const rows = await sql`
            SELECT period_end::text AS period_end, period_type, data
            FROM financial_statements
            WHERE ticker = ${ticker}
            ORDER BY period_end
          `;
          cached = rows.map((r) => ({
            period_end: String(r.period_end),
            period_type: String(r.period_type),
            data: r.data as StatementMetrics,
          }));
        } catch {
          cached = fresh.sort((x, y) => x.period_end.localeCompare(y.period_end));
        }
      } else {
        cached = fresh.sort((x, y) => x.period_end.localeCompare(y.period_end));
      }
    }
  }

  // Panel extras + price series (parallel, both best-effort). Fetched before
  // the backfill because the panel states the currency the filings are in,
  // which decides whether EDGAR's rows may be merged with these at all.
  const [panel, prices] = await Promise.all([
    fetchPanel(yahoo, ticker),
    fetchPrices(yahoo, ticker),
  ]);

  // Optional deep-history backfill from SEC EDGAR. Explicit trigger
  // (&backfill=edgar) — companyfacts is multi-MB, so it stays off the hot path.
  //
  // Two jobs, and for a ticker we already cover the SECOND is the one that
  // matters. Yahoo's free window returns ~5 quarters of everything but only
  // ever carried a few metrics deep, so a long-covered ticker ends up with a
  // full row per quarter back to 2006 where all but revenue/EPS/net income are
  // null — Apple had 138 quarters and free cash flow on 17 of them. An
  // insert-only backfill could never repair that: every EDGAR period was
  // "near" an existing row, so every one of them was skipped.
  //
  //   • INSERT periods we have no row for at all (the original job).
  //   • ENRICH the row we do have, filling ONLY the metrics that are null.
  //
  // Enrichment never overwrites a value Yahoo already reported, so the two
  // sources can't disagree on screen; it only turns nulls into numbers. The
  // ±20-day proximity guard still decides which row an EDGAR period belongs
  // to, so fiscal-vs-calendar drift updates the right quarter instead of
  // minting a near-duplicate bar beside it. Tickers absent from EDGAR / EDGAR
  // errors degrade to a no-op.
  //
  // Two things are checked before a single row is written, because both would
  // otherwise land as a step in the middle of a chart rather than as an error:
  // the two sources must agree on the reporting currency, and EDGAR's
  // per-ordinary-share EPS is restated per quoted share (Shell's ADS is two
  // ordinary shares, TSM's is five).
  if (sql && req.query.backfill === "edgar") {
    try {
      const { epsShareRatio, fetchEdgarStatements, scaleEps } = await import(
        "./_edgar-core.js"
      );
      const found = await fetchEdgarStatements(ticker);
      const filingCcy = panel?.financialCurrency ?? null;
      const currencyClash =
        !!found && !!filingCcy && found.currency !== filingCcy;
      if (currencyClash) skipped = `currency ${found!.currency} vs ${filingCcy}`;
      const ratio = found
        ? epsShareRatio(
            found.rows,
            cached.map((r) => ({
              periodEnd: r.period_end,
              periodType: r.period_type,
              eps: r.data.eps,
            })),
          )
        : null;
      const edgar =
        found && !currencyClash ? scaleEps(found.rows, ratio ?? 1) : [];
      epsRatio = ratio;
      if (edgar.length > 0) {
        // Rows that actually carry data. Yahoo occasionally leaves an all-null
        // placeholder row (odd report date, no usable metrics); those must NOT
        // claim an EDGAR period — it gets inserted properly instead.
        const hasData = (m: StatementMetrics) =>
          Object.values(m).some((v) => v != null);
        type Existing = { end: string; ms: number; data: StatementMetrics };
        const existing: Record<string, Existing[]> = { q: [], a: [] };
        for (const r of cached) {
          if (!hasData(r.data)) continue;
          (existing[r.period_type] ?? (existing[r.period_type] = [])).push({
            end: r.period_end,
            ms: Date.parse(r.period_end),
            data: r.data,
          });
        }
        // The closest existing row within the guard, or null.
        const nearest = (isoDay: string, type: string): Existing | null => {
          const d = Date.parse(isoDay);
          let best: Existing | null = null;
          let bestDist = 20 * 24 * 3600 * 1000;
          for (const r of existing[type] ?? []) {
            const dist = Math.abs(r.ms - d);
            if (dist < bestDist) {
              best = r;
              bestDist = dist;
            }
          }
          return best;
        };
        let inserted = 0;
        let enriched = 0;
        for (const row of edgar) {
          const hit = nearest(row.periodEnd, row.periodType);
          if (hit) {
            const merged = { ...hit.data };
            let filled = 0;
            for (const [k, v] of Object.entries(row.metrics)) {
              const key = k as keyof StatementMetrics;
              if (v != null && merged[key] == null) {
                merged[key] = v;
                filled++;
              }
            }
            if (filled === 0) continue;
            try {
              await sql`
                UPDATE financial_statements
                SET data = ${JSON.stringify(merged)}::jsonb, fetched_at = NOW()
                WHERE ticker = ${ticker}
                  AND period_end = ${hit.end}
                  AND period_type = ${row.periodType}
              `;
              // Keep the in-memory row in step so a later EDGAR period that
              // lands on the same row doesn't re-fill what we just wrote.
              hit.data = merged;
              enriched++;
            } catch {
              /* one bad row must not sink the rest */
            }
            continue;
          }
          try {
            // The conflict this hits is the all-null placeholder row Yahoo
            // leaves for the oldest year it returns. `existing` skips those so
            // they can't claim an EDGAR period for enrichment, which sent the
            // period here instead — where DO NOTHING quietly dropped it,
            // because the empty row is still a row. TSM lost 2021 that way.
            // Overwrite a placeholder, never a row that says anything.
            await sql`
              INSERT INTO financial_statements (ticker, period_end, period_type, data, fetched_at)
              VALUES (${ticker}, ${row.periodEnd}, ${row.periodType}, ${JSON.stringify(row.metrics)}::jsonb, NOW())
              ON CONFLICT (ticker, period_end, period_type)
              DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()
              WHERE jsonb_strip_nulls(financial_statements.data) = '{}'::jsonb
            `;
            inserted++;
          } catch {
            /* one bad row must not sink the rest */
          }
        }
        backfilled = { inserted, enriched, epsRatio, skipped };
        if (inserted > 0 || enriched > 0) {
          try {
            const rows = await sql`
              SELECT period_end::text AS period_end, period_type, data
              FROM financial_statements
              WHERE ticker = ${ticker}
              ORDER BY period_end
            `;
            cached = rows.map((r) => ({
              period_end: String(r.period_end),
              period_type: String(r.period_type),
              data: r.data as StatementMetrics,
            }));
          } catch {
            /* keep prior cached on re-read failure */
          }
        }
      }
      backfilled ??= { inserted: 0, enriched: 0, epsRatio, skipped };
    } catch {
      /* EDGAR module/network unavailable → Yahoo-only, no-op */
    }
  }

  // The rate that turns a filing-currency EPS into the currency the price is
  // quoted in. Only fetched when the two differ, which is the ADR case — TSM
  // quotes in USD and reports in TWD, ASML in USD and EUR.
  const filingCcy = panel?.financialCurrency ?? null;
  const quoteCcy = panel?.quoteCurrency ?? null;
  const fx =
    filingCcy && quoteCcy && filingCcy !== quoteCcy
      ? await fetchFx(yahoo, filingCcy, quoteCcy)
      : [];

  const quarters = cached
    .filter((r) => r.period_type === "q")
    .map((r) => ({ periodEnd: r.period_end, metrics: r.data }));
  const annual = cached
    .filter((r) => r.period_type === "a")
    .map((r) => ({ periodEnd: r.period_end, metrics: r.data }));

  // Public, identical for every user → cache at the CDN; SWR keeps it snappy.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=21600, stale-while-revalidate=86400",
  );
  res
    .status(200)
    .end(
      JSON.stringify({
        ok: true,
        ticker,
        backfilled,
        panel,
        prices,
        fx,
        quarters,
        annual,
      }),
    );
}
