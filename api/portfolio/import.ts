import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../_lib/db";
import { getUserIdFromRequest } from "../_lib/auth";

// Vercel function config: extend timeout from the 10s default to 60s (max
// allowed on Hobby plan). Imports of large spreadsheets need the headroom.
export const config = {
  maxDuration: 60,
};

type ImportPayload = {
  transactions: Array<{
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
  dividends: Array<{ ticker: string; amount: number; date: string | null }>;
  interests: Array<{ date: string | null; amount: number }>;
  wealth: Array<{ category: "stocks" | "cash"; label: string; value: number }>;
};

const CHUNK = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    if (!process.env.DATABASE_URL) {
      res.status(500).json({ error: "DATABASE_URL not configured" });
      return;
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(401).json({ error: "Missing x-user-id header" });
      return;
    }

    let body: ImportPayload;
    try {
      body =
        typeof req.body === "string"
          ? (JSON.parse(req.body) as ImportPayload)
          : (req.body as ImportPayload);
    } catch (e) {
      res.status(400).json({ error: `Invalid JSON: ${(e as Error).message}` });
      return;
    }

    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Empty or invalid request body" });
      return;
    }

    const transactions = Array.isArray(body.transactions)
      ? body.transactions
      : [];
    const dividends = Array.isArray(body.dividends) ? body.dividends : [];
    const interests = Array.isArray(body.interests) ? body.interests : [];
    const wealth = Array.isArray(body.wealth) ? body.wealth : [];

    if (transactions.length > 5000) {
      res.status(413).json({ error: "Too many transactions (max 5000)" });
      return;
    }

    // Step 1 — clear the user's previous import.
    await Promise.all([
      sql`DELETE FROM transactions WHERE user_id = ${userId}`,
      sql`DELETE FROM dividends WHERE user_id = ${userId}`,
      sql`DELETE FROM interests WHERE user_id = ${userId}`,
      sql`DELETE FROM wealth_entries WHERE user_id = ${userId}`,
    ]);

    // Step 2 — bulk insert in chunks. Neon's HTTP driver supports
    // sql.transaction([q1, q2, ...]) which sends all statements in a single
    // HTTPS roundtrip. With chunks of 50, 182 rows = 4 calls instead of 182.
    for (const batch of chunk(transactions, CHUNK)) {
      const queries = batch.map(
        (t) => sql`
          INSERT INTO transactions
            (user_id, portfolio, ticker, shares, buy_price, buy_value, buy_date,
             sell_shares, sell_price, sell_value, sell_date, result)
          VALUES
            (${userId}, ${t.portfolio ?? "default"}, ${t.ticker},
             ${Number.isFinite(t.shares) ? t.shares : 0},
             ${t.buyPrice}, ${t.buyValue}, ${t.buyDate},
             ${t.sellShares}, ${t.sellPrice}, ${t.sellValue}, ${t.sellDate},
             ${t.result})
        `,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any).transaction(queries);
    }

    for (const batch of chunk(dividends, CHUNK)) {
      const queries = batch.map(
        (d) => sql`
          INSERT INTO dividends (user_id, ticker, amount, paid_at)
          VALUES (${userId}, ${d.ticker}, ${d.amount}, ${d.date})
        `,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any).transaction(queries);
    }

    for (const batch of chunk(interests, CHUNK)) {
      const queries = batch.map(
        (it) => sql`
          INSERT INTO interests (user_id, amount, paid_at)
          VALUES (${userId}, ${it.amount}, ${it.date})
        `,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any).transaction(queries);
    }

    for (const batch of chunk(wealth, CHUNK)) {
      const queries = batch.map((w) => {
        const cat = w.category === "cash" ? "cash" : "stocks";
        return sql`
          INSERT INTO wealth_entries (user_id, category, label, value)
          VALUES (${userId}, ${cat}, ${w.label}, ${w.value})
        `;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any).transaction(queries);
    }

    res.status(200).json({
      ok: true,
      counts: {
        transactions: transactions.length,
        dividends: dividends.length,
        interests: interests.length,
        wealth: wealth.length,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[import] crashed:", e);
    res.status(500).json({
      error: `Import crashed: ${(e as Error)?.message ?? "unknown error"}`,
    });
  }
}
