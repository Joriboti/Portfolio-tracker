import { describe, it, expect } from "vitest";
import {
  epsShareRatio,
  extractStatements,
  reportingCurrency,
  scaleEps,
  type EdgarRow,
} from "./_edgar-core";

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
      // Cash flow as filers actually report it: cumulative from the fiscal
      // year start, and only the first 3-month period carries a frame.
      NetCashProvidedByUsedInOperatingActivities: {
        units: {
          USD: [
            { start: "2023-01-01", end: "2023-03-31", val: 40, frame: "CY2023Q1" },
            { start: "2023-01-01", end: "2023-06-30", val: 95 },
            { start: "2023-01-01", end: "2023-09-30", val: 160 },
            // A restatement of the 9-month figure, filed later: it must win.
            { start: "2023-01-01", end: "2023-09-30", val: 150, filed: "2024-02-01" },
            { start: "2023-01-01", end: "2023-12-31", val: 210, filed: "2024-02-01" },
          ],
        },
      },
      PaymentsToAcquirePropertyPlantAndEquipment: {
        units: {
          USD: [
            { start: "2023-01-01", end: "2023-03-31", val: 5, frame: "CY2023Q1" },
            { start: "2023-01-01", end: "2023-06-30", val: 11 },
          ],
        },
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

  it("recovers the quarters inside a year-to-date chain", () => {
    // The SEC frames only the first 3-month cash-flow period, so without this
    // a company gets one cash-flow quarter per year. 95 − 40 = 55.
    expect(q("2023-06-30")?.ocf).toBe(55);
    // 9-month restated to 150 (later `filed` wins over the original 160),
    // so Q3 = 150 − 95 and Q4 = 210 − 150.
    expect(q("2023-09-30")?.ocf).toBe(55);
    expect(q("2023-12-31")?.ocf).toBe(60);
    // Derived capex keeps the outflow sign, and fcf follows from both.
    expect(q("2023-06-30")?.capex).toBe(-6);
    expect(q("2023-06-30")?.fcf).toBe(49);
    // A quarter whose chain gives nothing stays null rather than guessing.
    expect(q("2023-09-30")?.capex).toBeNull();
    expect(q("2023-09-30")?.fcf).toBeNull();
  });

  it("reads diluted EPS from the USD/shares unit", () => {
    expect(q("2023-03-31")?.eps).toBe(1.5);
  });

  it("builds EBITDA from the bottom up when no operating subtotal is tagged", () => {
    // Chevron and Lilly present no OperatingIncomeLoss at all: net income +
    // tax + interest + D&A is the same figure reached from the other end.
    const noSubtotal = {
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 10, frame: "CY2023Q1" }] },
          },
          IncomeTaxExpenseBenefit: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 3, frame: "CY2023Q1" }] },
          },
          InterestExpense: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 2, frame: "CY2023Q1" }] },
          },
          DepreciationDepletionAndAmortization: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 4, frame: "CY2023Q1" }] },
          },
        },
        dei: {},
      },
    };
    const rows = extractStatements(noSubtotal);
    const met = rows.find((r: EdgarRow) => r.periodType === "q" && r.periodEnd === "2023-03-31")?.metrics;
    expect(met?.ebitda).toBe(19); // 10 + 3 + 2 + 4
  });

  it("will not build EBITDA from an incomplete bottom-up", () => {
    // No interest line: this is not EBIT, so it stays null rather than
    // understating the figure and flattering the multiple.
    const noInterest = {
      facts: {
        "us-gaap": {
          NetIncomeLoss: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 10, frame: "CY2023Q1" }] },
          },
          IncomeTaxExpenseBenefit: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 3, frame: "CY2023Q1" }] },
          },
          DepreciationDepletionAndAmortization: {
            units: { USD: [{ start: "2023-01-01", end: "2023-03-31", val: 4, frame: "CY2023Q1" }] },
          },
        },
        dei: {},
      },
    };
    const rows = extractStatements(noInterest);
    expect(
      rows.find((r: EdgarRow) => r.periodType === "q" && r.periodEnd === "2023-03-31")?.metrics.ebitda,
    ).toBeNull();
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

// A 20-F filer: IFRS concepts, a non-USD unit, and annual frames only. Every
// one of these was invisible while the reader was pinned to us-gaap and "USD",
// which is why TSM, NVO, SHEL and SAP had five quarters of history between
// them and a P/E chart six months wide.
const ifrsFacts = {
  facts: {
    "ifrs-full": {
      Revenue: {
        units: {
          TWD: [
            { start: "2023-01-01", end: "2023-12-31", val: 2100, frame: "CY2023" },
            { start: "2024-01-01", end: "2024-12-31", val: 2890, frame: "CY2024" },
          ],
        },
      },
      ProfitLoss: {
        units: {
          TWD: [{ start: "2024-01-01", end: "2024-12-31", val: 1170, frame: "CY2024" }],
        },
      },
      DilutedEarningsLossPerShare: {
        units: {
          // The convenience translation the filer also publishes. It must not
          // be read as the reporting currency, or half the statement arrives
          // in one currency and half in another.
          "USD/shares": [
            { start: "2024-01-01", end: "2024-12-31", val: 1.36, frame: "CY2024" },
          ],
          "TWD/shares": [
            { start: "2023-01-01", end: "2023-12-31", val: 32.85, frame: "CY2023" },
            { start: "2024-01-01", end: "2024-12-31", val: 44.67, frame: "CY2024" },
          ],
        },
      },
    },
    dei: {},
  },
};

describe("IFRS filers", () => {
  it("reads the currency the filer actually reports in", () => {
    expect(reportingCurrency(ifrsFacts)).toBe("TWD");
    expect(reportingCurrency(facts)).toBe("USD");
  });

  it("extracts annual IFRS rows in that currency", () => {
    const rows = extractStatements(ifrsFacts);
    const y24 = rows.find((r) => r.periodType === "a" && r.periodEnd === "2024-12-31");
    expect(y24?.metrics.revenue).toBe(2890);
    expect(y24?.metrics.netIncome).toBe(1170);
    // 44.67 (TWD/shares), never 1.36 (the USD convenience figure).
    expect(y24?.metrics.eps).toBe(44.67);
  });
});

describe("epsShareRatio", () => {
  const edgar = extractStatements(ifrsFacts);
  const yahoo = (eps: Record<string, number>) =>
    Object.entries(eps).map(([periodEnd, v]) => ({
      periodEnd,
      periodType: "a",
      eps: v,
    }));

  it("measures the ADS ratio from the periods both sources cover", () => {
    // Yahoo states TSM per ADS: five ordinary shares.
    expect(
      epsShareRatio(edgar, yahoo({ "2023-12-31": 161.7, "2024-12-31": 226.25 })),
    ).toBe(5);
  });

  it("snaps to the exact ratio rather than carrying restatement noise", () => {
    // 226.25/44.67 = 5.065 on its own; the ADS ratio is a whole number.
    expect(epsShareRatio(edgar, yahoo({ "2024-12-31": 226.25 }))).toBe(5);
  });

  it("reads an ordinary-share listing as 1", () => {
    expect(epsShareRatio(edgar, yahoo({ "2024-12-31": 44.67 }))).toBe(1);
  });

  it("matches a fiscal year end a few days off the calendar one", () => {
    expect(epsShareRatio(edgar, yahoo({ "2024-12-28": 223.35 }))).toBe(5);
  });

  it("measures nothing when the periods disagree", () => {
    // Not a share ratio: 2x on one year and 5x on the next is a changed basis.
    expect(
      epsShareRatio(edgar, yahoo({ "2023-12-31": 65.7, "2024-12-31": 223.35 })),
    ).toBeNull();
  });

  it("measures nothing with no overlap at all", () => {
    expect(epsShareRatio(edgar, yahoo({ "2019-12-31": 100 }))).toBeNull();
    expect(epsShareRatio(edgar, [])).toBeNull();
  });

  it("restates only EPS — revenue is a company total, not a per-share figure", () => {
    const scaled = scaleEps(edgar, 5);
    const y24 = scaled.find((r) => r.periodType === "a" && r.periodEnd === "2024-12-31");
    expect(y24?.metrics.eps).toBeCloseTo(223.35, 6);
    expect(y24?.metrics.revenue).toBe(2890);
    // The originals are untouched, so a caller can retry with another ratio.
    expect(
      edgar.find((r) => r.periodType === "a" && r.periodEnd === "2024-12-31")?.metrics.eps,
    ).toBe(44.67);
  });
});
