// Reads every qualitative-commentary row out of the Notion research DB and
// prints it as JSON: which tickers have Catalan Pros/Risks/Thesis, and which
// already carry a translation. Read-only — the companion writer is
// scripts/insights-translate.mjs.
//
//   node scripts/insights-dump.mjs > /tmp/insights.json

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const KEY = env.NOTION_API_KEY;
const DB = env.NOTION_RESEARCH_DB_ID;

async function notion(url, init = {}) {
  const res = await fetch(`https://api.notion.com/v1${url}`, {
    ...init,
    headers: {
      authorization: `Bearer ${KEY}`,
      "notion-version": "2022-06-28",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const plain = (rt) => (rt ?? []).map((t) => t?.plain_text ?? "").join("");

export { notion, KEY, DB, plain };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await notion(`/databases/${DB}`);
  const cols = Object.keys(db.properties);
  const rows = [];
  let cursor;
  do {
    const q = await notion(`/databases/${DB}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    rows.push(...q.results);
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);

  const out = rows
    .map((p) => {
      const pr = p.properties;
      const get = (n) => plain(pr?.[n]?.rich_text);
      return {
        id: p.id,
        ticker: get("Ticker"),
        title: plain(pr?.Title?.title),
        pros: get("Pros"),
        risks: get("Risks"),
        thesis: get("Thesis"),
        prosEs: get("ProsEs"),
        prosEn: get("ProsEn"),
      };
    })
    .filter((r) => r.pros || r.risks || r.thesis);

  console.log(JSON.stringify({ columns: cols, count: out.length, rows: out }, null, 2));
}
