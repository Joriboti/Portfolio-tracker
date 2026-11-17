import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticate } from "./_auth.js";

export const config = { maxDuration: 60 };

type ImportPayload = {
  transactions?: Array<{
    ticker: string;
    shares: number;
    buyPrice: number | null;
    buyValue: number | null;
    buyDate: string | null;
    sellShares: number | null;
    sellPrice: number | null;
    sellValue: number | null;
    sellDate: string | null;
    result: number | null;
    portfolio: string;
  }>;
  dividends?: Array<{ ticker: string; amount: number; date: string | null }>;
  interests?: Array<{ date: string | null; amount: number }>;
  wealth?: Array<{ category: "stocks" | "cash"; label: string; value: number }>;
  // When true, append the given transactions to the existing portfolio instead
  // of replacing everything (used by the manual "Add holding" form). Only
  // transactions are appended in this mode.
  append?: boolean;
  // Re-point every row of one holding at a different market symbol, without
  // touching the rest of the portfolio (dashboard "change ticker"). Folded in
  // here rather than given its own route because the Hobby plan caps a
  // deployment at 12 serverless functions and we are at the cap.
  rename?: { from?: string; to?: string };
};

// Market symbols as Yahoo writes them: BRK-B, SAN.MC, BTC-EUR, ^GSPC, EURUSD=X.
const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

function normaliseTicker(raw: string | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

// Self-contained — mirrors the structure of /api/db-direct.ts exactly
// (which we know works) but with INSERTs instead of SELECT 1.
// No imports from _lib, no subdirectory.

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  let phase = "start";
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "POST") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    phase = "env-check";
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    phase = "auth";
    const userId = await authenticate(req, res);
    if (!userId) return;

    phase = "parse-body";
    const body: ImportPayload =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as ImportPayload)
        : ((req.body ?? {}) as ImportPayload);

    const transactions = body.transactions ?? [];
    const dividends = body.dividends ?? [];
    const interests = body.interests ?? [];
    const wealth = body.wealth ?? [];
    const append = body.append === true;

    phase = "neon-import";
    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    // Rename mode: swap the symbol on every row of one holding and stop. The
    // ticker IS the storage key everywhere (prices, historical_prices,
    // fundamentals, dividend_events are all shared per-ticker caches), so once
    // the user's rows point at the right symbol the normal price/backfill
    // refresh populates the new key and every downstream view follows.
    if (body.rename) {
      phase = "rename";
      const from = normaliseTicker(body.rename.from);
      const to = normaliseTicker(body.rename.to);
      if (!from || !to) {
        res.status(400).end(JSON.stringify({ error: "Invalid ticker" }));
        return;
      }
      if (from === to) {
        res.status(400).end(JSON.stringify({ error: "Tickers are identical" }));
        return;
      }
      const txnRows = await sql`
        UPDATE transactions SET ticker = ${to}
        WHERE user_id = ${userId} AND ticker = ${from}
        RETURNING id
      `;
      const divRows = await sql`
        UPDATE dividends SET ticker = ${to}
        WHERE user_id = ${userId} AND ticker = ${from}
        RETURNING id
      `;
      // Carry the saved valuation model over too, but never clobber one the
      // user already has under the target symbol (the PK is (user_id, ticker)).
      await sql`
        UPDATE holding_scenarios SET ticker = ${to}, updated_at = NOW()
        WHERE user_id = ${userId} AND ticker = ${from}
          AND NOT EXISTS (
            SELECT 1 FROM holding_scenarios
            WHERE user_id = ${userId} AND ticker = ${to}
          )
      `;
      res.status(200).end(
        JSON.stringify({
          ok: true,
          from,
          to,
          renamed: { transactions: txnRows.length, dividends: divRows.length },
        }),
      );
      return;
    }

    // Full import replaces the portfolio; append mode keeps it and only adds
    // the new transactions (manual "Add holding").
    if (!append) {
      phase = "delete-old";
      await sql`DELETE FROM transactions WHERE user_id = ${userId}`;
      await sql`DELETE FROM dividends WHERE user_id = ${userId}`;
      await sql`DELETE FROM interests WHERE user_id = ${userId}`;
      await sql`DELETE FROM wealth_entries WHERE user_id = ${userId}`;
    }

    // Every table is written as a handful of multi-row statements (unnest over
    // parallel arrays) rather than one INSERT per row: a 300-row Excel used to
    // cost 300 round trips to Neon — ten-plus seconds of the user staring at a
    // frozen button — and now costs one. Within a statement unnest keeps array
    // order, so ids (and therefore portfolio-get's ORDER BY id) still follow
    // the spreadsheet's row order.
    const ROWS_PER_STATEMENT = 500;
    const numOrNull = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const strOrNull = (v: unknown): string | null =>
      typeof v === "string" && v.length > 0 ? v : null;

    phase = "insert-transactions";
    for (let i = 0; i < transactions.length; i += ROWS_PER_STATEMENT) {
      const batch = transactions.slice(i, i + ROWS_PER_STATEMENT);
      await sql`
        INSERT INTO transactions
          (user_id, portfolio, ticker, shares, buy_price, buy_value, buy_date,
           sell_shares, sell_price, sell_value, sell_date, result)
        SELECT ${userId}, portfolio, ticker, shares, buy_price, buy_value, buy_date,
               sell_shares, sell_price, sell_value, sell_date, result
        FROM unnest(
          ${batch.map((t) => t.portfolio ?? "default")}::text[],
          ${batch.map((t) => t.ticker)}::text[],
          ${batch.map((t) => numOrNull(t.shares) ?? 0)}::numeric[],
          ${batch.map((t) => numOrNull(t.buyPrice))}::numeric[],
          ${batch.map((t) => numOrNull(t.buyValue))}::numeric[],
          ${batch.map((t) => strOrNull(t.buyDate))}::date[],
          ${batch.map((t) => numOrNull(t.sellShares))}::numeric[],
          ${batch.map((t) => numOrNull(t.sellPrice))}::numeric[],
          ${batch.map((t) => numOrNull(t.sellValue))}::numeric[],
          ${batch.map((t) => strOrNull(t.sellDate))}::date[],
          ${batch.map((t) => numOrNull(t.result))}::numeric[]
        ) AS u(portfolio, ticker, shares, buy_price, buy_value, buy_date,
               sell_shares, sell_price, sell_value, sell_date, result)
      `;
    }

    phase = "insert-dividends";
    for (let i = 0; i < dividends.length; i += ROWS_PER_STATEMENT) {
      const batch = dividends.slice(i, i + ROWS_PER_STATEMENT);
      await sql`
        INSERT INTO dividends (user_id, ticker, amount, paid_at)
        SELECT ${userId}, ticker, amount, paid_at
        FROM unnest(
          ${batch.map((d) => d.ticker)}::text[],
          ${batch.map((d) => numOrNull(d.amount) ?? 0)}::numeric[],
          ${batch.map((d) => strOrNull(d.date))}::date[]
        ) AS u(ticker, amount, paid_at)
      `;
    }

    phase = "insert-interests";
    for (let i = 0; i < interests.length; i += ROWS_PER_STATEMENT) {
      const batch = interests.slice(i, i + ROWS_PER_STATEMENT);
      await sql`
        INSERT INTO interests (user_id, amount, paid_at)
        SELECT ${userId}, amount, paid_at
        FROM unnest(
          ${batch.map((it) => numOrNull(it.amount) ?? 0)}::numeric[],
          ${batch.map((it) => strOrNull(it.date))}::date[]
        ) AS u(amount, paid_at)
      `;
    }

    phase = "insert-wealth";
    for (let i = 0; i < wealth.length; i += ROWS_PER_STATEMENT) {
      const batch = wealth.slice(i, i + ROWS_PER_STATEMENT);
      await sql`
        INSERT INTO wealth_entries (user_id, category, label, value)
        SELECT ${userId}, category, label, value
        FROM unnest(
          ${batch.map((w) => (w.category === "cash" ? "cash" : "stocks"))}::text[],
          ${batch.map((w) => w.label)}::text[],
          ${batch.map((w) => numOrNull(w.value) ?? 0)}::numeric[]
        ) AS u(category, label, value)
      `;
    }

    res.status(200).end(
      JSON.stringify({
        ok: true,
        counts: {
          transactions: transactions.length,
          dividends: dividends.length,
          interests: interests.length,
          wealth: wealth.length,
        },
      }),
    );
  } catch (e) {
    const err = e as Error;
    res.status(500).end(
      JSON.stringify({
        ok: false,
        phase,
        error: err?.message ?? "unknown",
        name: err?.name,
        stack: err?.stack?.slice(0, 1500),
      }),
    );
  }
}
