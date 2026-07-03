import { describe, it, expect } from "vitest";
import {
  contributionForMonth,
  weightedTer,
  projectDeterministic,
  projectMonteCarlo,
  cholesky,
  covarianceFrom,
  rebalanceToTargets,
  maxDrawdown,
  type ForecastAsset,
  type ContributionSchedule,
} from "./forecast";

describe("contribution schedule", () => {
  const s = (over: Partial<ContributionSchedule>): ContributionSchedule => ({
    amount: 100,
    frequency: "monthly",
    ...over,
  });

  it("pays a one-off only at month 0", () => {
    const c = s({ frequency: "one_off" });
    expect(contributionForMonth(c, 0)).toBe(100);
    expect(contributionForMonth(c, 1)).toBe(0);
  });
  it("pays quarterly every 3rd month and annual every 12th", () => {
    expect(contributionForMonth(s({ frequency: "quarterly" }), 0)).toBe(100);
    expect(contributionForMonth(s({ frequency: "quarterly" }), 3)).toBe(100);
    expect(contributionForMonth(s({ frequency: "quarterly" }), 4)).toBe(0);
    expect(contributionForMonth(s({ frequency: "annual" }), 12)).toBe(100);
    expect(contributionForMonth(s({ frequency: "annual" }), 6)).toBe(0);
  });
  it("ignores non-positive amounts and 'none'", () => {
    expect(contributionForMonth(s({ amount: 0 }), 0)).toBe(0);
    expect(contributionForMonth(s({ frequency: "none" }), 0)).toBe(0);
  });
});

describe("weightedTer", () => {
  it("is the weight-normalised average of asset TERs", () => {
    const assets: ForecastAsset[] = [
      { id: "A", weight: 0.75, expectedReturn: 0, volatility: 0, ter: 0.002 },
      { id: "B", weight: 0.25, expectedReturn: 0, volatility: 0, ter: 0.006 },
    ];
    // 0.75*0.002 + 0.25*0.006 = 0.003
    expect(weightedTer(assets)).toBeCloseTo(0.003, 10);
  });
});

describe("projectDeterministic", () => {
  const none: ContributionSchedule = { amount: 0, frequency: "none" };

  it("compounds a lump sum with no contributions (closed form)", () => {
    const r = projectDeterministic({
      startValue: 1000,
      years: 10,
      annualReturn: 0.07,
      ter: 0,
      contribution: none,
    });
    // Monthly compounding of the annual rate reproduces (1+r)^years exactly.
    expect(r.finalValue).toBeCloseTo(1000 * Math.pow(1.07, 10), 4);
    expect(r.totalContributed).toBe(1000);
    expect(r.points).toHaveLength(11); // year 0..10
  });

  it("with zero return, value equals money invested (gain 0)", () => {
    const r = projectDeterministic({
      startValue: 0,
      years: 3,
      annualReturn: 0,
      ter: 0,
      contribution: { amount: 100, frequency: "monthly" },
    });
    expect(r.totalContributed).toBeCloseTo(3600, 6);
    expect(r.finalValue).toBeCloseTo(3600, 6);
    expect(r.totalGain).toBeCloseTo(0, 6);
  });

  it("TER drag lowers the final value vs no fee", () => {
    const base = { startValue: 1000, years: 20, annualReturn: 0.07, contribution: none };
    const noFee = projectDeterministic({ ...base, ter: 0 });
    const withFee = projectDeterministic({ ...base, ter: 0.005 });
    expect(withFee.finalValue).toBeLessThan(noFee.finalValue);
  });

  it("tax drag reduces the gain", () => {
    const base = { startValue: 1000, years: 5, annualReturn: 0.1, ter: 0, contribution: none };
    const noTax = projectDeterministic({ ...base });
    const taxed = projectDeterministic({ ...base, taxDrag: 0.2 });
    expect(taxed.finalValue).toBeLessThan(noTax.finalValue);
    expect(taxed.finalValue).toBeGreaterThan(1000); // still grows
  });
});

describe("linear algebra helpers", () => {
  it("cholesky factors reproduce the matrix (L·Lᵀ = A)", () => {
    const A = [
      [4, 2],
      [2, 3],
    ];
    const L = cholesky(A);
    const AA = [
      [L[0][0] ** 2, L[0][0] * L[1][0]],
      [L[1][0] * L[0][0], L[1][0] ** 2 + L[1][1] ** 2],
    ];
    expect(AA[0][0]).toBeCloseTo(4, 10);
    expect(AA[0][1]).toBeCloseTo(2, 10);
    expect(AA[1][1]).toBeCloseTo(3, 10);
  });

  it("covarianceFrom builds Σ from correlation + vols", () => {
    const cov = covarianceFrom(
      [
        [1, 0.5],
        [0.5, 1],
      ],
      [0.2, 0.1],
    );
    expect(cov[0][0]).toBeCloseTo(0.04, 10); // 0.2²
    expect(cov[0][1]).toBeCloseTo(0.5 * 0.2 * 0.1, 10); // 0.01
  });

  it("rebalanceToTargets restores exact target weights", () => {
    const v = rebalanceToTargets(1000, [0.6, 0.4]);
    expect(v[0]).toBeCloseTo(600, 10);
    expect(v[1]).toBeCloseTo(400, 10);
    expect(v[0] + v[1]).toBeCloseTo(1000, 10);
  });

  it("maxDrawdown finds the worst peak-to-trough", () => {
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(-0.5, 10); // 120→60, drawdown ≤ 0
    expect(maxDrawdown([100, 110, 120])).toBeCloseTo(0, 10);
  });
});

describe("projectMonteCarlo", () => {
  const assets: ForecastAsset[] = [
    { id: "eq", weight: 0.6, expectedReturn: 0.08, volatility: 0.16, ter: 0.002 },
    { id: "bond", weight: 0.4, expectedReturn: 0.03, volatility: 0.05, ter: 0.001 },
  ];
  const corr = [
    [1, 0.2],
    [0.2, 1],
  ];
  const base = {
    startValue: 10_000,
    years: 15,
    assets,
    correlation: corr,
    contribution: { amount: 200, frequency: "monthly" as const },
    rebalance: "annual" as const,
    runs: 800,
    seed: 42,
  };

  it("is reproducible for a fixed seed", () => {
    const a = projectMonteCarlo(base);
    const b = projectMonteCarlo(base);
    expect(a.terminal.p50).toBeCloseTo(b.terminal.p50, 10);
    expect(a.p90[10]).toBeCloseTo(b.p90[10], 10);
  });

  it("percentile bands are ordered p10 ≤ p50 ≤ p90", () => {
    const r = projectMonteCarlo(base);
    for (let y = 0; y < r.years.length; y++) {
      expect(r.p10[y]).toBeLessThanOrEqual(r.p50[y] + 1e-6);
      expect(r.p50[y]).toBeLessThanOrEqual(r.p90[y] + 1e-6);
    }
  });

  it("collapses to a single value when volatility is zero", () => {
    const zeroVol = assets.map((a) => ({ ...a, volatility: 0 }));
    const r = projectMonteCarlo({ ...base, assets: zeroVol, runs: 50 });
    // No randomness → the band has zero width at the horizon.
    expect(r.terminal.p90 - r.terminal.p10).toBeCloseTo(0, 4);
    expect(r.terminal.p50).toBeGreaterThan(base.startValue);
  });

  it("tracks cumulative invested independent of returns", () => {
    const r = projectMonteCarlo(base);
    // start 10k + 200/mo × 12 × 15 = 10k + 36k = 46k
    expect(r.invested[r.invested.length - 1]).toBeCloseTo(46_000, 6);
  });

  it("more contributions ⇒ higher median terminal value", () => {
    const more = projectMonteCarlo({
      ...base,
      contribution: { amount: 400, frequency: "monthly" },
    });
    const less = projectMonteCarlo(base);
    expect(more.terminal.p50).toBeGreaterThan(less.terminal.p50);
  });
});
