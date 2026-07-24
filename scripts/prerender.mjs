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
import { generateOgImages } from "./og-images.mjs";

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
// The API is OPTIONAL here: useSeo() derives the canonical from the URL and the
// /explore/:ticker heading + tags come from the static tickers.json, so a
// snapshot taken with the backend unavailable still carries correct SEO
// metadata, and prices/article bodies fill in client-side on the real page.
// When PRERENDER_API_ORIGIN is set we go further and proxy /api/* to a deployed
// origin (see the request handler), which bakes the company dashboard's actual
// figures and the Notion article bodies into the static HTML — the difference
// between Google seeing a heading and Google seeing the whole page.
const LANGS = ["ca", "es", "en"];
const NEUTRAL = [
  "/",
  "/explore",
  "/research",
  "/radiografia",
  "/calculadora-fifo",
  "/taxes",
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
const readData = (f) => JSON.parse(readFileSync(path.join(ROOT, f), "utf8"));
const TICKER_DATA = readData("src/data/tickers.json");
const PAIR_DATA = readData("src/data/compare-pairs.json");
const NAME_OF = Object.fromEntries(
  TICKER_DATA.map(({ symbol, name }) => [symbol.toUpperCase(), name]),
);
const TICKERS = TICKER_DATA.map(
  ({ symbol }) => `/explore/${symbol.toLowerCase()}`,
);
// Head-to-head pages. Curated direction only — the reverse slug redirects to it,
// so snapshotting both would bake a redirect into a page Google would then treat
// as a duplicate.
const COMPARISONS = PAIR_DATA.map(
  ({ a, b }) => `/explore/compare/${a.toLowerCase()}-vs-${b.toLowerCase()}`,
);

// Open Graph cards, one per programmatic page. Names must match the og:image
// URLs useSeo emits (see explore.tsx / compare.tsx).
const OG_SPECS = [
  ...TICKER_DATA.map(({ symbol, name }) => ({
    name: symbol.toLowerCase(),
    chip: symbol.toUpperCase(),
    title: name,
    subtitle: "Financials · Valuation · 15y history",
  })),
  ...PAIR_DATA.map(({ a, b }) => ({
    name: `compare-${a.toLowerCase()}-vs-${b.toLowerCase()}`,
    chip: `${a.toUpperCase()} vs ${b.toUpperCase()}`,
    title: `${NAME_OF[a.toUpperCase()] ?? a} vs ${NAME_OF[b.toUpperCase()] ?? b}`,
    subtitle: "Side-by-side financial comparison",
  })),
];

function withPrefix(route, lng) {
  if (lng === "ca") return route;
  return route === "/" ? `/${lng}` : `/${lng}${route}`;
}

const ALL_ROUTES = [
  ...LANGS.flatMap((lng) =>
    [...NEUTRAL, ...ARTICLES].map((r) => ({ url: withPrefix(r, lng), lng })),
  ),
  ...EN_TOOLS.map((url) => ({ url, lng: "en" })),
  // Ticker and comparison pages are the reason the API proxy exists: their
  // content is entirely API-driven, so they wait for the charts to paint before
  // snapshotting.
  ...TICKERS.map((url) => ({ url, lng: "ca", awaitCharts: true })),
  ...COMPARISONS.map((url) => ({ url, lng: "ca", awaitCharts: true })),
];

// Debug aid: PRERENDER_ONLY=/explore/aapl,/en narrows a 114-route run down to
// what you are actually iterating on. Never set in a real build.
const ONLY = (process.env.PRERENDER_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ROUTES = ONLY.length
  ? ALL_ROUTES.filter((r) => ONLY.includes(r.url))
  : ALL_ROUTES;

// The company dashboard renders its stat panels immediately and its charts only
// once /api/…?statements= resolves, so "React mounted" is not enough to know the
// figures are in the DOM. Chart SVGs are the ones inside a .card — the header
// and footer logos are role="img" too but never live in one.
const CHARTS_PAINTED = () =>
  document.querySelectorAll('.card svg[role="img"]').length >= 5;

const ACCEPT_LANGUAGE = {
  ca: "ca-ES,ca;q=0.9",
  es: "es-ES,es;q=0.9",
  en: "en-US,en;q=0.9",
};

// Deployed origin to borrow a backend from while snapshotting. On Vercel this
// resolves itself: VERCEL_PROJECT_PRODUCTION_URL is the *currently live*
// production domain, so a build in progress reads from the previous deployment.
// (VERCEL_URL would be wrong — that is this build's own URL, which is not
// serving yet.) Locally it stays off unless you opt in, since `vite build`
// should not depend on the network. Unset → the old metadata-only behaviour.
const API_ORIGIN = (
  process.env.PRERENDER_API_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "")
).replace(/\/$/, "");
const API_TIMEOUT_MS = 12000;

// Snapshots repeat calls across languages (the homepage's article list is the
// same three times over), so responses are memoised for the run. Failures are
// cached as null too: if the backend is down, we want one quick 404 per URL, not
// 114 timeouts serialised into the build.
const apiCache = new Map();

async function proxyApi(reqUrl) {
  if (apiCache.has(reqUrl)) return apiCache.get(reqUrl);
  let result = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
    try {
      const r = await fetch(`${API_ORIGIN}${reqUrl}`, {
        signal: ctl.signal,
        headers: { accept: "application/json" },
      });
      result = {
        status: r.status,
        contentType: r.headers.get("content-type") || "application/json",
        body: Buffer.from(await r.arrayBuffer()),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Unreachable/slow backend must never fail the build — fall through to the
    // 404 the app already knows how to degrade from.
    console.warn(`[prerender] api ${reqUrl}: ${err?.message || err}`);
    result = null;
  }
  apiCache.set(reqUrl, result);
  return result;
}

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
      // /api/* has no local implementation. With an origin configured we proxy
      // to the deployed backend so real data lands in the snapshot; without one
      // we answer a clean JSON 404, which hits the same "degrade to empty" path
      // the app already takes when an endpoint is unavailable. (Serving the SPA
      // shell instead would make jsonFetch choke on HTML and bake a parse-error
      // string into the page.)
      if (urlPath.startsWith("/api/")) {
        if (API_ORIGIN) {
          const proxied = await proxyApi(req.url);
          if (proxied) {
            res.statusCode = proxied.status;
            res.setHeader("Content-Type", proxied.contentType);
            res.end(proxied.body);
            return;
          }
        }
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
    for (const { url: route, lng, ...opts } of ROUTES) {
      // Each route is isolated: with ~114 of them, one flaky navigation (or a
      // Chrome that died mid-run and took its temp profile with it) must not
      // cost us every remaining snapshot. A route that fails here just falls
      // back to the client-rendered shell, which is correct, only slower.
      try {
        if (!browser.connected) {
          console.warn("[prerender] browser died — relaunching");
          browser = await puppeteer.launch(launchOptions);
        }
        await snapshot(browser, route, lng, opts);
        ok++;
      } catch (err) {
        failed.push(route);
        console.warn(`[prerender] ! ${route}: ${err?.message || err}`);
      }
    }
    // Share cards, on the browser we already have open. Isolated like the
    // routes: a failure here costs the per-page cards, not the snapshots — the
    // pages just keep falling back to the generic og.png from index.html.
    if (!ONLY.length || process.env.PRERENDER_OG === "1") {
      try {
        if (!browser.connected) browser = await puppeteer.launch(launchOptions);
        await generateOgImages(browser, DIST, OG_SPECS);
      } catch (err) {
        console.warn(`[og] skipped: ${err?.message || err}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  const apiHits = [...apiCache.values()].filter(Boolean).length;
  console.log(
    `[prerender] ${ok}/${ROUTES.length} routes snapshotted` +
      (API_ORIGIN
        ? ` — api ${apiHits}/${apiCache.size} ok via ${API_ORIGIN}`
        : " — no api origin (metadata only)") +
      (failed.length ? ` — ${failed.length} fell back to CSR: ${failed.join(", ")}` : ""),
  );
}

async function snapshot(browser, route, lng, opts = {}) {
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
    // API-driven pages additionally wait for their data to paint. Best-effort:
    // a timeout (no API origin, backend down, a ticker with no statements) just
    // snapshots what rendered, which is the metadata-only page we shipped
    // before — degraded, never broken.
    if (opts.awaitCharts && API_ORIGIN) {
      await page.waitForFunction(CHARTS_PAINTED, { timeout: 20000 }).catch(() => {
        console.warn(`[prerender] ${route}: charts did not paint — metadata only`);
      });
    }
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
