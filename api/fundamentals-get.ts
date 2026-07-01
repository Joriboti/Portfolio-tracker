import type { VercelRequest, VercelResponse } from "@vercel/node";

// Read-only market-data lookup for the dashboard. Two modes:
//   • ?tickers=A,B  → cached rows from the `fundamentals` table (default).
//   • ?live=A,B     → live Yahoo market cap + price for arbitrary symbols,
//                     used by the Sum-of-the-Parts / NAV valuation (a holding's
//                     stakes aren't in the user's portfolio, so they aren't in
//                     the fundamentals table). Folded in here rather than a new
//                     route to stay under the Hobby plan's serverless-function
//                     limit. Per-ticker isolated: a bad symbol → null figures.
// If the fundamentals table doesn't exist yet, the cached mode responds with an
// empty list — the UI shows its "no data" state.

type YahooLiveQuote = {
  marketCap?: number | null;
  regularMarketPrice?: number | null;
  currency?: string | null;
};
type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
};
// Yahoo validates responses against a bundled schema and THROWS when the live
// payload drifts from it (e.g. search's typeDisp "Equity" vs the expected
// "equity"). We pass `{ validateResult: false }` so a harmless schema drift
// doesn't nuke an otherwise-good response.
type ModuleOpts = { validateResult?: boolean };
type YahooLiveClient = {
  quote: (symbol: string, q?: unknown, m?: ModuleOpts) => Promise<YahooLiveQuote>;
  search: (query: string, q?: unknown, m?: ModuleOpts) => Promise<{ quotes?: YahooSearchQuote[] }>;
  setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
};

async function makeYahoo(): Promise<YahooLiveClient> {
  const yfMod = await import("yahoo-finance2");
  const YahooFinance = yfMod.default as unknown as new (opts?: {
    suppressNotices?: string[];
  }) => YahooLiveClient;
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  yahoo.setGlobalConfig?.({ validation: { logErrors: false } });
  return yahoo;
}

async function handleSearch(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.search;
  const query = (Array.isArray(raw) ? raw[0] : (raw ?? "")).trim();
  if (query.length === 0) {
    res.status(200).end(JSON.stringify({ ok: true, results: [] }));
    return;
  }
  const yahoo = await makeYahoo();
  let quotes: YahooSearchQuote[] = [];
  try {
    const r = await yahoo.search(query, {}, { validateResult: false });
    quotes = r.quotes ?? [];
  } catch {
    quotes = [];
  }
  // Keep tradeable instruments with a symbol; drop indices/options/etc.
  const allowed = new Set(["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY", "CURRENCY"]);
  const results = quotes
    .filter((q) => q.symbol && (!q.quoteType || allowed.has(q.quoteType)))
    .slice(0, 8)
    .map((q) => ({
      symbol: q.symbol as string,
      name: q.longname ?? q.shortname ?? (q.symbol as string),
      exchange: q.exchange ?? null,
      type: q.quoteType ?? null,
    }));
  res.status(200).end(JSON.stringify({ ok: true, results }));
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function handleLiveQuotes(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.live;
  const tickers = (Array.isArray(raw) ? raw[0] : (raw ?? ""))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);
  if (tickers.length === 0) {
    res.status(200).end(JSON.stringify({ ok: true, quotes: [] }));
    return;
  }

  const yahoo = await makeYahoo();

  const quotes = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const q = await yahoo.quote(ticker, {}, { validateResult: false });
        return {
          ticker,
          marketCap: toNum(q.marketCap),
          price: toNum(q.regularMarketPrice),
          currency: q.currency ?? null,
        };
      } catch {
        return { ticker, marketCap: null, price: null, currency: null };
      }
    }),
  );
  res.status(200).end(JSON.stringify({ ok: true, quotes }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Live Yahoo quotes mode (SoTP / NAV) — no DB needed.
    if (req.query.live != null) {
      await handleLiveQuotes(req, res);
      return;
    }

    // Ticker search mode (manual "Add holding") — no DB needed.
    if (req.query.search != null) {
      await handleSearch(req, res);
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const symbolsParam = req.query.tickers;
    const tickers = (
      Array.isArray(symbolsParam) ? symbolsParam[0] : (symbolsParam ?? "")
    )
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (tickers.length === 0) {
      res.status(200).end(JSON.stringify({ ok: true, fundamentals: [] }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const tableCheck = (await sql`
      SELECT to_regclass('public.fundamentals') AS exists
    `) as Array<{ exists: string | null }>;
    if (!tableCheck[0]?.exists) {
      res.status(200).end(JSON.stringify({ ok: true, fundamentals: [] }));
      return;
    }

    const rows = await sql`
      SELECT
        ticker,
        trailing_pe   AS "trailingPe",
        forward_pe    AS "forwardPe",
        price_to_book AS "priceToBook",
        roe,
        profit_margin  AS "profitMargin",
        debt_to_equity AS "debtToEquity",
        dividend_yield AS "dividendYield",
        market_cap     AS "marketCap",
        eps,
        forward_eps        AS "forwardEps",
        free_cashflow      AS "freeCashflow",
        shares_outstanding AS "sharesOutstanding",
        total_debt         AS "totalDebt",
        total_cash         AS "totalCash",
        sector,
        industry,
        currency,
        website,
        updated_at     AS "updatedAt"
      FROM fundamentals
      WHERE ticker = ANY(${tickers}::text[])
    `;

    res.status(200).end(JSON.stringify({ ok: true, fundamentals: rows }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Fundamentals query failed" }));
  }
}
