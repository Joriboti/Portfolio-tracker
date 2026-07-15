// Drafts the qualitative Insights (Pros / Risks / Thesis) for a company and
// writes them to the Notion research CMS as a Draft row, for a human to review
// before they ever reach the site.
//
// Why a local script and not an endpoint:
//   - No 13th serverless function (the Hobby plan caps deploys at 12).
//   - It runs once per company, not per request — there's nothing to serve.
//   - Most importantly it is deliberately NOT a publish path. Drafts land in
//     Notion with Status unset, so nothing is live until you say so. Publishing
//     generated text across ~80 pages unreviewed is the "scaled content abuse"
//     pattern Google devalues; the whole point of this pipeline is to turn
//     "write 80 insight sets" into "review 80 drafts".
//
// The model is grounded on the same cached figures the page itself renders
// (?quote= + ?statements=), so the drafts argue from this company's actual
// numbers rather than from whatever it remembers about the ticker.
//
// Usage:
//   node scripts/draft-insights.mjs AAPL MSFT      # named tickers
//   node scripts/draft-insights.mjs --all          # every curated ticker still missing insights
//   node scripts/draft-insights.mjs --all --limit 5
//   node scripts/draft-insights.mjs AAPL --force   # redraft one that already has insights
//   node scripts/draft-insights.mjs AAPL --dry-run # print the figures brief only
//
// Env: ANTHROPIC_API_KEY, NOTION_API_KEY, NOTION_RESEARCH_DB_ID (the last two
// are already in .env.local for the research CMS). --dry-run needs none of them.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Client as Notion } from "@notionhq/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const API_ORIGIN = process.env.INSIGHTS_API_ORIGIN || "https://www.trimmtrack.com";
const MODEL = "claude-opus-4-8";

// Insights are single-language on the site (the headers are i18n'd, the text is
// not) — same as the research articles.
const LANGUAGE = "Catalan";

/* ───────────────────────── grounding ───────────────────────── */

async function apiGet(qs) {
  const r = await fetch(`${API_ORIGIN}/api/fundamentals-get?${qs}`, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`${qs} → HTTP ${r.status}`);
  return r.json();
}

const fmt = (v, digits = 2) =>
  v == null || !Number.isFinite(v) ? "n/a" : Number(v).toFixed(digits);
const pct = (v) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const money = (v) =>
  v == null ? "n/a" : `${(v / 1e9).toFixed(2)}B`;

/**
 * A compact figures brief rather than the raw payload: a deep-history ticker
 * carries 100+ quarters, and pasting all of it buries the signal and burns
 * tokens for a paragraph of prose.
 */
async function buildBrief(ticker) {
  const [quote, statements] = await Promise.all([
    apiGet(`quote=${encodeURIComponent(ticker)}`),
    apiGet(`statements=${encodeURIComponent(ticker)}`),
  ]);
  const c = quote.company;
  if (!c) throw new Error("no company data");
  const f = c.fundamentals ?? {};
  const panel = statements.panel ?? {};
  const ccy = panel.financialCurrency ?? c.currency ?? "";

  // Yahoo leaves placeholder rows at odd report dates (AAPL has them at
  // 2024-10-18 and 2025-01-17) that carry no figure this brief prints — some
  // hold an unrelated field, so "has any metric" isn't the test. Keep a row only
  // if it can fill the line we're about to render, and filter before slicing so
  // the window isn't spent on rows that say nothing.
  const renders = (keys) => (r) => keys.some((k) => r.metrics?.[k] != null);
  const Q_KEYS = ["revenue", "netIncome", "eps", "fcf"];
  const A_KEYS = ["revenue", "netIncome", "fcf", "shares"];
  const lastQ = (statements.quarters ?? []).filter(renders(Q_KEYS)).slice(-8);
  const lastA = (statements.annual ?? []).filter(renders(A_KEYS)).slice(-5);

  const quarterly = lastQ
    .map(
      (r) =>
        `  ${r.periodEnd}: revenue ${money(r.metrics.revenue)}, net income ${money(
          r.metrics.netIncome,
        )}, EPS ${fmt(r.metrics.eps)}, FCF ${money(r.metrics.fcf)}`,
    )
    .join("\n");
  const annual = lastA
    .map(
      (r) =>
        `  ${r.periodEnd.slice(0, 4)}: revenue ${money(r.metrics.revenue)}, net income ${money(
          r.metrics.netIncome,
        )}, FCF ${money(r.metrics.fcf)}, shares ${money(r.metrics.shares)}`,
    )
    .join("\n");

  return `Company: ${c.ticker}
Sector: ${f.sector ?? "n/a"} / ${f.industry ?? "n/a"}
Price: ${fmt(c.price)} ${c.currency ?? ""}
Reporting currency: ${ccy}
Market cap: ${money(f.marketCap)}

Valuation: trailing P/E ${fmt(f.trailingPe)}, forward P/E ${fmt(f.forwardPe)}, P/S ${fmt(
    panel.priceToSales,
  )}, EV/EBITDA ${fmt(panel.evToEbitda)}, P/B ${fmt(f.priceToBook)}
Margins: net ${pct(f.profitMargin)}, operating ${pct(panel.operatingMargin)}, gross ${pct(
    panel.grossMargin,
  )}
Returns: ROE ${pct(f.roe)}, dividend yield ${pct(f.dividendYield)}, payout ${pct(
    panel.payoutRatio,
  )}
Balance: cash ${money(f.totalCash)}, debt ${money(f.totalDebt)}, debt/equity ${fmt(
    f.debtToEquity,
  )}
Cash flow: FCF ${money(f.freeCashflow)}, shares outstanding ${money(f.sharesOutstanding)}

Last ${lastQ.length} quarters (${ccy}):
${quarterly || "  none"}

Last ${lastA.length} fiscal years (${ccy}):
${annual || "  none"}`;
}

/* ───────────────────────── generation ───────────────────────── */

const SCHEMA = {
  type: "object",
  properties: {
    pros: {
      type: "array",
      items: { type: "string" },
      description: "Competitive advantages, one per item. 3-5 items.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Investment risks, one per item. 3-5 items.",
    },
    thesis: {
      type: "string",
      description: "One short paragraph summarising the investment case.",
    },
  },
  required: ["pros", "risks", "thesis"],
  additionalProperties: false,
};

const SYSTEM = `You write the qualitative section of a company page on TrimmTrack, a retail investing research site.

You are given that company's real, current figures. Write in ${LANGUAGE}.

Rules:
- Ground every point in the figures provided or in well-established, durable facts about the business. Cite the figure inline when it carries the point ("marge operatiu del 32%").
- Do not invent numbers. If a figure is "n/a", do not reason about it.
- A competitive advantage is something structural that protects returns, not a restatement of a good number. "High margins" is not an advantage; the reason the margins persist is.
- Risks must be specific to this company and real enough to change the investment case. Skip generic filler ("market volatility", "competition exists", "regulatory risk" with no specifics).
- Each bullet is one sentence, plain and concrete. No hedging, no marketing tone, no emoji.
- The thesis states what has to be true for the investment to work, and is not a recommendation to buy or sell.
- This is analysis, not advice.`;

async function draft(anthropic, ticker, brief) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Judging what's actually durable about a business, versus what merely
    // looks good this quarter, is the whole job here.
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Write the competitive advantages, investment risks and thesis for ${ticker}, from these figures:\n\n${brief}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`model declined (${response.stop_details?.category ?? "unknown"})`);
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in response");
  return { data: JSON.parse(text), usage: response.usage };
}

/* ───────────────────────── notion ───────────────────────── */

const richText = (s) => [{ type: "text", text: { content: s.slice(0, 2000) } }];

async function findExisting(notion, dbId, ticker) {
  const r = await notion.databases.query({
    database_id: dbId,
    filter: { property: "Ticker", rich_text: { equals: ticker } },
    page_size: 5,
  });
  return r.results.find((p) => {
    const pros = (p.properties?.Pros?.rich_text ?? [])
      .map((t) => t.plain_text)
      .join("");
    return pros.trim().length > 0;
  });
}

/**
 * Written with Status unset and no Slug: _research-core's insights mode keys off
 * Ticker + non-empty Pros/Risks, while the article list requires Status=Published
 * AND a Slug — so a draft surfaces as insights only once a human sets Status,
 * and never as an article.
 */
async function writeDraft(notion, dbId, ticker, name, insights) {
  return notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      Title: { title: richText(`${name} — insights (esborrany)`) },
      Ticker: { rich_text: richText(ticker) },
      Pros: { rich_text: richText(insights.pros.map((p) => `- ${p}`).join("\n")) },
      Risks: { rich_text: richText(insights.risks.map((r) => `- ${r}`).join("\n")) },
      Thesis: { rich_text: richText(insights.thesis) },
    },
  });
}

/* ───────────────────────── main ───────────────────────── */

function parseArgs(argv) {
  const args = { tickers: [], all: false, force: false, dryRun: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]) || Infinity;
    else if (!a.startsWith("--")) args.tickers.push(a.toUpperCase());
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --dry-run shows exactly what the model would be grounded on, before any
  // token is spent. Runs on the public API alone, so it needs no credentials.
  if (args.dryRun) {
    for (const ticker of args.tickers) {
      console.log(`\n${"=".repeat(60)}\n${await buildBrief(ticker)}`);
    }
    return;
  }

  const { ANTHROPIC_API_KEY, NOTION_API_KEY, NOTION_RESEARCH_DB_ID } = process.env;

  const missing = [
    !ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
    !NOTION_API_KEY && "NOTION_API_KEY",
    !NOTION_RESEARCH_DB_ID && "NOTION_RESEARCH_DB_ID",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    console.error("The Notion pair lives in .env.local; export them plus your Anthropic key.");
    process.exit(1);
  }

  const curated = JSON.parse(
    readFileSync(path.join(ROOT, "src/data/tickers.json"), "utf8"),
  );
  const nameOf = Object.fromEntries(
    curated.map(({ symbol, name }) => [symbol.toUpperCase(), name]),
  );

  let targets = args.tickers;
  if (args.all) targets = curated.map(({ symbol }) => symbol.toUpperCase());
  if (targets.length === 0) {
    console.error("Nothing to do. Pass tickers, or --all.");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const notion = new Notion({ auth: NOTION_API_KEY });

  let done = 0;
  let skipped = 0;
  let failed = 0;
  for (const ticker of targets) {
    if (done >= args.limit) break;
    try {
      if (!args.force && (await findExisting(notion, NOTION_RESEARCH_DB_ID, ticker))) {
        console.log(`- ${ticker}: already has insights, skipping`);
        skipped++;
        continue;
      }
      const brief = await buildBrief(ticker);
      const { data, usage } = await draft(anthropic, ticker, brief);
      await writeDraft(
        notion,
        NOTION_RESEARCH_DB_ID,
        ticker,
        nameOf[ticker] ?? ticker,
        data,
      );
      done++;
      console.log(
        `✓ ${ticker}: ${data.pros.length} pros, ${data.risks.length} risks ` +
          `(${usage.input_tokens} in / ${usage.output_tokens} out)`,
      );
    } catch (err) {
      // One bad ticker must not sink a --all run.
      failed++;
      console.warn(`! ${ticker}: ${err?.message || err}`);
    }
  }
  console.log(`\n${done} drafted, ${skipped} skipped, ${failed} failed.`);
  console.log("Review them in Notion, then set Status=Published to take them live.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
