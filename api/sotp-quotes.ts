import type { VercelRequest, VercelResponse } from "@vercel/node";

// Live market-cap lookup for the Sum-of-the-Parts / NAV valuation. Given a
// comma-separated list of sub-holding tickers (real Yahoo symbols the user
// enters manually — a holding's stakes are not in their own portfolio), return
// each one's market cap + quote currency straight from Yahoo. No DB, no auth:
// this is public market data, mirroring how the dashboard treats quotes.
//
// Per-ticker isolation: a bad/invalid symbol yields a null market cap in the
// row rather than failing the whole request, so the client can degrade to the
// user's manual value for that holding.

type YahooQuote = {
  marketCap?: number | null;
  regularMarketPrice?: number | null;
  currency?: string | null;
};

type YahooClient = {
  quote: (symbol: string) => Promise<YahooQuote>;
  setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const tickersParam = req.query.tickers;
    const tickers = (
      Array.isArray(tickersParam) ? tickersParam[0] : (tickersParam ?? "")
    )
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 40); // sanity cap

    if (tickers.length === 0) {
      res.status(200).end(JSON.stringify({ ok: true, quotes: [] }));
      return;
    }

    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (opts?: {
      suppressNotices?: string[];
    }) => YahooClient;
    const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    yahoo.setGlobalConfig?.({ validation: { logErrors: false } });

    const quotes = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const q = await yahoo.quote(ticker);
          return {
            ticker,
            marketCap: numOrNull(q.marketCap),
            price: numOrNull(q.regularMarketPrice),
            currency: q.currency ?? null,
          };
        } catch {
          return { ticker, marketCap: null, price: null, currency: null };
        }
      }),
    );

    res.status(200).end(JSON.stringify({ ok: true, quotes }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "SoTP quotes failed" }));
  }
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
