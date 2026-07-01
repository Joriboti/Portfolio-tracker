// Pure Monte Carlo layer over the Simple DCF (dcf.ts).
//
// Instead of a single fair value from point assumptions, draw the two most
// uncertain inputs (metric growth, exit multiple) from normal distributions and
// simulate thousands of Simple-DCF runs. The output is a distribution — "the
// fair value is between X and Y with ~80% probability" — summarised as
// percentiles + a histogram. Runs entirely client-side (a few thousand
// iterations are instantaneous), so no backend/cron is needed.

import { calculateSimpleDCF } from "./dcf";

/** Box-Muller normal sample. Pure given Math.random (not seeded). */
export function randomNormal(mean: number, sd: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type HistogramBin = { x0: number; x1: number; count: number };

export type MonteCarloResult = {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  /** Number of finite runs actually collected. */
  runs: number;
  bins: HistogramBin[];
};

export type MonteCarloBase = {
  baseMetric: number;
  growthRate: number;
  years: number;
  exitMultiple: number;
  desiredReturn: number;
  currentPrice: number | null;
};

export type MonteCarloSigmas = {
  /** Std-dev of the annual growth draw, decimal (e.g. 0.03 = ±3pp). */
  growthSd: number;
  /** Std-dev of the exit-multiple draw, absolute (e.g. 3 turns). */
  multipleSd: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

/**
 * Simulate `runs` Simple-DCF fair values with growth + exit multiple jittered.
 * Non-finite results (e.g. from a degenerate draw) are skipped. Returns
 * percentiles, mean and a `binCount`-bucket histogram over [min, max]. When
 * both sigmas are 0 every run is identical, so the distribution collapses to
 * the deterministic fair value (useful as a test anchor).
 */
export function monteCarloSimpleDCF(
  base: MonteCarloBase,
  sigmas: MonteCarloSigmas,
  runs = 5000,
  binCount = 24,
): MonteCarloResult {
  const results: number[] = [];
  for (let r = 0; r < runs; r++) {
    const growthRate =
      sigmas.growthSd > 0 ? randomNormal(base.growthRate, sigmas.growthSd) : base.growthRate;
    const exitMultiple = Math.max(
      0,
      sigmas.multipleSd > 0 ? randomNormal(base.exitMultiple, sigmas.multipleSd) : base.exitMultiple,
    );
    const { fairValue } = calculateSimpleDCF({
      baseMetric: base.baseMetric,
      growthRate,
      years: base.years,
      exitMultiple,
      desiredReturn: base.desiredReturn,
      currentPrice: base.currentPrice,
    });
    if (Number.isFinite(fairValue)) results.push(fairValue);
  }

  results.sort((a, b) => a - b);
  const n = results.length;
  const mean = n > 0 ? results.reduce((s, x) => s + x, 0) / n : NaN;

  // Histogram over [min, max]. Guard the zero-width case (all runs equal).
  const min = n > 0 ? results[0] : NaN;
  const max = n > 0 ? results[n - 1] : NaN;
  const bins: HistogramBin[] = [];
  if (n > 0) {
    const width = max - min;
    if (width <= 0) {
      bins.push({ x0: min, x1: max, count: n });
    } else {
      const step = width / binCount;
      for (let i = 0; i < binCount; i++) {
        bins.push({ x0: min + i * step, x1: min + (i + 1) * step, count: 0 });
      }
      for (const v of results) {
        let idx = Math.floor((v - min) / step);
        if (idx >= binCount) idx = binCount - 1;
        if (idx < 0) idx = 0;
        bins[idx].count++;
      }
    }
  }

  return {
    p10: percentile(results, 0.1),
    p50: percentile(results, 0.5),
    p90: percentile(results, 0.9),
    mean,
    runs: n,
    bins,
  };
}

/** Persisted Monte Carlo sigmas; reuses the DCF config for the point inputs. */
export type MonteCarloConfig = {
  growthSd: number;
  multipleSd: number;
};

export const DEFAULT_GROWTH_SD = 0.03;
export const DEFAULT_MULTIPLE_SD = 3;

export function defaultMonteCarloConfig(): MonteCarloConfig {
  return { growthSd: DEFAULT_GROWTH_SD, multipleSd: DEFAULT_MULTIPLE_SD };
}
