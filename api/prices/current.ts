import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    res.status(500).json({ error: "DATABASE_URL not configured" });
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
    res.status(200).json({ quotes: [] });
    return;
  }

  try {
    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);
    const rows = await sql`
      SELECT ticker, price, currency, as_of AS "asOf"
      FROM latest_prices
      WHERE ticker = ANY(${symbols})
    `;
    res.status(200).json({ quotes: rows });
  } catch (e) {
    res
      .status(500)
      .json({ error: `Prices query failed: ${(e as Error).message}` });
  }
}
