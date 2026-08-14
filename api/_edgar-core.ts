import type { StatementMetrics } from "./_statements-core.js";

// SEC EDGAR deep-history backfill for the company dashboard. US filers only.
// NOT a route (underscore prefix); dynamically imported by _statements-core
// behind `?statements=T&backfill=edgar` (explicit trigger — companyfacts is
// multi-MB, kept off the hot path). Produces rows in the SAME StatementMetrics
// shape as the Yahoo path so they upsert into `financial_statements` and the
// existing charts just gain history.
//
// The extraction leans on SEC "frames" — calendar-aligned, cross-filing-
// deduped period buckets the SEC publishes on each fact:
//   • CY{YYYY}Q{n}   → a 3-month flow value (income/cash-flow), keyed by end
//   • CY{YYYY}       → a full fiscal-year flow value (labelled by fiscal year)
//   • CY{YYYY}Q{n}I  → an instant (balance-sheet) value at a quarter end
// Companies never file a standalone fiscal-Q4 3-month period (the 10-K only
// carries the full year), so one calendar quarter per year is missing from the
// framed flow set. We DERIVE it: fiscal Q4 = annual − (the 3 framed quarters
// whose period falls inside that fiscal year). This is exact for additive USD
// flows and a negligible approximation for diluted EPS.
//
// Sign convention matches the Yahoo path: capex / dividends / buybacks are
// stored as negative outflows; fcf = ocf + capex.

/* eslint-disable @typescript-eslint/no-explicit-any */

const Q_FRAME = /^CY(\d{4})Q([1-4])$/;
const A_FRAME = /^CY(\d{4})$/;
const QI_FRAME = /^CY(\d{4})Q([1-4])I$/;

type Facts = any;
type FramedPoint = { start?: string; end: string; val: number };

export type EdgarRow = {
  periodEnd: string;
  periodType: "q" | "a";
  metrics: StatementMetrics;
};

// Collect the framed points matching `re` for the first concept that provides
// them, keyed by their period-end date (dedupes restatements — the SEC frame
// already resolves to one value per calendar period).
function pickFramed(
  facts: Facts,
  concepts: string[],
  unit: string,
  re: RegExp,
): Map<string, FramedPoint> {
  const byEnd = new Map<string, FramedPoint>();
  const namespaces = [facts?.facts?.["us-gaap"], facts?.facts?.["dei"]];
  for (const concept of concepts) {
    for (const bag of namespaces) {
      const arr = bag?.[concept]?.units?.[unit];
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        if (!p?.frame || typeof p.val !== "number" || !re.test(p.frame)) continue;
        if (!byEnd.has(p.end)) {
          byEnd.set(p.end, { start: p.start, end: p.end, val: p.val });
        }
      }
    }
  }
  return byEnd;
}

const DAY = 24 * 3600 * 1000;

/** 3, 6, 9 or 12 if the span is that many months (±5 days), else null. */
function periodMonths(start: string, end: string): 3 | 6 | 9 | 12 | null {
  const days = (Date.parse(end) - Date.parse(start)) / DAY;
  if (days > 84 && days < 97) return 3;
  if (days > 176 && days < 189) return 6;
  if (days > 268 && days < 281) return 9;
  if (days > 359 && days < 372) return 12;
  return null;
}

/**
 * Every duration fact for the first concept that has any, deduped on
 * (start, end) keeping the most recently FILED value so a restatement wins.
 *
 * Unlike pickFramed this keeps the UNFRAMED points, which is the whole point:
 * see ytdQuarters.
 */
function durationFacts(
  facts: Facts,
  concepts: string[],
  unit: string,
): FramedPoint[] {
  const namespaces = [facts?.facts?.["us-gaap"], facts?.facts?.["dei"]];
  for (const concept of concepts) {
    const best = new Map<string, { p: FramedPoint; filed: string }>();
    for (const bag of namespaces) {
      const arr = bag?.[concept]?.units?.[unit];
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        if (typeof p.val !== "number" || !p.start || !p.end) continue;
        const key = `${p.start}|${p.end}`;
        const filed = String(p.filed ?? "");
        const cur = best.get(key);
        if (!cur || filed > cur.filed) {
          best.set(key, { p: { start: p.start, end: p.end, val: p.val }, filed });
        }
      }
    }
    if (best.size > 0) return [...best.values()].map((b) => b.p);
  }
  return [];
}

/**
 * Quarters recovered from year-to-date chains.
 *
 * Cash-flow and several income-statement items are filed CUMULATIVELY from the
 * fiscal year start — 3, then 6, then 9, then 12 months — and the SEC only
 * frames the first of those as a calendar quarter. Reading framed points alone
 * therefore yields ONE cash-flow quarter per year: Apple had 140 quarters on
 * file and operating cash flow on 22 of them, which is what put the holes in
 * the free-cash-flow chart.
 *
 * Facts sharing a `start` are one YTD chain, so consecutive differences along
 * it are the individual quarters. Only spans that really are 3/6/9/12 months
 * take part, and a 3-month gap between the two ends is required before a
 * difference is trusted — an interrupted chain yields nothing rather than a
 * wrong bar.
 */
function ytdQuarters(dur: FramedPoint[], sign: number): Map<string, number> {
  const out = new Map<string, number>();
  const byStart = new Map<string, FramedPoint[]>();
  for (const d of dur) {
    const list = byStart.get(d.start!);
    if (list) list.push(d);
    else byStart.set(d.start!, [d]);
  }
  for (const chain of byStart.values()) {
    chain.sort((x, y) => x.end.localeCompare(y.end));
    let prev: FramedPoint | null = null;
    for (const cur of chain) {
      const months = periodMonths(cur.start!, cur.end);
      if (months == null) {
        prev = null;
        continue;
      }
      if (months === 3) {
        out.set(cur.end, cur.val * sign);
      } else if (prev && periodMonths(prev.end, cur.end) === 3) {
        out.set(cur.end, (cur.val - prev.val) * sign);
      }
      prev = cur;
    }
  }
  return out;
}

// Framed 3-month quarters, then the YTD-derived ones, then the derived fiscal
// Q4 (annual − 3 inner quarters). Framed values are authoritative — the SEC has
// already deduped them across filings — so they are never overwritten.
function flowSeries(
  facts: Facts,
  concepts: string[],
  unit: string,
  sign: number,
): Map<string, number> {
  const q = pickFramed(facts, concepts, unit, Q_FRAME);
  const a = pickFramed(facts, concepts, unit, A_FRAME);
  const out = new Map<string, number>();
  for (const [end, p] of q) out.set(end, p.val * sign);
  for (const [end, v] of ytdQuarters(durationFacts(facts, concepts, unit), sign)) {
    if (!out.has(end)) out.set(end, v);
  }
  for (const ap of a.values()) {
    if (!ap.start || out.has(ap.end)) continue;
    const inside = [...out.entries()].filter(
      ([end]) => end > ap.start! && end <= ap.end,
    );
    if (inside.length === 3) {
      const sum = inside.reduce((t, [, v]) => t + v, 0);
      out.set(ap.end, ap.val * sign - sum);
    }
  }
  return out;
}

function annualFlow(
  facts: Facts,
  concepts: string[],
  unit: string,
  sign: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [end, p] of pickFramed(facts, concepts, unit, A_FRAME)) {
    out.set(end, p.val * sign);
  }
  return out;
}

function instantSeries(
  facts: Facts,
  concepts: string[],
  unit: string,
  sign: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [end, p] of pickFramed(facts, concepts, unit, QI_FRAME)) {
    out.set(end, p.val * sign);
  }
  return out;
}

type MetricCfg = {
  key: keyof StatementMetrics;
  concepts: string[];
  unit?: string;
  sign?: number;
};

// Additive flows (income statement + cash flow). Concept lists are ordered by
// preference; the first that yields framed data wins (ASC 606 renamed several).
const FLOW: MetricCfg[] = [
  {
    key: "revenue",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ],
  },
  { key: "netIncome", concepts: ["NetIncomeLoss"] },
  { key: "operatingIncome", concepts: ["OperatingIncomeLoss"] },
  { key: "grossProfit", concepts: ["GrossProfit"] },
  { key: "rnd", concepts: ["ResearchAndDevelopmentExpense"] },
  {
    key: "sga",
    concepts: [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
    ],
  },
  {
    key: "ocf",
    concepts: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
  },
  { key: "capex", concepts: ["PaymentsToAcquirePropertyPlantAndEquipment"], sign: -1 },
  { key: "sbc", concepts: ["ShareBasedCompensation"] },
  {
    key: "dividendsPaid",
    concepts: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
    sign: -1,
  },
  { key: "buybacks", concepts: ["PaymentsForRepurchaseOfCommonStock"], sign: -1 },
  { key: "eps", concepts: ["EarningsPerShareDiluted"], unit: "USD/shares" },
];

// Depreciation & amortisation, the one input EBITDA needs that isn't already a
// metric of its own. Kept out of FLOW because we don't store D&A — it exists
// only to turn operating income into EBITDA below. Concepts in preference
// order: filers use whichever of these their cash-flow statement is built on.
const DNA_CONCEPTS = [
  "DepreciationDepletionAndAmortization",
  "DepreciationAmortizationAndAccretionNet",
  "DepreciationAndAmortization",
];

// Instant balance-sheet snapshots (available every quarter, no derivation).
// Debt is intentionally omitted (no single unambiguous XBRL concept; mixing a
// derived debt with Yahoo's would risk a visible discontinuity).
const INSTANT: MetricCfg[] = [
  { key: "cash", concepts: ["CashAndCashEquivalentsAtCarryingValue"] },
  {
    key: "shares",
    concepts: [
      "CommonStockSharesOutstanding",
      "EntityCommonStockSharesOutstanding",
    ],
    unit: "shares",
  },
];

function emptyMetrics(): StatementMetrics {
  return {
    revenue: null,
    ebitda: null,
    netIncome: null,
    eps: null,
    operatingIncome: null,
    grossProfit: null,
    rnd: null,
    sga: null,
    shares: null,
    totalDebt: null,
    cash: null,
    fcf: null,
    ocf: null,
    capex: null,
    sbc: null,
    dividendsPaid: null,
    buybacks: null,
  };
}

// Pure: parsed companyfacts JSON → statement rows (quarterly + annual) in the
// shared StatementMetrics shape. No network — unit-tested against a fixture.
export function extractStatements(facts: Facts): EdgarRow[] {
  const qMetrics = new Map<string, StatementMetrics>();
  const aMetrics = new Map<string, StatementMetrics>();
  const ensure = (m: Map<string, StatementMetrics>, end: string) => {
    let cur = m.get(end);
    if (!cur) {
      cur = emptyMetrics();
      m.set(end, cur);
    }
    return cur;
  };

  for (const cfg of FLOW) {
    const unit = cfg.unit ?? "USD";
    const sign = cfg.sign ?? 1;
    for (const [end, v] of flowSeries(facts, cfg.concepts, unit, sign)) {
      ensure(qMetrics, end)[cfg.key] = v;
    }
    for (const [end, v] of annualFlow(facts, cfg.concepts, unit, sign)) {
      ensure(aMetrics, end)[cfg.key] = v;
    }
  }

  for (const cfg of INSTANT) {
    const unit = cfg.unit ?? "USD";
    const sign = cfg.sign ?? 1;
    const inst = instantSeries(facts, cfg.concepts, unit, sign);
    for (const [end, v] of inst) ensure(qMetrics, end)[cfg.key] = v;
    // Annual balance = the instant at each fiscal year-end (matches a QI frame).
    for (const end of aMetrics.keys()) {
      const v = inst.get(end);
      if (v != null) ensure(aMetrics, end)[cfg.key] = v;
    }
  }

  // EBITDA = operating income + D&A. Yahoo only ever reports it for the ~5
  // quarters in its free window, so without this every company's EBITDA chart
  // is five bars deep no matter how much history the rest of the page has.
  const dnaQ = flowSeries(facts, DNA_CONCEPTS, "USD", 1);
  const dnaA = annualFlow(facts, DNA_CONCEPTS, "USD", 1);
  for (const [m, dna] of [
    [qMetrics, dnaQ],
    [aMetrics, dnaA],
  ] as const) {
    for (const [end, met] of m.entries()) {
      if (met.ocf != null && met.capex != null) met.fcf = met.ocf + met.capex;
      const d = dna.get(end);
      if (met.operatingIncome != null && d != null) met.ebitda = met.operatingIncome + d;
    }
  }

  const rows = (m: Map<string, StatementMetrics>, type: "q" | "a"): EdgarRow[] =>
    [...m.entries()]
      .map(([periodEnd, metrics]) => ({ periodEnd, periodType: type, metrics }))
      .sort((x, y) => x.periodEnd.localeCompare(y.periodEnd));

  return [...rows(qMetrics, "q"), ...rows(aMetrics, "a")];
}

// SEC asks for a descriptive User-Agent with contact info; requests without one
// are 403'd. Ticker→CIK map is fetched once and cached for the warm function.
const SEC_UA = "TrimmTrack research bot (+https://www.trimmtrack.com)";
let cikMap: Record<string, string> | null = null;

// A few tickers resolve in company_tickers.json to a holding/shell entity that
// carries no XBRL statements, shadowing the real operating filer; pin those to
// the operating company's CIK so the backfill finds their data.
const CIK_OVERRIDES: Record<string, string> = {
  XOM: "0000034088", // Exxon Mobil Corporation (map points to a holdings shell)
};

async function resolveCik(ticker: string): Promise<string | null> {
  // Market-suffixed symbols (SAN.MC, MC.PA…) are non-US listings → not on EDGAR.
  if (ticker.includes(".")) return null;
  const override = CIK_OVERRIDES[ticker.toUpperCase()];
  if (override) return override;
  if (!cikMap) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": SEC_UA },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as Record<
      string,
      { cik_str: number; ticker: string }
    >;
    const map: Record<string, string> = {};
    for (const k in data) {
      const row = data[k];
      if (row?.ticker) {
        map[row.ticker.toUpperCase()] = String(row.cik_str).padStart(10, "0");
      }
    }
    cikMap = map;
  }
  return cikMap[ticker.toUpperCase()] ?? null;
}

// Network entry point: ticker → deep-history rows, or null when the ticker is
// not a US filer / EDGAR is unavailable. Never throws.
export async function fetchEdgarStatements(
  ticker: string,
): Promise<EdgarRow[] | null> {
  try {
    const cik = await resolveCik(ticker.trim().toUpperCase());
    if (!cik) return null;
    const r = await fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      { headers: { "User-Agent": SEC_UA } },
    );
    if (!r.ok) return null;
    const facts = await r.json();
    const rows = extractStatements(facts);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}
