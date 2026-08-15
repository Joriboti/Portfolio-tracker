// Pure display math for the company dashboard ("Resum" tab): shapes the
// `?statements=` API payload into chart series and panel figures. No API or
// React here — covered by statements.test.ts.

export type StatementMetrics = {
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
  eps: number | null;
  operatingIncome: number | null;
  grossProfit: number | null;
  rnd: number | null;
  sga: number | null;
  shares: number | null;
  totalDebt: number | null;
  cash: number | null;
  fcf: number | null;
  ocf: number | null;
  capex: number | null;
  sbc: number | null;
  /** Filing sign convention: outflows are negative. */
  dividendsPaid: number | null;
  buybacks: number | null;
};

export type StatementRow = { periodEnd: string; metrics: StatementMetrics };

/** Analyst consensus for one upcoming quarter (earningsTrend "0q"/"+1q"). */
export type QuarterEstimate = {
  periodEnd: string;
  eps: number | null;
  revenue: number | null;
};

/**
 * One consensus figure with the spread behind it: what analysts expect on
 * average, the lowest and highest of them, how many there are, and the growth
 * the average implies against the same period a year earlier.
 */
export type EstimateBand = {
  avg: number;
  low: number | null;
  high: number | null;
  analysts: number | null;
  growth: number | null;
};

/** One un-reported period of the earningsTrend table ("0q"/"+1q"/"0y"/"+1y"). */
export type ForecastPeriod = {
  period: string;
  periodEnd: string;
  eps: EstimateBand | null;
  revenue: EstimateBand | null;
};

/**
 * A quarter that has already reported, on the consensus basis.
 *
 * `actual` is Yahoo's earningsHistory figure, not the income statement's — the
 * two are different numbers (adjusted vs GAAP) and only this one may be
 * compared with the estimate beside it.
 */
export type EpsSurpriseRow = {
  periodEnd: string;
  actual: number;
  estimate: number | null;
};

export type PanelExtras = {
  priceToSales: number | null;
  evToEbitda: number | null;
  operatingMargin: number | null;
  grossMargin: number | null;
  payoutRatio: number | null;
  dividendDate: string | null;
  nextYearEps: number | null;
  /** Ascending by periodEnd. Absent on older cached responses. */
  estimates?: QuarterEstimate[];
  /**
   * Consensus EPS for the fiscal years not yet reported, ascending, already
   * converted to the quote currency by the API (earningsTrend is not
   * consistent about which currency it answers in). Absent on older cached
   * responses; empty when it could not be normalised.
   */
  annualEstimates?: Array<{ periodEnd: string; eps: number }>;
  /**
   * The full analyst consensus behind the forecast charts. Absent on older
   * cached responses, which is why every consumer treats it as optional rather
   * than empty.
   */
  forecast?: {
    /**
     * Multiply a trend EPS by this to get one quoted share's worth in the
     * quote currency. Null when it could not be measured — see the API's
     * estScale note. Only meaningful for the ADRs whose filing and quote
     * currencies differ.
     */
    epsScale: number | null;
    periods: ForecastPeriod[];
    epsHistory: EpsSurpriseRow[];
  };
  /**
   * Currency the statements are filed in — not always the quote currency (TSM
   * quotes in USD but reports in TWD). Absent on older cached responses.
   */
  financialCurrency?: string | null;
  /** Currency `prices` are quoted in. Absent on older cached responses. */
  quoteCurrency?: string | null;
};

export type PricePoint = { date: string; close: number };

/** One weekly filing-currency → quote-currency rate. */
export type FxPoint = { date: string; rate: number };

export type CompanyStatements = {
  ticker: string;
  panel: PanelExtras | null;
  prices: PricePoint[];
  /**
   * Weekly filing→quote rate, empty when the two currencies are the same.
   * Absent on older cached responses, which is NOT the same as empty: an old
   * payload for an ADR cannot be converted at all.
   */
  fx?: FxPoint[];
  quarters: StatementRow[];
  annual: StatementRow[];
};

export type SeriesPoint = { label: string; value: number };

/** "2026-03-31" → "Q1 26" (calendar quarter of the period end). */
export function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  const q = Math.ceil((m || 1) / 3);
  return `Q${q} ${String(y).slice(2)}`;
}

/** "2025-09-30" → "2025" (fiscal-year rows are labelled by their end year). */
export function annualLabel(periodEnd: string): string {
  return periodEnd.slice(0, 4);
}

/**
 * Chart series for one metric: rows (already period-sorted ascending) → labelled
 * points, skipping periods where the metric is missing. `transform` lets a
 * chart flip filing-sign outflows (dividends, buybacks) positive for display.
 */
export function series(
  rows: StatementRow[],
  key: keyof StatementMetrics,
  opts?: { annual?: boolean; transform?: (v: number) => number },
): SeriesPoint[] {
  const label = opts?.annual ? annualLabel : quarterLabel;
  const out: SeriesPoint[] = [];
  for (const r of rows) {
    const v = r.metrics[key];
    if (v == null) continue;
    out.push({ label: label(r.periodEnd), value: opts?.transform ? opts.transform(v) : v });
  }
  return out;
}

const DAY = 24 * 3600 * 1000;

/**
 * The consensus bar to append after the last reported quarter, or null.
 *
 * Yahoo's "0q" row is the quarter *in progress*, but right after a company
 * files, "0q" is a period we already have actuals for — so estimates are
 * matched by period end, not by label: take the first one that lands roughly
 * one quarter (45–135 days) after the newest quarter reporting this metric.
 * A wider gap means the trend rows are stale or fiscally mismatched, and a
 * narrower one means we already have the real figure — neither is worth
 * drawing next to actuals.
 */
export function estimateBar(
  quarters: StatementRow[],
  estimates: QuarterEstimate[] | undefined,
  key: "revenue" | "eps",
): SeriesPoint | null {
  if (!estimates?.length) return null;
  let last: StatementRow | undefined;
  for (let i = quarters.length - 1; i >= 0; i--) {
    if (quarters[i].metrics[key] != null) {
      last = quarters[i];
      break;
    }
  }
  if (!last) return null;
  const lastT = Date.parse(last.periodEnd);
  if (!Number.isFinite(lastT)) return null;
  for (const e of estimates) {
    const v = e[key];
    if (v == null) continue;
    const gap = Date.parse(e.periodEnd) - lastT;
    if (!Number.isFinite(gap)) continue;
    if (gap > 45 * DAY && gap <= 135 * DAY) {
      return { label: quarterLabel(e.periodEnd), value: v };
    }
  }
  return null;
}

/** Sum of the metric over the last 4 quarters; null unless all 4 report it. */
export function ttm(quarters: StatementRow[], key: keyof StatementMetrics): number | null {
  const last4 = quarters.slice(-4);
  if (last4.length < 4) return null;
  let sum = 0;
  for (const r of last4) {
    const v = r.metrics[key];
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

/**
 * Latest year-over-year growth of a quarterly metric: newest quarter vs the
 * quarter ending ~1 year earlier (±45 days tolerance for fiscal drift). Null
 * when either side is missing or the base is ~zero (a sign flip through zero
 * has no meaningful growth rate).
 */
export function yoyLatest(
  quarters: StatementRow[],
  key: keyof StatementMetrics,
): number | null {
  for (let i = quarters.length - 1; i >= 0; i--) {
    const cur = quarters[i];
    const curV = cur.metrics[key];
    if (curV == null) continue;
    const curT = Date.parse(cur.periodEnd);
    const year = 365.25 * 24 * 3600 * 1000;
    const tol = 45 * 24 * 3600 * 1000;
    for (let j = i - 1; j >= 0; j--) {
      const base = quarters[j];
      const gap = curT - Date.parse(base.periodEnd);
      if (gap < year - tol) continue;
      if (gap > year + tol) break;
      const baseV = base.metrics[key];
      if (baseV == null || Math.abs(baseV) < 1e-9) return null;
      return curV / baseV - 1;
    }
    return null;
  }
  return null;
}

/**
 * Compact money label for big figures ("$379.60b", "31,23 kM€" per locale).
 * Falls back to a plain compact number when Intl rejects the currency code.
 */
export function formatCompact(value: number, currency?: string | null): string {
  const opts: Intl.NumberFormatOptions = {
    notation: "compact",
    maximumFractionDigits: 2,
  };
  try {
    if (currency) {
      return new Intl.NumberFormat(undefined, {
        ...opts,
        style: "currency",
        currency,
      }).format(value);
    }
  } catch {
    /* unknown currency code → plain number below */
  }
  return new Intl.NumberFormat(undefined, opts).format(value);
}

/** Percent with sign, 2 decimals: 0.0518 → "+5,18 %" (locale-aware). */
export function formatSignedPct(fraction: number): string {
  const pct = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(fraction);
  return pct;
}

/** Derived stat-panel figures that mix live fundamentals with TTM statements. */
export function cashFlowPanel(input: {
  freeCashflow: number | null;
  sharesOutstanding: number | null;
  price: number | null;
  sbcTtm: number | null;
}): {
  fcfPerShare: number | null;
  fcfYield: number | null;
  adjFcfPerShare: number | null;
  adjFcfYield: number | null;
  /** Relative reduction of FCF yield caused by SBC (negative fraction). */
  sbcImpact: number | null;
} {
  const { freeCashflow, sharesOutstanding, price, sbcTtm } = input;
  const perShare =
    freeCashflow != null && sharesOutstanding ? freeCashflow / sharesOutstanding : null;
  const fcfYield = perShare != null && price ? perShare / price : null;
  const adjPerShare =
    freeCashflow != null && sbcTtm != null && sharesOutstanding
      ? (freeCashflow - sbcTtm) / sharesOutstanding
      : null;
  const adjYield = adjPerShare != null && price ? adjPerShare / price : null;
  const impact =
    fcfYield != null && adjYield != null && Math.abs(fcfYield) > 1e-12
      ? (adjYield - fcfYield) / Math.abs(fcfYield)
      : null;
  return {
    fcfPerShare: perShare,
    fcfYield,
    adjFcfPerShare: adjPerShare,
    adjFcfYield: adjYield,
    sbcImpact: impact,
  };
}
