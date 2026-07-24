import { describe, it, expect } from "vitest";
import { computeXray, regionForTicker, scoreToGrade, type XrayHoldingInput } from "./xray";
import type { Transaction } from "./excel-parser";

// Minimal holding factory: only the fields computeXray reads.
function h(over: Partial<XrayHoldingInput>): XrayHoldingInput {
  return {
    ticker: "AAPL",
    shares: 1,
    costEur: 100,
    avgCostEur: 100,
    realizedPlEur: 0,
    marketValueEur: 100,
    currency: "USD",
    sector: null,
    trailingPe: null,
    ...over,
  };
}

// A synthetic buy so computeSinceInception has cash flows to chew on.
function buy(ticker: string, value: number, date: string | null = "2023-01-01"): Transaction {
  return {
    ticker,
    shares: 1,
    buyPrice: value,
    buyValue: value,
    buyDate: date,
    sellShares: null,
    sellPrice: null,
    sellValue: null,
    sellDate: null,
    result: null,
    portfolio: "test",
  };
}

describe("regionForTicker", () => {
  it("classifies by exchange suffix first", () => {
    expect(regionForTicker("SAN.MC", "EUR")).toBe("Europe");
    expect(regionForTicker("VOD.L", "GBp")).toBe("UK");
    expect(regionForTicker("7203.T", "JPY")).toBe("Asia");
  });
  it("falls back to currency, then US, for un-suffixed tickers", () => {
    expect(regionForTicker("AAPL", "USD")).toBe("US");
    expect(regionForTicker("ASML", "EUR")).toBe("Europe");
    expect(regionForTicker("NVDA", null)).toBe("US");
  });
  it("detects crypto", () => {
    expect(regionForTicker("BTC-USD", "USD")).toBe("Crypto");
    expect(regionForTicker("ETH", "USD")).toBe("Crypto");
  });
});

describe("computeXray concentration + grade", () => {
  it("gives a single-stock portfolio an F", () => {
    const r = computeXray({
      holdings: [h({ ticker: "AAPL", marketValueEur: 1000, costEur: 1000 })],
      txns: [buy("AAPL", 1000)],
      dividends: [],
      interests: [],
    });
    expect(r.concentration.top1).toBeCloseTo(1, 5);
    expect(r.concentration.effectiveN).toBeCloseTo(1, 5);
    expect(r.grade).toBe("F");
    expect(r.flags.map((f) => f.id)).toContain("concentrated");
    expect(r.flags.map((f) => f.id)).toContain("fewHoldings");
  });

  it("scores an evenly-spread, multi-region book far higher", () => {
    const holdings: XrayHoldingInput[] = [
      h({ ticker: "AAPL", currency: "USD", sector: "Technology", trailingPe: 30, marketValueEur: 100, costEur: 90 }),
      h({ ticker: "MSFT", currency: "USD", sector: "Technology", trailingPe: 35, marketValueEur: 100, costEur: 95 }),
      h({ ticker: "SAN.MC", currency: "EUR", sector: "Financial Services", trailingPe: 8, marketValueEur: 100, costEur: 80 }),
      h({ ticker: "ASML", currency: "EUR", sector: "Technology", trailingPe: 25, marketValueEur: 100, costEur: 110 }),
      h({ ticker: "VOD.L", currency: "GBp", sector: "Communication Services", trailingPe: 12, marketValueEur: 100, costEur: 100 }),
      h({ ticker: "7203.T", currency: "JPY", sector: "Consumer Cyclical", trailingPe: 10, marketValueEur: 100, costEur: 100 }),
      h({ ticker: "NESN.SW", currency: "CHF", sector: "Consumer Defensive", trailingPe: 18, marketValueEur: 100, costEur: 100 }),
      h({ ticker: "NVO", currency: "USD", sector: "Healthcare", trailingPe: 22, marketValueEur: 100, costEur: 100 }),
    ];
    const r = computeXray({
      holdings,
      txns: holdings.map((x) => buy(x.ticker, x.costEur)),
      dividends: [],
      interests: [],
    });
    expect(r.holdingsCount).toBe(8);
    expect(r.concentration.top1).toBeLessThan(0.2);
    expect(r.sectors).not.toBeNull();
    expect(r.weightedPe).not.toBeNull();
    expect(r.score).toBeGreaterThan(r.score * 0); // sanity: finite
    expect(["A+", "A", "B+", "B"]).toContain(r.grade);
    // A well-spread book should raise no high-severity flags.
    expect(r.flags.some((f) => f.severity === "high")).toBe(false);
  });

  it("hides the sector breakdown when coverage is thin", () => {
    const r = computeXray({
      holdings: [
        h({ ticker: "AAPL", sector: "Technology", marketValueEur: 100, costEur: 100 }),
        h({ ticker: "MSFT", sector: null, marketValueEur: 900, costEur: 900 }),
      ],
      txns: [buy("AAPL", 100), buy("MSFT", 900)],
      dividends: [],
      interests: [],
    });
    // Only 10% of value has a sector → below the 40% trust threshold.
    expect(r.sectors).toBeNull();
    expect(r.scoreParts.sector).toBeNull();
  });

  it("values an unpriceable holding at cost instead of dropping it", () => {
    const r = computeXray({
      holdings: [
        h({ ticker: "AAPL", marketValueEur: 600, costEur: 500 }),
        h({ ticker: "WEIRD.XX", marketValueEur: null, costEur: 400 }),
      ],
      txns: [buy("AAPL", 500), buy("WEIRD.XX", 400)],
      dividends: [],
      interests: [],
    });
    expect(r.totalValueEur).toBe(1000); // 600 + 400(at cost)
    expect(r.holdingsCount).toBe(2);
  });
});

describe("scoreToGrade", () => {
  it("maps the band edges", () => {
    expect(scoreToGrade(88)).toBe("A+");
    expect(scoreToGrade(70)).toBe("B+");
    expect(scoreToGrade(29)).toBe("F");
  });
});
