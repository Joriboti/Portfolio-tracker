import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  digestInput,
  generateCode,
  getSecret,
  hmacHex,
  sha256Hex,
  validateCanonicalBody,
} from "./_snapshot-core.js";

/** Ceiling on cards issued per account per day — a public endpoint that writes
 *  rows needs one, and nobody legitimately publishes 50 portfolios a day. */
const DAILY_LIMIT = 50;

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
    const secret = getSecret();
    if (!secret) {
      // Without a key we could still store a snapshot, but the badge would be
      // unsigned — a verification feature that verifies nothing. Fail loudly.
      res.status(500).end(
        JSON.stringify({
          error: "SNAPSHOT_SECRET not configured (needs a random string of 16+ chars)",
        }),
      );
      return;
    }

    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId || userId.length === 0 || userId.length > 128) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

    const body = (req.body ?? {}) as { canonical?: unknown };
    const canonical = typeof body.canonical === "string" ? body.canonical : "";

    let meta;
    try {
      meta = validateCanonicalBody(canonical);
    } catch (e) {
      res.status(400).end(JSON.stringify({ error: (e as Error).message }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const recent = (await sql`
      SELECT COUNT(*)::int AS n
      FROM portfolio_snapshots
      WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 day'
    `) as Array<{ n: number }>;
    if ((recent[0]?.n ?? 0) >= DAILY_LIMIT) {
      res.status(429).end(JSON.stringify({ error: "Daily snapshot limit reached" }));
      return;
    }

    // issuedAt is generated here and stored as the exact string that goes into
    // the digest, so the verify page can rebuild the hash byte-for-byte.
    const issuedAt = new Date().toISOString();

    // Codes are random, so a collision means "try again", not "fail".
    let code = "";
    let digest = "";
    let signature = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      digest = await sha256Hex(digestInput(candidate, issuedAt, canonical));
      signature = await hmacHex(secret, digest);
      const inserted = (await sql`
        INSERT INTO portfolio_snapshots
          (code, user_id, issued_at_iso, tier, broker, amounts, canonical, digest, signature)
        VALUES
          (${candidate}, ${userId}, ${issuedAt}, ${meta.tier}, ${meta.broker},
           ${meta.amounts}, ${canonical}, ${digest}, ${signature})
        ON CONFLICT (code) DO NOTHING
        RETURNING code
      `) as Array<{ code: string }>;
      if (inserted.length > 0) {
        code = inserted[0].code;
        break;
      }
    }
    if (!code) {
      res.status(500).end(JSON.stringify({ error: "Could not allocate a snapshot code" }));
      return;
    }

    res.status(200).end(JSON.stringify({ code, issuedAt, digest }));
  } catch (e) {
    const err = e as Error;
    res.status(500).end(JSON.stringify({ error: err?.message ?? "Snapshot create failed" }));
  }
}
