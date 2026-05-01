import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const FX_PAIRS = ["EUR/USD", "GBP/USD", "CHF/USD"];

// Map portfolio tickers to Twelve Data symbols. Add new entries here as they
// come up. Keys are normalised (uppercase, trimmed) before lookup.
const TICKER_MAP: Record<string, string> = {
  TESLA: "TSLA",
  ABERCROMBIE: "ANF",
  PINDUODUO: "PDD",
  SABADELL: "SAB.MC", // Banco Sabadell, Madrid
  IAG: "IAG.L", // International Airlines Group, London
  BBVA: "BBVA.MC",
  SILVER: "XAGUSD", // spot silver
  PALLADIUM: "XPDUSD", // spot palladium
  GOLD: "XAUUSD",
};

// Tickers we don't try to fetch — usually crypto under symbols Twelve Data
// doesn't recognise on the free tier, or non-tradable categories.
const SKIP_TICKERS = new Set([
  "ETH",
  "ADA",
  "BTC",
  "SOL",
  "DOT",
  "NBUS", // unknown
]);

function mapTicker(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  if (SKIP_TICKERS.has(key)) return null;
  return TICKER_MAP[key] ?? key;
}

async function fetchPrice(
  symbol: string,
  apiKey: string,
): Promise<{ price: number; currency: string } | null> {
  const url = new URL(`${TWELVE_DATA_BASE}/quote`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = (await res.json()) as {
    close?: string;
    price?: string;
    currency?: string;
    code?: number;
    status?: string;
    message?: string;
  };
  if (data.status === "error" || data.code) return null;
  const priceStr = data.close ?? data.price;
  if (!priceStr) return null;
  const price = parseFloat(priceStr);
  if (!Number.isFinite(price)) return null;
  return { price, currency: data.currency ?? "USD" };
}

async function fetchFx(
  pair: string,
  apiKey: string,
): Promise<number | null> {
  const url = new URL(`${TWELVE_DATA_BASE}/price`);
  url.searchParams.set("symbol", pair);
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = (await res.json()) as { price?: string };
  return data.price ? parseFloat(data.price) : null;
}

// Run async work with a hard concurrency cap so we don't blow the
// Twelve Data free-tier rate limit (8 calls/min on the free plan but
// in practice it accepts more if spaced).
async function runBatched<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  concurrency = 5,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    res.setHeader("Content-Type", "application/json");

    const cronSecret = process.env.CRON_SECRET;
    const authz = req.headers.authorization ?? "";
    const cronOk = !cronSecret || authz === `Bearer ${cronSecret}`;
    const userId = req.headers["x-user-id"];
    if (!cronOk && !userId) {
      res.status(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      res
        .status(500)
        .end(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const tickers = (await sql`
      SELECT DISTINCT ticker FROM transactions
    `) as Array<{ ticker: string }>;

    // Build a list of unique mapped symbols, remembering the original ticker
    // so we save the price under the name the dashboard queries by.
    const work: Array<{ original: string; mapped: string }> = [];
    const seen = new Set<string>();
    for (const row of tickers) {
      const mapped = mapTicker(row.ticker);
      if (!mapped) continue;
      if (seen.has(row.ticker)) continue;
      seen.add(row.ticker);
      work.push({ original: row.ticker.trim().toUpperCase(), mapped });
    }

    let updated = 0;
    const errors: string[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();

    await runBatched(
      work,
      async ({ original, mapped }) => {
        try {
          const quote = await fetchPrice(mapped, apiKey);
          if (!quote) {
            skipped.push(`${original} (${mapped})`);
            return;
          }
          await sql`
            INSERT INTO prices (ticker, as_of, price, currency, source)
            VALUES (${original}, ${now}, ${quote.price}, ${quote.currency}, 'twelvedata')
            ON CONFLICT (ticker, as_of) DO UPDATE
              SET price = EXCLUDED.price,
                  currency = EXCLUDED.currency
          `;
          updated++;
        } catch (e) {
          errors.push(`${original}: ${(e as Error).message}`);
        }
      },
      5,
    );

    let fxOk = 0;
    for (const pair of FX_PAIRS) {
      try {
        const rate = await fetchFx(pair, apiKey);
        if (rate == null) continue;
        const currency = pair.split("/")[0];
        await sql`
          INSERT INTO fx_rates (currency, as_of, rate)
          VALUES (${currency}, ${now}, ${rate})
          ON CONFLICT (currency, as_of) DO UPDATE
            SET rate = EXCLUDED.rate
        `;
        fxOk++;
      } catch (e) {
        errors.push(`fx ${pair}: ${(e as Error).message}`);
      }
    }

    res.status(200).end(
      JSON.stringify({
        ok: true,
        updated,
        skipped,
        fxOk,
        tickers: work.length,
        errors,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Update failed" }));
  }
}
