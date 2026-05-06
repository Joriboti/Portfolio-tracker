import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId || userId.length === 0 || userId.length > 128) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const [transactions, dividends, interests, wealth, last, dividendEvents] =
      await Promise.all([
        sql`
          SELECT
            ticker, shares,
            buy_price AS "buyPrice",
            buy_value AS "buyValue",
            to_char(buy_date, 'YYYY-MM-DD') AS "buyDate",
            sell_shares AS "sellShares",
            sell_price AS "sellPrice",
            sell_value AS "sellValue",
            to_char(sell_date, 'YYYY-MM-DD') AS "sellDate",
            result, portfolio
          FROM transactions
          WHERE user_id = ${userId}
          ORDER BY id ASC
        `,
        sql`
          SELECT ticker, amount, to_char(paid_at, 'YYYY-MM-DD') AS date
          FROM dividends
          WHERE user_id = ${userId}
          ORDER BY paid_at NULLS LAST
        `,
        sql`
          SELECT amount, to_char(paid_at, 'YYYY-MM-DD') AS date
          FROM interests
          WHERE user_id = ${userId}
          ORDER BY paid_at NULLS LAST
        `,
        sql`
          SELECT category, label, value
          FROM wealth_entries
          WHERE user_id = ${userId}
          ORDER BY id ASC
        `,
        sql`SELECT MAX(as_of) AS "lastPriceUpdate" FROM prices`,
        sql`
          SELECT ticker, to_char(ex_date, 'YYYY-MM-DD') AS "exDate",
                 amount, currency
          FROM dividend_events
          ORDER BY ticker, ex_date DESC
        `,
      ]);

    res.status(200).end(
      JSON.stringify({
        transactions,
        dividends,
        interests,
        wealth,
        dividendEvents,
        lastPriceUpdate:
          (last as Array<{ lastPriceUpdate: string | null }>)[0]
            ?.lastPriceUpdate ?? null,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Portfolio query failed" }));
  }
}
