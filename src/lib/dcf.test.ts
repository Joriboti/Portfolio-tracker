import { describe, it, expect } from "vitest";
import {
  calculateSimpleDCF,
  impliedGrowth,
  defaultDcfConfig,
  type SimpleDcfInputs,
} from "./dcf";

function baseInputs(over: Partial<SimpleDcfInputs> = {}): SimpleDcfInputs {
  return {
    baseMetric: 10,
    growthRate: 0.1,
    years: 5,
    exitMultiple: 15,
    desiredReturn: 0.1,
    currentPrice: 100,
    ...over,
  };
}

describe("calculateSimpleDCF — basic maths", () => {
  it("projects, applies the exit multiple and discounts exactly", () => {
    const r = calculateSimpleDCF(baseInputs({ growthRate: 0.1, desiredReturn: 0.1 }));
    // futureMetric = 10 * 1.1^5 = 16.1051
    expect(r.futureMetric).toBeCloseTo(16.1051, 4);
    // futurePrice = 16.1051 * 15 = 241.5765
    expect(r.futurePrice).toBeCloseTo(241.5765, 3);
    // growth == desiredReturn → discount cancels the metric growth:
    // fairValue = base * mult = 150
    expect(r.fairValue).toBeCloseTo(150, 6);
  });

  it("computes upside vs price and implied return", () => {
    const r = calculateSimpleDCF(baseInputs());
    // fairValue 150 vs price 100 → +50%
    expect(r.upsideVsPrice).toBeCloseTo(0.5, 6);
    // implied return = (241.5765/100)^(1/5) - 1 ≈ 0.1932
    expect(r.impliedReturn).toBeCloseTo(0.1932, 3);
  });

  it("returns null ratios for a loss-making base (negative metric)", () => {
    const r = calculateSimpleDCF(baseInputs({ baseMetric: -2 }));
    expect(r.futurePrice).toBeLessThan(0);
    expect(r.impliedReturn).toBeNull();
  });

  it("returns null ratios when price is unavailable", () => {
    const r = calculateSimpleDCF(baseInputs({ currentPrice: null }));
    expect(r.upsideVsPrice).toBeNull();
    expect(r.impliedReturn).toBeNull();
  });
});

describe("impliedGrowth — reverse model", () => {
  it("recovers the growth that the forward model priced in", () => {
    const inputs = baseInputs({ growthRate: 0.13 });
    const { fairValue } = calculateSimpleDCF(inputs);
    const g = impliedGrowth({
      currentPrice: fairValue, // price the model fair-values at 13% growth
      baseMetric: inputs.baseMetric,
      years: inputs.years,
      exitMultiple: inputs.exitMultiple,
      desiredReturn: inputs.desiredReturn,
    });
    expect(g).not.toBeNull();
    expect(g!).toBeCloseTo(0.13, 6);
  });

  it("returns null for a non-positive base metric", () => {
    expect(
      impliedGrowth({
        currentPrice: 100,
        baseMetric: 0,
        years: 5,
        exitMultiple: 15,
        desiredReturn: 0.1,
      }),
    ).toBeNull();
  });

  it("returns null when price is unavailable", () => {
    expect(
      impliedGrowth({
        currentPrice: null,
        baseMetric: 10,
        years: 5,
        exitMultiple: 15,
        desiredReturn: 0.1,
      }),
    ).toBeNull();
  });
});

describe("defaults", () => {
  it("ships EPS-based defaults", () => {
    const c = defaultDcfConfig();
    expect(c.metric).toBe("eps");
    expect(c.years).toBe(5);
    expect(c.exitMultiple).toBe(15);
  });
});
