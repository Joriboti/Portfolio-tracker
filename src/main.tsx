import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { NeonAuthUIProvider } from "@neondatabase/neon-js/auth/react";
import { authClient } from "./lib/auth";
import "./lib/i18n";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <NeonAuthUIProvider authClient={authClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </NeonAuthUIProvider>
  </StrictMode>,
);
