// Post-build prerender: snapshot the fully-rendered HTML of the public,
// backend-free routes so Google (and non-JS crawlers/social scrapers) get real
// content + the per-route <title>/meta/canonical in the *static* HTML instead
// of an empty CSR shell. Runs a real headless Chrome against the built dist/,
// so it needs zero changes to app code.
//
// SAFETY: this step is intentionally non-fatal. Any failure (e.g. Chromium not
// available in the build image) is caught and the process still exits 0, so the
// Vercel production build can never break because of prerendering — it just
// degrades to the previous CSR behaviour.

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");
const PORT = 4317;

// Only routes whose content renders without a backend. /explore and the
// auth-gated pages are skipped (they need live API/session data).
const ROUTES = ["/", "/calculadora-fifo", "/forecast", "/disclaimer"];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
};

async function run() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    throw new Error("dist/index.html not found — run vite build first");
  }
  // The SPA shell is kept in memory: even after we overwrite dist/index.html
  // with the prerendered homepage, the fallback served to the browser for the
  // remaining routes stays the clean, empty shell.
  const shell = await readFile(path.join(DIST, "index.html"));

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const ext = path.extname(urlPath);
      // Real asset request → serve from disk; anything else → SPA shell.
      if (ext && ext !== ".html") {
        const filePath = path.join(DIST, urlPath);
        if (existsSync(filePath)) {
          const data = await readFile(filePath);
          res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
          res.end(data);
          return;
        }
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(shell);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      // Headless Chrome defaults to en-US; force Catalan so the default-URL
      // prerender matches the ca canonical (i18next reads localStorage first).
      await page.evaluateOnNewDocument(() => {
        try {
          localStorage.setItem("i18nextLng", "ca");
        } catch {
          /* no-op */
        }
      });
      await page.setExtraHTTPHeaders({ "Accept-Language": "ca-ES,ca;q=0.9" });

      await page.goto(`http://localhost:${PORT}${route}`, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      // Wait until React has rendered content AND useSeo has set the title.
      await page
        .waitForFunction(
          () => {
            const root = document.getElementById("root");
            return !!root && root.children.length > 0 && !!document.title;
          },
          { timeout: 15000 },
        )
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 300));

      const html = await page.evaluate(
        () => "<!DOCTYPE html>\n" + document.documentElement.outerHTML,
      );
      const outDir = route === "/" ? DIST : path.join(DIST, route);
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "index.html"), html, "utf8");
      console.log(
        `[prerender] ${route} → ${path.relative(DIST, path.join(outDir, "index.html"))} (${(html.length / 1024).toFixed(1)} kB)`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    // Non-fatal: never break the build because prerendering failed.
    console.error("[prerender] skipped:", err?.message || err);
    process.exit(0);
  });
