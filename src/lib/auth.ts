import { createAuthClient } from "@neondatabase/neon-js/auth";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react";

const url = import.meta.env.VITE_NEON_AUTH_URL;

if (!url) {
  // eslint-disable-next-line no-console
  console.warn("VITE_NEON_AUTH_URL is not set.");
}

export const authClient = createAuthClient(url ?? "", {
  adapter: BetterAuthReactAdapter(),
});
