import type { VercelRequest, VercelResponse } from "@vercel/node";

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

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const symbolsParam = req.query.symbols;
    const symbols = (
      Array.isArray(symbolsParam) ? symbolsParam[0] : (symbolsParam ?? "")
    )
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length === 0) {
      res.status(200).end(JSON.stringify({ quotes: [] }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);
    const rows = await sql`
      SELECT ticker, price, currency, as_of AS "asOf"
      FROM latest_prices
      WHERE ticker = ANY(${symbols})
    `;
    // Latest FX rate per quote currency (rates are quoted CURRENCY/USD).
    // The dashboard needs these to convert prices to the user's display
    // currency before summing — otherwise USD and EUR positions get added
    // as if they were the same unit.
    const fxRows = (await sql`
      SELECT DISTINCT ON (currency) currency, rate
      FROM fx_rates
      ORDER BY currency, as_of DESC
    `) as Array<{ currency: string; rate: string | number }>;
    const fxRates: Record<string, number> = {};
    for (const r of fxRows) {
      const n = typeof r.rate === "number" ? r.rate : parseFloat(String(r.rate));
      if (Number.isFinite(n)) fxRates[r.currency] = n;
    }
    res.status(200).end(JSON.stringify({ quotes: rows, fxRates }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Prices query failed" }));
  }
}
