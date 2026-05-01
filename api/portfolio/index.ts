import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../_lib/db";
import { getUserIdFromRequest } from "../_lib/auth";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
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

  try {
    const [transactions, dividends, interests, wealth, last] = await Promise.all([
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
    ]);

    res.status(200).json({
      transactions,
      dividends,
      interests,
      wealth,
      lastPriceUpdate:
        (last as Array<{ lastPriceUpdate: string | null }>)[0]
          ?.lastPriceUpdate ?? null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[portfolio GET] failed:", e);
    res
      .status(500)
      .json({ error: `Portfolio query failed: ${(e as Error).message}` });
  }
}
