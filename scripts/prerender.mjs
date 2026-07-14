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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = 4317;

// Every route listed in the two sitemaps gets a snapshot, once per language, so
// each URL ships real translated HTML plus its own self-referencing canonical
// and hreflang set. Anything in a sitemap but not prerendered would fall back to
// the SPA shell (see SHELL_FILE below) and depend on Google executing JS to get
// its canonical — so this list and the sitemap generators must stay in sync.
//
// Live API data is NOT needed here: useSeo() derives the canonical from the URL
// and the /explore/:ticker heading + tags come from the static tickers.json, so
// a snapshot taken with the API unavailable still carries correct SEO metadata.
// Prices and Notion article bodies fill in client-side on the real page.
const LANGS = ["ca", "es", "en"];
const NEUTRAL = [
  "/",
  "/explore",
  "/research",
  "/calculadora-fifo",
  "/forecast",
  "/disclaimer",
];
const ARTICLES = ["/research/netflix", "/research/exor", "/research/meta"];
// English-only SEO tool pages (Phase 1) — each only exists under /en.
const EN_TOOLS = [
  "/en/dcf-calculator",
  "/en/reverse-dcf-calculator",
  "/en/graham-number-calculator",
  "/en/monte-carlo-stock-simulator",
  "/en/fifo-capital-gains-calculator",
  "/en/etf-growth-calculator",
  "/en/portfolio-tracker",
];
// Programmatic /explore/:ticker pages — the same source sitemap-tickers.xml is
// generated from. Only the bare (Catalan) URL is in that sitemap's <loc>, so the
// /es|/en variants it advertises via hreflang ride the SPA shell fallback.
const TICKERS = JSON.parse(
  readFileSync(path.join(ROOT, "src/data/tickers.json"), "utf8"),
).map(({ symbol }) => `/explore/${symbol.toLowerCase()}`);

function withPrefix(route, lng) {
  if (lng === "ca") return route;
  return route === "/" ? `/${lng}` : `/${lng}${route}`;
}

const ROUTES = [
  ...LANGS.flatMap((lng) =>
    [...NEUTRAL, ...ARTICLES].map((r) => ({ url: withPrefix(r, lng), lng })),
  ),
  ...EN_TOOLS.map((url) => ({ url, lng: "en" })),
  ...TICKERS.map((url) => ({ url, lng: "ca" })),
];

const ACCEPT_LANGUAGE = {
  ca: "ca-ES,ca;q=0.9",
  es: "es-ES,es;q=0.9",
  en: "en-US,en;q=0.9",
};

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
      // Match assets by known extension, not by "has a dot": ticker routes like
      // /explore/air.pa or /explore/bbva.mc otherwise look like files and get a
      // 404 snapshotted into them instead of the real page.
      const ext = MIME[path.extname(urlPath)] ? path.extname(urlPath) : "";
      // No backend during prerender. Answering /api/* with the SPA shell would
      // make the app's jsonFetch choke on HTML and bake a parse-error string
      // into the snapshot; a clean JSON 404 hits the same "degrade to empty"
      // path the app already takes when an endpoint is unavailable.
      if (urlPath.startsWith("/api/")) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "prerender: no backend" }));
        return;
      }
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

  // Locally, Puppeteer's bundled Chromium works. In Vercel's build image it
  // can't launch (missing system libraries), so there we drive @sparticuz's
  // Amazon-Linux-compatible Chromium via its executablePath instead.
  const onVercel = !!process.env.VERCEL || !!process.env.CI;
  let launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (onVercel) {
    const { default: chromium } = await import("@sparticuz/chromium");
    launchOptions = {
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: await chromium.executablePath(),
      headless: true,
    };
  }
  let browser = await puppeteer.launch(launchOptions);

  let ok = 0;
  const failed = [];
  try {
    for (const { url: route, lng } of ROUTES) {
      // Each route is isolated: with ~114 of them, one flaky navigation (or a
      // Chrome that died mid-run and took its temp profile with it) must not
      // cost us every remaining snapshot. A route that fails here just falls
      // back to the client-rendered shell, which is correct, only slower.
      try {
        if (!browser.connected) {
          console.warn("[prerender] browser died — relaunching");
          browser = await puppeteer.launch(launchOptions);
        }
        await snapshot(browser, route, lng);
        ok++;
      } catch (err) {
        failed.push(route);
        console.warn(`[prerender] ! ${route}: ${err?.message || err}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  console.log(
    `[prerender] ${ok}/${ROUTES.length} routes snapshotted` +
      (failed.length ? ` — ${failed.length} fell back to CSR: ${failed.join(", ")}` : ""),
  );
}

async function snapshot(browser, route, lng) {
  const page = await browser.newPage();
  try {
    // Seed the language both ways: localStorage (i18next cache) and
    // Accept-Language. The URL path prefix is the primary signal (i18n's
    // "path" detector), but seeding avoids any first-paint flicker for the
    // Catalan root, which has no prefix.
    await page.evaluateOnNewDocument((lng) => {
      try {
        localStorage.setItem("i18nextLng", lng);
      } catch {
        /* no-op */
      }
    }, lng);
    await page.setExtraHTTPHeaders({ "Accept-Language": ACCEPT_LANGUAGE[lng] });

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
  } finally {
    await page.close().catch(() => {});
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    // Non-fatal: never break the build because prerendering failed.
    console.error("[prerender] skipped:", err?.message || err);
    process.exit(0);
  });
