import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CODE_RE } from "./_snapshot-core.js";

/**
 * Withdraw a card the owner had shared. The row is kept and stamped rather than
 * deleted, so a link already sitting in someone's DMs resolves to an explicit
 * "no longer vouched for" instead of a 404 that looks like it never existed.
 *
 * Revocation is idempotent: revoking twice keeps the first timestamp.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "POST") {
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

    const body = (req.body ?? {}) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!CODE_RE.test(code)) {
      res.status(400).end(JSON.stringify({ error: "Invalid code" }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    // The user_id predicate is the authorisation: a code you do not own simply
    // does not match, and is reported as unknown.
    const updated = (await sql`
      UPDATE portfolio_snapshots
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE code = ${code} AND user_id = ${userId}
      RETURNING code,
        to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "revokedAt"
    `) as Array<{ code: string; revokedAt: string }>;

    if (updated.length === 0) {
      res.status(404).end(JSON.stringify({ error: "Unknown code" }));
      return;
    }

    res.status(200).end(JSON.stringify(updated[0]));
  } catch (e) {
    const err = e as Error;
    res.status(500).end(JSON.stringify({ error: err?.message ?? "Snapshot revoke failed" }));
  }
}
