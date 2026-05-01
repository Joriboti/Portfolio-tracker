import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "./_lib/db";

// Diagnostic — confirms the Neon driver loads and a trivial query works.
// If GET /api/dbtest returns 200 with { ok: true, result: [{ ok: 1 }] } the
// DB pipeline is healthy. Any error is returned as JSON, not a crash page.
export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  try {
    const sql = await getSql();
    const result = await sql`SELECT 1 AS ok`;
    res.status(200).json({ ok: true, result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: (e as Error)?.message ?? "unknown",
      stack: (e as Error)?.stack,
    });
  }
}
