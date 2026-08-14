import { describe, expect, it } from "vitest";
import {
  alignFrom,
  epsPoints,
  forwardEpsAt,
  forwardEpsPoints,
  forwardPeSeries,
  median,
  peSeries,
  rateLookup,
  rebase,
  trailingEpsAt,
  ttmEpsAt,
} from "./pe-history";
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

  it("refuses four quarters that are not a year", () => {
    // Shell's EDGAR coverage looks like this: real quarters, years apart.
    // Adding them up produced a "trailing year" that was nothing of the sort.
    const sparse = [
      q("2019-06-30", 1),
      q("2020-06-30", -4),
      q("2021-06-30", 2),
      q("2024-12-31", 4),
    ];
    expect(ttmEpsAt(sparse, "2025-01-15")).toBeNull();
  });
});

const ANNUAL = epsPoints([q("2022-12-31", 6), q("2023-12-31", 8), q("2024-12-31", 12)]);

describe("trailingEpsAt", () => {
  it("prefers four real quarters over the annual row", () => {
    expect(trailingEpsAt(YEAR, ANNUAL, "2025-01-15")?.eps).toBe(10);
  });

  it("falls back to the last full year once the quarters run out", () => {
    // Without this a company with Yahoo's five quarters has two drawable
    // quarters of P/E history and nothing before them.
    expect(trailingEpsAt([], ANNUAL, "2024-06-30")?.eps).toBe(8);
    expect(trailingEpsAt([], ANNUAL, "2023-06-30")?.eps).toBe(6);
  });

  it("waits for the year to be announced before using it", () => {
    // 2024 ended on the 31st of December; the market did not know the figure
    // on New Year's Day, and did by the middle of February.
    expect(trailingEpsAt([], ANNUAL, "2025-01-05")?.eps).toBe(8);
    expect(trailingEpsAt([], ANNUAL, "2025-03-01")?.eps).toBe(12);
  });

  it("has nothing before the first reported year", () => {
    expect(trailingEpsAt([], ANNUAL, "2022-06-30")).toBeNull();
  });

  it("takes whichever arm runs to the later period", () => {
    // Quarters that stop in 2024 against a 2024 year already announced: the
    // year is the newer figure and the one the market was pricing.
    const stale = [
      q("2023-06-30", 1),
      q("2023-09-30", 1),
      q("2023-12-31", 1),
      q("2024-03-31", 1),
    ];
    expect(trailingEpsAt(stale, ANNUAL, "2025-06-30")?.eps).toBe(12);
    // …and before that year was announced, the quarters still win.
    expect(trailingEpsAt(stale, ANNUAL, "2024-06-30")?.eps).toBe(4);
  });
});

describe("forwardEpsPoints / forwardEpsAt", () => {
  const estimates = [
    { periodEnd: "2024-12-31", eps: 11 }, // a year already reported
    { periodEnd: "2025-12-31", eps: 15 },
    { periodEnd: "2026-12-31", eps: 18 },
  ];
  const fwd = forwardEpsPoints(ANNUAL, estimates);

  it("keeps the reported year and drops the estimate covering it", () => {
    expect(fwd.map((p) => [p.periodEnd, p.eps])).toEqual([
      ["2022-12-31", 6],
      ["2023-12-31", 8],
      ["2024-12-31", 12],
      ["2025-12-31", 15],
      ["2026-12-31", 18],
    ]);
  });

  it("marks consensus as already in the quote currency, and actuals as not", () => {
    expect(fwd.find((p) => p.periodEnd === "2025-12-31")?.quoted).toBe(true);
    expect(fwd.find((p) => p.periodEnd === "2024-12-31")?.quoted).toBeUndefined();
  });

  it("looks past the year in progress to the one after it", () => {
    // Mid-2023 the market is trading 2024, not the year it is standing in —
    // the convention every screener's "forward P/E" uses.
    expect(forwardEpsAt(fwd, "2023-06-30")?.eps).toBe(12);
    expect(forwardEpsAt(fwd, "2024-01-01")?.eps).toBe(15);
    // Two years of consensus is all there is, so the line stops rather than
    // repeating the last estimate forever.
    expect(forwardEpsAt(fwd, "2026-01-01")).toBeNull();
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

  it("drops weeks with no earnings figure at all, and loss-making ones", () => {
    const losses = [q("2024-03-31", -3), q("2024-06-30", -2), q("2024-09-30", -1), q("2024-12-31", 1)];
    expect(peSeries([{ date: "2024-06-30", close: 10 }], YEAR)).toEqual([]);
    expect(peSeries([{ date: "2025-01-15", close: 10 }], losses)).toEqual([]);
  });

  it("reaches back over the annual rows once the quarters run out", () => {
    const prices = [
      { date: "2023-06-30", close: 60 },
      { date: "2025-01-15", close: 100 },
    ];
    expect(peSeries(prices, YEAR, ANNUAL)).toEqual([
      { date: "2023-06-30", value: 10 }, // 60 / 6, the 2022 year
      { date: "2025-01-15", value: 10 }, // 100 / 10, the four quarters
    ]);
  });

  it("converts the EPS into the currency the price is quoted in", () => {
    // TSM: a USD close over a TWD earnings figure was drawing 1.0x.
    const prices = [{ date: "2025-01-15", close: 425 }];
    const fx = [{ date: "2025-01-10", rate: 0.03125 }];
    const [point] = peSeries(prices, YEAR, [], rateLookup(fx));
    expect(point.value).toBeCloseTo(1360, 0); // 425 / (10 * 0.03125)
  });

  it("draws nothing rather than an unconverted line when no rate can be had", () => {
    const prices = [{ date: "2025-01-15", close: 425 }];
    expect(peSeries(prices, YEAR, [], rateLookup(null))).toEqual([]);
  });
});

describe("forwardPeSeries", () => {
  const prices = [
    { date: "2023-06-30", close: 80 },
    { date: "2025-06-30", close: 150 },
  ];
  const fwd = forwardEpsPoints(ANNUAL, [
    { periodEnd: "2025-12-31", eps: 15 },
    { periodEnd: "2026-12-31", eps: 20 },
  ]);

  it("prices each week against the year after the one in progress", () => {
    expect(forwardPeSeries(prices, fwd)).toEqual([
      { date: "2023-06-30", value: 6.666666666666667 }, // 80 / the 2024 year, 12
      { date: "2025-06-30", value: 7.5 }, // 150 / the 2026 consensus, 20
    ]);
  });

  it("leaves consensus unconverted — the API already quoted it", () => {
    // Same rate applied to the reported year and not to the estimate.
    const fx = [{ date: "2020-01-01", rate: 0.5 }];
    const s = forwardPeSeries(prices, fwd, rateLookup(fx));
    expect(s[0].value).toBeCloseTo(13.333, 3); // 80 / (12 * 0.5)
    expect(s[1].value).toBe(7.5); // 150 / 20, no second conversion
  });
});

describe("rateLookup", () => {
  const fx = [
    { date: "2024-01-01", rate: 1.1 },
    { date: "2024-06-01", rate: 1.2 },
  ];

  it("steps to the last rate quoted on or before the date", () => {
    expect(rateLookup(fx)("2024-03-01")).toBe(1.1);
    expect(rateLookup(fx)("2024-06-01")).toBe(1.2);
    expect(rateLookup(fx)("2025-01-01")).toBe(1.2);
  });

  it("has no rate before the series starts", () => {
    expect(rateLookup(fx)("2023-12-31")).toBeNull();
  });

  it("converts nothing when the currencies match, and refuses when unknown", () => {
    expect(rateLookup([])("2024-03-01")).toBe(1);
    expect(rateLookup(null)("2024-03-01")).toBeNull();
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
