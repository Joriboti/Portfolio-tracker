import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storageKey, symbolPairs } from "./_ticker-resolve.js";
import {
  makeYahooClient,
  refreshFundamentals,
  type SqlClient,
} from "./_fundamentals-core.js";

// Backfills the `historical_prices` table with 3 years of weekly closes for
// every ticker held by any user, plus the analytics benchmark (^GSPC).
// Idempotent: re-running just upserts the same rows. Designed to be called
// weekly by Vercel cron, plus manually after a new import.

export const config = { maxDuration: 60 };

const SUB_UNIT_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

// Benchmark used by the analytics layer. Hardcoded — see vercel.json cron
// for refresh cadence. Stored under the literal "^GSPC" key.
const BENCHMARK_SYMBOL = "^GSPC";

// FX history feeds the value-based annual return (api/performance.ts), which
// needs the EUR/USD (etc.) rate AS OF each historical date to convert USD- and
// crypto-denominated holdings to EUR at the right point in time. Stored under
// their literal Yahoo symbols so the consumer can read them directly.
const FX_SYMBOLS = ["EURUSD=X", "GBPUSD=X", "CHFUSD=X"];
const LITERAL_SYMBOLS = new Set<string>([BENCHMARK_SYMBOL, ...FX_SYMBOLS]);

type ChartQuote = {
  date: Date | string;
  close?: number | null;
  adjclose?: number | null;
};

type ChartResult = {
  meta?: { currency?: string | null };
  quotes?: ChartQuote[];
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const startMs = Date.now();

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

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const dbMod = await import("@neondatabase/serverless");
    const sql = dbMod.neon(dbUrl);

    // Idempotent migration. Safe on every invocation — no-op if the table
    // already exists. Avoids needing a separate migration step.
    await sql`
      CREATE TABLE IF NOT EXISTS historical_prices (
        ticker      TEXT NOT NULL,
        week_date   DATE NOT NULL,
        close       NUMERIC(20, 8) NOT NULL,
        currency    TEXT NOT NULL DEFAULT 'USD',
        source      TEXT NOT NULL DEFAULT 'yahoo',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ticker, week_date)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_historical_prices_ticker_recent
        ON historical_prices (ticker, week_date DESC)
    `;

    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (
      opts?: { suppressNotices?: string[] },
    ) => {
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

    // 3 years back from today, rounded to start of the week to keep the
    // request boundary predictable.
    const period1 = new Date();
    period1.setUTCFullYear(period1.getUTCFullYear() - 3);

    const tickers = (await sql`
      SELECT DISTINCT ticker FROM transactions
    `) as Array<{ ticker: string }>;

    // Static map → Postgres cache of past Yahoo searches (api/_ticker-resolve).
    // Skipped and unresolved tickers are dropped here, so no Yahoo call is
    // wasted on them.
    const work: Array<{ original: string; mapped: string }> = (
      await symbolPairs(sql, tickers.map((r) => r.ticker))
    ).map((p) => ({ original: p.original, mapped: p.symbol }));
    // Benchmark + FX are special-cased: stored under their Yahoo symbol so the
    // consumers can join directly without going through the storage alias map.
    work.push({ original: BENCHMARK_SYMBOL, mapped: BENCHMARK_SYMBOL });
    for (const fx of FX_SYMBOLS) work.push({ original: fx, mapped: fx });

    let tickersDone = 0;
    let totalRows = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    const BATCH = 6;
    for (let i = 0; i < work.length; i += BATCH) {
      const batch = work.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ original, mapped }) => {
          try {
            const chartData = (await yahooFinance.chart(mapped, {
              period1,
              interval: "1wk",
            })) as ChartResult;

            const quotes = chartData?.quotes;
            if (!Array.isArray(quotes) || quotes.length === 0) {
              skipped.push(`${original} (no quotes)`);
              return;
            }

            const rawCcy = chartData?.meta?.currency ?? "USD";
            const conv = SUB_UNIT_TO_MAJOR[rawCcy];
            const divisor = conv?.divisor ?? 1;
            const currency = conv?.major ?? rawCcy;

            // For the benchmark and FX pairs we store under the literal
            // symbol; for user tickers we apply the storage alias so analytics
            // can join against the same key the transactions table uses.
            const stored = LITERAL_SYMBOLS.has(original)
              ? original
              : storageKey(original);

            // Yahoo dates weekly bars at the period START (Monday for
            // equities) while the close they carry is the END of the week.
            // Shift each bar to the Friday of its week — capped at today for
            // the in-progress week — so consumers don't see Friday's close
            // stamped ~5 days early. Dedupe by date keeping the latest bar
            // (the capped current-week bar can collide after shifting).
            const todayStr = new Date().toISOString().slice(0, 10);
            const byDate = new Map<string, number>();
            for (const q of quotes) {
              const closeRaw = q.close ?? q.adjclose;
              if (closeRaw == null) continue;
              const close = Number(closeRaw) / divisor;
              if (!Number.isFinite(close) || close <= 0) continue;
              const d =
                q.date instanceof Date ? q.date : new Date(String(q.date));
              if (Number.isNaN(d.getTime())) continue;
              d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
              let weekDate = d.toISOString().slice(0, 10);
              if (weekDate > todayStr) weekDate = todayStr;
              byDate.set(weekDate, close);
            }
            const rows = [...byDate.entries()].map(([weekDate, close]) => ({
              weekDate,
              close,
            }));

            // Bulk insert via UNNEST: one round-trip per ticker instead
            // of one per row. 156 weeks × 50 tickers in individual INSERTs
            // would blow the 60s Vercel function budget — this keeps the
            // whole job under ~30s even on a cold start.
            if (rows.length > 0) {
              const dateArr = rows.map((r) => r.weekDate);
              const closeArr = rows.map((r) => r.close);
              // Drop rows on dates the fresh fetch no longer produces —
              // notably the Monday-dated bars stored before the Friday shift.
              await sql`
                DELETE FROM historical_prices
                WHERE ticker = ${stored}
                  AND week_date <> ALL(${dateArr}::date[])
              `;
              await sql`
                INSERT INTO historical_prices (ticker, week_date, close, currency, source)
                SELECT ${stored} AS ticker, d::date, c::numeric, ${currency} AS currency, 'yahoo' AS source
                FROM UNNEST(${dateArr}::text[], ${closeArr}::numeric[]) AS u(d, c)
                ON CONFLICT (ticker, week_date) DO UPDATE
                  SET close = EXCLUDED.close,
                      currency = EXCLUDED.currency
              `;
              totalRows += rows.length;
              tickersDone++;
            }
          } catch (e) {
            errors.push(`${original}: ${(e as Error).message}`);
          }
        }),
      );
    }

    // Piggy-back the weekly fundamentals refresh on this cron (Hobby plan:
    // no cron slots left). Time-budgeted and fully isolated: any failure here
    // — Yahoo, DB — is reported but never breaks the price backfill.
    let fundamentals: Record<string, unknown> | null = null;
    try {
      const fundamentalsYahoo = await makeYahooClient();
      fundamentals = (await refreshFundamentals(
        sql as unknown as SqlClient,
        fundamentalsYahoo,
        startMs + 50_000,
      )) as unknown as Record<string, unknown>;
    } catch (e) {
      fundamentals = { error: (e as Error).message };
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    res.status(200).end(
      JSON.stringify({
        ok: true,
        tickers: work.length,
        tickersDone,
        totalRows,
        skipped,
        elapsed: `${elapsed}s`,
        errors,
        fundamentals,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(
        JSON.stringify({ error: err?.message ?? "Historical backfill failed" }),
      );
  }
}
