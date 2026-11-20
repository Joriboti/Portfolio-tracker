// Request authentication for every /api/* route that reads or writes user data.
//
// Underscore prefix = shared module, NOT a route (so it does not count against
// the 12-function Hobby cap): imported statically with an explicit ".js"
// extension, because Node ESM in the Vercel runtime cannot resolve
// extensionless relative specifiers.
//
// ── What this replaces ───────────────────────────────────────────────────────
// Every route used to read an `x-user-id` header and believe it. Nothing
// verified it, so the id was whatever the caller typed: with someone's id you
// could read their portfolio, overwrite it, or issue verification cards in
// their name, and any id at all was enough to trigger the price and backfill
// jobs. Confirmed on production on 2026-11-17 with a made-up id.
//
// ── Rollout ──────────────────────────────────────────────────────────────────
// Shipped in two steps. The first deploy still accepted the old header as a
// fallback and reported which path identified each caller (`X-Auth-Via`, shown
// on /debug). Once a real signed-in session was seen arriving as `jwt`
// (2026-11-20), the fallback was deleted: a request without a valid session
// token is now a 401, whatever headers it carries.
//
// ── Why a JWT and not the session cookie ──────────────────────────────────────
// The obvious designs both fail here:
//
//   1. Read the session cookie. Neon Auth is hosted on its OWN origin, so its
//      cookie is never sent to our functions. There is nothing to read.
//   2. Forward the session token and re-ask the auth server via /get-session.
//      That endpoint calls `getSignedCookie(name, secret)` — the cookie is HMAC
//      signed with the auth server's secret, which we do not have, so a cookie
//      rebuilt from a raw token is rejected. (The `bearer` plugin would sign it
//      for us, but only if that plugin is enabled on the Neon instance, which we
//      cannot depend on.)
//
// What the client actually holds is better than either: the Neon Auth adapter
// hooks `onSuccess` and overwrites `session.token` with the value of the
// `set-auth-jwt` response header (see @neondatabase/auth adapter-core). So the
// browser carries a JWT signed by the auth server's private key, and the public
// half is published at `${authUrl}/jwks`. We verify it here — offline after the
// first fetch, no round trip per request, and it cannot be forged.
//
// The JWT's default lifetime is 15 minutes (better-auth's jwt plugin). The
// client refreshes it per request via getJWTToken(), so a short expiry is fine
// and deliberately limits the damage of a leaked token.

import type { VercelRequest } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Constant-time compare for shared secrets (CRON_SECRET). Lives here so the
 * routes that accept the cron secret cannot drift into different comparisons.
 *
 * timingSafeEqual throws on unequal lengths, and the length itself is not worth
 * hiding, so it is checked first.
 */
export function timingSafeMatch(got: string, want: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * True when the request carries the configured CRON_SECRET. An unset secret
 * matches nobody: it used to mean "allow everyone".
 */
export function isCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const raw = req.headers.authorization ?? "";
  const authz = Array.isArray(raw) ? raw[0] : raw;
  return timingSafeMatch(authz, `Bearer ${secret}`);
}

/** Thrown by requireUserId. `status` is what the route should answer with. */
export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// Server-side name first, then the Vite one. Vercel injects every project env
// var into functions, so an existing deployment that only ever set
// VITE_NEON_AUTH_URL keeps working without a new variable — one less way to
// lock everyone out of their own dashboard on the deploy that ships this.
function authBaseUrl(): string {
  const raw = (process.env.NEON_AUTH_URL ?? process.env.VITE_NEON_AUTH_URL ?? "").trim();
  if (!raw) {
    throw new AuthError(500, "NEON_AUTH_URL (or VITE_NEON_AUTH_URL) is not configured");
  }
  return raw.replace(/\/+$/, "");
}

// Neon Auth publishes the key set at the standard OIDC discovery path, NOT at
// Better Auth's own default of `/jwks` — that one 404s. Verified against the
// live instance on 2026-07-30: `${base}/.well-known/jwks.json` → 200 with an
// Ed25519 key, `${base}/jwks` → 404. Assuming the library default here shipped
// an auth layer that rejected every login, so the full URL is overridable.
const JWKS_PATH = "/.well-known/jwks.json";

function jwksUrl(base: string): string {
  return process.env.NEON_AUTH_JWKS_URL?.trim() || `${base}${JWKS_PATH}`;
}

// createRemoteJWKSet caches the key set and only refetches on an unknown `kid`,
// so hoisting it to module scope makes verification free across warm
// invocations of the same function instance. Keyed by the resolved URL so a
// changed env var can't be served from a stale cache.
let cachedSet: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedFor = "";

function jwkSet(base: string): ReturnType<typeof createRemoteJWKSet> {
  const url = jwksUrl(base);
  if (!cachedSet || cachedFor !== url) {
    cachedSet = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000 });
    cachedFor = url;
  }
  return cachedSet;
}

function bearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Resolve the caller's user id from a verified JWT, or throw AuthError.
 *
 * Never trust a client-supplied id: the header this replaced (`x-user-id`) let
 * any caller read, overwrite or delete any other user's account by guessing it.
 */
export async function requireUserId(req: VercelRequest): Promise<string> {
  const token = bearerToken(req);
  if (!token) {
    throw new AuthError(401, "Missing Authorization: Bearer <token>");
  }
  const base = authBaseUrl();

  // Issuer and audience both default to the auth server's own baseURL, which we
  // can't reliably predict (Neon may mount it under a path). Trust is already
  // pinned by the JWKS URL — only this one auth server's keys can sign a token
  // we accept — so these checks are opt-in for anyone who wants them tighter.
  const issuer = process.env.NEON_AUTH_ISSUER?.trim() || undefined;
  const audience = process.env.NEON_AUTH_AUDIENCE?.trim() || undefined;

  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, jwkSet(base), {
      issuer,
      audience,
      clockTolerance: 5,
    });
    sub = typeof payload.sub === "string" ? payload.sub.trim() : undefined;
  } catch (e) {
    throw asAuthError(e);
  }

  // The length cap is the same one the old header guard had: user_id is a
  // bounded column, and an absurd `sub` is a malformed token, not a user.
  if (!sub || sub.length === 0 || sub.length > 128) {
    throw new AuthError(401, "Token has no usable subject claim");
  }
  return sub;
}

// Map jose's failure modes onto statuses the client can act on. The distinction
// that matters: 401 means "get a fresh token or sign in", 503 means "the auth
// server is unreachable, retry" — answering 401 for an outage would silently
// sign everybody out.
function asAuthError(e: unknown): AuthError {
  const code = (e as { code?: string })?.code ?? "";
  const message = (e as Error)?.message ?? "Token verification failed";
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return new AuthError(401, "Session expired");
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return new AuthError(401, `Invalid session token: ${code || message}`);
    case "ERR_JWKS_TIMEOUT":
      return new AuthError(503, "Auth server did not respond (JWKS timeout)");
    // A key set that won't load is a misconfiguration or an outage — never the
    // caller's fault. This one bit for real: a 404 on the JWKS path surfaced as
    // "Invalid session token", which reads as "your login is bad" and sends you
    // debugging the client instead of the URL.
    case "ERR_JWKS_INVALID":
    case "ERR_JWKS_NO_MATCHING_KEY_TIMEOUT":
      return new AuthError(503, `Could not load the auth server's key set: ${message}`);
    default:
      if (/JSON Web Key Set/i.test(message)) {
        return new AuthError(503, `Could not load the auth server's key set: ${message}`);
      }
      // An unreachable JWKS endpoint surfaces as a plain fetch TypeError.
      if (e instanceof TypeError) {
        return new AuthError(503, `Could not reach the auth server: ${message}`);
      }
      return new AuthError(401, `Invalid session token: ${message}`);
  }
}

// ── Route guards ─────────────────────────────────────────────────────────────

/** How the caller was identified. Sent back as `X-Auth-Via`. */
export type AuthVia = "jwt" | "cron";

/** The slice of VercelResponse this module touches (keeps the tests honest). */
type Res = {
  status: (n: number) => { end: (b: string) => void };
  setHeader: (name: string, value: string) => unknown;
};

/**
 * Route-level wrapper: returns the verified user id, or null having ALREADY
 * written the error response. Callers just `if (!userId) return;`.
 *
 * Only a valid session JWT identifies a caller. An `x-user-id` header, the
 * unverified identity every route used to trust, is ignored.
 *
 * The failure reason is passed through to the body verbatim on purpose. None of
 * these messages reveal anything an attacker doesn't already know (they hold
 * the token), and this cannot be exercised from a laptop — when a deploy
 * misbehaves, the browser console naming the exact failure mode is the
 * difference between a two-minute fix and being locked out of your own app.
 */
export async function authenticate(req: VercelRequest, res: Res): Promise<string | null> {
  try {
    const userId = await requireUserId(req);
    res.setHeader("X-Auth-Via", "jwt" satisfies AuthVia);
    return userId;
  } catch (e) {
    const err = e instanceof AuthError ? e : new AuthError(401, "Unauthorized");
    res.status(err.status).end(JSON.stringify({ error: err.message }));
    return null;
  }
}

/** Who a cron-or-user route is running for. */
export type Caller = { cron: true; userId: null } | { cron: false; userId: string };

/**
 * For the jobs that both the scheduler and a signed-in user may start (price
 * refresh, backfills): the cron secret, or else an authenticated user. Returns
 * null having already written the response when it is neither.
 */
export async function authenticateCronOrUser(req: VercelRequest, res: Res): Promise<Caller | null> {
  if (isCronRequest(req)) {
    res.setHeader("X-Auth-Via", "cron" satisfies AuthVia);
    return { cron: true, userId: null };
  }
  const userId = await authenticate(req, res);
  return userId ? { cron: false, userId } : null;
}
