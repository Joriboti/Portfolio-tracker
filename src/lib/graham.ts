// Pure Benjamin Graham intrinsic-value engine (interest-rate-adjusted revision).
//
// Sibling of dcf.ts / scenarioValuation.ts: unit-agnostic, NaN-free, undefinable
// results come back as null. Fast, defensive, good for screening — NOT a fine
// valuation. The 2g term is linear and aggressive, so growth is capped and the
// output is flagged as a conservative screen.
//
// Formula (revised, interest-adjusted):
//   V = [ EPS × (8.5 + 2·g) × 4.4 ] / Y
// where g = expected annual growth (percent), 8.5 = base P/E of a no-growth
// company, 4.4 = AAA corporate yield of Graham's era (normalisation constant),
// Y = today's AAA corporate bond yield (percent, manual — Yahoo doesn't give it).

/** Growth above this (percent) is clamped — the linear 2g term over-inflates. */
export const GRAHAM_GROWTH_CAP = 15;
/** Graham-era AAA yield used as the numerator constant. */
const GRAHAM_ERA_YIELD = 4.4;

/**
 * Graham intrinsic value per share. Returns null when the AAA yield is unusable
 * (0/negative) or EPS isn't finite. Growth is clamped to GRAHAM_GROWTH_CAP.
 */
export function grahamValue(
  eps: number,
  growthPct: number,
  aaaYieldPct: number,
): number | null {
  if (!Number.isFinite(eps) || !(aaaYieldPct > 0)) return null;
  const g = Math.min(growthPct, GRAHAM_GROWTH_CAP);
  const v = (eps * (8.5 + 2 * g) * GRAHAM_ERA_YIELD) / aaaYieldPct;
  return Number.isFinite(v) ? v : null;
}

/** True when the requested growth was clamped by the cap. */
export function grahamGrowthClamped(growthPct: number): boolean {
  return growthPct > GRAHAM_GROWTH_CAP;
}

/**
 * Editable, persisted slice of the Graham model. EPS is recomputed from
 * fundamentals on load; only the override + assumptions are saved, alongside
 * the scenario/DCF models in the same per-holding JSONB document.
 */
export type GrahamConfig = {
  /** Manual override of trailing EPS; null = use the auto value. */
  epsOverride: number | null;
  /** Expected annual EPS growth, in percent. */
  growthPct: number;
  /** Current AAA corporate bond yield, in percent (manual input). */
  aaaYieldPct: number;
};

export const DEFAULT_GRAHAM_GROWTH = 8;
export const DEFAULT_AAA_YIELD = 4.5;

export function defaultGrahamConfig(): GrahamConfig {
  return {
    epsOverride: null,
    growthPct: DEFAULT_GRAHAM_GROWTH,
    aaaYieldPct: DEFAULT_AAA_YIELD,
  };
}
