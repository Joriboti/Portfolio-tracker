// Walks the covered universe and asks each ticker's statements endpoint to
// backfill itself from SEC EDGAR (`&backfill=edgar`), printing what each run
// actually wrote.
//
//   node scripts/backfill-edgar.mjs                # every ticker, production
//   node scripts/backfill-edgar.mjs ASML TSM       # just these
//   API_ORIGIN=https://…preview.vercel.app node scripts/backfill-edgar.mjs
//
// The endpoint is the only thing that talks to the database, so this is a
// driver and nothing more. Every write it triggers is an append-only upsert
// keyed on (ticker, period_end, period_type) and enrichment only ever turns a
// null into a number, so the whole run is safe to repeat — which is the point:
// a ticker that times out is re-run, not recovered.
//
// Serial on purpose. Each call pulls a multi-megabyte companyfacts document
// server-side and SEC asks for restraint; there is nothing waiting on the
// result, so the extra minutes cost nothing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = process.env.API_ORIGIN || "https://www.trimmtrack.com";
// Long enough for the slowest filer: Apple's first run writes 138 quarters one
// statement at a time.
const TIMEOUT_MS = 120_000;
const PAUSE_MS = 1_000;

const universe = JSON.parse(
  readFileSync(path.join(root, "src/data/tickers.json"), "utf8"),
).map((t) => t.symbol);

const argv = process.argv.slice(2).map((s) => s.toUpperCase());
const tickers = argv.length > 0 ? argv : universe;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function backfill(ticker) {
  const url = `${ORIGIN}/api/fundamentals-get?statements=${encodeURIComponent(ticker)}&backfill=edgar`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const eps = (d.quarters ?? [])
    .concat(d.annual ?? [])
    .filter((row) => row.metrics?.eps != null)
    .map((row) => row.periodEnd)
    .sort();
  return { backfilled: d.backfilled, from: eps[0] ?? null, periods: eps.length };
}

console.log(`${tickers.length} tickers → ${ORIGIN}\n`);

let wrote = 0;
let quiet = 0;
const failed = [];

for (const [i, ticker] of tickers.entries()) {
  const n = `${String(i + 1).padStart(3)}/${tickers.length}`;
  try {
    const { backfilled, from, periods } = await backfill(ticker);
    const b = backfilled ?? { inserted: 0, enriched: 0, epsRatio: null, skipped: null };
    const notes = [
      b.epsRatio != null && b.epsRatio !== 1 ? `eps ×${b.epsRatio}` : null,
      b.skipped ? `skipped: ${b.skipped}` : null,
    ].filter(Boolean);
    const touched = b.inserted + b.enriched;
    if (touched > 0) wrote++;
    else quiet++;
    console.log(
      `${n} ${ticker.padEnd(7)} +${String(b.inserted).padStart(3)} ins ` +
        `~${String(b.enriched).padStart(3)} enr | ${String(periods).padStart(3)} periods with EPS` +
        `${from ? ` from ${from}` : ""}${notes.length ? ` | ${notes.join(", ")}` : ""}`,
    );
  } catch (e) {
    failed.push(ticker);
    console.log(`${n} ${ticker.padEnd(7)} FAILED — ${e.message}`);
  }
  if (i < tickers.length - 1) await sleep(PAUSE_MS);
}

console.log(
  `\n${wrote} written, ${quiet} already complete, ${failed.length} failed` +
    (failed.length ? `\nre-run: node scripts/backfill-edgar.mjs ${failed.join(" ")}` : ""),
);
