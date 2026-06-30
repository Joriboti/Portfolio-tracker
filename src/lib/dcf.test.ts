import { describe, it, expect } from "vitest";
import {
  calculateDCF,
  reverseDCF,
  defaultGrowthRates,
  type DCFInputs,
} from "./dcf";

function baseInputs(over: Partial<DCFInputs> = {}): DCFInputs {
  return {
    baseFCF: 1000,
    growthRates: [0.1, 0.08, 0.06, 0.05, 0.04],
    wacc: 0.09,
    terminalGrowth: 0.025,
    netDebt: 0,
    sharesOutstanding: 100,
    ...over,
  };
}

describe("calculateDCF — basic maths", () => {
  it("discounts a flat one-year projection exactly", () => {
    // baseFCF 1000, +10% → 1100 at year 1, discounted at 10%.
    const r = calculateDCF({
      baseFCF: 1000,
      growthRates: [0.1],
      wacc: 0.1,
      terminalGrowth: 0,
      netDebt: 0,
      sharesOutstanding: 1,
    });
    // explicit PV = 1100 / 1.1 = 1000
    expect(r.pvExplicit).toBeCloseTo(1000, 6);
    // terminal = 1100*(1+0)/(0.1-0) = 11000 ; PV = 11000/1.1^1 = 10000
    expect(r.pvTerminal).toBeCloseTo(10000, 6);
    expect(r.enterpriseValue).toBeCloseTo(11000, 6);
    expect(r.equityValue).toBeCloseTo(11000, 6);
    expect(r.fairValuePerShare).toBeCloseTo(11000, 6);
  });

  it("subtracts net debt from enterprise value", () => {
    const r = calculateDCF(baseInputs({ netDebt: 500 }));
    expect(r.equityValue).toBeCloseTo(r.enterpriseValue - 500, 6);
  });

  it("reports terminalWeight as pvTerminal / EV in (0,1)", () => {
    const r = calculateDCF(baseInputs());
    expect(r.terminalWeight).not.toBeNull();
    expect(r.terminalWeight!).toBeGreaterThan(0);
    expect(r.terminalWeight!).toBeLessThan(1);
    expect(r.terminalWeight!).toBeCloseTo(r.pvTerminal / r.enterpriseValue, 10);
  });

  it("returns null fairValue/terminalWeight when WACC ≤ g (singularity)", () => {
    const r = calculateDCF(baseInputs({ wacc: 0.02, terminalGrowth: 0.025 }));
    expect(r.pvTerminal).toBe(0);
    expect(r.terminalWeight).toBeNull();
    // EV degrades to the explicit PV only, equity still defined.
    expect(r.enterpriseValue).toBeCloseTo(r.pvExplicit, 10);
  });

  it("returns null fairValue when shares are zero", () => {
    const r = calculateDCF(baseInputs({ sharesOutstanding: 0 }));
    expect(r.fairValuePerShare).toBeNull();
  });
});

describe("reverseDCF — implied growth", () => {
  it("recovers the growth that a forward DCF priced in", () => {
    const inputs = baseInputs({ growthRates: Array(5).fill(0.12) });
    const { fairValuePerShare } = calculateDCF(inputs);
    const implied = reverseDCF({
      currentPrice: fairValuePerShare!,
      baseFCF: inputs.baseFCF,
      wacc: inputs.wacc,
      terminalGrowth: inputs.terminalGrowth,
      netDebt: inputs.netDebt,
      sharesOutstanding: inputs.sharesOutstanding,
      years: 5,
    });
    expect(implied).not.toBeNull();
    expect(implied!).toBeCloseTo(0.12, 3);
  });

  it("returns null when the price is outside the search band", () => {
    const implied = reverseDCF({
      currentPrice: 1e12, // absurdly high → unreachable
      baseFCF: 1000,
      wacc: 0.09,
      terminalGrowth: 0.025,
      netDebt: 0,
      sharesOutstanding: 100,
    });
    expect(implied).toBeNull();
  });

  it("returns null when WACC ≤ terminal growth", () => {
    const implied = reverseDCF({
      currentPrice: 50,
      baseFCF: 1000,
      wacc: 0.02,
      terminalGrowth: 0.025,
      netDebt: 0,
      sharesOutstanding: 100,
    });
    expect(implied).toBeNull();
  });
});

describe("defaults", () => {
  it("exposes a fading 5-year growth ramp", () => {
    expect(defaultGrowthRates()).toEqual([0.1, 0.08, 0.06, 0.05, 0.04]);
  });
});
