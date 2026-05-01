import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_lib/db";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const symbolsParam = req.query.symbols;
  const symbols = (Array.isArray(symbolsParam) ? symbolsParam[0] : symbolsParam ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    res.status(200).json({ quotes: [] });
    return;
  }

  try {
    const sql = getSql();
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
