import type { VercelRequest, VercelResponse } from "@vercel/node";

// Per-holding scenario valuation model: load (GET) and save (PUT).
//
// Follows the project's serverless conventions: flat route, `await import`
// of the Neon driver inside the handler, auth via the `x-user-id` header. The
// model is stored verbatim as JSONB in `holding_scenarios` keyed by
// (user_id, ticker). The table is ensured lazily on first use, mirroring the
// fundamentals routes — no separate migration step required at runtime.

type SqlClient = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<unknown>;

async function ensureTable(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS holding_scenarios (
      user_id     TEXT NOT NULL,
      ticker      TEXT NOT NULL,
      model       JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, ticker)
    )
  `;
}

function getUserId(req: VercelRequest): string | null {
  const raw = req.headers["x-user-id"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = v?.trim();
  if (!trimmed || trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}

function getTickerFromQuery(req: VercelRequest): string | null {
  const raw = req.query.ticker;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = v?.trim().toUpperCase();
  return t && t.length > 0 && t.length <= 64 ? t : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET" && req.method !== "PUT") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const userId = getUserId(req);
    if (!userId) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl) as unknown as SqlClient;
    await ensureTable(sql);

    if (req.method === "GET") {
      const ticker = getTickerFromQuery(req);
      if (!ticker) {
        res.status(400).end(JSON.stringify({ error: "Missing ?ticker" }));
        return;
      }
      const rows = (await sql`
        SELECT model, updated_at AS "updatedAt"
        FROM holding_scenarios
        WHERE user_id = ${userId} AND ticker = ${ticker}
      `) as Array<{ model: unknown; updatedAt: string }>;
      const row = rows[0];
      res.status(200).end(
        JSON.stringify({
          ok: true,
          model: row?.model ?? null,
          updatedAt: row?.updatedAt ?? null,
        }),
      );
      return;
    }

    // PUT — upsert the model.
    const body =
      typeof req.body === "string" ? safeParse(req.body) : (req.body ?? {});
    const ticker =
      typeof body?.ticker === "string"
        ? body.ticker.trim().toUpperCase()
        : null;
    const model = body?.model;
    if (!ticker || ticker.length === 0 || ticker.length > 64) {
      res.status(400).end(JSON.stringify({ error: "Missing or invalid ticker" }));
      return;
    }
    if (model == null || typeof model !== "object") {
      res.status(400).end(JSON.stringify({ error: "Missing or invalid model" }));
      return;
    }

    const json = JSON.stringify(model);
    await sql`
      INSERT INTO holding_scenarios (user_id, ticker, model, updated_at)
      VALUES (${userId}, ${ticker}, ${json}::jsonb, NOW())
      ON CONFLICT (user_id, ticker) DO UPDATE
        SET model = EXCLUDED.model, updated_at = NOW()
    `;
    res.status(200).end(JSON.stringify({ ok: true }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Scenario request failed" }));
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
