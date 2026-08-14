import { describe, expect, it } from "vitest";
import {
  COMPARE_PAIRS,
  alignSeries,
  canonicalPair,
  companyName,
  convertValues,
  fxSymbol,
  isCuratedPair,
  pairSlug,
  pairsFor,
  parsePairSlug,
} from "./compare";
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

const row = (periodEnd: string, patch: Partial<StatementMetrics>): StatementRow => ({
  periodEnd,
  metrics: { ...EMPTY, ...patch },
});

describe("pair slugs", () => {
  it("round-trips a curated pair", () => {
    expect(pairSlug({ a: "AAPL", b: "MSFT" })).toBe("aapl-vs-msft");
    expect(parsePairSlug("aapl-vs-msft")).toEqual({ a: "AAPL", b: "MSFT" });
  });

  it("canonicalises a reversed curated slug to the curated direction", () => {
    // /explore/compare/msft-vs-aapl is the same page as aapl-vs-msft; the page
    // canonicalises so the two don't compete as duplicates.
    expect(parsePairSlug("msft-vs-aapl")).toEqual({ a: "MSFT", b: "AAPL" });
    expect(canonicalPair({ a: "MSFT", b: "AAPL" })).toEqual({ a: "AAPL", b: "MSFT" });
  });

  it("keeps symbols that contain a dash or a dot intact", () => {
    expect(pairSlug({ a: "BA", b: "AIR.PA" })).toBe("ba-vs-air.pa");
    expect(parsePairSlug("ba-vs-air.pa")).toEqual({ a: "BA", b: "AIR.PA" });
    expect(parsePairSlug("san.mc-vs-bbva.mc")).toEqual({ a: "SAN.MC", b: "BBVA.MC" });
    expect(parsePairSlug("brk-b-vs-bf-b")).toEqual({ a: "BRK-B", b: "BF-B" });
  });

  it("accepts an uncurated pair but orders it alphabetically", () => {
    // The picker can put any two companies side by side; only the curated ones
    // are indexable, so a free pair still needs ONE spelling to live at.
    expect(parsePairSlug("ko-vs-aapl")).toEqual({ a: "KO", b: "AAPL" });
    expect(canonicalPair({ a: "KO", b: "AAPL" })).toEqual({ a: "AAPL", b: "KO" });
    expect(canonicalPair({ a: "AAPL", b: "KO" })).toEqual({ a: "AAPL", b: "KO" });
    expect(isCuratedPair({ a: "AAPL", b: "KO" })).toBe(false);
    expect(isCuratedPair({ a: "MSFT", b: "AAPL" })).toBe(true);
  });

  it("rejects malformed slugs, so a stray path never becomes a page", () => {
    expect(parsePairSlug("garbage")).toBeNull();
    expect(parsePairSlug("aapl-vs-aapl")).toBeNull();
    expect(parsePairSlug("-vs-msft")).toBeNull();
    expect(parsePairSlug("")).toBeNull();
    expect(parsePairSlug("aapl-vs-not a ticker")).toBeNull();
    expect(parsePairSlug("aapl-vs-waytoolongsymbol")).toBeNull();
  });

  it("every curated pair round-trips through its own slug", () => {
    for (const p of COMPARE_PAIRS) {
      expect(parsePairSlug(pairSlug(p)), pairSlug(p)).toEqual(p);
      expect(canonicalPair(p), pairSlug(p)).toEqual(p);
    }
  });

  it("names both curated and unknown symbols", () => {
    expect(companyName("AAPL")).toBe("Apple");
    expect(companyName("ZZZZ")).toBe("ZZZZ");
  });

  it("finds the pairs featuring a symbol, either side", () => {
    const forAmd = pairsFor("AMD");
    expect(forAmd).toContainEqual({ a: "NVDA", b: "AMD" });
    expect(forAmd).toContainEqual({ a: "AMD", b: "INTC" });
  });
});

describe("alignSeries", () => {
  it("lines up companies on different fiscal calendars by calendar quarter", () => {
    // Apple's quarter ends 28 Dec, Microsoft's 31 Dec — both are Q4 25 and must
    // share one slot rather than producing two adjacent near-duplicate bars.
    const a = [row("2025-12-28", { revenue: 100 })];
    const b = [row("2025-12-31", { revenue: 60 })];
    expect(alignSeries(a, b, "revenue")).toEqual({
      labels: ["Q4 25"],
      a: [100],
      b: [60],
    });
  });

  it("keeps a period only one side reports, nulling the other", () => {
    const a = [row("2025-09-30", { revenue: 90 }), row("2025-12-31", { revenue: 100 })];
    const b = [row("2025-12-31", { revenue: 60 })];
    expect(alignSeries(a, b, "revenue")).toEqual({
      labels: ["Q3 25", "Q4 25"],
      a: [90, 100],
      b: [null, 60],
    });
  });

  it("orders by period, not by insertion", () => {
    const a = [row("2025-12-31", { revenue: 100 }), row("2025-03-31", { revenue: 70 })];
    const b = [row("2025-06-30", { revenue: 50 })];
    expect(alignSeries(a, b, "revenue").labels).toEqual(["Q1 25", "Q2 25", "Q4 25"]);
  });

  it("caps to the most recent N periods", () => {
    const a = [
      row("2025-03-31", { revenue: 1 }),
      row("2025-06-30", { revenue: 2 }),
      row("2025-09-30", { revenue: 3 }),
    ];
    expect(alignSeries(a, [], "revenue", { last: 2 })).toEqual({
      labels: ["Q2 25", "Q3 25"],
      a: [2, 3],
      b: [null, null],
    });
  });

  it("uses year labels in annual mode", () => {
    const a = [row("2025-09-30", { revenue: 400 })];
    const b = [row("2025-12-31", { revenue: 300 })];
    expect(alignSeries(a, b, "revenue", { annual: true })).toEqual({
      labels: ["2025"],
      a: [400],
      b: [300],
    });
  });

  it("skips periods where the metric is missing entirely", () => {
    const a = [row("2025-09-30", { revenue: null }), row("2025-12-31", { revenue: 100 })];
    expect(alignSeries(a, [], "revenue").labels).toEqual(["Q4 25"]);
  });
});

describe("currency conversion", () => {
  it("builds the ADR crosses the comparison pages actually need", () => {
    // TSM reports in TWD but quotes in USD; without this its revenue bars would
    // tower ~30x over an American peer's for purely notional reasons.
    expect(fxSymbol("TWD", "USD")).toBe("TWDUSD=X");
    expect(fxSymbol("JPY", "USD")).toBe("JPYUSD=X");
    expect(fxSymbol("EUR", "USD")).toBe("EURUSD=X");
  });

  it("uses Yahoo's short form for USD-base crosses", () => {
    // Yahoo answers a USDEUR=X request as EUR=X, so a lookup keyed by the
    // requested symbol would find nothing.
    expect(fxSymbol("USD", "EUR")).toBe("EUR=X");
    expect(fxSymbol("USD", "JPY")).toBe("JPY=X");
  });

  it("needs no conversion for a matching or unknown currency", () => {
    expect(fxSymbol("USD", "USD")).toBeNull();
    expect(fxSymbol("eur", "EUR")).toBeNull();
    expect(fxSymbol("", "USD")).toBeNull();
  });

  it("scales values and preserves gaps", () => {
    expect(convertValues([100, null, 200], 0.031079067)).toEqual([
      3.1079067,
      null,
      6.2158134,
    ]);
  });
});
