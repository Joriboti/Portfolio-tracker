import { describe, expect, it } from "vitest";
import { axisLabel, niceTicks, unitFrom } from "./axis";

describe("niceTicks", () => {
  it("lands on round numbers", () => {
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 10)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("never leaves the range it was given", () => {
    for (const [lo, hi] of [
      [0, 102.25e9],
      [-3.4, 17.9],
      [12.7, 41.1],
      [0.002, 0.019],
    ] as const) {
      const ticks = niceTicks(lo, hi);
      expect(ticks.length).toBeGreaterThan(0);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(lo);
        expect(t).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("includes zero when the range crosses it", () => {
    expect(niceTicks(-40, 120)).toContain(0);
  });

  it("gives roughly the number of ticks asked for", () => {
    for (const [lo, hi] of [
      [0, 331.8e9],
      [0, 7],
      [-12, 88],
    ] as const) {
      const n = niceTicks(lo, hi, 4).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it("does not hang or explode on a degenerate range", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(9, 3)).toEqual([9]);
    expect(niceTicks(NaN, 10)).toEqual([]);
  });

  it("prints no negative zero", () => {
    for (const t of niceTicks(-1, 1)) expect(Object.is(t, -0)).toBe(false);
  });
});

describe("unitFrom", () => {
  const money = (ccy: string) => (v: number) =>
    new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 2,
      style: "currency",
      currency: ccy,
    }).format(v);

  it("reads the currency out of the chart's own formatter", () => {
    // The point is that a chart of an ADR's filings cannot silently look like
    // dollars. Whatever the runtime's locale renders, the two must differ and
    // neither may be empty.
    const usd = unitFrom(money("USD"));
    const twd = unitFrom(money("TWD"));
    expect(usd).not.toBe("");
    expect(twd).not.toBe("");
    expect(usd).not.toBe(twd);
  });

  it("says nothing for a plain number", () => {
    expect(unitFrom((v) => v.toFixed(2))).toBe("");
    expect(unitFrom((v) => `${v.toFixed(1)}×`)).toBe("×");
  });

  it("survives a formatter that throws", () => {
    expect(
      unitFrom(() => {
        throw new Error("nope");
      }),
    ).toBe("");
  });
});

describe("axisLabel", () => {
  it("compacts big figures and keeps small ones readable", () => {
    expect(axisLabel(0)).toBe("0");
    expect(axisLabel(100e9)).toMatch(/100/);
    expect(axisLabel(4.71)).toMatch(/4[.,]7/);
    expect(axisLabel(0.25)).toMatch(/0[.,]25/);
  });

  it("never writes a currency into the gutter", () => {
    expect(axisLabel(102.25e9)).not.toMatch(/USD|\$|€/);
  });
});
