import { createInternalNeonAuth } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react";

const url = import.meta.env.VITE_NEON_AUTH_URL;

if (!url) {
  console.warn("VITE_NEON_AUTH_URL is not set.");
}

// createInternalNeonAuth, not createAuthClient: the latter returns only
// `.adapter` and throws away `getJWTToken`, which is the one thing api/* needs.
// Everything else about the client is identical — createAuthClient is literally
// `createInternalNeonAuth(url, config).adapter`.
const neonAuth = createInternalNeonAuth(url ?? "", {
  adapter: BetterAuthReactAdapter(),
});

export const authClient = neonAuth.adapter;

/**
 * The signed JWT for the current session, or null when signed out.
 *
 * This is what /api/* verifies against the auth server's key set (see
 * api/_auth.ts). Call it per request rather than holding the value: the token
 * lives ~15 minutes, and this reads through the session cache, so it refreshes
 * itself as needed.
 */
export function getAuthToken(): Promise<string | null> {
  return neonAuth.getJWTToken();
}
