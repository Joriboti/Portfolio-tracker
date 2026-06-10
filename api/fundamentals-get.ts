import type { VercelRequest, VercelResponse } from "@vercel/node";

// Read-only fundamentals lookup for the dashboard. Returns the cached rows
// from the `fundamentals` table for the requested tickers (the same storage
// keys the positions table uses). If the table doesn't exist yet (refresh
// never ran), responds with an empty list — the UI shows its "no data" state.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
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
        sector,
        industry,
        currency,
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
