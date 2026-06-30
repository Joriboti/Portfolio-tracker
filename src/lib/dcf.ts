// Pure, side-effect-free "Simple DCF" valuation engine — Qualtrim-style.
//
// Sibling of scenarioValuation.ts: same conventions (unit-agnostic, NaN-free,
// undefinable ratios come back as null). Every monetary input (baseMetric,
// currentPrice) MUST be expressed per share in the SAME currency before
// calling. The dashboard component FX-converts where needed and feeds the
// ticker's quote currency, so fairValue is directly comparable to the price.
//
// Unlike a textbook enterprise DCF (project absolute FCF, discount at WACC,
// subtract net debt, divide by shares), this is a per-share model driven by an
// exit multiple and a required ("desired") return — the formulation Qualtrim's
// Simple DCF uses. It works on any positive per-share metric (EPS or FCF/share)
// and is always computable when that metric and the current price exist, so the
// panel never falls back to "missing data" the way the enterprise model did.
//
// Formulas:
//   futureMetric  = baseMetric × (1 + growth) ^ years
//   futurePrice   = futureMetric × exitMultiple
//   fairValue     = futurePrice / (1 + desiredReturn) ^ years   // max price today
//   impliedReturn = (futurePrice / currentPrice) ^ (1/years) − 1 // CAGR if bought now
//   impliedGrowth = (1 + desiredReturn) × (price / (base × mult)) ^ (1/years) − 1

/** Which per-share metric the projection compounds. */
export type DcfMetric = "eps" | "fcfShare";

/** Everything `calculateSimpleDCF` needs, per share, in one shared currency. */
export type SimpleDcfInputs = {
  /** Base per-share metric (forward EPS or FCF/share). Must be > 0 to value. */
  baseMetric: number;
  /** Annual growth of the metric, decimal (e.g. 0.10). */
  growthRate: number;
  /** Horizon in years (the exponent). */
  years: number;
  /** Terminal multiple applied to the metric (exit P/E or P/FCF). */
  exitMultiple: number;
  /** Required annual return used to discount the future price, decimal. */
  desiredReturn: number;
  /** Live price in the same currency, or null when unavailable. */
  currentPrice: number | null;
};

/** Full output of the Simple DCF engine. NaN-free; undefinables are null. */
export type SimpleDcfResult = {
  /** Projected per-share metric at the horizon. */
  futureMetric: number;
  /** Projected share price at the horizon (futureMetric × exitMultiple). */
  futurePrice: number;
  /** Today's fair value: the most you can pay to earn the desired return. */
  fairValue: number;
  /** fairValue / currentPrice − 1, or null when price is unusable. */
  upsideVsPrice: number | null;
  /** Annualised return earned if bought at the current price, or null. */
  impliedReturn: number | null;
};

function isUsable(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n !== 0;
}

/**
 * Run a per-share Simple DCF. Pure: no I/O, no mutation. Negative/zero base
 * metrics (a loss-making company, no FCF) produce a non-positive future price;
 * the derived ratios then come back null rather than lying.
 */
export function calculateSimpleDCF(i: SimpleDcfInputs): SimpleDcfResult {
  const futureMetric = i.baseMetric * Math.pow(1 + i.growthRate, i.years);
  const futurePrice = futureMetric * i.exitMultiple;
  const fairValue = futurePrice / Math.pow(1 + i.desiredReturn, i.years);

  const upsideVsPrice = isUsable(i.currentPrice)
    ? fairValue / i.currentPrice - 1
    : null;

  // CAGR an investor buying at today's price would realise, assuming the exit
  // multiple holds. Only defined for a positive future price and price.
  const impliedReturn =
    isUsable(i.currentPrice) && futurePrice > 0 && i.years > 0
      ? Math.pow(futurePrice / i.currentPrice, 1 / i.years) - 1
      : null;

  return {
    futureMetric,
    futurePrice,
    fairValue,
    upsideVsPrice: upsideVsPrice != null && Number.isFinite(upsideVsPrice) ? upsideVsPrice : null,
    impliedReturn: impliedReturn != null && Number.isFinite(impliedReturn) ? impliedReturn : null,
  };
}

/**
 * Reverse the model: the constant annual metric growth the current price is
 * pricing in, for the given exit multiple and required return. Closed form —
 * solving fairValue = currentPrice for growth. Returns null when the inputs
 * can't define it (non-positive base, multiple or price).
 */
export function impliedGrowth(args: {
  currentPrice: number | null;
  baseMetric: number;
  years: number;
  exitMultiple: number;
  desiredReturn: number;
}): number | null {
  const { currentPrice, baseMetric, years, exitMultiple, desiredReturn } = args;
  if (
    !isUsable(currentPrice) ||
    !(baseMetric > 0) ||
    !(exitMultiple > 0) ||
    !(years > 0)
  ) {
    return null;
  }
  // currentPrice = base·(1+g)^n·mult / (1+r)^n
  //   ⇒ (1+g) = (1+r)·[ price / (base·mult) ]^(1/n)
  const ratio = currentPrice / (baseMetric * exitMultiple);
  const g = (1 + desiredReturn) * Math.pow(ratio, 1 / years) - 1;
  return Number.isFinite(g) ? g : null;
}

export const DEFAULT_GROWTH = 0.1;
export const DEFAULT_YEARS = 5;
export const DEFAULT_EXIT_MULTIPLE = 15;
export const DEFAULT_DESIRED_RETURN = 0.1;

/**
 * Editable, persisted slice of the Simple DCF model. Live data (the base
 * metric, price) is recomputed from fundamentals on every load; only the
 * assumptions + an optional manual base override are saved. Stored alongside
 * the scenario model in the same per-holding JSONB document.
 */
export type DcfConfig = {
  /** Project EPS or FCF per share. */
  metric: DcfMetric;
  /** Manual override of the base per-share metric; null = use the auto value. */
  baseOverride: number | null;
  /** Annual metric growth, decimal. */
  growthRate: number;
  /** Horizon in years. */
  years: number;
  /** Terminal exit multiple (P/E or P/FCF). */
  exitMultiple: number;
  /** Required annual return, decimal. */
  desiredReturn: number;
};

/** A fresh Simple DCF config with sensible defaults. */
export function defaultDcfConfig(): DcfConfig {
  return {
    metric: "eps",
    baseOverride: null,
    growthRate: DEFAULT_GROWTH,
    years: DEFAULT_YEARS,
    exitMultiple: DEFAULT_EXIT_MULTIPLE,
    desiredReturn: DEFAULT_DESIRED_RETURN,
  };
}
