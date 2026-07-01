import { describe, it, expect } from "vitest";
import {
  grahamValue,
  grahamGrowthClamped,
  GRAHAM_GROWTH_CAP,
  defaultGrahamConfig,
} from "./graham";

describe("grahamValue", () => {
  it("matches the revised formula exactly", () => {
    // V = [EPS(5) × (8.5 + 2·10) × 4.4] / 4.4 = 5 × 28.5 = 142.5
    expect(grahamValue(5, 10, 4.4)).toBeCloseTo(142.5, 6);
  });

  it("scales inversely with the AAA yield", () => {
    const atLowYield = grahamValue(5, 10, 4.4)!;
    const atHighYield = grahamValue(5, 10, 8.8)!;
    expect(atHighYield).toBeCloseTo(atLowYield / 2, 6);
  });

  it("clamps growth above the cap", () => {
    const atCap = grahamValue(5, GRAHAM_GROWTH_CAP, 4.5)!;
    const above = grahamValue(5, 40, 4.5)!;
    expect(above).toBeCloseTo(atCap, 10);
    expect(grahamGrowthClamped(40)).toBe(true);
    expect(grahamGrowthClamped(10)).toBe(false);
  });

  it("returns null on an unusable AAA yield", () => {
    expect(grahamValue(5, 10, 0)).toBeNull();
    expect(grahamValue(5, 10, -1)).toBeNull();
  });

  it("ships sensible defaults", () => {
    const c = defaultGrahamConfig();
    expect(c.aaaYieldPct).toBeGreaterThan(0);
    expect(c.growthPct).toBeGreaterThan(0);
  });
});
