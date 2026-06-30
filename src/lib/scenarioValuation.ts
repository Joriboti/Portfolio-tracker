// Pure, side-effect-free scenario valuation engine.
//
// Unit-agnostic: every monetary input (currentPrice, avgCost, addPrice,
// totalPortfolioValue) MUST be expressed in the SAME currency before calling
// `computeValuation`. The dashboard component is responsible for FX-converting
// the user's EUR cost basis into the ticker's quote currency (where EPS and
// the exit multiple live) so the maths stays consistent. Keeping currency out
// of here is what makes the function trivially testable.
//
// Formulas (implemented verbatim from the spec):
//   terminalEPS_i   = baseEPS * (1 + cagr_i/100) ^ years
//   fairValue_i     = terminalEPS_i * exitMultiple_i
//   weight_i        = prob_i / Σ(prob)                 // normalised even if ≠ 100
//   expectedValue   = Σ( fairValue_i * weight_i )
//   upsideVsPrice_i = fairValue_i / currentPrice - 1
//   blendedCost     = (shares*avgCost + addShares*addPrice) / (shares+addShares)
//   upsideVsCost_i  = fairValue_i / blendedCost - 1
//   positionValue   = (shares + addShares) * currentPrice
//   portfolioWeight = positionValue / totalPortfolioValue
//   peTrailing      = currentPrice / epsTTM
//   peForward       = currentPrice / baseEPS

import { defaultDcfConfig, type DcfConfig } from "./dcf";

/** One editable scenario row. */
export type ScenarioInput = {
  /** Stable id so the UI can key rows and reorder without losing focus. */
  id: string;
  name: string;
  /** Any CSS colour string; used for the chart marker. */
  color: string;
  /** Forecast EPS CAGR over the horizon, in percent (e.g. 11 = +11%/yr). */
  epsCagrPct: number;
  /** Exit P/E applied to terminal EPS. */
  exitMultiple: number;
  /** Probability weight, in percent. Need not sum to 100 across scenarios. */
  probabilityPct: number;
};

/** Optional dollar-cost-averaging simulator (planned additional buy). */
export type DcaInput = {
  addShares: number;
  addPrice: number;
};

/** Everything the engine needs, all monetary values in one shared currency. */
export type ValuationInputs = {
  /** Forward base EPS the CAGR compounds from. */
  baseEps: number;
  /** Horizon in years (the exponent). */
  years: number;
  currentPrice: number;
  /** Current position size. */
  shares: number;
  /** Average cost per share of the current position. */
  avgCost: number;
  /** Planned extra purchase, or null/undefined for no DCA. */
  dca?: DcaInput | null;
  /** Total portfolio market value, same currency as the rest. */
  totalPortfolioValue: number;
  /** Trailing twelve-month EPS, for the reference trailing P/E. */
  epsTtm?: number | null;
  scenarios: ScenarioInput[];
};

/** Per-scenario derived results. */
export type ScenarioResult = {
  id: string;
  terminalEps: number;
  fairValue: number;
  /** Normalised probability weight in [0, 1]. */
  weight: number;
  /** fairValue / currentPrice - 1, or null when price is unusable. */
  upsideVsPrice: number | null;
  /** fairValue / blendedCost - 1, or null when cost is unusable. */
  upsideVsCost: number | null;
};

/** Full output of the engine. */
export type ValuationModelResult = {
  perScenario: ScenarioResult[];
  /** Probability-weighted expected fair value. */
  expectedValue: number;
  /** Blended average cost after the simulated DCA buy. */
  blendedCost: number;
  /** Resulting position market value (incl. DCA shares) at current price. */
  positionValue: number;
  /** positionValue / totalPortfolioValue, or null when total is unusable. */
  portfolioWeight: number | null;
  /** Reference trailing P/E (currentPrice / epsTTM), null when unusable. */
  peTrailing: number | null;
  /** Reference forward P/E (currentPrice / baseEps), null when unusable. */
  peForward: number | null;
  /** Sum of the raw probability inputs, in percent. */
  probSum: number;
  /** True when probSum is (numerically) 100. */
  probNormalized: boolean;
  /** Expected upside vs current price using expectedValue. */
  expectedUpsideVsPrice: number | null;
  /** Expected upside vs blended cost using expectedValue. */
  expectedUpsideVsCost: number | null;
};

function isUsable(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n !== 0;
}

function ratioOrNull(numerator: number, denominator: number | null | undefined): number | null {
  if (!isUsable(denominator)) return null;
  const r = numerator / denominator - 1;
  return Number.isFinite(r) ? r : null;
}

/**
 * Run the full scenario valuation. Pure: no I/O, no mutation of inputs.
 * Returns NaN-free numbers; impossible-to-define ratios come back as null.
 */
export function computeValuation(inputs: ValuationInputs): ValuationModelResult {
  const {
    baseEps,
    years,
    currentPrice,
    shares,
    avgCost,
    dca,
    totalPortfolioValue,
    epsTtm,
    scenarios,
  } = inputs;

  // Blended cost after the optional DCA buy. With no DCA (or zero shares),
  // it collapses to the existing average cost.
  const addShares = dca && Number.isFinite(dca.addShares) ? dca.addShares : 0;
  const addPrice = dca && Number.isFinite(dca.addPrice) ? dca.addPrice : 0;
  const totalShares = shares + addShares;
  const blendedCost =
    totalShares > 0
      ? (shares * avgCost + addShares * addPrice) / totalShares
      : avgCost;

  const probSum = scenarios.reduce(
    (s, sc) => s + (Number.isFinite(sc.probabilityPct) ? sc.probabilityPct : 0),
    0,
  );
  const probNormalized = Math.abs(probSum - 100) < 1e-9;

  const perScenario: ScenarioResult[] = scenarios.map((sc) => {
    const terminalEps = baseEps * Math.pow(1 + sc.epsCagrPct / 100, years);
    const fairValue = terminalEps * sc.exitMultiple;
    const weight = probSum > 0 ? sc.probabilityPct / probSum : 0;
    return {
      id: sc.id,
      terminalEps,
      fairValue,
      weight,
      upsideVsPrice: ratioOrNull(fairValue, currentPrice),
      upsideVsCost: ratioOrNull(fairValue, blendedCost),
    };
  });

  const expectedValue = perScenario.reduce(
    (s, r) => s + r.fairValue * r.weight,
    0,
  );

  const positionValue = totalShares * currentPrice;
  const portfolioWeight = isUsable(totalPortfolioValue)
    ? positionValue / totalPortfolioValue
    : null;

  return {
    perScenario,
    expectedValue,
    blendedCost,
    positionValue,
    portfolioWeight,
    peTrailing: isUsable(epsTtm) ? currentPrice / epsTtm : null,
    peForward: isUsable(baseEps) ? currentPrice / baseEps : null,
    probSum,
    probNormalized,
    expectedUpsideVsPrice: ratioOrNull(expectedValue, currentPrice),
    expectedUpsideVsCost: ratioOrNull(expectedValue, blendedCost),
  };
}

/** Default deep-value scenario set, per the spec. */
export function defaultScenarios(): ScenarioInput[] {
  return [
    { id: "bear", name: "Bear", color: "#dc2626", epsCagrPct: 3, exitMultiple: 7, probabilityPct: 35 },
    { id: "base", name: "Base", color: "#2563eb", epsCagrPct: 11, exitMultiple: 12, probabilityPct: 50 },
    { id: "bull", name: "Bull", color: "#059669", epsCagrPct: 14, exitMultiple: 18, probabilityPct: 15 },
  ];
}

export const DEFAULT_HORIZON_YEARS = 2;
export const MAX_SCENARIOS = 5;

/**
 * Editable, persisted slice of the panel state (the part the user controls).
 * Live position data (price, shares, avg cost, fundamentals) is NOT stored —
 * it's recomputed from the portfolio + quotes on every load. Only the model
 * the user edits is saved to Postgres as JSONB.
 */
export type ValuationModel = {
  scenarios: ScenarioInput[];
  years: number;
  /** Manual override of the base forward EPS; null = use the auto value. */
  baseEpsOverride: number | null;
  /** DCA simulator state; addShares 0 means "no planned buy". */
  dca: DcaInput;
  /**
   * DCF / Reverse-DCF assumptions, persisted alongside the scenarios in the
   * same per-holding JSONB document. Optional so models saved before the DCF
   * panel shipped load fine; the component fills it with defaults on first use.
   */
  dcf?: DcfConfig;
};

/** A fresh model with the spec's deep-value defaults. */
export function defaultModel(): ValuationModel {
  return {
    scenarios: defaultScenarios(),
    years: DEFAULT_HORIZON_YEARS,
    baseEpsOverride: null,
    dca: { addShares: 0, addPrice: 0 },
    dcf: defaultDcfConfig(),
  };
}
