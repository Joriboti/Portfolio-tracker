import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const transactions = await sql`
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
    WHERE user_id = ${user.id}
    ORDER BY id ASC
  `;

  const dividends = await sql`
    SELECT
      ticker, amount,
      to_char(paid_at, 'YYYY-MM-DD') AS date
    FROM dividends
    WHERE user_id = ${user.id}
    ORDER BY paid_at NULLS LAST
  `;

  const interests = await sql`
    SELECT
      amount,
      to_char(paid_at, 'YYYY-MM-DD') AS date
    FROM interests
    WHERE user_id = ${user.id}
    ORDER BY paid_at NULLS LAST
  `;

  const wealth = await sql`
    SELECT category, label, value
    FROM wealth_entries
    WHERE user_id = ${user.id}
    ORDER BY id ASC
  `;

  const last = await sql`
    SELECT MAX(as_of) AS "lastPriceUpdate" FROM prices
  `;

  res.status(200).json({
    transactions,
    dividends,
    interests,
    wealth,
    lastPriceUpdate: last[0]?.lastPriceUpdate ?? null,
  });
}
