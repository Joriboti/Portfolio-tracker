import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../_lib/db";
import { getUserIdFromRequest } from "../_lib/auth";

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
};

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

    const body: ImportPayload =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as ImportPayload)
        : ((req.body ?? {}) as ImportPayload);

    const transactions = body.transactions ?? [];
    const dividends = body.dividends ?? [];
    const interests = body.interests ?? [];
    const wealth = body.wealth ?? [];

    // Wipe previous data first.
    await sql`DELETE FROM transactions WHERE user_id = ${userId}`;
    await sql`DELETE FROM dividends WHERE user_id = ${userId}`;
    await sql`DELETE FROM interests WHERE user_id = ${userId}`;
    await sql`DELETE FROM wealth_entries WHERE user_id = ${userId}`;

    // Sequential inserts. Slow but predictable; with maxDuration=60 this is
    // safe for several hundred rows.
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
    for (const d of dividends) {
      await sql`
        INSERT INTO dividends (user_id, ticker, amount, paid_at)
        VALUES (${userId}, ${d.ticker}, ${d.amount}, ${d.date})
      `;
    }
    for (const it of interests) {
      await sql`
        INSERT INTO interests (user_id, amount, paid_at)
        VALUES (${userId}, ${it.amount}, ${it.date})
      `;
    }
    for (const w of wealth) {
      const cat = w.category === "cash" ? "cash" : "stocks";
      await sql`
        INSERT INTO wealth_entries (user_id, category, label, value)
        VALUES (${userId}, ${cat}, ${w.label}, ${w.value})
      `;
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
    console.error("[import] error:", e);
    res.status(500).json({
      error: `Import error: ${(e as Error)?.message ?? "unknown"}`,
    });
  }
}
