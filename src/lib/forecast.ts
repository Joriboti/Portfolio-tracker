// Pure forecast engine for a passive / ETF portfolio.
//
// Projects a starting portfolio value forward, month by month, with recurring
// contributions, fee (TER) drag, an optional generic tax drag on yearly gains,
// and — for the multi-asset Monte Carlo path — correlated returns drawn from an
// expected-returns vector + covariance matrix, with optional annual
// rebalancing. Everything is deterministic given a seed, unit-agnostic (all
// amounts in one base currency; the caller FX-normalises), and runs entirely
// client-side, so it needs no backend route (respecting the Hobby 12-function
// cap). Mirrors the style of montecarlo.ts.

/* ─────────────────────────── shared types ─────────────────────────── */

export type ContributionFrequency =
  | "none"
  | "one_off"
  | "monthly"
  | "quarterly"
  | "annual";

/** A recurring (or one-off) contribution plan, all amounts in base currency. */
export interface ContributionSchedule {
  amount: number;
  frequency: ContributionFrequency;
}

/** One asset (typically an ETF) in the forecast portfolio. */
export interface ForecastAsset {
  id: string;
  /** Target weight in [0, 1]; the caller should make these sum to ~1. */
  weight: number;
  /** Expected annual return, decimal (0.07 = 7%). */
  expectedReturn: number;
  /** Annual volatility (std-dev of annual return), decimal. */
  volatility: number;
  /** Annual expense ratio drag, decimal (0.002 = 0.20% TER). */
  ter: number;
}

/** A yearly snapshot of a single projected path. */
export interface YearPoint {
  year: number;
  /** Cumulative money put in (start value + all contributions so far). */
  invested: number;
  value: number;
  /** value − invested. */
  gain: number;
}

/* ─────────────────────────── contributions ────────────────────────── */

/** Contribution paid in a given 0-based month index for a schedule. */
export function contributionForMonth(
  s: ContributionSchedule,
  monthIndex: number,
): number {
  if (!Number.isFinite(s.amount) || s.amount <= 0) return 0;
  switch (s.frequency) {
    case "one_off":
      return monthIndex === 0 ? s.amount : 0;
    case "monthly":
      return s.amount;
    case "quarterly":
      return monthIndex % 3 === 0 ? s.amount : 0;
    case "annual":
      return monthIndex % 12 === 0 ? s.amount : 0;
    case "none":
    default:
      return 0;
  }
}

/** Weighted total expense ratio across the assets (Σ wᵢ·TERᵢ). */
export function weightedTer(assets: ForecastAsset[]): number {
  const w = assets.reduce((s, a) => s + a.weight, 0);
  if (w <= 0) return 0;
  return assets.reduce((s, a) => s + (a.weight / w) * a.ter, 0);
}

/* ────────────────────── deterministic projection ──────────────────── */

export interface DeterministicConfig {
  startValue: number;
  years: number;
  /** Portfolio-level expected annual return, decimal. */
  annualReturn: number;
  /** Annual fee drag, decimal (e.g. weightedTer(...)). */
  ter: number;
  contribution: ContributionSchedule;
  /** Optional generic tax drag applied to each year's positive gain [0, 1). */
  taxDrag?: number;
}

export interface DeterministicResult {
  points: YearPoint[];
  finalValue: number;
  totalContributed: number;
  totalGain: number;
}

/**
 * Single-path deterministic projection, stepped monthly. The net monthly rate
 * compounds `annualReturn − ter`; contributions land on their schedule; an
 * optional tax drag skims each calendar year's positive gain. Returns one point
 * per year (year 0 = today).
 */
export function projectDeterministic(cfg: DeterministicConfig): DeterministicResult {
  const netAnnual = cfg.annualReturn - cfg.ter;
  const monthlyRate = Math.pow(1 + netAnnual, 1 / 12) - 1;
  const months = Math.max(0, Math.round(cfg.years * 12));

  let value = cfg.startValue;
  let invested = cfg.startValue;
  let yearStartValue = cfg.startValue;
  let yearStartInvested = cfg.startValue;

  const points: YearPoint[] = [
    { year: 0, invested, value, gain: value - invested },
  ];

  for (let m = 0; m < months; m++) {
    const c = contributionForMonth(cfg.contribution, m);
    value += c;
    invested += c;
    value *= 1 + monthlyRate;

    if ((m + 1) % 12 === 0) {
      // End of a calendar year: apply the generic tax drag to the gain earned
      // this year (net of the year's contributions), if configured.
      const drag = cfg.taxDrag ?? 0;
      if (drag > 0) {
        const contribThisYear = invested - yearStartInvested;
        const gainThisYear = value - yearStartValue - contribThisYear;
        if (gainThisYear > 0) value -= gainThisYear * drag;
      }
      points.push({
        year: (m + 1) / 12,
        invested,
        value,
        gain: value - invested,
      });
      yearStartValue = value;
      yearStartInvested = invested;
    }
  }

  return {
    points,
    finalValue: value,
    totalContributed: invested,
    totalGain: value - invested,
  };
}

/* ───────────────────────── seeded RNG + linalg ────────────────────── */

/** mulberry32 — small, fast, seeded PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller standard-normal draw from a [0,1) generator. */
export function standardNormal(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Cholesky factor L (lower-triangular, L·Lᵀ = A) of a symmetric
 * positive-semidefinite matrix. Non-PD inputs are nudged (negative pivots
 * clamped to 0) so a slightly inconsistent user correlation matrix still yields
 * a usable factor rather than NaNs.
 */
export function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const l: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= l[i][k] * l[j][k];
      if (i === j) l[i][j] = Math.sqrt(Math.max(sum, 0));
      else l[i][j] = l[j][j] > 0 ? sum / l[j][j] : 0;
    }
  }
  return l;
}

/** Covariance matrix Σᵢⱼ = corrᵢⱼ·σᵢ·σⱼ from a correlation matrix + vols. */
export function covarianceFrom(
  correlation: number[][],
  vols: number[],
): number[][] {
  const n = vols.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => correlation[i][j] * vols[i] * vols[j]),
  );
}

/** Reset each asset value to targetWeightᵢ × total (annual rebalancing). */
export function rebalanceToTargets(total: number, weights: number[]): number[] {
  const w = weights.reduce((s, x) => s + x, 0) || 1;
  return weights.map((wi) => (wi / w) * total);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * p)),
  );
  return sorted[idx];
}

/* ─────────────────────────── Monte Carlo ──────────────────────────── */

export interface MonteCarloConfig {
  startValue: number;
  years: number;
  assets: ForecastAsset[];
  /** N×N correlation matrix aligned with `assets`. */
  correlation: number[][];
  contribution: ContributionSchedule;
  rebalance: "none" | "annual";
  /** Optional generic tax drag on each year's positive gain [0, 1). */
  taxDrag?: number;
  runs: number;
  /** Seed for reproducible runs (tests, shareable forecasts). */
  seed?: number;
}

export interface MonteCarloResult {
  years: number[];
  /** Cumulative invested at each year boundary (same for every path). */
  invested: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  mean: number[];
  terminal: { p10: number; p50: number; p90: number; mean: number };
  runsCollected: number;
}

/**
 * Monte Carlo projection over correlated monthly returns. Each month every
 * asset grows by a draw from N(μ/12, Σ/12) (Σ from `correlation` + vols) net of
 * its monthly TER; contributions are split across assets by target weight;
 * annual rebalancing (optional) resets to target weights each 12 months; an
 * optional tax drag skims each year's positive gain. Yearly percentiles are
 * taken across `runs` paths. Seeded → reproducible.
 */
export function projectMonteCarlo(cfg: MonteCarloConfig): MonteCarloResult {
  const assets = cfg.assets;
  const n = assets.length;
  const yearCount = Math.max(0, Math.round(cfg.years));
  const weights = assets.map((a) => a.weight);
  const wSum = weights.reduce((s, x) => s + x, 0) || 1;
  const targetW = weights.map((w) => w / wSum);
  const mu = assets.map((a) => a.expectedReturn);
  const vols = assets.map((a) => a.volatility);
  const terM = assets.map((a) => a.ter / 12);

  const cov = covarianceFrom(cfg.correlation, vols);
  const L = cholesky(cov); // annual factor; monthly factor = L / √12
  const invSqrt12 = 1 / Math.sqrt(12);

  const rng = mulberry32(cfg.seed ?? 0x9e3779b9);

  // valuesByYear[year] = array of terminal values across runs at that year.
  const valuesByYear: number[][] = Array.from({ length: yearCount + 1 }, () => []);
  const investedByYear = new Array(yearCount + 1).fill(0);

  for (let r = 0; r < cfg.runs; r++) {
    // Per-asset holdings for this path.
    let holdings = targetW.map((w) => w * cfg.startValue);
    let invested = cfg.startValue;
    valuesByYear[0].push(cfg.startValue);
    if (r === 0) investedByYear[0] = invested;

    let yearStartValue = cfg.startValue;
    let yearStartInvested = cfg.startValue;

    for (let month = 0; month < yearCount * 12; month++) {
      // Contribution split across assets by target weight.
      const c = contributionForMonth(cfg.contribution, month);
      if (c > 0) {
        for (let i = 0; i < n; i++) holdings[i] += targetW[i] * c;
        invested += c;
      }

      // Correlated monthly return draw, applied per asset net of monthly TER.
      const z = new Array(n);
      for (let i = 0; i < n; i++) z[i] = standardNormal(rng);
      for (let i = 0; i < n; i++) {
        let corr = 0;
        for (let k = 0; k <= i; k++) corr += L[i][k] * z[k];
        const rMonth = mu[i] / 12 + corr * invSqrt12 - terM[i];
        holdings[i] *= 1 + rMonth;
      }

      if ((month + 1) % 12 === 0) {
        let total = holdings.reduce((s, x) => s + x, 0);

        const drag = cfg.taxDrag ?? 0;
        if (drag > 0) {
          const contribThisYear = invested - yearStartInvested;
          const gainThisYear = total - yearStartValue - contribThisYear;
          if (gainThisYear > 0) {
            total -= gainThisYear * drag;
            holdings = rebalanceToTargets(total, holdings); // keep split consistent
          }
        }

        if (cfg.rebalance === "annual") {
          holdings = rebalanceToTargets(total, targetW);
        }

        const year = (month + 1) / 12;
        valuesByYear[year].push(total);
        if (r === 0) investedByYear[year] = invested;
        yearStartValue = total;
        yearStartInvested = invested;
      }
    }
  }

  const years = valuesByYear.map((_, y) => y);
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  const mean: number[] = [];
  for (let y = 0; y <= yearCount; y++) {
    const arr = valuesByYear[y].slice().sort((a, b) => a - b);
    p10.push(percentile(arr, 0.1));
    p50.push(percentile(arr, 0.5));
    p90.push(percentile(arr, 0.9));
    mean.push(arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN);
  }

  const last = yearCount;
  return {
    years,
    invested: investedByYear,
    p10,
    p50,
    p90,
    mean,
    terminal: { p10: p10[last], p50: p50[last], p90: p90[last], mean: mean[last] },
    runsCollected: cfg.runs,
  };
}

/* ─────────────────────── chart-data derivations ───────────────────── */

/** Risk/return scatter point per asset (for the SVG scatter chart). */
export interface ScatterPoint {
  id: string;
  risk: number; // volatility
  return: number; // expected return
  weight: number;
}

export function riskReturnScatter(assets: ForecastAsset[]): ScatterPoint[] {
  return assets.map((a) => ({
    id: a.id,
    risk: a.volatility,
    return: a.expectedReturn,
    weight: a.weight,
  }));
}

/** Max peak-to-trough drawdown of a value path, decimal (≤ 0). */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}
