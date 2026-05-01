import type { VercelRequest } from "@vercel/node";

// MVP auth model: the frontend reads the current user from the Neon Auth
// session client-side and sends `user.id` in the `x-user-id` header.
//
// SECURITY NOTE: this trusts the header. A malicious user could spoof another
// user_id and read/write their data. To harden, replace this with a true
// session check (decode the Better Auth JWT with the public key, or proxy to
// the Neon Auth `/api/auth/get-session` endpoint and verify cookies).
//
// Acceptable for v0 / personal use. MUST be tightened before public release.

export function getUserIdFromRequest(req: VercelRequest): string | null {
  const raw = req.headers["x-user-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}
