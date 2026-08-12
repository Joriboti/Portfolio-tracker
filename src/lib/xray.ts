// Portfolio X-Ray — pure scoring math for the public "Radiografia" tool. Takes a
// set of holdings already enriched with a live market value (in EUR), plus the
// raw transactions, and produces a single diversification grade + the supporting
// metrics (concentration, geography, sector mix) and a list of risk flags.
//
// Everything here is side-effect-free and FX-free: the caller (PortfolioXray)
// does the network fetches and converts each holding's market value into EUR
// before calling computeXray, so this module stays trivially testable and the
// grade is deterministic for a given input.

import type { Transaction, Dividend, Interest } from "./excel-parser";
import { computeSinceInception, type SinceInception } from "./performance";

import {
  concentrationOf,
  regionForTicker,
  scoreDiversification,
  scoreToGrade,
  slicesFrom,
  type Region,
  type Slice,
} from "./xray-core";

// Re-exported so callers keep importing the X-ray's vocabulary from one place.
export { regionForTicker, scoreToGrade };
export type { Region, Slice };

export type XrayHoldingInput = {
  ticker: string;
  shares: number;
  costEur: number; // cost basis of the remaining (open) shares, EUR
  avgCostEur: number;
  realizedPlEur: number;
  /** Live market value in EUR, or null when the ticker couldn't be priced
   *  (valued at cost so it never invents a gain or a loss). */
  marketValueEur: number | null;
  currency: string | null; // quote currency, e.g. "USD"
  sector: string | null; // Yahoo sector, e.g. "Technology"
  trailingPe: number | null;
};

export type XrayInput = {
  holdings: XrayHoldingInput[];
  txns: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
};

export type XrayWeight = { ticker: string; weight: number; valueEur: number };
export type FlagSeverity = "high" | "med" | "low";
export type XrayFlag = { id: string; severity: FlagSeverity; value?: number; label?: string };

export type XrayReport = {
  holdingsCount: number;
  totalValueEur: number;
  totalCostEur: number;
  unrealizedEur: number;
  sinceInception: SinceInception;
  weights: XrayWeight[]; // sorted desc
  concentration: { hhi: number; effectiveN: number; top1: number; top3: number };
  regions: Slice[]; // sorted desc, weights sum to 1
  sectors: Slice[] | null; // null when sector coverage is too thin to trust
  sectorCoverage: number;
  weightedPe: number | null;
  peCoverage: number;
  score: number; // 0..100
  grade: string; // "A+" … "F"
  scoreParts: { concentration: number; count: number; region: number; sector: number | null };
  flags: XrayFlag[];
};

export function computeXray(input: XrayInput): XrayReport {
  const holdings = input.holdings;
  const n = holdings.length;

  // Value each holding: live market value when we have it, else its cost basis
  // (so an unpriceable name is weight-neutral rather than dropped, mirroring the
  // dashboard's robustness layer).
  const valueOf = (h: XrayHoldingInput): number =>
    h.marketValueEur != null ? h.marketValueEur : h.costEur;

  const totalValueEur = holdings.reduce((s, h) => s + valueOf(h), 0);
  const totalCostEur = holdings.reduce((s, h) => s + h.costEur, 0);
  const unrealizedEur = totalValueEur - totalCostEur;

  const weights: XrayWeight[] = holdings
    .map((h) => ({
      ticker: h.ticker,
      valueEur: valueOf(h),
      weight: totalValueEur > 0 ? valueOf(h) / totalValueEur : 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  const w = weights.map((x) => x.weight);
  const { hhi, effectiveN, top1, top3 } = concentrationOf(w);

  // Region mix by market value.
  const regionMap = new Map<string, number>();
  const currencySet = new Set<string>();
  for (const h of holdings) {
    const r = regionForTicker(h.ticker, h.currency);
    regionMap.set(r, (regionMap.get(r) ?? 0) + valueOf(h));
    if (h.currency) currencySet.add(h.currency);
  }
  const regions = slicesFrom(regionMap, totalValueEur);

  // Sector mix — only over the value we actually have a sector for.
  const sectorMap = new Map<string, number>();
  let sectorCovered = 0;
  for (const h of holdings) {
    if (h.sector) {
      sectorMap.set(h.sector, (sectorMap.get(h.sector) ?? 0) + valueOf(h));
      sectorCovered += valueOf(h);
    }
  }
  const sectorCoverage = totalValueEur > 0 ? sectorCovered / totalValueEur : 0;
  // Below 40% coverage the breakdown is more misleading than useful, so we hide
  // it (and drop it from the score) rather than show a lopsided chart.
  const sectors = sectorCoverage >= 0.4 ? slicesFrom(sectorMap, sectorCovered) : null;

  // Value-weighted harmonic mean P/E (same method as the dashboard PER card),
  // over holdings with a positive trailing P/E. Shown only with enough coverage.
  let peWeight = 0;
  let peRecip = 0;
  for (const h of holdings) {
    if (h.trailingPe != null && h.trailingPe > 0) {
      const val = valueOf(h);
      peWeight += val;
      peRecip += val / h.trailingPe;
    }
  }
  const peCoverage = totalValueEur > 0 ? peWeight / totalValueEur : 0;
  const weightedPe = peRecip > 0 && peCoverage >= 0.4 ? peWeight / peRecip : null;

  // ---- Diversification score ----------------------------------------------
  const { score, grade, parts: scoreParts } = scoreDiversification({
    effectiveN,
    count: n,
    regions,
    sectors,
  });

  // ---- Risk flags ----------------------------------------------------------
  const flags: XrayFlag[] = [];
  if (top1 >= 0.3) {
    flags.push({ id: "concentrated", severity: top1 >= 0.45 ? "high" : "med", value: top1 });
  }
  if (n < 5) {
    flags.push({ id: "fewHoldings", severity: n < 3 ? "high" : "med", value: n });
  }
  const topRegion = regions[0];
  if (topRegion && topRegion.weight >= 0.75) {
    flags.push({
      id: "regionBias",
      severity: topRegion.weight >= 0.9 ? "high" : "med",
      value: topRegion.weight,
      label: topRegion.key,
    });
  }
  if (sectors && sectors[0] && sectors[0].weight >= 0.4) {
    flags.push({
      id: "sectorBias",
      severity: sectors[0].weight >= 0.6 ? "high" : "med",
      value: sectors[0].weight,
      label: sectors[0].key,
    });
  }
  if (currencySet.size === 1 && n >= 4) {
    flags.push({ id: "singleCurrency", severity: "low", label: [...currencySet][0] });
  }
  const tinyCount = weights.filter((x) => x.weight > 0 && x.weight < 0.01).length;
  if (tinyCount >= 5) {
    flags.push({ id: "manyTiny", severity: "low", value: tinyCount });
  }
  const order: Record<FlagSeverity, number> = { high: 0, med: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);

  // ---- Return / IRR (reuses the dashboard's since-inception engine) --------
  const openCost = holdings.reduce((s, h) => s + h.costEur, 0);
  const realized = holdings.reduce((s, h) => s + h.realizedPlEur, 0);
  const sinceInception = computeSinceInception({
    txns: input.txns,
    dividends: input.dividends,
    interests: input.interests,
    currentValue: totalValueEur,
    openCost,
    realized,
  });

  return {
    holdingsCount: n,
    totalValueEur,
    totalCostEur,
    unrealizedEur,
    sinceInception,
    weights,
    concentration: { hhi, effectiveN, top1, top3 },
    regions,
    sectors,
    sectorCoverage,
    weightedPe,
    peCoverage,
    score,
    grade,
    scoreParts,
    flags,
  };
}
