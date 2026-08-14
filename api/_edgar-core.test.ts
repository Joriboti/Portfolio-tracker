import { describe, it, expect } from "vitest";
import { extractStatements, type EdgarRow } from "./_edgar-core";

// A minimal companyfacts fixture reproducing the real SEC pattern: a fiscal
// year (annual frame) whose fiscal Q4 3-month period is NOT filed and must be
// derived from annual − the three inner framed quarters.
const facts = {
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            { start: "2022-10-01", end: "2022-12-31", val: 20, frame: "CY2022Q4" },
            { start: "2023-01-01", end: "2023-03-31", val: 25, frame: "CY2023Q1" },
            { start: "2023-04-01", end: "2023-06-30", val: 30, frame: "CY2023Q2" },
            { start: "2023-10-01", end: "2023-12-31", val: 28, frame: "CY2023Q4" },
            // a 6-month YTD point with NO frame → must be ignored
            { start: "2023-01-01", end: "2023-06-30", val: 55 },
            { start: "2022-10-01", end: "2023-09-30", val: 100, frame: "CY2023" },
          ],
        },
      },
      NetCashProvidedByUsedInOperatingActivities: {
        units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 40, frame: "CY2023Q1" }] },
      },
      PaymentsToAcquirePropertyPlantAndEquipment: {
        units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 5, frame: "CY2023Q1" }] },
      },
      EarningsPerShareDiluted: {
        units: { "USD/shares": [{ start: "2023-01-01", end: "2023-03-31", val: 1.5, frame: "CY2023Q1" }] },
      },
      CashAndCashEquivalentsAtCarryingValue: {
        units: {
          USD: [
            { end: "2023-09-30", val: 50, frame: "CY2023Q3I" },
            { end: "2023-12-31", val: 55, frame: "CY2023Q4I" },
          ],
        },
      },
      CommonStockSharesOutstanding: {
        units: { shares: [{ end: "2023-09-30", val: 1000, frame: "CY2023Q3I" }] },
      },
      OperatingIncomeLoss: {
        units: {
          USD: [
            { start: "2023-01-01", end: "2023-03-31", val: 12, frame: "CY2023Q1" },
            { start: "2023-04-01", end: "2023-06-30", val: 14, frame: "CY2023Q2" },
          ],
        },
      },
      DepreciationDepletionAndAmortization: {
        units: {
          USD: [{ start: "2023-01-01", end: "2023-03-31", val: 3, frame: "CY2023Q1" }],
        },
      },
    },
    dei: {},
  },
};

const rows = extractStatements(facts);
const q = (end: string) =>
  rows.find((r: EdgarRow) => r.periodType === "q" && r.periodEnd === end)?.metrics;
const a = (end: string) =>
  rows.find((r: EdgarRow) => r.periodType === "a" && r.periodEnd === end)?.metrics;

describe("extractStatements", () => {
  it("keeps directly-framed quarters", () => {
    expect(q("2023-03-31")?.revenue).toBe(25);
    expect(q("2023-06-30")?.revenue).toBe(30);
    expect(q("2023-12-31")?.revenue).toBe(28);
  });

  it("derives the missing fiscal Q4 = annual − the 3 inner quarters", () => {
    // 100 − (20 + 25 + 30) = 25, dated at the fiscal year end
    expect(q("2023-09-30")?.revenue).toBe(25);
  });

  it("ignores un-framed YTD points", () => {
    // the 6-month 55 point has no frame and must never appear as a quarter
    expect(rows.some((r) => r.metrics.revenue === 55)).toBe(false);
  });

  it("stores capex / outflows as negatives and computes fcf = ocf + capex", () => {
    expect(q("2023-03-31")?.capex).toBe(-5);
    expect(q("2023-03-31")?.ocf).toBe(40);
    expect(q("2023-03-31")?.fcf).toBe(35);
  });

  it("reads diluted EPS from the USD/shares unit", () => {
    expect(q("2023-03-31")?.eps).toBe(1.5);
  });

  it("derives EBITDA from operating income + D&A, and only where both exist", () => {
    // Yahoo only carries EBITDA for its ~5-quarter window, so this derivation
    // is the entire depth of the EBITDA charts.
    expect(q("2023-03-31")?.ebitda).toBe(15);
    // Q2 has operating income but no D&A point: no half-computed EBITDA.
    expect(q("2023-06-30")?.operatingIncome).toBe(14);
    expect(q("2023-06-30")?.ebitda).toBeNull();
  });

  it("maps instant balance items per quarter and at the fiscal year end", () => {
    expect(q("2023-12-31")?.cash).toBe(55);
    expect(q("2023-09-30")?.cash).toBe(50);
    expect(q("2023-09-30")?.shares).toBe(1000);
    // annual balance snapshot = the instant at the fiscal year end
    expect(a("2023-09-30")?.cash).toBe(50);
    expect(a("2023-09-30")?.revenue).toBe(100);
  });

  it("leaves debt null — no single unambiguous XBRL concept for it", () => {
    expect(q("2023-03-31")?.totalDebt).toBeNull();
  });
});
