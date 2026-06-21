import { describe, it, expect } from "vitest";
import {
  computeValuation,
  defaultScenarios,
  type ValuationInputs,
} from "./scenarioValuation";

function baseInputs(over: Partial<ValuationInputs> = {}): ValuationInputs {
  return {
    baseEps: 10,
    years: 2,
    currentPrice: 100,
    shares: 10,
    avgCost: 80,
    dca: null,
    totalPortfolioValue: 10_000,
    epsTtm: 8,
    scenarios: defaultScenarios(),
    ...over,
  };
}

describe("computeValuation — basic maths", () => {
  it("computes terminalEPS, fairValue and the reference P/Es exactly", () => {
    const r = computeValuation(
      baseInputs({
        scenarios: [
          { id: "a", name: "A", color: "#000", epsCagrPct: 10, exitMultiple: 15, probabilityPct: 100 },
        ],
      }),
    );
    // terminalEPS = 10 * 1.1^2 = 12.1 ; fairValue = 12.1 * 15 = 181.5
    expect(r.perScenario[0].terminalEps).toBeCloseTo(12.1, 10);
    expect(r.perScenario[0].fairValue).toBeCloseTo(181.5, 10);
    // single scenario at 100% → weight 1, EV = fairValue
    expect(r.perScenario[0].weight).toBeCloseTo(1, 10);
    expect(r.expectedValue).toBeCloseTo(181.5, 10);
    // upside vs price = 181.5/100 - 1 = 0.815
    expect(r.perScenario[0].upsideVsPrice).toBeCloseTo(0.815, 10);
    // no DCA → blendedCost = avgCost = 80 ; upside vs cost = 181.5/80 - 1
    expect(r.blendedCost).toBeCloseTo(80, 10);
    expect(r.perScenario[0].upsideVsCost).toBeCloseTo(181.5 / 80 - 1, 10);
    // peForward = 100/10 = 10 ; peTrailing = 100/8 = 12.5
    expect(r.peForward).toBeCloseTo(10, 10);
    expect(r.peTrailing).toBeCloseTo(12.5, 10);
    // positionValue = 10 * 100 = 1000 ; weight = 1000/10000 = 0.1
    expect(r.positionValue).toBeCloseTo(1000, 10);
    expect(r.portfolioWeight).toBeCloseTo(0.1, 10);
  });

  it("returns null ratios when denominators are unusable", () => {
    const r = computeValuation(
      baseInputs({ currentPrice: 0, epsTtm: 0, totalPortfolioValue: 0, avgCost: 0 }),
    );
    expect(r.perScenario[0].upsideVsPrice).toBeNull();
    expect(r.perScenario[0].upsideVsCost).toBeNull();
    expect(r.peTrailing).toBeNull();
    expect(r.portfolioWeight).toBeNull();
  });
});

describe("computeValuation — probability normalisation", () => {
  it("normalises probabilities that do not sum to 100", () => {
    const r = computeValuation(
      baseInputs({
        scenarios: [
          { id: "a", name: "A", color: "#000", epsCagrPct: 0, exitMultiple: 10, probabilityPct: 30 },
          { id: "b", name: "B", color: "#000", epsCagrPct: 0, exitMultiple: 20, probabilityPct: 30 },
        ],
        baseEps: 10,
        years: 1,
      }),
    );
    // probSum = 60 (not 100) → flagged but still normalised to 0.5 / 0.5
    expect(r.probSum).toBe(60);
    expect(r.probNormalized).toBe(false);
    expect(r.perScenario[0].weight).toBeCloseTo(0.5, 10);
    expect(r.perScenario[1].weight).toBeCloseTo(0.5, 10);
    // EV = 0.5*(10*10) + 0.5*(10*20) = 50 + 100 = 150
    expect(r.expectedValue).toBeCloseTo(150, 10);
  });

  it("flags probNormalized=true when the sum is exactly 100", () => {
    const r = computeValuation(baseInputs());
    expect(r.probSum).toBe(100);
    expect(r.probNormalized).toBe(true);
    // weights sum to 1
    const wSum = r.perScenario.reduce((s, x) => s + x.weight, 0);
    expect(wSum).toBeCloseTo(1, 10);
  });

  it("yields zero weights and EV when all probabilities are zero", () => {
    const r = computeValuation(
      baseInputs({
        scenarios: [
          { id: "a", name: "A", color: "#000", epsCagrPct: 5, exitMultiple: 10, probabilityPct: 0 },
        ],
      }),
    );
    expect(r.perScenario[0].weight).toBe(0);
    expect(r.expectedValue).toBe(0);
  });
});

describe("computeValuation — DCA simulator", () => {
  it("recomputes blended cost, position value and portfolio weight after a buy", () => {
    const r = computeValuation(
      baseInputs({
        shares: 10,
        avgCost: 80,
        currentPrice: 100,
        totalPortfolioValue: 10_000,
        dca: { addShares: 10, addPrice: 120 },
        scenarios: [
          { id: "a", name: "A", color: "#000", epsCagrPct: 0, exitMultiple: 11, probabilityPct: 100 },
        ],
        baseEps: 10,
        years: 1,
      }),
    );
    // blendedCost = (10*80 + 10*120) / 20 = (800 + 1200)/20 = 100
    expect(r.blendedCost).toBeCloseTo(100, 10);
    // positionValue = (10+10)*100 = 2000 ; weight = 2000/10000 = 0.2
    expect(r.positionValue).toBeCloseTo(2000, 10);
    expect(r.portfolioWeight).toBeCloseTo(0.2, 10);
    // fairValue = 10*11 = 110 ; upside vs blended cost = 110/100 - 1 = 0.10
    expect(r.perScenario[0].upsideVsCost).toBeCloseTo(0.1, 10);
  });

  it("falls back to plain avg cost when DCA adds zero shares", () => {
    const r = computeValuation(
      baseInputs({ shares: 5, avgCost: 50, dca: { addShares: 0, addPrice: 999 } }),
    );
    expect(r.blendedCost).toBeCloseTo(50, 10);
  });
});
