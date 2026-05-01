import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "../_lib/db";
import { getUserFromRequest, requireUser } from "../_lib/auth";

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
  wealth: Array<{
    category: "stocks" | "cash";
    label: string;
    value: number;
  }>;
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const user = await getUserFromRequest(req);
  try {
    requireUser(user);
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as ImportPayload;

  // Replace strategy: wipe user's previous import, then insert the new one.
  await sql`DELETE FROM transactions WHERE user_id = ${user.id}`;
  await sql`DELETE FROM dividends WHERE user_id = ${user.id}`;
  await sql`DELETE FROM interests WHERE user_id = ${user.id}`;
  await sql`DELETE FROM wealth_entries WHERE user_id = ${user.id}`;

  for (const t of body.transactions ?? []) {
    await sql`
      INSERT INTO transactions
        (user_id, portfolio, ticker, shares, buy_price, buy_value, buy_date,
         sell_shares, sell_price, sell_value, sell_date, result)
      VALUES
        (${user.id}, ${t.portfolio}, ${t.ticker}, ${t.shares},
         ${t.buyPrice}, ${t.buyValue}, ${t.buyDate},
         ${t.sellShares}, ${t.sellPrice}, ${t.sellValue}, ${t.sellDate},
         ${t.result})
    `;
  }

  for (const d of body.dividends ?? []) {
    await sql`
      INSERT INTO dividends (user_id, ticker, amount, paid_at)
      VALUES (${user.id}, ${d.ticker}, ${d.amount}, ${d.date})
    `;
  }

  for (const i of body.interests ?? []) {
    await sql`
      INSERT INTO interests (user_id, amount, paid_at)
      VALUES (${user.id}, ${i.amount}, ${i.date})
    `;
  }

  for (const w of body.wealth ?? []) {
    await sql`
      INSERT INTO wealth_entries (user_id, category, label, value)
      VALUES (${user.id}, ${w.category}, ${w.label}, ${w.value})
    `;
  }

  res.status(200).json({ ok: true });
}
