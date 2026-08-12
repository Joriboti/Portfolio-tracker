import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  CODE_RE,
  digestInput,
  getSecret,
  hmacHex,
  sha256Hex,
  timingSafeEqualHex,
} from "./_snapshot-core.js";

/**
 * Public read for /verify/:code — no auth, by design: anyone handed a card must
 * be able to check it. Only the figures the owner chose to disclose are
 * returned; user_id never leaves the database.
 *
 * The two checks reported back are independent:
 *   digestValid    — the stored digest matches the stored body (recomputed here,
 *                    and again in the browser, so the page does not have to take
 *                    this endpoint's word for it).
 *   signatureValid — the digest carries our HMAC, i.e. this row was issued by
 *                    TrimmTrack and not written straight into the table.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const raw = req.query.code;
    const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? "";
    if (!CODE_RE.test(code)) {
      res.status(400).end(JSON.stringify({ error: "Invalid code" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const rows = (await sql`
      SELECT code, issued_at_iso AS "issuedAt", tier, broker, amounts,
             canonical, digest, signature,
             to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "revokedAt"
      FROM portfolio_snapshots
      WHERE code = ${code}
    `) as Array<{
      code: string;
      issuedAt: string;
      tier: string;
      broker: string | null;
      amounts: boolean;
      canonical: string;
      digest: string;
      signature: string;
      revokedAt: string | null;
    }>;

    const row = rows[0];
    if (!row) {
      res.status(404).end(JSON.stringify({ error: "Unknown code" }));
      return;
    }

    const recomputed = await sha256Hex(
      digestInput(row.code, row.issuedAt, row.canonical),
    );
    const digestValid = timingSafeEqualHex(recomputed, row.digest);

    const secret = getSecret();
    const signatureValid = secret
      ? timingSafeEqualHex(await hmacHex(secret, row.digest), row.signature)
      : false;

    // Cards are immutable once issued, but revocation can flip, so allow only a
    // short shared cache.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    res.status(200).end(
      JSON.stringify({
        code: row.code,
        issuedAt: row.issuedAt,
        tier: row.tier,
        broker: row.broker,
        amounts: row.amounts,
        canonical: row.canonical,
        digest: row.digest,
        digestValid,
        signatureValid,
        revokedAt: row.revokedAt,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res.status(500).end(JSON.stringify({ error: err?.message ?? "Snapshot read failed" }));
  }
}
