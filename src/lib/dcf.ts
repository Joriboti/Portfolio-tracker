// Pure, side-effect-free DCF + Reverse-DCF valuation engine.
//
// Sibling of scenarioValuation.ts: same conventions (unit-agnostic, NaN-free,
// impossible ratios come back as null). Every monetary input (baseFcf,
// netDebt, currentPrice) MUST be expressed in the SAME currency before
// calling. The dashboard component FX-converts where needed and feeds the
// ticker's quote currency, so fairValuePerShare is directly comparable to the
// quote price.
//
// Formulas (implemented verbatim from the spec):
//   Enterprise value = Σ [FCFₜ / (1+WACC)ᵗ]  +  [Terminal value / (1+WACC)ⁿ]
//   Terminal value   = FCFₙ × (1+g) / (WACC − g)
//   Equity value     = Enterprise value − Net debt
//   Fair value/share = Equity value / shares outstanding
//   terminalWeight   = PV(terminal) / Enterprise value   (fragility flag if >0.75)
//
// Reverse DCF inverts the model: given the current price it binary-searches the
// constant annual FCF growth the market is implicitly pricing in.

/** Everything `calculateDCF` needs, all monetary values in one shared currency. */
export type DCFInputs = {
  /** Base free cash flow the projection compounds from. */
  baseFCF: number;
  /** Per-year FCF growth, as decimals (e.g. [0.10, 0.08, 0.06, 0.05, 0.04]). */
  growthRates: number[];
  /** Weighted average cost of capital, decimal (e.g. 0.09). */
  wacc: number;
  /** Perpetual terminal growth, decimal (e.g. 0.025). Must be < wacc. */
  terminalGrowth: number;
  /** Net debt (total debt − cash); subtracted from enterprise value. */
  netDebt: number;
  /** Diluted shares outstanding. */
  sharesOutstanding: number;
};

/** Full output of the DCF engine. NaN-free; undefinable ratios are null. */
export type DCFResult = {
  enterpriseValue: number;
  equityValue: number;
  /** equityValue / sharesOutstanding, or null when shares are unusable. */
  fairValuePerShare: number | null;
  /** Present value of the explicit (year 1..n) projected FCFs. */
  pvExplicit: number;
  /** Present value of the discounted terminal value. */
  pvTerminal: number;
  /** Projected (undiscounted) FCF for each explicit year. */
  projectedFCF: number[];
  /** pvTerminal / enterpriseValue, or null. Warn the user when > 0.75. */
  terminalWeight: number | null;
};

function isUsable(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n !== 0;
}

/**
 * Run a discounted-cash-flow valuation. Pure: no I/O, no mutation of inputs.
 * Guards against the WACC ≤ g singularity (returns a non-finite terminal that
 * is surfaced as null ratios rather than throwing).
 */
export function calculateDCF(i: DCFInputs): DCFResult {
  const wacc = i.wacc;
  let pvExplicit = 0;
  let fcf = i.baseFCF;
  const projectedFCF: number[] = [];

  i.growthRates.forEach((g, t) => {
    fcf = fcf * (1 + g);
    projectedFCF.push(fcf);
    pvExplicit += fcf / Math.pow(1 + wacc, t + 1);
  });

  const n = i.growthRates.length;
  const lastFCF = projectedFCF.length > 0 ? projectedFCF[projectedFCF.length - 1] : i.baseFCF;

  // Gordon-growth terminal value. Undefined/explosive when WACC ≤ g — leave it
  // non-finite so downstream ratios collapse to null instead of lying.
  const denom = wacc - i.terminalGrowth;
  const terminalValue = denom > 0 ? (lastFCF * (1 + i.terminalGrowth)) / denom : NaN;
  const pvTerminal = Number.isFinite(terminalValue)
    ? terminalValue / Math.pow(1 + wacc, n)
    : NaN;

  const enterpriseValue = pvExplicit + (Number.isFinite(pvTerminal) ? pvTerminal : 0);
  const equityValue = enterpriseValue - i.netDebt;

  return {
    enterpriseValue,
    equityValue,
    fairValuePerShare: isUsable(i.sharesOutstanding)
      ? equityValue / i.sharesOutstanding
      : null,
    pvExplicit,
    pvTerminal: Number.isFinite(pvTerminal) ? pvTerminal : 0,
    projectedFCF,
    terminalWeight:
      isUsable(enterpriseValue) && Number.isFinite(pvTerminal)
        ? pvTerminal / enterpriseValue
        : null,
  };
}

/**
 * Reverse DCF: solve for the constant annual FCF growth that makes the model's
 * fair value equal the current price. Binary search (no closed form) over a
 * realistic growth band. Returns null when the model can't be made to match
 * within the band (e.g. price already below a zero-growth valuation floor, or
 * unusable inputs).
 */
export function reverseDCF(args: {
  currentPrice: number;
  baseFCF: number;
  wacc: number;
  terminalGrowth: number;
  netDebt: number;
  sharesOutstanding: number;
  years?: number;
  /** Search bounds for the implied annual growth, decimals. */
  loBound?: number;
  hiBound?: number;
}): number | null {
  const {
    currentPrice,
    baseFCF,
    wacc,
    terminalGrowth,
    netDebt,
    sharesOutstanding,
    years = 5,
    loBound = -0.5,
    hiBound = 0.5,
  } = args;

  if (
    !isUsable(currentPrice) ||
    !isUsable(sharesOutstanding) ||
    !Number.isFinite(baseFCF) ||
    !(wacc - terminalGrowth > 0)
  ) {
    return null;
  }

  const fairAt = (growth: number): number => {
    const { fairValuePerShare } = calculateDCF({
      baseFCF,
      growthRates: Array(years).fill(growth),
      wacc,
      terminalGrowth,
      netDebt,
      sharesOutstanding,
    });
    return fairValuePerShare ?? NaN;
  };

  // fairValue is monotonically increasing in growth, so a bracket check tells
  // us whether the price is even reachable inside [loBound, hiBound].
  const fLo = fairAt(loBound);
  const fHi = fairAt(hiBound);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (currentPrice < fLo || currentPrice > fHi) return null;

  let lo = loBound;
  let hi = hiBound;
  let implied = (lo + hi) / 2;
  for (let iter = 0; iter < 100; iter++) {
    implied = (lo + hi) / 2;
    if (fairAt(implied) > currentPrice) hi = implied;
    else lo = implied;
  }
  return implied;
}

/** Sensible 5-year fading growth ramp, per the spec's example. */
export function defaultGrowthRates(): number[] {
  return [0.1, 0.08, 0.06, 0.05, 0.04];
}

export const DEFAULT_WACC = 0.09;
export const DEFAULT_TERMINAL_GROWTH = 0.025;
/** Terminal value above this share of EV ⇒ flag the model as fragile. */
export const TERMINAL_WEIGHT_WARN = 0.75;

/**
 * Editable, persisted slice of the DCF model (the part the user controls).
 * Live data (price, marketCap, FCF, shares, net debt) is recomputed from
 * fundamentals on every load; only overrides + assumptions are saved. Stored
 * alongside the scenario model in the same per-holding JSONB document.
 */
export type DcfConfig = {
  /** Manual override of the base FCF (quote currency); null = use Yahoo's. */
  baseFcfOverride: number | null;
  /** Per-year FCF growth, decimals. Length defines the explicit horizon. */
  growthRates: number[];
  wacc: number;
  terminalGrowth: number;
  /** Manual override of net debt (quote currency); null = use Yahoo's. */
  netDebtOverride: number | null;
  /** Manual override of shares outstanding; null = use Yahoo's. */
  sharesOverride: number | null;
};

/** A fresh DCF config with the spec's defaults. */
export function defaultDcfConfig(): DcfConfig {
  return {
    baseFcfOverride: null,
    growthRates: defaultGrowthRates(),
    wacc: DEFAULT_WACC,
    terminalGrowth: DEFAULT_TERMINAL_GROWTH,
    netDebtOverride: null,
    sharesOverride: null,
  };
}
