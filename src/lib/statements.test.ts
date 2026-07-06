import { describe, expect, it } from "vitest";
import {
  annualLabel,
  cashFlowPanel,
  quarterLabel,
  series,
  ttm,
  yoyLatest,
  type StatementMetrics,
  type StatementRow,
} from "./statements";

const EMPTY: StatementMetrics = {
  revenue: null,
  ebitda: null,
  netIncome: null,
  eps: null,
  operatingIncome: null,
  grossProfit: null,
  rnd: null,
  sga: null,
  shares: null,
  totalDebt: null,
  cash: null,
  fcf: null,
  ocf: null,
  capex: null,
  sbc: null,
  dividendsPaid: null,
  buybacks: null,
};

function row(periodEnd: string, patch: Partial<StatementMetrics>): StatementRow {
  return { periodEnd, metrics: { ...EMPTY, ...patch } };
}

describe("labels", () => {
  it("labels calendar quarters from the period end", () => {
    expect(quarterLabel("2026-03-31")).toBe("Q1 26");
    expect(quarterLabel("2025-12-31")).toBe("Q4 25");
    expect(quarterLabel("2025-06-30")).toBe("Q2 25");
  });
  it("labels annual rows by end year", () => {
    expect(annualLabel("2025-09-30")).toBe("2025");
  });
});

describe("series", () => {
  const rows = [
    row("2025-06-30", { revenue: 100 }),
    row("2025-09-30", { revenue: null }),
    row("2025-12-31", { revenue: 120 }),
  ];
  it("skips missing periods and keeps order", () => {
    expect(series(rows, "revenue")).toEqual([
      { label: "Q2 25", value: 100 },
      { label: "Q4 25", value: 120 },
    ]);
  });
  it("applies the display transform (sign flip for outflows)", () => {
    const divs = [row("2025-12-31", { dividendsPaid: -50 })];
    expect(series(divs, "dividendsPaid", { transform: Math.abs })).toEqual([
      { label: "Q4 25", value: 50 },
    ]);
  });
});

describe("ttm", () => {
  it("sums the last four quarters", () => {
    const rows = [
      row("2025-03-31", { sbc: 1 }),
      row("2025-06-30", { sbc: 2 }),
      row("2025-09-30", { sbc: 3 }),
      row("2025-12-31", { sbc: 4 }),
      row("2026-03-31", { sbc: 5 }),
    ];
    expect(ttm(rows, "sbc")).toBe(14); // 2+3+4+5
  });
  it("returns null with under four quarters or a gap", () => {
    expect(ttm([row("2025-12-31", { sbc: 4 })], "sbc")).toBeNull();
    const gap = [
      row("2025-03-31", { sbc: 1 }),
      row("2025-06-30", { sbc: null }),
      row("2025-09-30", { sbc: 3 }),
      row("2025-12-31", { sbc: 4 }),
    ];
    expect(ttm(gap, "sbc")).toBeNull();
  });
});

describe("yoyLatest", () => {
  it("compares the newest quarter to the one a year earlier", () => {
    const rows = [
      row("2025-03-31", { revenue: 100 }),
      row("2025-06-30", { revenue: 105 }),
      row("2025-09-30", { revenue: 110 }),
      row("2025-12-31", { revenue: 115 }),
      row("2026-03-31", { revenue: 130 }),
    ];
    expect(yoyLatest(rows, "revenue")).toBeCloseTo(0.3, 10);
  });
  it("tolerates fiscal drift within ±45 days", () => {
    const rows = [
      row("2025-03-29", { revenue: 200 }),
      row("2026-04-04", { revenue: 220 }),
    ];
    expect(yoyLatest(rows, "revenue")).toBeCloseTo(0.1, 10);
  });
  it("returns null without a year-ago base or on a ~zero base", () => {
    expect(yoyLatest([row("2026-03-31", { revenue: 100 })], "revenue")).toBeNull();
    const zeroBase = [
      row("2025-03-31", { netIncome: 0 }),
      row("2026-03-31", { netIncome: 50 }),
    ];
    expect(yoyLatest(zeroBase, "netIncome")).toBeNull();
  });
});

describe("cashFlowPanel", () => {
  it("reproduces the reference figures (FCF yield + SBC impact)", () => {
    // Reference card: FCF/share 21.66 @ price 417.99 → 5.18%; SBC-adjusted
    // 20.62 → 4.93%; impact ≈ −4.8%.
    const shares = 1e9;
    const r = cashFlowPanel({
      freeCashflow: 21.66 * shares,
      sharesOutstanding: shares,
      price: 417.99,
      sbcTtm: (21.66 - 20.62) * shares,
    });
    expect(r.fcfPerShare).toBeCloseTo(21.66, 6);
    expect(r.fcfYield).toBeCloseTo(0.0518, 3);
    expect(r.adjFcfPerShare).toBeCloseTo(20.62, 6);
    expect(r.adjFcfYield).toBeCloseTo(0.0493, 3);
    expect(r.sbcImpact).toBeCloseTo(-0.048, 2);
  });
  it("degrades to nulls when inputs are missing", () => {
    const r = cashFlowPanel({
      freeCashflow: null,
      sharesOutstanding: null,
      price: null,
      sbcTtm: null,
    });
    expect(r).toEqual({
      fcfPerShare: null,
      fcfYield: null,
      adjFcfPerShare: null,
      adjFcfYield: null,
      sbcImpact: null,
    });
  });
});
