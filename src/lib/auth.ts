import { createAuthClient } from "@neondatabase/neon-js/auth";

const url = import.meta.env.VITE_NEON_AUTH_URL;

if (!url) {
  // eslint-disable-next-line no-console
  console.warn(
    "VITE_NEON_AUTH_URL is not set. Auth client created with empty URL.",
  );
}

export const authClient = createAuthClient(url ?? "");
