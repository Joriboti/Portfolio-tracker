import { describe, expect, it } from "vitest";
import { alignFrom, median, peSeries, rebase, ttmEpsAt } from "./pe-history";
import type { StatementMetrics, StatementRow } from "./statements";

const EMPTY = {
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
} satisfies StatementMetrics;

const q = (periodEnd: string, eps: number | null): StatementRow => ({
  periodEnd,
  metrics: { ...EMPTY, eps },
});

const YEAR = [
  q("2024-03-31", 1),
  q("2024-06-30", 2),
  q("2024-09-30", 3),
  q("2024-12-31", 4),
  q("2025-03-31", 5),
];

describe("ttmEpsAt", () => {
  it("sums the four quarters reported by that date", () => {
    expect(ttmEpsAt(YEAR, "2025-01-15")).toBe(10); // 1+2+3+4
    expect(ttmEpsAt(YEAR, "2025-04-15")).toBe(14); // 2+3+4+5
  });

  it("uses only what had been reported, never a later quarter", () => {
    // The whole point of the series: on this date Q1 25 does not exist yet.
    expect(ttmEpsAt(YEAR, "2024-12-31")).toBe(10);
  });

  it("returns null rather than a partial year", () => {
    expect(ttmEpsAt(YEAR, "2024-09-30")).toBeNull();
    expect(ttmEpsAt([], "2025-01-01")).toBeNull();
  });

  it("ignores quarters with no EPS instead of counting them as zero", () => {
    const withHole = [q("2024-03-31", 1), q("2024-06-30", null), q("2024-09-30", 3), q("2024-12-31", 4)];
    expect(ttmEpsAt(withHole, "2025-01-15")).toBeNull();
  });
});

describe("peSeries", () => {
  it("divides each close by the TTM EPS of its own week", () => {
    const s = peSeries(
      [
        { date: "2025-01-15", close: 100 },
        { date: "2025-04-15", close: 140 },
      ],
      YEAR,
    );
    expect(s).toEqual([
      { date: "2025-01-15", value: 10 },
      { date: "2025-04-15", value: 10 },
    ]);
  });

  it("drops weeks with no full year of EPS, and loss-making ones", () => {
    const losses = [q("2024-03-31", -3), q("2024-06-30", -2), q("2024-09-30", -1), q("2024-12-31", 1)];
    expect(peSeries([{ date: "2024-06-30", close: 10 }], YEAR)).toEqual([]);
    expect(peSeries([{ date: "2025-01-15", close: 10 }], losses)).toEqual([]);
  });
});

describe("rebase", () => {
  it("indexes to 100 at the first close", () => {
    expect(rebase([
      { date: "2024-01-01", close: 50 },
      { date: "2024-02-01", close: 75 },
    ])).toEqual([
      { date: "2024-01-01", value: 100 },
      { date: "2024-02-01", value: 150 },
    ]);
  });

  it("has nothing to say about an empty series", () => {
    expect(rebase([])).toEqual([]);
  });
});

describe("alignFrom", () => {
  it("cuts both to the window they share", () => {
    const a = [{ date: "2020-01-01" }, { date: "2023-01-01" }];
    const b = [{ date: "2023-01-01" }];
    expect(alignFrom(a, b)).toEqual([[{ date: "2023-01-01" }], [{ date: "2023-01-01" }]]);
  });
});

describe("median", () => {
  it("takes the middle, and the mean of the two middles when even", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
