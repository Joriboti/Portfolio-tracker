import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  makeYahooClient,
  refreshFundamentals,
  type SqlClient,
} from "./_fundamentals-core";

// Manual trigger for the fundamentals refresh (dashboard button). The weekly
// cron path lives in api/historical-backfill.ts; both share the core in
// api/_fundamentals-core.ts.

export const config = { maxDuration: 60 };

// Leave headroom inside maxDuration for the DB writes + response.
const TIME_BUDGET_MS = 50_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startMs = Date.now();
  try {
    res.setHeader("Content-Type", "application/json");

    const cronSecret = process.env.CRON_SECRET;
    const authz = req.headers.authorization ?? "";
    const cronOk = !cronSecret || authz === `Bearer ${cronSecret}`;
    const userId = req.headers["x-user-id"];
    if (!cronOk && !userId) {
      res.status(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const dbMod = await import("@neondatabase/serverless");
    const sql = dbMod.neon(dbUrl) as unknown as SqlClient;
    const yahoo = await makeYahooClient();

    const stats = await refreshFundamentals(sql, yahoo, startMs + TIME_BUDGET_MS);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    res.status(200).end(JSON.stringify({ ok: true, ...stats, elapsed: `${elapsed}s` }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Fundamentals refresh failed" }));
  }
}
