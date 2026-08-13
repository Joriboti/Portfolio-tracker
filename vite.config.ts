/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // There is no local backend: /api/* are Vercel functions, so `vite dev`
    // used to answer them with the SPA shell and every fetch died on "Unexpected
    // token '<'". Proxy them to a deployed origin instead so the dashboard,
    // /explore and the company overview render real data while developing.
    // Point VITE_API_ORIGIN at a preview deployment to test unreleased API work.
    proxy: {
      "/api": {
        target: process.env.VITE_API_ORIGIN || "https://www.trimmtrack.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor-only splitting (app code is already split per route by
        // React.lazy). Deliberately no app-code grouping: hand-grouping
        // components across lazy boundaries is how manualChunks creates
        // circular chunks. The auth SDK is the big one — it carries zod — and
        // it changes far less often than the app, so it caches on its own.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) {
            if (id.includes("/src/locales/")) return "locales";
            return undefined;
          }
          // @neondatabase is deliberately NOT forced into one chunk: Rollup
          // splits its auth CLIENT (read wherever a session is needed) from its
          // auth UI (only /auth and /account) on its own, and grouping them
          // would drag the whole sign-in UI onto every landing page.
          if (id.includes("i18next")) return "vendor-i18n";
          if (id.includes("react-router") || id.includes("@remix-run")) return "vendor-router";
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          return undefined;
        },
      },
    },
  },

  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
});
