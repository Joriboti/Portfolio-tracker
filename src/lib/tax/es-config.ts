// Per-exercise Spanish IRPF configuration. Box numbers and thresholds shift
// every year, so they live here (one entry per exercise) and NEVER inside the
// engine. Box numbers are orientative — Renta Web is the source of truth and
// the UI says so; verify against the live Modelo 100 before enabling a new
// exercise.

export type EsYearConfig = {
  year: number;
  /** Progressive savings-base brackets: [upper bound (null = ∞), rate]. */
  brackets: { upTo: number | null; rate: number }[];
  /** Treaty cap on creditable foreign dividend withholding (habitual DTA). */
  treatyCap: number;
  /** Cross-compensation cap between gains and RCM inside the savings base. */
  crossCompensationCap: number;
  /** Model 720/721 reporting threshold, EUR. */
  abroadThreshold: number;
  /** Years a negative balance can be carried forward. */
  carryForwardYears: number;
  /** Orientative Modelo 100 box numbers, keyed like BoxLine.key. */
  boxes: Record<string, string>;
};

const SHARED = {
  treatyCap: 0.15,
  crossCompensationCap: 0.25,
  abroadThreshold: 50_000,
  carryForwardYears: 4,
  boxes: {
    interests: "0027",
    dividends: "0029",
    salesListed: "0328 i seg.",
    foreignDeduction: "0588",
    carryLosses: "G (saldos pendents)",
  },
};

export const ES_YEARS: Record<number, EsYearConfig> = {
  2024: {
    year: 2024,
    ...SHARED,
    brackets: [
      { upTo: 6_000, rate: 0.19 },
      { upTo: 50_000, rate: 0.21 },
      { upTo: 200_000, rate: 0.23 },
      { upTo: 300_000, rate: 0.27 },
      { upTo: null, rate: 0.28 },
    ],
  },
  2025: {
    year: 2025,
    ...SHARED,
    brackets: [
      { upTo: 6_000, rate: 0.19 },
      { upTo: 50_000, rate: 0.21 },
      { upTo: 200_000, rate: 0.23 },
      { upTo: 300_000, rate: 0.27 },
      { upTo: null, rate: 0.3 },
    ],
  },
};

export const ES_DEFAULT_YEAR = 2025;
export const ES_AVAILABLE_YEARS = Object.keys(ES_YEARS)
  .map(Number)
  .sort((a, b) => b - a);
