import type { VercelRequest } from "@vercel/node";

// Verify the Neon Auth session for incoming serverless function requests.
//
// The Neon Auth client (frontend) sets a session cookie on requests to the
// auth domain. Because our API runs on the same Vercel project but a different
// origin, the SDK forwards the session token via the `Authorization` header.
// We forward that to the Neon Auth server for verification.
//
// This is intentionally minimal — refine when Neon Auth's stable API publishes
// a server-side helper.

export type AuthUser = {
  id: string;
  email?: string;
};

export async function getUserFromRequest(
  req: VercelRequest,
): Promise<AuthUser | null> {
  const authURL = process.env.NEON_AUTH_URL ?? process.env.VITE_NEON_AUTH_URL;
  if (!authURL) return null;

  const cookie = req.headers.cookie ?? "";
  const authz = req.headers.authorization ?? "";
  if (!cookie && !authz) return null;

  try {
    const res = await fetch(`${authURL}/session`, {
      headers: {
        cookie,
        ...(authz ? { authorization: authz } : {}),
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id: string; email?: string } };
    if (!data.user?.id) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

export function requireUser(user: AuthUser | null): asserts user is AuthUser {
  if (!user) {
    const err = new Error("Unauthorized");
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
}
