import type { VercelRequest, VercelResponse } from "@vercel/node";
import { computeAnalytics } from "../src/lib/analytics";

// Reads the user's open positions + the latest-quote weight derivation +
// the shared `historical_prices` rows for those tickers and the benchmark,
// then runs the pure-math computeAnalytics() to produce {beta, alpha, etc.}.
//
// This endpoint is read-only. It never writes to the DB. Backfill is a
// separate endpoint (`api/historical-backfill.ts`).

const BENCHMARK_KEY = "^GSPC";
const DEFAULT_RISK_FREE = 0.03;
const MIN_WEEKS = 26;

type FxRow = { currency: string; rate: string | number };
type PriceRow = { ticker: string; price: string | number; currency: string };
type TxnRow = {
  ticker: string;
  shares: string | number;
  buyShares: string | number | null;
  buyPrice: string | number | null;
  buyValue: string | number | null;
  buyDate: string | null;
  sellShares: string | number | null;
  sellPrice: string | number | null;
  sellValue: string | number | null;
  sellDate: string | null;
  result: string | number | null;
};
type HistRow = {
  ticker: string;
  weekDate: string;
  close: string | number;
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    // Optional ?rf= query param (e.g. ?rf=0.04 for 4%). Clamped to a sane
    // range so junk input doesn't produce nonsense alpha.
    const rfParam = req.query.rf;
    const rfRaw =
      typeof rfParam === "string"
        ? parseFloat(rfParam)
        : Array.isArray(rfParam) && rfParam[0]
          ? parseFloat(rfParam[0])
          : DEFAULT_RISK_FREE;
    const riskFreeRate =
      Number.isFinite(rfRaw) && rfRaw >= -0.05 && rfRaw <= 0.2
        ? rfRaw
        : DEFAULT_RISK_FREE;

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    // Detect missing table gracefully. If the backfill endpoint has never
    // been called, historical_prices simply won't exist and we want the
    // frontend to see a clear "needs-backfill" state instead of a 500.
    const tableCheck = (await sql`
      SELECT to_regclass('public.historical_prices') AS exists
    `) as Array<{ exists: string | null }>;
    if (!tableCheck[0]?.exists) {
      res.status(200).end(
        JSON.stringify({
          ok: true,
          ready: false,
          reason: "historical_prices table not yet created",
        }),
      );
      return;
    }

    // 1. Pull the user's transactions (same shape portfolio-get returns).
    const txnRows = (await sql`
      SELECT
        ticker, shares,
        buy_price AS "buyPrice",
        buy_value AS "buyValue",
        to_char(buy_date, 'YYYY-MM-DD') AS "buyDate",
        sell_shares AS "sellShares",
        sell_price AS "sellPrice",
        sell_value AS "sellValue",
        to_char(sell_date, 'YYYY-MM-DD') AS "sellDate",
        result
      FROM transactions
      WHERE user_id = ${userId}
    `) as TxnRow[];

    // 2. Compute net shares per ticker (same logic as the parser, but
    // simpler: we only need open positions for weight derivation).
    const sharesByTicker = new Map<string, number>();
    for (const t of txnRows) {
      const ticker = t.ticker.trim().toUpperCase();
      const buyShares = toNum(t.shares);
      const sellShares = toNum(t.sellShares);
      const prev = sharesByTicker.get(ticker) ?? 0;
      sharesByTicker.set(ticker, prev + buyShares - sellShares);
    }
    // Drop closed/zero positions
    const openTickers = [...sharesByTicker.entries()]
      .filter(([, s]) => s > 1e-6)
      .map(([ticker, shares]) => ({ ticker, shares }));

    if (openTickers.length === 0) {
      res
        .status(200)
        .end(JSON.stringify({ ok: true, ready: false, reason: "no positions" }));
      return;
    }

    const tickerList = openTickers.map((p) => p.ticker);

    // 3. Latest quotes for weight derivation
    const priceRows = (await sql`
      SELECT ticker, price, currency
      FROM latest_prices
      WHERE ticker = ANY(${tickerList}::text[])
    `) as PriceRow[];
    const priceByTicker = new Map<
      string,
      { price: number; currency: string }
    >();
    for (const r of priceRows) {
      priceByTicker.set(r.ticker.toUpperCase(), {
        price: toNum(r.price),
        currency: r.currency,
      });
    }

    // FX rates (CURRENCY per 1 USD). Used to normalize position values
    // to EUR so weights are comparable across listing currencies.
    const fxRows = (await sql`
      SELECT DISTINCT ON (currency) currency, rate
      FROM fx_rates
      ORDER BY currency, as_of DESC
    `) as FxRow[];
    const fxRates: Record<string, number> = {};
    for (const r of fxRows) fxRates[r.currency] = toNum(r.rate);

    function toEUR(amount: number, fromCcy: string): number {
      if (fromCcy === "EUR") return amount;
      const rateFrom = fromCcy === "USD" ? 1 : fxRates[fromCcy];
      const rateEUR = fxRates["EUR"];
      if (!rateFrom || !rateEUR) return amount;
      const inUSD = fromCcy === "USD" ? amount : amount * rateFrom;
      return inUSD / rateEUR;
    }

    // 4. Build weights from market value in EUR. Tickers without a quote
    // are weighted by their cost basis (the buyValue sum in EUR) as a
    // best-effort fallback.
    const costByTicker = new Map<string, number>();
    for (const t of txnRows) {
      const ticker = t.ticker.trim().toUpperCase();
      const cost = toNum(t.buyValue);
      costByTicker.set(ticker, (costByTicker.get(ticker) ?? 0) + cost);
    }

    const valueByTicker = new Map<string, number>();
    for (const { ticker, shares } of openTickers) {
      const q = priceByTicker.get(ticker);
      let value: number;
      if (q && q.price > 0) {
        value = toEUR(q.price * shares, q.currency);
      } else {
        value = costByTicker.get(ticker) ?? 0;
      }
      if (value > 0) valueByTicker.set(ticker, value);
    }

    const totalValue = [...valueByTicker.values()].reduce((s, v) => s + v, 0);
    if (totalValue <= 0) {
      res
        .status(200)
        .end(JSON.stringify({ ok: true, ready: false, reason: "zero value" }));
      return;
    }

    const weightByTicker: Record<string, number> = {};
    for (const [ticker, value] of valueByTicker) {
      weightByTicker[ticker] = value / totalValue;
    }

    // 5. Pull historical prices for all those tickers + the benchmark
    const histTickers = [...Object.keys(weightByTicker), BENCHMARK_KEY];
    const histRows = (await sql`
      SELECT ticker, to_char(week_date, 'YYYY-MM-DD') AS "weekDate", close
      FROM historical_prices
      WHERE ticker = ANY(${histTickers}::text[])
      ORDER BY ticker, week_date ASC
    `) as HistRow[];

    const pricesByTicker: Record<
      string,
      Array<{ weekDate: string; close: number }>
    > = {};
    for (const r of histRows) {
      const t = r.ticker.toUpperCase();
      const arr = pricesByTicker[t] ?? [];
      arr.push({ weekDate: r.weekDate, close: toNum(r.close) });
      pricesByTicker[t] = arr;
    }

    // 6. Run the pure math
    const result = computeAnalytics({
      pricesByTicker,
      weightByTicker,
      benchmarkKey: BENCHMARK_KEY,
      riskFreeRate,
      periodsPerYear: 52,
      minWeeks: MIN_WEEKS,
    });

    res.status(200).end(
      JSON.stringify({
        ok: true,
        ready: result.metrics != null,
        metrics: result.metrics,
        excludedTickers: result.excludedTickers,
        includedTickers: result.includedTickers,
        includedWeight: result.reweightedWeightSum,
        benchmark: BENCHMARK_KEY,
        riskFreeRate,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Analytics failed" }));
  }
}
