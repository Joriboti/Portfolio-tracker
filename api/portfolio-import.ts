import type { VercelRequest, VercelResponse } from "@vercel/node";

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
    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId || userId.length === 0 || userId.length > 128) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

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

    phase = "insert-transactions";
    for (const t of transactions) {
      await sql`
        INSERT INTO transactions
          (user_id, portfolio, ticker, shares, buy_price, buy_value, buy_date,
           sell_shares, sell_price, sell_value, sell_date, result)
        VALUES
          (${userId}, ${t.portfolio ?? "default"}, ${t.ticker},
           ${Number.isFinite(t.shares) ? t.shares : 0},
           ${t.buyPrice}, ${t.buyValue}, ${t.buyDate},
           ${t.sellShares}, ${t.sellPrice}, ${t.sellValue}, ${t.sellDate},
           ${t.result})
      `;
    }

    phase = "insert-dividends";
    for (const d of dividends) {
      await sql`
        INSERT INTO dividends (user_id, ticker, amount, paid_at)
        VALUES (${userId}, ${d.ticker}, ${d.amount}, ${d.date})
      `;
    }

    phase = "insert-interests";
    for (const it of interests) {
      await sql`
        INSERT INTO interests (user_id, amount, paid_at)
        VALUES (${userId}, ${it.amount}, ${it.date})
      `;
    }

    phase = "insert-wealth";
    for (const w of wealth) {
      const cat = w.category === "cash" ? "cash" : "stocks";
      await sql`
        INSERT INTO wealth_entries (user_id, category, label, value)
        VALUES (${userId}, ${cat}, ${w.label}, ${w.value})
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
