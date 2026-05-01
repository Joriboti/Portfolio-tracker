import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { NeonAuthUIProvider } from "@neondatabase/neon-js/auth/react";
import { authClient } from "./lib/auth";
import "./lib/i18n";
import App from "./App";
import "./index.css";

// Redirect to the canonical Vercel URL when the visitor lands on a
// per-deployment preview URL. Better Auth's trustedOrigins only contains the
// canonical domain; without this, sign-in/sign-up fail with "Invalid origin"
// from any preview URL.
const CANONICAL_HOST =
  import.meta.env.VITE_CANONICAL_HOST ?? "portfolio-tracker-chi-ten.vercel.app";

if (
  typeof window !== "undefined" &&
  window.location.hostname.endsWith(".vercel.app") &&
  window.location.hostname !== CANONICAL_HOST
) {
  window.location.replace(
    `https://${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <NeonAuthUIProvider
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authClient={authClient as any}
      emailOTP
      magicLink
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </NeonAuthUIProvider>
  </StrictMode>,
);
