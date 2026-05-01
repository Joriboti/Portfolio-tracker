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
    res.status(200).end(JSON.stringify({ quotes: rows }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Prices query failed" }));
  }
}
