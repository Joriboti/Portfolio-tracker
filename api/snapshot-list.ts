import type { VercelRequest, VercelResponse } from "@vercel/node";

/** The owner's own issued cards, newest first — so they can see what is out
 *  there under their name and withdraw any of it. Bodies are not returned: the
 *  list is for managing links, not for re-reading figures. */
const MAX_ROWS = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
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

    const rows = await sql`
      SELECT code, issued_at_iso AS "issuedAt", tier, broker, amounts, digest,
             to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "revokedAt"
      FROM portfolio_snapshots
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${MAX_ROWS}
    `;

    res.status(200).end(JSON.stringify({ snapshots: rows }));
  } catch (e) {
    const err = e as Error;
    res.status(500).end(JSON.stringify({ error: err?.message ?? "Snapshot list failed" }));
  }
}
