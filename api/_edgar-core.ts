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

// Foreign private issuers file a 20-F under IFRS, so their facts live in
// `ifrs-full` rather than `us-gaap` — TSM, NVO, SHEL and SAP between them had
// not one readable fact while this list was the two US taxonomies. Order is
// preference order for a concept name present in both (GrossProfit is).
const NAMESPACES = ["us-gaap", "ifrs-full", "dei"] as const;

function bags(facts: Facts): Facts[] {
  return NAMESPACES.map((ns) => facts?.facts?.[ns]).filter(Boolean);
}

const CCY = /^[A-Z]{3}$/;

/**
 * The currency the filer actually reports in.
 *
 * Every unit in this file used to be the literal "USD", which silently
 * excluded every filer that reports in anything else: ASML tags plain
 * us-gaap concepts but in EUR, so the backfill found nothing for it and the
 * chart fell back to Yahoo's five quarters.
 *
 * Picked by weight of evidence rather than from a single concept — a filer
 * that also tags a convenience translation (TSM publishes both TWD and USD)
 * must not be read half in one currency and half in the other. USD when
 * nothing says otherwise.
 */
export function reportingCurrency(facts: Facts): string {
  const counts = new Map<string, number>();
  for (const bag of bags(facts)) {
    for (const concept of Object.keys(bag)) {
      const units = bag[concept]?.units;
      if (!units) continue;
      for (const u of Object.keys(units)) {
        // "EUR" and "EUR/shares" are the same evidence about one filer.
        const code = u.split("/")[0];
        if (!CCY.test(code) || !Array.isArray(units[u])) continue;
        counts.set(code, (counts.get(code) ?? 0) + units[u].length);
      }
    }
  }
  let best = "USD";
  let bestN = 0;
  for (const [code, n] of counts) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  return best;
}

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
  const namespaces = bags(facts);
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
  const namespaces = bags(facts);
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

// Which XBRL unit a metric is measured in. Resolved against the filer's
// reporting currency rather than written out, so one config serves a filer
// reporting in USD, EUR or TWD.
type UnitKind = "money" | "perShare" | "shares";

type MetricCfg = {
  key: keyof StatementMetrics;
  concepts: string[];
  unit?: UnitKind;
  sign?: number;
};

function unitFor(kind: UnitKind, ccy: string): string {
  if (kind === "shares") return "shares";
  return kind === "perShare" ? `${ccy}/shares` : ccy;
}

// Additive flows (income statement + cash flow). Concept lists are ordered by
// preference; the first that yields framed data wins (ASC 606 renamed several).
// Each list runs us-gaap names first, then the ifrs-full names for the same
// line — a filer tags one taxonomy or the other, never both, so appending the
// IFRS spelling can only fill a period that would otherwise be empty.
const FLOW: MetricCfg[] = [
  {
    key: "revenue",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
      "RevenueFromContractsWithCustomers",
      "Revenue",
    ],
  },
  {
    key: "netIncome",
    concepts: ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  },
  {
    key: "operatingIncome",
    concepts: ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"],
  },
  { key: "grossProfit", concepts: ["GrossProfit"] },
  { key: "rnd", concepts: ["ResearchAndDevelopmentExpense"] },
  {
    key: "sga",
    concepts: [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
      "AdministrativeExpense",
    ],
  },
  {
    key: "ocf",
    concepts: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      "CashFlowsFromUsedInOperatingActivities",
    ],
  },
  // Capex has no single concept: retailers tag productive assets, oil and gas
  // tag exploration and development, telecoms and utilities their own. With
  // only the first of these, ten of the largest US companies on the site had
  // 70 quarters of operating cash flow and 5 of free cash flow — the whole
  // series was being lost on the capex half of ocf + capex. First list that
  // yields data wins, so a company is never a mix of two definitions.
  {
    key: "capex",
    concepts: [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
      "PaymentsToExploreAndDevelopOilAndGasProperties",
      "PaymentsToAcquireOilAndGasProperty",
      "PaymentsForCapitalImprovements",
      "PaymentsToAcquireMachineryAndEquipment",
      "PaymentsToAcquireOtherPropertyPlantAndEquipment",
      "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
      "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets",
    ],
    sign: -1,
  },
  { key: "sbc", concepts: ["ShareBasedCompensation", "ShareBasedPaymentsExpense"] },
  {
    key: "dividendsPaid",
    concepts: [
      "PaymentsOfDividendsCommonStock",
      "PaymentsOfDividends",
      "DividendsPaidClassifiedAsFinancingActivities",
    ],
    sign: -1,
  },
  {
    key: "buybacks",
    concepts: [
      "PaymentsForRepurchaseOfCommonStock",
      "PaymentsToAcquireOrRedeemEntitysShares",
    ],
    sign: -1,
  },
  // Diluted first, basic only where a period has no diluted figure at all —
  // the two differ by a percent or two, which is noise next to a missing year.
  // SHEL tags only the continuing-operations variants.
  {
    key: "eps",
    concepts: [
      "EarningsPerShareDiluted",
      "DilutedEarningsLossPerShare",
      "DilutedEarningsLossPerShareFromContinuingOperations",
      "EarningsPerShareBasic",
      "BasicEarningsLossPerShare",
      "BasicEarningsLossPerShareFromContinuingOperations",
    ],
    unit: "perShare",
  },
];

// Depreciation & amortisation, the one input EBITDA needs that isn't already a
// metric of its own. Kept out of FLOW because we don't store D&A — it exists
// only to turn operating income into EBITDA below. Concepts in preference
// order: filers use whichever of these their cash-flow statement is built on.
const DNA_CONCEPTS = [
  "DepreciationDepletionAndAmortization",
  "DepreciationAmortizationAndAccretionNet",
  "DepreciationAndAmortization",
  "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
  "DepreciationAndAmortisationExpense",
];

// EBIT the long way round, for the filers that present no operating-income
// subtotal at all — oil and gas, pharma and the banks among them, which is why
// Chevron and Lilly had 70+ quarters of cash flow and 5 of EBITDA. Net income
// plus tax plus interest is the same figure approached from the bottom of the
// statement. All three are required: without the interest line this is not EBIT
// and quietly pretending otherwise would understate the multiple.
const TAX_CONCEPTS = [
  "IncomeTaxExpenseBenefit",
  "IncomeTaxExpenseContinuingOperations",
];
const INTEREST_CONCEPTS = [
  "InterestExpense",
  "InterestExpenseNonoperating",
  "InterestAndDebtExpense",
  "FinanceCosts",
];

// Instant balance-sheet snapshots (available every quarter, no derivation).
// Debt is intentionally omitted (no single unambiguous XBRL concept; mixing a
// derived debt with Yahoo's would risk a visible discontinuity).
const INSTANT: MetricCfg[] = [
  {
    key: "cash",
    concepts: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashAndCashEquivalents",
      "CashAndBankBalancesAtCentralBanks",
    ],
  },
  {
    key: "shares",
    concepts: [
      "CommonStockSharesOutstanding",
      "EntityCommonStockSharesOutstanding",
      "NumberOfSharesOutstanding",
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
  const ccy = reportingCurrency(facts);
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
    const unit = unitFor(cfg.unit ?? "money", ccy);
    const sign = cfg.sign ?? 1;
    for (const [end, v] of flowSeries(facts, cfg.concepts, unit, sign)) {
      ensure(qMetrics, end)[cfg.key] = v;
    }
    for (const [end, v] of annualFlow(facts, cfg.concepts, unit, sign)) {
      ensure(aMetrics, end)[cfg.key] = v;
    }
  }

  for (const cfg of INSTANT) {
    const unit = unitFor(cfg.unit ?? "money", ccy);
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
  const dnaQ = flowSeries(facts, DNA_CONCEPTS, ccy, 1);
  const dnaA = annualFlow(facts, DNA_CONCEPTS, ccy, 1);
  const taxQ = flowSeries(facts, TAX_CONCEPTS, ccy, 1);
  const taxA = annualFlow(facts, TAX_CONCEPTS, ccy, 1);
  const intQ = flowSeries(facts, INTEREST_CONCEPTS, ccy, 1);
  const intA = annualFlow(facts, INTEREST_CONCEPTS, ccy, 1);
  for (const [m, dna, tax, int] of [
    [qMetrics, dnaQ, taxQ, intQ],
    [aMetrics, dnaA, taxA, intA],
  ] as const) {
    for (const [end, met] of m.entries()) {
      if (met.ocf != null && met.capex != null) met.fcf = met.ocf + met.capex;
      const d = dna.get(end);
      if (d == null) continue;
      // Operating income when the filer tags it — one line, no assumptions.
      // Otherwise build EBIT from the bottom up. A company either tags the
      // subtotal or it doesn't, consistently, so this never mixes the two
      // definitions inside one company's history.
      if (met.operatingIncome != null) {
        met.ebitda = met.operatingIncome + d;
        continue;
      }
      const taxV = tax.get(end);
      const intV = int.get(end);
      if (met.netIncome != null && taxV != null && intV != null) {
        met.ebitda = met.netIncome + taxV + intV + d;
      }
    }
  }

  const rows = (m: Map<string, StatementMetrics>, type: "q" | "a"): EdgarRow[] =>
    [...m.entries()]
      .map(([periodEnd, metrics]) => ({ periodEnd, periodType: type, metrics }))
      .sort((x, y) => x.periodEnd.localeCompare(y.periodEnd));

  return [...rows(qMetrics, "q"), ...rows(aMetrics, "a")];
}

/* ─────────────── reconciling EDGAR's shares with Yahoo's ─────────────── */

// ADR ratios are small whole numbers or their reciprocals. A measured ratio
// near one of these is that ratio; the rest of the distance is restatement and
// basic-vs-diluted noise, which snapping removes rather than baking in.
const ADR_RATIOS = [
  1 / 12, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2,
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20,
];

const MATCH_MS = 20 * 24 * 3600 * 1000;

/**
 * How many ordinary shares one quoted share stands for, measured against the
 * rows already on file.
 *
 * EDGAR reports per ORDINARY share; Yahoo reports per quoted share, and for an
 * ADR those are not the same thing — Shell's ADS is two ordinary shares, TSM's
 * is five. Merging the two sources unscaled puts a 5× cliff in the middle of
 * the P/E history at the exact week the deep history takes over.
 *
 * Measured rather than looked up: no free feed publishes ADR ratios, but every
 * ticker with a Yahoo row and an EDGAR row for the same period states it
 * directly. Returns null when there is nothing to measure against or the
 * samples disagree — an unscaled series is a smaller lie than a wrongly
 * scaled one.
 */
export function epsShareRatio(
  edgarRows: EdgarRow[],
  existing: Array<{ periodEnd: string; periodType: string; eps: number | null }>,
): number | null {
  const samples: number[] = [];
  for (const row of edgarRows) {
    const e = row.metrics.eps;
    // Near-zero EPS makes the ratio explode; a loss year can differ in sign
    // between a continuing-operations figure and a total one.
    if (e == null || Math.abs(e) < 0.05) continue;
    const t = Date.parse(row.periodEnd);
    for (const other of existing) {
      if (other.periodType !== row.periodType || other.eps == null) continue;
      if (Math.abs(Date.parse(other.periodEnd) - t) > MATCH_MS) continue;
      const r = other.eps / e;
      if (r > 0) samples.push(r);
      break;
    }
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  const mid = samples[Math.floor(samples.length / 2)];
  // One period disagreeing with the others means we are not measuring a share
  // ratio at all — a changed accounting basis, say — so measure nothing.
  if (samples.some((s) => Math.abs(s - mid) > 0.1 * mid)) return null;
  const snapped = ADR_RATIOS.find((r) => Math.abs(mid - r) <= 0.05 * r);
  return snapped ?? mid;
}

/** EDGAR rows restated per quoted share. Returns the input when ratio is 1. */
export function scaleEps(rows: EdgarRow[], ratio: number): EdgarRow[] {
  if (ratio === 1) return rows;
  return rows.map((r) =>
    r.metrics.eps == null
      ? r
      : { ...r, metrics: { ...r.metrics, eps: r.metrics.eps * ratio } },
  );
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
  // Market-suffixed symbols (SAN.MC, MC.PA…) are listed only on their home
  // exchange and file nothing with the SEC. An ADR of the same company (SAN,
  // MC…) usually does — but that is a different symbol with a different price
  // series, so resolving one to the other here is not ours to do.
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

// Network entry point: ticker → deep-history rows and the currency they are
// stated in, or null when the ticker files nothing with the SEC / EDGAR is
// unavailable. Never throws.
//
// The currency is part of the answer, not a detail: these rows are merged into
// the same table as Yahoo's, and a 20-F filer reporting in EUR beside Yahoo
// figures in USD would put a silent 15% step in the middle of every chart. The
// caller compares the two before writing anything.
export async function fetchEdgarStatements(
  ticker: string,
): Promise<{ currency: string; rows: EdgarRow[] } | null> {
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
    return rows.length ? { currency: reportingCurrency(facts), rows } : null;
  } catch {
    return null;
  }
}
