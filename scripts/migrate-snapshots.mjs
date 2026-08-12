// One-off migration for the verified-portfolio feature: creates
// portfolio_snapshots and its index. Additive and idempotent (IF NOT EXISTS),
// so re-running it is a no-op and it cannot touch any existing table.
//
// Exists because the project has no psql dependency — this goes through the
// same Neon driver the API functions use.
//
//   node scripts/migrate-snapshots.mjs
//
// Reads DATABASE_URL from the environment, falling back to .env.local. The
// value is never printed.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const url = databaseUrl();
if (!url) {
  console.error("DATABASE_URL not found in the environment or .env.local");
  process.exit(1);
}

const sql = neon(url);

// Kept verbatim from db/schema.sql. Two statements, run one at a time because
// the HTTP driver takes a single statement per call.
await sql`
  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    code          TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    issued_at_iso TEXT NOT NULL,
    tier          TEXT NOT NULL DEFAULT 'self',
    broker        TEXT,
    amounts       BOOLEAN NOT NULL DEFAULT FALSE,
    canonical     TEXT NOT NULL,
    digest        TEXT NOT NULL,
    signature     TEXT NOT NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user
    ON portfolio_snapshots (user_id, created_at DESC)
`;

const cols = await sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'portfolio_snapshots'
  ORDER BY ordinal_position
`;
console.log("portfolio_snapshots ready:");
for (const c of cols) console.log(`  ${c.column_name.padEnd(14)} ${c.data_type}`);
