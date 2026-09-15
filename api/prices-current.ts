import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SKIP_TICKERS, loadCachedSymbols, normaliseTicker } from "./_ticker-resolve.js";

// Latest cached price per ticker, plus FX, plus — for any requested ticker
// that has no market symbol (skipped, or searched and not found) — an entry
// in `unavailable` so the dashboard can say "price unavailable" on that row
// instead of leaving it blank.

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
      .map(normaliseTicker)
      .filter(Boolean);

    if (symbols.length === 0) {
      res.status(200).end(JSON.stringify({ quotes: [], fxRates: {}, unavailable: {} }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);
    const [rows, fxRowsRaw, cached] = await Promise.all([
      sql`
        SELECT ticker, price, currency, as_of AS "asOf"
        FROM latest_prices
        WHERE ticker = ANY(${symbols})
      `,
      // Latest FX rate per quote currency (rates are quoted CURRENCY/USD).
      // The dashboard needs these to convert prices to the user's display
      // currency before summing — otherwise USD and EUR positions get added
      // as if they were the same unit.
      sql`
        SELECT DISTINCT ON (currency) currency, rate
        FROM fx_rates
        ORDER BY currency, as_of DESC
      `,
      loadCachedSymbols(sql, symbols),
    ]);
    const fxRows = fxRowsRaw as Array<{ currency: string; rate: string | number }>;

    const fxRates: Record<string, number> = {};
    for (const r of fxRows) {
      const n = typeof r.rate === "number" ? r.rate : parseFloat(String(r.rate));
      if (Number.isFinite(n)) fxRates[r.currency] = n;
    }

    const unavailable: Record<string, "skipped" | "unresolved"> = {};
    for (const s of symbols) {
      if (SKIP_TICKERS.has(s)) unavailable[s] = "skipped";
      else {
        const c = cached.get(s);
        if (c && !c.symbol) unavailable[s] = c.status === "skipped" ? "skipped" : "unresolved";
      }
    }

    res.status(200).end(JSON.stringify({ quotes: rows, fxRates, unavailable }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Prices query failed" }));
  }
}
