import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../_lib/db";

// Vercel Cron handler — fetch prices from Twelve Data once a day.
// Called via vercel.json cron at ~22:30 CET (after US market close).
//
// Twelve Data free tier: 8 req/min, 800/day. We use the batch /quote endpoint
// with up to 120 symbols per call.

const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const FX_PAIRS = ["EUR/USD", "GBP/USD", "CHF/USD"];

type TwelveQuote = {
  symbol: string;
  close?: string;
  price?: string;
  currency?: string;
  exchange?: string;
};

async function fetchQuotesBatch(
  symbols: string[],
  apiKey: string,
): Promise<TwelveQuote[]> {
  if (symbols.length === 0) return [];
  const url = new URL(`${TWELVE_DATA_BASE}/quote`);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`twelvedata quote failed: ${res.status}`);
  const data = (await res.json()) as Record<string, TwelveQuote> | TwelveQuote;
  if (Array.isArray(data)) return data;
  if ((data as TwelveQuote).symbol) return [data as TwelveQuote];
  return Object.values(data as Record<string, TwelveQuote>).filter(
    (v) => v && typeof v === "object" && "symbol" in v,
  );
}

async function fetchPrice(symbol: string, apiKey: string): Promise<number | null> {
  const url = new URL(`${TWELVE_DATA_BASE}/price`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = (await res.json()) as { price?: string };
  return data.price ? parseFloat(data.price) : null;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  // Allow GET (Vercel Cron) and POST (manual trigger)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authz = req.headers.authorization ?? "";
    if (authz !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "TWELVE_DATA_API_KEY not configured" });
    return;
  }

  const sql = await getSql();
  // Collect distinct tickers across all users.
  const tickers = (await sql`
    SELECT DISTINCT ticker FROM transactions
  `) as Array<{ ticker: string }>;
  const symbols: string[] = tickers.map((r) => r.ticker);

  let updated = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Process in chunks of 120 to respect free tier limits.
  for (let i = 0; i < symbols.length; i += 120) {
    const chunk = symbols.slice(i, i + 120);
    try {
      const quotes = await fetchQuotesBatch(chunk, apiKey);
      for (const q of quotes) {
        const priceStr = q.close ?? q.price;
        if (!q.symbol || !priceStr) continue;
        const price = parseFloat(priceStr);
        if (!Number.isFinite(price)) continue;
        const currency = q.currency ?? "USD";
        await sql`
          INSERT INTO prices (ticker, as_of, price, currency, source)
          VALUES (${q.symbol.toUpperCase()}, ${now}, ${price}, ${currency}, 'twelvedata')
          ON CONFLICT (ticker, as_of) DO UPDATE
            SET price = EXCLUDED.price,
                currency = EXCLUDED.currency
        `;
        updated++;
      }
    } catch (e) {
      errors.push(`chunk ${i}: ${(e as Error).message}`);
    }
  }

  // FX rates
  for (const pair of FX_PAIRS) {
    try {
      const rate = await fetchPrice(pair, apiKey);
      if (rate == null) continue;
      const currency = pair.split("/")[0];
      await sql`
        INSERT INTO fx_rates (currency, as_of, rate)
        VALUES (${currency}, ${now}, ${rate})
        ON CONFLICT (currency, as_of) DO UPDATE
          SET rate = EXCLUDED.rate
      `;
    } catch (e) {
      errors.push(`fx ${pair}: ${(e as Error).message}`);
    }
  }

  res.status(200).json({
    ok: true,
    updated,
    fxPairs: FX_PAIRS.length,
    tickers: symbols.length,
    errors,
  });
}
