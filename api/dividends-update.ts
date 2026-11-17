import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateCronOrUser } from "./_auth.js";
import { storageKey, symbolPairs } from "./_ticker-resolve.js";

export const config = { maxDuration: 60 };

const SUB_UNIT_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number | null;
  currency?: string | null;
};

type ChartDivEvent = { date: Date | string; amount: number };
type ChartResult = {
  events?: { dividends?: ChartDivEvent[] };
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const startMs = Date.now();

  try {
    res.setHeader("Content-Type", "application/json");

    const caller = await authenticateCronOrUser(req, res);
    if (!caller) return;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const dbMod = await import("@neondatabase/serverless");
    const sql = dbMod.neon(dbUrl);

    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (
      opts?: { suppressNotices?: string[] },
    ) => {
      quote: (symbol: string | string[]) => Promise<unknown>;
      chart: (
        symbol: string,
        opts: Record<string, unknown>,
      ) => Promise<unknown>;
      setGlobalConfig?: (cfg: {
        validation?: { logErrors?: boolean };
      }) => void;
    };
    const yahooFinance = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
    yahooFinance.setGlobalConfig?.({ validation: { logErrors: false } });

    const tickers = (await sql`
      SELECT DISTINCT ticker FROM transactions
    `) as Array<{ ticker: string }>;

    // Static map → Postgres cache of past Yahoo searches (api/_ticker-resolve).
    // Skipped and unresolved tickers are dropped here, so no Yahoo call is
    // wasted on them.
    const work: Array<{ original: string; mapped: string }> = (
      await symbolPairs(sql, tickers.map((r) => r.ticker))
    ).map((p) => ({ original: p.original, mapped: p.symbol }));

    const symbols = work.map((w) => w.mapped);

    const rawCurrencyBySymbol = new Map<string, string>();
    try {
      const all = (await yahooFinance.quote(symbols)) as
        | YahooQuote
        | YahooQuote[];
      const list = Array.isArray(all) ? all : [all];
      for (const q of list) {
        if (q.symbol && q.currency) {
          rawCurrencyBySymbol.set(q.symbol, q.currency);
        }
      }
    } catch {
      // proceed without — will default to USD
    }

    function normalizeCurrency(symbol: string): {
      divisor: number;
      currency: string;
    } {
      const rawCcy = rawCurrencyBySymbol.get(symbol) ?? "USD";
      const conv = SUB_UNIT_TO_MAJOR[rawCcy];
      if (conv) return { divisor: conv.divisor, currency: conv.major };
      return { divisor: 1, currency: rawCcy };
    }

    let tickersWithDividends = 0;
    let totalEvents = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    const BATCH = 8;
    for (let i = 0; i < work.length; i += BATCH) {
      const batch = work.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ original, mapped }) => {
          try {
            const chartData = (await yahooFinance.chart(mapped, {
              period1: "2010-01-01",
              events: "div",
            })) as ChartResult;

            const divEvents = chartData?.events?.dividends;
            if (!Array.isArray(divEvents) || divEvents.length === 0) {
              skipped.push(`${original} (no dividends)`);
              return;
            }

            const stored = storageKey(original);
            const { divisor, currency } = normalizeCurrency(mapped);

            const rows: Array<{ exDate: string; amount: number }> = [];
            for (const row of divEvents) {
              if (!row.date || !row.amount) continue;
              const exDate =
                row.date instanceof Date
                  ? row.date.toISOString().slice(0, 10)
                  : String(row.date).slice(0, 10);
              rows.push({ exDate, amount: row.amount / divisor });
            }

            for (const { exDate, amount } of rows) {
              await sql`
                INSERT INTO dividend_events (ticker, ex_date, amount, currency, source)
                VALUES (${stored}, ${exDate}, ${amount}, ${currency}, 'yahoo')
                ON CONFLICT (ticker, ex_date) DO UPDATE
                  SET amount = EXCLUDED.amount,
                      currency = EXCLUDED.currency
              `;
            }
            totalEvents += rows.length;
            tickersWithDividends++;
          } catch (e) {
            errors.push(`${original}: ${(e as Error).message}`);
          }
        }),
      );
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    res.status(200).end(
      JSON.stringify({
        ok: true,
        tickersWithDividends,
        totalEvents,
        skipped,
        tickers: work.length,
        elapsed: `${elapsed}s`,
        errors,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(
        JSON.stringify({ error: err?.message ?? "Dividend update failed" }),
      );
  }
}
