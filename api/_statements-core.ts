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
// beyond the shared Fundamentals shape) and `prices` (1y weekly closes for the
// price chart). Both best-effort: any Yahoo failure degrades to null/[] — this
// endpoint never 500s over a partial payload.

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
        ],
      },
      { validateResult: false },
    );
    const sd = qs.summaryDetail ?? {};
    const ks = qs.defaultKeyStatistics ?? {};
    const fd = qs.financialData ?? {};
    const ce = qs.calendarEvents ?? {};
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
    return {
      priceToSales: num(sd.priceToSalesTrailing12Months),
      evToEbitda: num(ks.enterpriseToEbitda),
      operatingMargin: num(fd.operatingMargins),
      grossMargin: num(fd.grossMargins),
      payoutRatio: num(sd.payoutRatio),
      dividendDate: isoDate(ce.dividendDate) ?? isoDate(sd.exDividendDate),
      nextYearEps,
      estimates,
    };
  } catch {
    return null;
  }
}

// 1y of weekly closes for the price chart. Live (not cached in Neon —
// historical_prices only covers portfolio tickers) but CDN-cached via the
// response's s-maxage.
async function fetchPrices(yahoo: YahooStatementsClient, ticker: string) {
  try {
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 366 * 24 * 3600 * 1000);
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

  // Optional one-shot deep-history backfill from SEC EDGAR (US filers only).
  // Explicit trigger (&backfill=edgar) — companyfacts is multi-MB, so it stays
  // off the hot path and is run once per ticker (rows persist forever). Only
  // fills periods Yahoo doesn't already cover: a ±20-day proximity guard drops
  // any EDGAR period near an existing one, avoiding fiscal-vs-calendar
  // near-duplicate bars at the boundary; ON CONFLICT DO NOTHING never
  // overwrites Yahoo data. Non-US tickers / EDGAR errors degrade to a no-op.
  if (sql && req.query.backfill === "edgar") {
    try {
      const { fetchEdgarStatements } = await import("./_edgar-core.js");
      const edgar = await fetchEdgarStatements(ticker);
      if (edgar && edgar.length > 0) {
        // Proximity set = existing periods that actually carry data. Yahoo
        // occasionally leaves an all-null placeholder row (odd report date, no
        // usable metrics); those must NOT block EDGAR from filling that period.
        const hasData = (m: StatementMetrics) =>
          Object.values(m).some((v) => v != null);
        const existing: Record<string, number[]> = { q: [], a: [] };
        for (const r of cached) {
          if (!hasData(r.data)) continue;
          (existing[r.period_type] ?? (existing[r.period_type] = [])).push(
            Date.parse(r.period_end),
          );
        }
        const near = (isoDay: string, type: string) => {
          const d = Date.parse(isoDay);
          return (existing[type] ?? []).some(
            (m) => Math.abs(m - d) < 20 * 24 * 3600 * 1000,
          );
        };
        let inserted = 0;
        for (const row of edgar) {
          if (near(row.periodEnd, row.periodType)) continue;
          try {
            await sql`
              INSERT INTO financial_statements (ticker, period_end, period_type, data, fetched_at)
              VALUES (${ticker}, ${row.periodEnd}, ${row.periodType}, ${JSON.stringify(row.metrics)}::jsonb, NOW())
              ON CONFLICT (ticker, period_end, period_type) DO NOTHING
            `;
            inserted++;
          } catch {
            /* one bad row must not sink the rest */
          }
        }
        if (inserted > 0) {
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
    } catch {
      /* EDGAR module/network unavailable → Yahoo-only, no-op */
    }
  }

  // Panel extras + price series (parallel, both best-effort).
  const [panel, prices] = await Promise.all([
    fetchPanel(yahoo, ticker),
    fetchPrices(yahoo, ticker),
  ]);

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
  res.status(200).end(JSON.stringify({ ok: true, ticker, panel, prices, quarters, annual }));
}
