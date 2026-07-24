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

export type Region = "US" | "Europe" | "UK" | "Asia" | "Crypto" | "Other";

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
export type Slice = { key: string; weight: number };
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

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Herfindahl index of a set of weights that sum to 1 (Σ wᵢ²). 1 = one bucket
 *  holds everything; → 0 as the split becomes more even. */
function herfindahl(weights: number[]): number {
  return weights.reduce((s, w) => s + w * w, 0);
}

// Exchange-suffix → region. Yahoo appends the market as a dotted suffix
// (SAN.MC = Madrid, VOD.L = London). US listings carry no suffix. This is the
// most reliable geography signal we have without a paid data source; currency
// is the fallback when a ticker has no recognised suffix.
const SUFFIX_REGION: Record<string, Region> = {
  // United Kingdom
  L: "UK",
  IL: "UK",
  // Europe (continental)
  MC: "Europe", PA: "Europe", AS: "Europe", DE: "Europe", F: "Europe",
  BE: "Europe", MI: "Europe", BR: "Europe", LS: "Europe", VI: "Europe",
  MA: "Europe", ST: "Europe", HE: "Europe", OL: "Europe", CO: "Europe",
  SW: "Europe", VX: "Europe", IR: "Europe", AT: "Europe", WA: "Europe",
  PR: "Europe", LI: "Europe",
  // Asia-Pacific
  HK: "Asia", T: "Asia", JP: "Asia", KS: "Asia", KQ: "Asia", SS: "Asia",
  SZ: "Asia", TW: "Asia", SI: "Asia", AX: "Asia", NS: "Asia", BO: "Asia",
  KL: "Asia", BK: "Asia",
};

const CURRENCY_REGION: Record<string, Region> = {
  USD: "US",
  EUR: "Europe",
  GBP: "UK",
  GBp: "UK",
  CHF: "Europe",
  SEK: "Europe", NOK: "Europe", DKK: "Europe", PLN: "Europe",
  JPY: "Asia", HKD: "Asia", CNY: "Asia", KRW: "Asia", TWD: "Asia",
  SGD: "Asia", AUD: "Asia", INR: "Asia",
  CAD: "Other", BRL: "Other", MXN: "Other",
};

/** Classify a holding's region from its ticker suffix, falling back to the
 *  quote currency, then "Other". A "-USD" tail (BTC-USD…) marks crypto. */
export function regionForTicker(ticker: string, currency: string | null): Region {
  const up = ticker.trim().toUpperCase();
  if (/-USD$/.test(up) || /^(BTC|ETH|SOL|ADA|XRP|DOGE|DOT|LTC|BNB|USDT|USDC)$/.test(up)) {
    return "Crypto";
  }
  const dot = up.lastIndexOf(".");
  if (dot >= 0) {
    const suffix = up.slice(dot + 1);
    if (SUFFIX_REGION[suffix]) return SUFFIX_REGION[suffix];
  }
  if (currency && CURRENCY_REGION[currency]) return CURRENCY_REGION[currency];
  // No suffix and an unknown/absent currency: overwhelmingly a US listing.
  if (!currency || currency === "USD") return "US";
  return "Other";
}

function slicesFrom(map: Map<string, number>, total: number): Slice[] {
  if (total <= 0) return [];
  return [...map.entries()]
    .map(([key, v]) => ({ key, weight: v / total }))
    .sort((a, b) => b.weight - a.weight);
}

// Grade bands on the 0..100 diversification score. Deliberately generous at the
// top (a genuinely spread portfolio should be able to reach an A) and harsh at
// the bottom (a one- or two-stock "portfolio" earns an F).
export function scoreToGrade(score: number): string {
  if (score >= 88) return "A+";
  if (score >= 78) return "A";
  if (score >= 70) return "B+";
  if (score >= 62) return "B";
  if (score >= 52) return "C+";
  if (score >= 42) return "C";
  if (score >= 30) return "D";
  return "F";
}

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
  const hhi = herfindahl(w);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  const top1 = w[0] ?? 0;
  const top3 = w.slice(0, 3).reduce((s, x) => s + x, 0);

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
  // Four transparent components, each 0..1:
  //  concentration — how many "effective" equal-weight names you hold
  //  count         — raw breadth (saturates around 15 names)
  //  region        — geographic spread (1 − Herfindahl of region weights)
  //  sector        — sector spread, when we have the data
  const concPart = clamp01((effectiveN - 1) / 9); // effN 1→0, 10→1
  const countPart = clamp01((n - 1) / 14); // 1 name→0, 15+→1
  const regionPart = regions.length ? 1 - herfindahl(regions.map((r) => r.weight)) : 0;
  const sectorPart = sectors ? 1 - herfindahl(sectors.map((s) => s.weight)) : null;

  const weightsMix =
    sectorPart != null
      ? { concentration: 0.34, count: 0.24, region: 0.21, sector: 0.21 }
      : { concentration: 0.44, count: 0.3, region: 0.26, sector: 0 };
  const raw =
    concPart * weightsMix.concentration +
    countPart * weightsMix.count +
    regionPart * weightsMix.region +
    (sectorPart ?? 0) * weightsMix.sector;
  const score = Math.round(clamp01(raw) * 100);
  const grade = scoreToGrade(score);

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
    scoreParts: { concentration: concPart, count: countPart, region: regionPart, sector: sectorPart },
    flags,
  };
}
