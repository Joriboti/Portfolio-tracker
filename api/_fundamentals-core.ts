// Shared core of the fundamentals refresh — NOT a route (the underscore
// prefix keeps Vercel from exposing it as a serverless function). Imported
// statically by api/fundamentals-refresh.ts (manual dashboard button) and
// api/historical-backfill.ts (weekly cron piggy-back). Static imports are
// required: a dynamic relative import between api files doesn't survive
// Vercel's per-function bundling (extensionless ESM specifier fails to
// resolve at runtime in /var/task).
//
// Yahoo quoteSummary is fetched IN SERIES with a delay between tickers (it
// rate-limits aggressive parallel use), oldest-updated first, and stops
// before the serverless time budget runs out — the next invocation (next
// click or next weekly cron) continues where it left off. Every field can be
// null/undefined; rows are written with whatever came back.

import { symbolPairs } from "./_ticker-resolve.js";

const DELAY_BETWEEN_TICKERS_MS = 400;

// Crypto pseudo-tickers have no earnings/fundamentals — skip the Yahoo call
// entirely but still write a row (sector "Crypto") so the UI can group them.
const CRYPTO_TICKERS = new Set<string>(["BTC", "ETH", "ADA", "SOL", "DOT"]);

// Yahoo numbers sometimes arrive as {raw: n} wrappers depending on module —
// yahoo-finance2 usually unwraps, but be defensive. null/undefined → null.
function pickNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    return pickNum((v as Record<string, unknown>).raw);
  }
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

type QuoteSummaryShape = {
  summaryDetail?: Record<string, unknown>;
  defaultKeyStatistics?: Record<string, unknown>;
  financialData?: Record<string, unknown>;
  assetProfile?: Record<string, unknown>;
  price?: Record<string, unknown>;
};

type YahooClient = {
  quoteSummary: (
    symbol: string,
    opts: { modules: string[] },
  ) => Promise<QuoteSummaryShape>;
  setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SqlClient = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<unknown>;

export async function ensureFundamentalsTable(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS fundamentals (
      ticker          TEXT PRIMARY KEY,
      trailing_pe     NUMERIC(14, 4),
      forward_pe      NUMERIC(14, 4),
      price_to_book   NUMERIC(14, 4),
      roe             NUMERIC(14, 6),
      profit_margin   NUMERIC(14, 6),
      debt_to_equity  NUMERIC(14, 4),
      dividend_yield  NUMERIC(14, 6),
      market_cap      NUMERIC(24, 0),
      eps             NUMERIC(14, 4),
      sector          TEXT,
      industry        TEXT,
      currency        TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Additive column for DBs created before forward EPS was captured. Safe to
  // run every time (IF NOT EXISTS).
  await sql`
    ALTER TABLE fundamentals
      ADD COLUMN IF NOT EXISTS forward_eps NUMERIC(14, 4)
  `;
  // Additive columns powering the DCF / Reverse-DCF panel. Absolute values in
  // the company's financial currency.
  await sql`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS free_cashflow NUMERIC(24, 0)`;
  await sql`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS shares_outstanding NUMERIC(24, 0)`;
  await sql`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS total_debt NUMERIC(24, 0)`;
  await sql`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS total_cash NUMERIC(24, 0)`;
  // Company website — used to derive a logo domain on the dashboard.
  await sql`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS website TEXT`;
}

export type FundamentalsRefreshStats = {
  tickers: number;
  refreshed: number;
  skipped: string[];
  errors: string[];
  exhausted: boolean; // true = stopped on time budget, more pending
};

// Serial refresh with per-ticker isolation: one bad ticker (delisted,
// invented, Yahoo hiccup) is recorded in `errors` and the loop continues.
export async function refreshFundamentals(
  sql: SqlClient,
  yahoo: YahooClient,
  deadlineMs: number,
): Promise<FundamentalsRefreshStats> {
  await ensureFundamentalsTable(sql);

  // Everything the site covers, not just what someone happens to hold: the
  // portfolios, plus every company we keep financial statements for (the
  // curated /explore universe). Holdings alone left the fundamentals table at
  // 33 rows, which was fine while it only fed the dashboard — but the P/E
  // benchmark on the company pages is a median over this table, and a median
  // of "whatever these users own" is not the market.
  // financial_statements is created lazily by the company pages, so a database
  // that has never served one would make the UNION throw and take the whole
  // refresh with it.
  let rows: Array<{ ticker: string }>;
  try {
    rows = (await sql`
      SELECT DISTINCT ticker FROM transactions
      UNION
      SELECT DISTINCT ticker FROM financial_statements
    `) as Array<{ ticker: string }>;
  } catch {
    rows = (await sql`
      SELECT DISTINCT ticker FROM transactions
    `) as Array<{ ticker: string }>;
  }

  // original broker name → (stored key, yahoo symbol), deduped by stored key.
  // Static map → Postgres cache of past Yahoo searches (api/_ticker-resolve);
  // skipped and unresolved tickers never reach Yahoo.
  const work = new Map<string, { yahoo: string; crypto: boolean }>();
  for (const p of await symbolPairs(sql, rows.map((r) => r.ticker))) {
    if (!work.has(p.stored)) {
      work.set(p.stored, { yahoo: p.symbol, crypto: CRYPTO_TICKERS.has(p.stored) });
    }
  }

  // Stale-first: tickers with no row yet, then oldest updated_at. This makes
  // repeated invocations converge even when one run can't cover everything.
  const updatedAt = new Map<string, string>();
  try {
    const existing = (await sql`
      SELECT ticker, updated_at AS "updatedAt" FROM fundamentals
    `) as Array<{ ticker: string; updatedAt: string }>;
    for (const r of existing) updatedAt.set(r.ticker.toUpperCase(), r.updatedAt);
  } catch {
    /* table just created — everything is stale */
  }
  const queue = [...work.entries()].sort((a, b) => {
    const ua = updatedAt.get(a[0]) ?? "";
    const ub = updatedAt.get(b[0]) ?? "";
    return ua < ub ? -1 : ua > ub ? 1 : 0;
  });

  const stats: FundamentalsRefreshStats = {
    tickers: queue.length,
    refreshed: 0,
    skipped: [],
    errors: [],
    exhausted: false,
  };

  for (const [stored, info] of queue) {
    if (Date.now() > deadlineMs) {
      stats.exhausted = true;
      break;
    }
    try {
      if (info.crypto) {
        // No fundamentals to fetch; keep a typed row so sector grouping works.
        await sql`
          INSERT INTO fundamentals (ticker, sector, updated_at)
          VALUES (${stored}, 'Crypto', NOW())
          ON CONFLICT (ticker) DO UPDATE
            SET sector = 'Crypto', updated_at = NOW()
        `;
        stats.refreshed++;
        continue;
      }

      const qs = await yahoo.quoteSummary(info.yahoo, {
        modules: [
          "summaryDetail",
          "defaultKeyStatistics",
          "financialData",
          "assetProfile",
        ],
      });

      const sd = qs.summaryDetail ?? {};
      const ks = qs.defaultKeyStatistics ?? {};
      const fd = qs.financialData ?? {};
      const ap = qs.assetProfile ?? {};

      const trailingPe = pickNum(sd.trailingPE) ?? pickNum(ks.trailingPE);
      const forwardPe = pickNum(sd.forwardPE) ?? pickNum(ks.forwardPE);
      const priceToBook = pickNum(ks.priceToBook);
      const roe = pickNum(fd.returnOnEquity);
      const profitMargin = pickNum(fd.profitMargins) ?? pickNum(ks.profitMargins);
      const debtToEquity = pickNum(fd.debtToEquity);
      const dividendYield = pickNum(sd.dividendYield);
      const marketCap = pickNum(sd.marketCap) ?? pickNum(fd.marketCap);
      const eps = pickNum(ks.trailingEps);
      // Forward EPS for the scenario valuation base. Yahoo exposes it under
      // defaultKeyStatistics.forwardEps; financialData has no direct field, so
      // fall back to deriving it from forward P/E + current price when needed.
      const forwardEps =
        pickNum(ks.forwardEps) ??
        (forwardPe && forwardPe !== 0
          ? (pickNum(fd.currentPrice) ?? 0) / forwardPe || null
          : null);
      const sector = pickStr(ap.sector);
      const industry = pickStr(ap.industry);
      const currency = pickStr(fd.financialCurrency) ?? pickStr(sd.currency);
      const website = pickStr(ap.website);
      // DCF inputs. freeCashflow + totalDebt + totalCash live in financialData;
      // sharesOutstanding in defaultKeyStatistics (fall back to summaryDetail).
      const freeCashflow = pickNum(fd.freeCashflow);
      const sharesOutstanding =
        pickNum(ks.sharesOutstanding) ?? pickNum(sd.sharesOutstanding);
      const totalDebt = pickNum(fd.totalDebt);
      const totalCash = pickNum(fd.totalCash);

      await sql`
        INSERT INTO fundamentals (
          ticker, trailing_pe, forward_pe, price_to_book, roe, profit_margin,
          debt_to_equity, dividend_yield, market_cap, eps, forward_eps,
          free_cashflow, shares_outstanding, total_debt, total_cash, sector,
          industry, currency, website, updated_at
        ) VALUES (
          ${stored}, ${trailingPe}, ${forwardPe}, ${priceToBook}, ${roe},
          ${profitMargin}, ${debtToEquity}, ${dividendYield}, ${marketCap},
          ${eps}, ${forwardEps}, ${freeCashflow}, ${sharesOutstanding},
          ${totalDebt}, ${totalCash}, ${sector}, ${industry}, ${currency},
          ${website}, NOW()
        )
        ON CONFLICT (ticker) DO UPDATE SET
          trailing_pe = EXCLUDED.trailing_pe,
          forward_pe = EXCLUDED.forward_pe,
          price_to_book = EXCLUDED.price_to_book,
          roe = EXCLUDED.roe,
          profit_margin = EXCLUDED.profit_margin,
          debt_to_equity = EXCLUDED.debt_to_equity,
          dividend_yield = EXCLUDED.dividend_yield,
          market_cap = EXCLUDED.market_cap,
          eps = EXCLUDED.eps,
          forward_eps = EXCLUDED.forward_eps,
          free_cashflow = EXCLUDED.free_cashflow,
          shares_outstanding = EXCLUDED.shares_outstanding,
          total_debt = EXCLUDED.total_debt,
          total_cash = EXCLUDED.total_cash,
          sector = EXCLUDED.sector,
          industry = EXCLUDED.industry,
          currency = EXCLUDED.currency,
          website = EXCLUDED.website,
          updated_at = NOW()
      `;
      stats.refreshed++;
    } catch (e) {
      stats.errors.push(`${stored}: ${(e as Error).message}`);
    }
    await sleep(DELAY_BETWEEN_TICKERS_MS);
  }

  return stats;
}

export async function makeYahooClient(): Promise<YahooClient> {
  const yfMod = await import("yahoo-finance2");
  const YahooFinance = yfMod.default as unknown as new (opts?: {
    suppressNotices?: string[];
  }) => YahooClient;
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  yahoo.setGlobalConfig?.({ validation: { logErrors: false } });
  return yahoo;
}

