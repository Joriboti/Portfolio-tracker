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
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
  },
});
