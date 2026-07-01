import { describe, it, expect } from "vitest";
import { monteCarloSimpleDCF, randomNormal, type MonteCarloBase } from "./montecarlo";
import { calculateSimpleDCF } from "./dcf";

function base(over: Partial<MonteCarloBase> = {}): MonteCarloBase {
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

describe("monteCarloSimpleDCF", () => {
  it("collapses to the deterministic fair value when sigmas are 0", () => {
    const b = base();
    const { fairValue } = calculateSimpleDCF(b);
    const mc = monteCarloSimpleDCF(b, { growthSd: 0, multipleSd: 0 }, 1000);
    expect(mc.runs).toBe(1000);
    expect(mc.p10).toBeCloseTo(fairValue, 6);
    expect(mc.p50).toBeCloseTo(fairValue, 6);
    expect(mc.p90).toBeCloseTo(fairValue, 6);
    expect(mc.mean).toBeCloseTo(fairValue, 6);
    // zero-width distribution → single histogram bucket holding every run
    expect(mc.bins).toHaveLength(1);
    expect(mc.bins[0].count).toBe(1000);
  });

  it("produces an ordered, spread distribution with positive sigmas", () => {
    const mc = monteCarloSimpleDCF(base(), { growthSd: 0.03, multipleSd: 3 }, 4000);
    expect(mc.runs).toBeGreaterThan(0);
    expect(mc.p10).toBeLessThan(mc.p50);
    expect(mc.p50).toBeLessThan(mc.p90);
    // histogram counts sum to the number of runs
    const total = mc.bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(mc.runs);
  });
});

describe("randomNormal", () => {
  it("returns finite samples and roughly the requested mean", () => {
    let sum = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const x = randomNormal(5, 1);
      expect(Number.isFinite(x)).toBe(true);
      sum += x;
    }
    expect(sum / N).toBeCloseTo(5, 1);
  });
});
