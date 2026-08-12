// The dependency-free heart of the X-ray: region classification, concentration
// maths and the diversification score.
//
// Split out of xray.ts so the serverless functions can share it. xray.ts itself
// reaches transaction history (and through it the Excel parser and the xlsx
// library), which a function that only ever sees broker positions has no
// business bundling. Nothing in this file imports anything.

export type Region = "US" | "Europe" | "UK" | "Asia" | "Crypto" | "Other";
export type Slice = { key: string; weight: number };

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Herfindahl index of a set of weights that sum to 1 (Σ wᵢ²). 1 = one bucket
 *  holds everything; → 0 as the split becomes more even. */
export function herfindahl(weights: number[]): number {
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

export function slicesFrom(map: Map<string, number>, total: number): Slice[] {
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

export type ScoreParts = {
  concentration: number;
  count: number;
  region: number;
  sector: number | null;
};

/**
 * The diversification score: four transparent components, each 0..1.
 *
 *   concentration — how many "effective" equal-weight names you hold
 *   count         — raw breadth (saturates around 15 names)
 *   region        — geographic spread (1 − Herfindahl of region weights)
 *   sector        — sector spread, when we have the data
 *
 * When sector data is too thin to trust, its weight is redistributed over the
 * other three rather than counted as zero — a portfolio should not be marked
 * down for a gap in *our* data.
 */
export function scoreDiversification(input: {
  effectiveN: number;
  count: number;
  regions: Slice[];
  sectors: Slice[] | null;
}): { score: number; grade: string; parts: ScoreParts } {
  const concPart = clamp01((input.effectiveN - 1) / 9); // effN 1→0, 10→1
  const countPart = clamp01((input.count - 1) / 14); // 1 name→0, 15+→1
  const regionPart = input.regions.length
    ? 1 - herfindahl(input.regions.map((r) => r.weight))
    : 0;
  const sectorPart = input.sectors ? 1 - herfindahl(input.sectors.map((s) => s.weight)) : null;

  const mix =
    sectorPart != null
      ? { concentration: 0.34, count: 0.24, region: 0.21, sector: 0.21 }
      : { concentration: 0.44, count: 0.3, region: 0.26, sector: 0 };
  const raw =
    concPart * mix.concentration +
    countPart * mix.count +
    regionPart * mix.region +
    (sectorPart ?? 0) * mix.sector;
  const score = Math.round(clamp01(raw) * 100);
  return {
    score,
    grade: scoreToGrade(score),
    // Parts stay as the raw 0..1 components that went into the weighted sum, so
    // a caller can show how the score was reached without re-deriving it.
    parts: {
      concentration: concPart,
      count: countPart,
      region: regionPart,
      sector: sectorPart,
    },
  };
}

/** Concentration summary for a set of weights sorted descending. */
export function concentrationOf(weights: number[]): {
  hhi: number;
  effectiveN: number;
  top1: number;
  top3: number;
} {
  const hhi = herfindahl(weights);
  return {
    hhi,
    effectiveN: hhi > 0 ? 1 / hhi : 0,
    top1: weights[0] ?? 0,
    top3: weights.slice(0, 3).reduce((s, x) => s + x, 0),
  };
}
