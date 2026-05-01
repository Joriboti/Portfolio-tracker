import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../_lib/db";
import { getUserIdFromRequest } from "../_lib/auth";

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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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

  const transactions = body.transactions ?? [];
  const dividends = body.dividends ?? [];
  const interests = body.interests ?? [];
  const wealth = body.wealth ?? [];

  try {
    // Wipe and replace this user's data.
    await Promise.all([
      sql`DELETE FROM transactions WHERE user_id = ${userId}`,
      sql`DELETE FROM dividends WHERE user_id = ${userId}`,
      sql`DELETE FROM interests WHERE user_id = ${userId}`,
      sql`DELETE FROM wealth_entries WHERE user_id = ${userId}`,
    ]);

    // Parallel inserts. Neon's serverless driver multiplexes over HTTP so this
    // is safe and ~10x faster than awaiting each insert sequentially.
    await Promise.all([
      ...transactions.map(
        (t) => sql`
          INSERT INTO transactions
            (user_id, portfolio, ticker, shares, buy_price, buy_value, buy_date,
             sell_shares, sell_price, sell_value, sell_date, result)
          VALUES
            (${userId}, ${t.portfolio}, ${t.ticker}, ${t.shares},
             ${t.buyPrice}, ${t.buyValue}, ${t.buyDate},
             ${t.sellShares}, ${t.sellPrice}, ${t.sellValue}, ${t.sellDate},
             ${t.result})
        `,
      ),
      ...dividends.map(
        (d) => sql`
          INSERT INTO dividends (user_id, ticker, amount, paid_at)
          VALUES (${userId}, ${d.ticker}, ${d.amount}, ${d.date})
        `,
      ),
      ...interests.map(
        (i) => sql`
          INSERT INTO interests (user_id, amount, paid_at)
          VALUES (${userId}, ${i.amount}, ${i.date})
        `,
      ),
      ...wealth.map(
        (w) => sql`
          INSERT INTO wealth_entries (user_id, category, label, value)
          VALUES (${userId}, ${w.category}, ${w.label}, ${w.value})
        `,
      ),
    ]);

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
    console.error("[import] failed:", e);
    res.status(500).json({
      error: `Import failed: ${(e as Error).message}`,
    });
  }
}
