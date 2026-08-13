import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
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

// The Neon Auth UI provider used to wrap the whole app here, which pulled the
// auth SDK (and its zod dependency) into the entry chunk on every public page.
// Only the two pages that render its views need it, and both are lazy routes,
// so it now lives in AuthShell inside those chunks. The auth CLIENT is a
// separate module and still loads wherever the session is read.
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
