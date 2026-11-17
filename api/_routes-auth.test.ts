import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// api/_auth.test.ts proves the guard works. This file proves every route USES
// it — the half that was missing for the life of the project: eleven routes each
// carried their own copy of "read x-user-id and believe it", and a twelfth
// written tomorrow would have copied the same four lines.
//
// Two layers:
//   1. Static: no route may read an identity header itself, and every route is
//      either on the short public list or imports the guard.
//   2. Behavioural: each guarded route's real handler is called with no
//      credentials and must answer 401 before touching the database.

const API = path.resolve(__dirname);
const routes = readdirSync(API)
  .filter((f) => f.endsWith(".ts") && !f.startsWith("_") && !f.endsWith(".test.ts"))
  .sort();

/** Routes with no per-user data at all. Adding to this list is a decision. */
const PUBLIC = new Set(["prices-current.ts"]);

describe("every route goes through api/_auth.ts", () => {
  it("still knows about all twelve functions", () => {
    // The Hobby plan caps a deployment at 12; a 13th fails the deploy.
    expect(routes.length).toBeLessThanOrEqual(12);
    expect(routes.length).toBeGreaterThanOrEqual(11);
  });

  it.each(routes)("%s never reads an identity header itself", (file) => {
    const src = readFileSync(path.join(API, file), "utf8");
    expect(src, `${file} reads x-user-id directly`).not.toMatch(/headers\s*\[\s*["']x-user-id["']\s*\]/);
    expect(src, `${file} compares the cron secret itself`).not.toMatch(/process\.env\.CRON_SECRET/);
  });

  it.each(routes.filter((f) => !PUBLIC.has(f)))("%s imports the guard", (file) => {
    const src = readFileSync(path.join(API, file), "utf8");
    expect(src).toMatch(/import \{ authenticate(CronOrUser)? \} from "\.\/_auth\.js";/);
    expect(src).toMatch(/await authenticate(CronOrUser)?\(req, res\)/);
  });
});

// ---------------------------------------------------------------------------

type Call = { file: string; method: "GET" | "POST" | "PUT"; query?: Record<string, string>; body?: unknown };

/** One credential-less call per guarded entry point. */
const GUARDED: Call[] = [
  { file: "portfolio-get.ts", method: "GET" },
  { file: "portfolio-history.ts", method: "GET" },
  { file: "performance.ts", method: "GET" },
  { file: "analytics.ts", method: "GET" },
  { file: "portfolio-import.ts", method: "POST", body: {} },
  { file: "scenarios.ts", method: "GET", query: { ticker: "AAPL" } },
  { file: "scenarios.ts", method: "PUT", query: { ticker: "AAPL" }, body: {} },
  { file: "snapshots.ts", method: "GET" },
  { file: "snapshots.ts", method: "POST", query: { action: "create" }, body: {} },
  { file: "snapshots.ts", method: "POST", query: { action: "revoke" }, body: {} },
  { file: "prices-update.ts", method: "GET" },
  { file: "prices-update.ts", method: "GET", query: { mode: "resolve", symbols: "AAPL" } },
  { file: "dividends-update.ts", method: "GET" },
  { file: "historical-backfill.ts", method: "GET" },
  { file: "fundamentals-get.ts", method: "GET", query: { refresh: "1" } },
];

function fakeRes() {
  const out: { status: number | null; body: string | null; headers: Record<string, string> } = {
    status: null,
    body: null,
    headers: {},
  };
  const res = {
    setHeader(name: string, value: string) {
      out.headers[name.toLowerCase()] = value;
      return res;
    },
    status(n: number) {
      out.status = n;
      return {
        end(b: string) {
          out.body = b;
        },
        json(b: unknown) {
          out.body = JSON.stringify(b);
        },
      };
    },
  };
  return { res: res as unknown as VercelResponse, out };
}

const saved = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  // A database URL that would fail loudly if anything tried to use it: a 401
  // must come BEFORE any query, so nothing may connect.
  process.env.DATABASE_URL = "postgres://nobody:nothing@127.0.0.1:1/none";
  process.env.NEON_AUTH_URL = "https://auth.example.test";
  process.env.CRON_SECRET = "s3cr3t-cron-value";
  delete process.env.AUTH_MODE;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("a credential-less request must not reach the network");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

describe("a request with no credentials", () => {
  it.each(GUARDED)("$method $file $query → 401", async ({ file, method, query, body }) => {
    const name = file.replace(/\.ts$/, "");
    const mod = (await import(/* @vite-ignore */ `./${name}.js`)) as {
      default: (req: VercelRequest, res: VercelResponse) => Promise<void>;
    };
    const { res, out } = fakeRes();
    await mod.default({ method, headers: {}, query: query ?? {}, body } as unknown as VercelRequest, res);
    expect(out.status, out.body ?? "").toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each(GUARDED)("$method $file $query → 401 for a wrong cron secret too", async ({ file, method, query, body }) => {
    const name = file.replace(/\.ts$/, "");
    const mod = (await import(/* @vite-ignore */ `./${name}.js`)) as {
      default: (req: VercelRequest, res: VercelResponse) => Promise<void>;
    };
    const { res, out } = fakeRes();
    await mod.default(
      { method, headers: { authorization: "Bearer not-the-secret" }, query: query ?? {}, body } as unknown as VercelRequest,
      res,
    );
    // "not-the-secret" is not a JWT either, so this fails at parse: 401, and
    // still without a network call.
    expect(out.status, out.body ?? "").toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("the public entry points stay public", () => {
  it("serves a verification card by code without credentials", async () => {
    const src = readFileSync(path.join(API, "snapshots.ts"), "utf8");
    // The code branch returns before the guard: anyone handed a card can check it.
    expect(src.indexOf("await handleRead(res, code)")).toBeGreaterThan(-1);
    expect(src.indexOf("await handleRead(res, code)")).toBeLessThan(src.indexOf("await authenticate(req, res)"));
  });
});
