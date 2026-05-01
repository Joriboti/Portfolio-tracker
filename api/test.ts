import type { VercelRequest, VercelResponse } from "@vercel/node";

// Diagnostic endpoint — never touches the DB. If GET /api/test returns 200,
// the basic Vercel function pipeline is healthy. If even this crashes, the
// problem is platform-level (env vars, runtime, deps), not in our code.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    method: req.method,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasNeonAuthUrl: Boolean(process.env.NEON_AUTH_URL),
    hasTwelveDataKey: Boolean(process.env.TWELVE_DATA_API_KEY),
    nodeVersion: process.version,
    userIdHeader: req.headers["x-user-id"] ?? null,
    bodyType: typeof req.body,
    bodyLength: req.body
      ? typeof req.body === "string"
        ? req.body.length
        : JSON.stringify(req.body).length
      : 0,
    timestamp: new Date().toISOString(),
  });
}
