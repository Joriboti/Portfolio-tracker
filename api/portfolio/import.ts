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

// Run a list of async operations with a hard concurrency cap. Avoids opening
// hundreds of HTTP connections to Neon at once, which can crash the Vercel
// serverless function or trip Neon connection limits.
async function runBatched<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<unknown>,
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

    const transactions = Array.isArray(body.transactions) ? body.transactions : [];
    const dividends = Array.isArray(body.dividends) ? body.dividends : [];
    const interests = Array.isArray(body.interests) ? body.interests : [];
    const wealth = Array.isArray(body.wealth) ? body.wealth : [];

    // Sanity-check the sizes so a runaway payload doesn't time us out.
    if (transactions.length > 5000) {
      res.status(413).json({ error: "Too many transactions (max 5000)" });
      return;
    }

    // Wipe the user's previous data — these are independent so we can run
    // them in parallel.
    await Promise.all([
      sql`DELETE FROM transactions WHERE user_id = ${userId}`,
      sql`DELETE FROM dividends WHERE user_id = ${userId}`,
      sql`DELETE FROM interests WHERE user_id = ${userId}`,
      sql`DELETE FROM wealth_entries WHERE user_id = ${userId}`,
    ]);

    // Concurrency-capped inserts. Neon's HTTP driver can only handle a small
    // number of concurrent calls cleanly, so we keep it conservative.
    const errors: string[] = [];

    await runBatched(
      transactions,
      async (t, i) => {
        try {
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
        } catch (e) {
          errors.push(`tx[${i}] ${t.ticker}: ${(e as Error).message}`);
        }
      },
      5,
    );

    await runBatched(
      dividends,
      async (d, i) => {
        try {
          await sql`
            INSERT INTO dividends (user_id, ticker, amount, paid_at)
            VALUES (${userId}, ${d.ticker}, ${d.amount}, ${d.date})
          `;
        } catch (e) {
          errors.push(`dividend[${i}] ${d.ticker}: ${(e as Error).message}`);
        }
      },
      5,
    );

    await runBatched(
      interests,
      async (it, i) => {
        try {
          await sql`
            INSERT INTO interests (user_id, amount, paid_at)
            VALUES (${userId}, ${it.amount}, ${it.date})
          `;
        } catch (e) {
          errors.push(`interest[${i}]: ${(e as Error).message}`);
        }
      },
      5,
    );

    await runBatched(
      wealth,
      async (w, i) => {
        try {
          // Only allow valid category values — DB has a CHECK constraint.
          const cat = w.category === "cash" ? "cash" : "stocks";
          await sql`
            INSERT INTO wealth_entries (user_id, category, label, value)
            VALUES (${userId}, ${cat}, ${w.label}, ${w.value})
          `;
        } catch (e) {
          errors.push(`wealth[${i}] ${w.label}: ${(e as Error).message}`);
        }
      },
      5,
    );

    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.error("[import] partial failure:", errors.slice(0, 5));
    }

    res.status(200).json({
      ok: true,
      counts: {
        transactions: transactions.length,
        dividends: dividends.length,
        interests: interests.length,
        wealth: wealth.length,
      },
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[import] crashed:", e);
    res.status(500).json({
      error: `Import crashed: ${(e as Error)?.message ?? "unknown"}`,
      stack: process.env.NODE_ENV !== "production"
        ? (e as Error)?.stack
        : undefined,
    });
  }
}
