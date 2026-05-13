// Portfolio analytics: pure math, no side effects, no I/O.
//
// All inputs are simple JS arrays/maps. Tests-friendly: every function here
// is deterministic and side-effect free, so callers can swap in synthetic
// data without touching DB or HTTP. The API layer (`api/analytics.ts`) is
// the only thing that should pull rows from Postgres and feed them in.
//
// Conventions:
//   - "returns" means simple period-over-period returns: (p_t - p_{t-1}) / p_{t-1}
//   - "weeks" because we use weekly closes, but the math holds for any
//     uniform period — just keep the annualization factor (52 by default)
//     consistent across all metrics in a single call.
//   - All series are aligned by index before any math runs. Misaligned
//     dates would silently corrupt results, so `alignByDate` is mandatory.

export type WeeklyPoint = { weekDate: string; close: number };

export type AlignedSeries = {
  dates: string[];
  values: number[];
};

/**
 * Given a list of {date, value} maps (one per ticker) keyed by ISO week
 * date, return a list of "common" dates and, for each input series, the
 * values aligned to those dates. Dates only included if EVERY input series
 * has a price on that date — otherwise the missing one would dominate the
 * regression with an implicit zero.
 */
export function alignByDate(
  seriesByName: Record<string, Map<string, number>>,
): { dates: string[]; series: Record<string, number[]> } {
  const names = Object.keys(seriesByName);
  if (names.length === 0) return { dates: [], series: {} };

  // Intersect all date sets
  const [first, ...rest] = names.map((n) => seriesByName[n]);
  const commonDates: string[] = [];
  for (const date of first.keys()) {
    let inAll = true;
    for (const m of rest) {
      if (!m.has(date)) {
        inAll = false;
        break;
      }
    }
    if (inAll) commonDates.push(date);
  }
  commonDates.sort();

  const series: Record<string, number[]> = {};
  for (const name of names) {
    const m = seriesByName[name];
    series[name] = commonDates.map((d) => m.get(d) as number);
  }
  return { dates: commonDates, series };
}

/**
 * Convert a price series to a return series: r_t = (p_t - p_{t-1}) / p_{t-1}.
 * Drops the first element (no prior price to compare to). Guards against
 * zero/negative prior prices (returns 0 for that step instead of NaN).
 */
export function toReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(curr)) {
      out.push(0);
      continue;
    }
    out.push((curr - prev) / prev);
  }
  return out;
}

/**
 * Sample mean of a finite array. Returns 0 for empty input.
 */
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Sample variance (denominator n-1) — the unbiased estimator used by every
 * stats package for regression, Sharpe, etc. Falls back to 0 for n < 2.
 */
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return s / (xs.length - 1);
}

export function stddev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

/**
 * Sample covariance (denominator n-1). Requires xs and ys to be the same
 * length and aligned period-by-period.
 */
export function covariance(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (xs[i] - mx) * (ys[i] - my);
  }
  return s / (xs.length - 1);
}

/**
 * Pearson correlation coefficient. Range [-1, 1]. Returns 0 for degenerate
 * inputs (constant series, mismatched length).
 */
export function correlation(xs: number[], ys: number[]): number {
  const sx = stddev(xs);
  const sy = stddev(ys);
  if (sx === 0 || sy === 0) return 0;
  return covariance(xs, ys) / (sx * sy);
}

/**
 * Beta of `portfolio` returns vs `market` returns:
 *   β = Cov(portfolio, market) / Var(market)
 * Standard textbook OLS slope. Both series MUST be aligned.
 */
export function beta(
  portfolioReturns: number[],
  marketReturns: number[],
): number {
  const varM = variance(marketReturns);
  if (varM === 0) return 0;
  return covariance(portfolioReturns, marketReturns) / varM;
}

/**
 * Coefficient of determination (R²) for the OLS regression of `portfolio`
 * on `market`. Tells you what fraction of the portfolio's variability is
 * explained by the market.
 */
export function rSquared(
  portfolioReturns: number[],
  marketReturns: number[],
): number {
  const r = correlation(portfolioReturns, marketReturns);
  return r * r;
}

/**
 * Annualized arithmetic mean return. periodsPerYear=52 for weekly returns.
 * (We use arithmetic, not geometric, to match the regression-based alpha
 * formula — they need to be consistent in the same call.)
 */
export function annualizedMean(returns: number[], periodsPerYear = 52): number {
  return mean(returns) * periodsPerYear;
}

/**
 * Annualized standard deviation of returns.
 */
export function annualizedStddev(
  returns: number[],
  periodsPerYear = 52,
): number {
  return stddev(returns) * Math.sqrt(periodsPerYear);
}

/**
 * Jensen's Alpha (annualized):
 *   α = R_p − [R_f + β · (R_m − R_f)]
 * Where R_p, R_m are annualized arithmetic mean returns, R_f is the annual
 * risk-free rate (e.g. 0.03 for 3%), and β is the portfolio's beta vs the
 * market.
 */
export function jensensAlpha(params: {
  portfolioAnnualReturn: number;
  marketAnnualReturn: number;
  beta: number;
  riskFreeRate: number;
}): number {
  const { portfolioAnnualReturn, marketAnnualReturn, beta, riskFreeRate } =
    params;
  const expected = riskFreeRate + beta * (marketAnnualReturn - riskFreeRate);
  return portfolioAnnualReturn - expected;
}

/**
 * Sharpe Ratio (annualized):
 *   Sharpe = (R_p − R_f) / σ_p
 * Where σ_p is the annualized stddev of the portfolio's returns. Higher =
 * better risk-adjusted return.
 */
export function sharpeRatio(params: {
  portfolioAnnualReturn: number;
  portfolioAnnualStddev: number;
  riskFreeRate: number;
}): number {
  const { portfolioAnnualReturn, portfolioAnnualStddev, riskFreeRate } = params;
  if (portfolioAnnualStddev === 0) return 0;
  return (portfolioAnnualReturn - riskFreeRate) / portfolioAnnualStddev;
}

/**
 * Maximum drawdown of a return series, expressed as a positive fraction
 * (e.g. 0.32 = 32% peak-to-trough). Computed by walking the cumulative
 * wealth curve.
 */
export function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let wealth = 1;
  let maxDD = 0;
  for (const r of returns) {
    wealth *= 1 + r;
    if (wealth > peak) peak = wealth;
    const dd = (peak - wealth) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Compute the weighted portfolio return series, given:
 *   - per-ticker aligned return series
 *   - weights (must sum to ~1; we don't enforce, just multiply)
 *
 * Returns the array of weighted weekly returns, same length as input series.
 */
export function weightedPortfolioReturns(
  returnsByTicker: Record<string, number[]>,
  weightByTicker: Record<string, number>,
): number[] {
  const tickers = Object.keys(returnsByTicker);
  if (tickers.length === 0) return [];
  const len = returnsByTicker[tickers[0]].length;
  const out = new Array(len).fill(0);
  for (const ticker of tickers) {
    const w = weightByTicker[ticker] ?? 0;
    if (w === 0) continue;
    const series = returnsByTicker[ticker];
    for (let i = 0; i < len; i++) {
      out[i] += w * series[i];
    }
  }
  return out;
}

// ---- Top-level: full metrics from raw inputs --------------------------

export type AnalyticsMetrics = {
  weeks: number;
  beta: number;
  alpha: number; // annualized, fraction (0.04 = +4%)
  sharpe: number;
  volatility: number; // annualized stddev, fraction
  maxDrawdown: number; // fraction
  rSquared: number;
  portfolioAnnualReturn: number;
  marketAnnualReturn: number;
};

export type AnalyticsInput = {
  // Map ticker → weekly close series. The benchmark MUST be present under
  // the agreed key (e.g. "^GSPC").
  pricesByTicker: Record<string, WeeklyPoint[]>;
  // Map ticker → portfolio weight (e.g. by market value). Does NOT include
  // the benchmark.
  weightByTicker: Record<string, number>;
  benchmarkKey: string;
  riskFreeRate: number; // e.g. 0.03
  periodsPerYear?: number; // defaults to 52
  minWeeks?: number; // skip tickers with fewer points, default 26
};

export type AnalyticsResult = {
  metrics: AnalyticsMetrics | null;
  excludedTickers: string[]; // didn't have enough history
  includedTickers: string[]; // contributed to the calculation
  reweightedWeightSum: number; // total weight of included tickers (was renormalized)
};

/**
 * Top-level orchestrator. Pulls all the pieces together: aligns dates,
 * computes per-ticker returns, weights them, regresses against the
 * benchmark, and returns a struct of metrics.
 *
 * If a ticker has fewer than `minWeeks` data points, it's excluded and its
 * weight is redistributed pro-rata across the remaining tickers (otherwise
 * the portfolio would have a "missing" slice that doesn't behave like a
 * real portfolio).
 */
export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const {
    pricesByTicker,
    weightByTicker,
    benchmarkKey,
    riskFreeRate,
    periodsPerYear = 52,
    minWeeks = 26,
  } = input;

  const benchmarkSeries = pricesByTicker[benchmarkKey];
  if (!benchmarkSeries || benchmarkSeries.length < minWeeks) {
    return {
      metrics: null,
      excludedTickers: [],
      includedTickers: [],
      reweightedWeightSum: 0,
    };
  }

  // Split user tickers (weighted) from the benchmark
  const userTickers = Object.keys(weightByTicker).filter(
    (t) => t !== benchmarkKey,
  );

  // Filter out tickers without enough data
  const included: string[] = [];
  const excluded: string[] = [];
  for (const t of userTickers) {
    const series = pricesByTicker[t];
    if (series && series.length >= minWeeks) {
      included.push(t);
    } else {
      excluded.push(t);
    }
  }

  if (included.length === 0) {
    return {
      metrics: null,
      excludedTickers: excluded,
      includedTickers: [],
      reweightedWeightSum: 0,
    };
  }

  // Renormalize weights so the included tickers sum to 1 (or to the
  // original sum minus the excluded weight — we preserve the *original*
  // sum so callers can see how much of the portfolio is being analyzed).
  let includedWeight = 0;
  for (const t of included) {
    includedWeight += weightByTicker[t] ?? 0;
  }
  const reweighted: Record<string, number> = {};
  if (includedWeight > 0) {
    for (const t of included) {
      reweighted[t] = (weightByTicker[t] ?? 0) / includedWeight;
    }
  }

  // Build the date-aligned price matrix
  const seriesByName: Record<string, Map<string, number>> = {};
  seriesByName[benchmarkKey] = new Map(
    benchmarkSeries.map((p) => [p.weekDate, p.close]),
  );
  for (const t of included) {
    seriesByName[t] = new Map(
      pricesByTicker[t].map((p) => [p.weekDate, p.close]),
    );
  }
  const { dates, series } = alignByDate(seriesByName);
  if (dates.length < minWeeks) {
    return {
      metrics: null,
      excludedTickers: excluded,
      includedTickers: [],
      reweightedWeightSum: 0,
    };
  }

  // Convert to returns
  const returnsByTicker: Record<string, number[]> = {};
  for (const t of included) {
    returnsByTicker[t] = toReturns(series[t]);
  }
  const marketReturns = toReturns(series[benchmarkKey]);

  const portfolioReturns = weightedPortfolioReturns(returnsByTicker, reweighted);

  // Run the regression + risk metrics
  const b = beta(portfolioReturns, marketReturns);
  const r2 = rSquared(portfolioReturns, marketReturns);
  const portAnnualReturn = annualizedMean(portfolioReturns, periodsPerYear);
  const marketAnnualReturn = annualizedMean(marketReturns, periodsPerYear);
  const portAnnualStddev = annualizedStddev(portfolioReturns, periodsPerYear);

  const alpha = jensensAlpha({
    portfolioAnnualReturn: portAnnualReturn,
    marketAnnualReturn,
    beta: b,
    riskFreeRate,
  });

  const sharpe = sharpeRatio({
    portfolioAnnualReturn: portAnnualReturn,
    portfolioAnnualStddev: portAnnualStddev,
    riskFreeRate,
  });

  const dd = maxDrawdown(portfolioReturns);

  return {
    metrics: {
      weeks: portfolioReturns.length,
      beta: b,
      alpha,
      sharpe,
      volatility: portAnnualStddev,
      maxDrawdown: dd,
      rSquared: r2,
      portfolioAnnualReturn: portAnnualReturn,
      marketAnnualReturn,
    },
    excludedTickers: excluded,
    includedTickers: included,
    reweightedWeightSum: includedWeight,
  };
}
