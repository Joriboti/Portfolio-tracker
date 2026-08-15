import { describe, expect, it } from "vitest";
import {
  alignReported,
  buildForecast,
  epsEstimateScale,
  epsForecast,
  nextEstimate,
  revenueForecast,
} from "./estimates";
import type {
  CompanyStatements,
  EstimateBand,
  StatementMetrics,
  StatementRow,
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

function band(avg: number, low?: number, high?: number, analysts = 20): EstimateBand {
  return {
    avg,
    low: low ?? null,
    high: high ?? null,
    analysts,
    growth: null,
  };
}

function statements(patch: Partial<CompanyStatements> = {}): CompanyStatements {
  return {
    ticker: "TEST",
    panel: null,
    prices: [],
    quarters: [],
    annual: [],
    ...patch,
  };
}

describe("buildForecast", () => {
  const estimates = [
    { periodEnd: "2026-03-31", band: band(130, 125, 140) },
    { periodEnd: "2026-06-30", band: band(140) },
  ];

  it("puts reported periods before expected ones on one axis", () => {
    const bars = buildForecast({
      actuals: [
        { periodEnd: "2025-09-30", value: 110 },
        { periodEnd: "2025-12-31", value: 120 },
      ],
      estimates,
    });
    expect(bars.map((b) => b.label)).toEqual(["Q3 25", "Q4 25", "Q1 26", "Q2 26"]);
    expect(bars.map((b) => b.actual)).toEqual([110, 120, null, null]);
    expect(bars.map((b) => b.estimate?.avg ?? null)).toEqual([null, null, 130, 140]);
  });

  // Yahoo's "0q" is the quarter in progress as of ITS snapshot, so right after
  // a company files it names a quarter we already have the real figure for.
  it("drops an estimate for a period that has already reported", () => {
    const bars = buildForecast({
      actuals: [{ periodEnd: "2026-03-31", value: 128 }],
      estimates,
    });
    expect(bars.map((b) => b.label)).toEqual(["Q1 26", "Q2 26"]);
    expect(bars[0].actual).toBe(128);
    expect(bars[0].estimate).toBeNull();
  });

  it("treats a period end a fortnight off as the same period", () => {
    const bars = buildForecast({
      actuals: [{ periodEnd: "2026-04-04", value: 128 }],
      estimates,
    });
    expect(bars.map((b) => b.label)).toEqual(["Q2 26", "Q2 26"]);
    expect(bars.filter((b) => b.estimate != null)).toHaveLength(1);
  });

  it("measures the surprise against what had been expected", () => {
    const bars = buildForecast({
      actuals: [{ periodEnd: "2025-12-31", value: 2.4 }],
      estimates: [],
      consensusHistory: [{ periodEnd: "2025-12-31", estimate: 2 }],
    });
    expect(bars[0].consensus).toBe(2);
    expect(bars[0].surprise).toBeCloseTo(0.2, 10);
  });

  it("reports a miss as a negative surprise", () => {
    const bars = buildForecast({
      actuals: [{ periodEnd: "2025-12-31", value: 1.8 }],
      estimates: [],
      consensusHistory: [{ periodEnd: "2025-12-31", estimate: 2 }],
    });
    expect(bars[0].surprise).toBeCloseTo(-0.1, 10);
  });

  it("declines to divide by a zero consensus", () => {
    const bars = buildForecast({
      actuals: [{ periodEnd: "2025-12-31", value: 0.4 }],
      estimates: [],
      consensusHistory: [{ periodEnd: "2025-12-31", estimate: 0 }],
    });
    expect(bars[0].surprise).toBeNull();
  });

  it("keeps only the most recent reported periods", () => {
    const actuals = Array.from({ length: 12 }, (_, i) => ({
      periodEnd: `20${20 + i}-12-31`,
      value: i,
    }));
    const bars = buildForecast({ actuals, estimates: [], annual: true, maxActuals: 5 });
    expect(bars).toHaveLength(5);
    expect(bars[0].label).toBe("2027");
  });

  it("labels annual bars by year", () => {
    const bars = buildForecast({
      actuals: [{ periodEnd: "2025-09-30", value: 1 }],
      estimates: [{ periodEnd: "2026-09-30", band: band(2) }],
      annual: true,
    });
    expect(bars.map((b) => b.label)).toEqual(["2025", "2026"]);
  });
});

describe("alignReported", () => {
  const wide = buildForecast({
    actuals: [
      { periodEnd: "2025-03-31", value: 1 },
      { periodEnd: "2025-06-30", value: 2 },
      { periodEnd: "2025-09-30", value: 3 },
      { periodEnd: "2025-12-31", value: 4 },
    ],
    estimates: [{ periodEnd: "2026-03-31", band: band(5) }],
  });
  const narrow = buildForecast({
    actuals: [
      { periodEnd: "2025-09-30", value: 30 },
      { periodEnd: "2025-12-31", value: 40 },
    ],
    estimates: [{ periodEnd: "2026-03-31", band: band(50) }],
  });

  it("cuts the deeper series back to the shallowest one's history", () => {
    const [a, b] = alignReported([wide, narrow]);
    expect(a.map((x) => x.label)).toEqual(["Q3 25", "Q4 25", "Q1 26"]);
    expect(b.map((x) => x.label)).toEqual(["Q3 25", "Q4 25", "Q1 26"]);
  });

  it("keeps every forecast period on both sides", () => {
    const [a, b] = alignReported([wide, narrow]);
    expect(a.filter((x) => x.estimate != null)).toHaveLength(1);
    expect(b.filter((x) => x.estimate != null)).toHaveLength(1);
  });

  // A head-to-head page draws four at once; trimming them pairwise would leave
  // the grid ragged in a different way.
  it("puts four series on one window", () => {
    const mid = buildForecast({
      actuals: [
        { periodEnd: "2025-06-30", value: 7 },
        { periodEnd: "2025-09-30", value: 8 },
        { periodEnd: "2025-12-31", value: 9 },
      ],
      estimates: [{ periodEnd: "2026-03-31", band: band(10) }],
    });
    const out = alignReported([wide, narrow, mid, wide]);
    expect(out.map((s) => s.filter((x) => x.actual != null).length)).toEqual([2, 2, 2, 2]);
    for (const s of out) {
      expect(s[0].label).toBe("Q3 25");
    }
  });

  it("leaves a series with nothing reported alone", () => {
    const empty = buildForecast({
      actuals: [],
      estimates: [{ periodEnd: "2026-03-31", band: band(5) }],
    });
    const [a, b] = alignReported([wide, empty]);
    expect(a).toEqual(wide);
    expect(b).toEqual(empty);
  });
});

describe("revenueForecast", () => {
  const data = statements({
    quarters: [row("2025-09-30", { revenue: 90 }), row("2025-12-31", { revenue: 100 })],
    annual: [row("2024-12-31", { revenue: 350 }), row("2025-12-31", { revenue: 380 })],
    panel: {
      priceToSales: null,
      evToEbitda: null,
      operatingMargin: null,
      grossMargin: null,
      payoutRatio: null,
      dividendDate: null,
      nextYearEps: null,
      forecast: {
        epsScale: null,
        epsHistory: [],
        periods: [
          { period: "0q", periodEnd: "2026-03-31", eps: band(2), revenue: band(110, 105, 118) },
          { period: "+1q", periodEnd: "2026-06-30", eps: band(2.2), revenue: band(120) },
          { period: "0y", periodEnd: "2026-12-31", eps: band(9), revenue: band(430) },
          { period: "+1y", periodEnd: "2027-12-31", eps: band(10), revenue: band(470) },
        ],
      },
    },
  });

  it("reads the quarterly rows against the quarterly consensus", () => {
    const bars = revenueForecast(data, "q");
    expect(bars.map((b) => b.label)).toEqual(["Q3 25", "Q4 25", "Q1 26", "Q2 26"]);
    expect(bars[2].estimate).toEqual(band(110, 105, 118));
  });

  it("reads the annual rows against the annual consensus", () => {
    const bars = revenueForecast(data, "a");
    expect(bars.map((b) => b.label)).toEqual([
      "2024",
      "2025",
      "2026",
      "2027",
      "2028",
      "2029",
      "2030",
    ]);
    const published = bars.filter((b) => b.estimate != null && !b.projected);
    expect(published.map((b) => b.estimate!.avg)).toEqual([430, 470]);
  });

  // Analysts publish two years. A five-year chart needs three more, and those
  // three must never be mistaken for the two.
  it("carries revenue forward at the growth its published years imply", () => {
    const bars = revenueForecast(data, "a");
    const projected = bars.filter((b) => b.projected);
    expect(projected).toHaveLength(3);
    const g = 470 / 430 - 1;
    expect(projected[0].estimate!.avg).toBeCloseTo(470 * (1 + g), 6);
    expect(projected[2].estimate!.avg).toBeCloseTo(470 * (1 + g) ** 3, 6);
  });

  it("gives a projection no analyst range, because there is no disagreement", () => {
    for (const b of revenueForecast(data, "a").filter((x) => x.projected)) {
      expect(b.estimate!.low).toBeNull();
      expect(b.estimate!.high).toBeNull();
      expect(b.estimate!.analysts).toBeNull();
    }
  });

  it("projects nothing onto the quarterly axis", () => {
    expect(revenueForecast(data, "q").some((b) => b.projected)).toBe(false);
  });

  it("finds the next period ahead, which is the one a reader wants", () => {
    const bars = revenueForecast(data, "q");
    expect(nextEstimate(bars)?.label).toBe("Q1 26");
    expect(nextEstimate(bars)?.estimate?.analysts).toBe(20);
  });

  it("draws nothing without a forecast payload", () => {
    expect(revenueForecast(statements({ quarters: data.quarters }), "q").every(
      (b) => b.estimate == null,
    )).toBe(true);
  });
});

describe("epsForecast", () => {
  const panel = {
    priceToSales: null,
    evToEbitda: null,
    operatingMargin: null,
    grossMargin: null,
    payoutRatio: null,
    dividendDate: null,
    nextYearEps: null,
    financialCurrency: "USD",
    quoteCurrency: "USD",
    forecast: {
      epsScale: 1,
      epsHistory: [
        { periodEnd: "2025-09-30", actual: 2.1, estimate: 2 },
        { periodEnd: "2025-12-31", actual: 2.4, estimate: 2.5 },
      ],
      periods: [
        { period: "0q", periodEnd: "2026-03-31", eps: band(2.6, 2.4, 2.9), revenue: null },
        { period: "0y", periodEnd: "2026-12-31", eps: band(11), revenue: null },
      ],
    },
  };

  // The income statement is GAAP and the consensus is adjusted, so a quarterly
  // bar drawn from the statements would be compared with a figure measured a
  // different way.
  it("draws the quarters from the same dataset as their estimates", () => {
    const data = statements({
      panel,
      quarters: [row("2025-12-31", { eps: 1.9 })],
    });
    const bars = epsForecast(data, "q");
    expect(bars.map((b) => b.actual)).toEqual([2.1, 2.4, null]);
    expect(bars[1].surprise).toBeCloseTo(-0.04, 10);
    expect(bars[2].estimate?.avg).toBe(2.6);
  });

  it("draws nothing quarterly when there is no earnings history", () => {
    const data = statements({
      panel: { ...panel, forecast: { ...panel.forecast, epsHistory: [] } },
      quarters: [row("2025-12-31", { eps: 1.9 })],
    });
    expect(epsForecast(data, "q")).toEqual([]);
  });

  it("pairs reported fiscal years with consensus and no markers", () => {
    const data = statements({
      panel,
      annual: [row("2024-12-31", { eps: 8 }), row("2025-12-31", { eps: 9.5 })],
    });
    const bars = epsForecast(data, "a");
    expect(bars.slice(0, 3).map((b) => b.label)).toEqual(["2024", "2025", "2026"]);
    expect(bars.every((b) => b.consensus == null)).toBe(true);
    expect(bars[2].estimate?.avg).toBe(11);
    expect(bars[2].projected).toBeFalsy();
  });

  // EPS is carried forward on the long-term EARNINGS growth consensus, which
  // is a different number from the pace revenue is expected to grow at.
  it("carries EPS forward at the long-term growth consensus", () => {
    const data = statements({
      panel: {
        ...panel,
        forecast: { ...panel.forecast, longTermGrowth: 0.1 },
      },
      annual: [row("2025-12-31", { eps: 9.5 })],
    });
    const projected = epsForecast(data, "a").filter((b) => b.projected);
    expect(projected).toHaveLength(4);
    expect(projected[0].estimate!.avg).toBeCloseTo(11 * 1.1, 6);
    expect(projected[3].estimate!.avg).toBeCloseTo(11 * 1.1 ** 4, 6);
  });

  it("refuses to compound a loss into a forecast", () => {
    const data = statements({
      panel: {
        ...panel,
        forecast: {
          ...panel.forecast,
          longTermGrowth: 0.1,
          periods: [
            { period: "0y", periodEnd: "2026-12-31", eps: band(-2), revenue: null },
          ],
        },
      },
      annual: [row("2025-12-31", { eps: -3 })],
    });
    expect(epsForecast(data, "a").some((b) => b.projected)).toBe(false);
  });

  it("converts an ADR's filings and scales its estimates into the quote currency", () => {
    const data = statements({
      panel: {
        ...panel,
        financialCurrency: "TWD",
        quoteCurrency: "USD",
        forecast: { ...panel.forecast, epsScale: 0.16 },
      },
      annual: [row("2025-12-31", { eps: 60 })],
    });
    const bars = epsForecast(data, "a", () => 0.031);
    expect(bars[0].actual).toBeCloseTo(1.86, 10);
    expect(bars[1].estimate?.avg).toBeCloseTo(1.76, 10);
  });

  it("draws nothing when an ADR's estimates cannot be put in the quote currency", () => {
    const data = statements({
      panel: {
        ...panel,
        financialCurrency: "TWD",
        quoteCurrency: "USD",
        forecast: { ...panel.forecast, epsScale: null },
      },
      annual: [row("2025-12-31", { eps: 60 })],
    });
    expect(epsForecast(data, "a", () => 0.031)).toEqual([]);
  });

  it("never rescales a company that files and trades in one currency", () => {
    // A stale forwardPE makes the measured ratio drift off 1; applying it would
    // step the forecast bars away from the actuals for no reason.
    const data = statements({
      panel: { ...panel, forecast: { ...panel.forecast, epsScale: 1.04 } },
    });
    expect(epsEstimateScale(data)).toBe(1);
  });
});
