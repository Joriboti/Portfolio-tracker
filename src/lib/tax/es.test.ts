import { describe, expect, it } from "vitest";
import type { Transaction } from "../excel-parser";
import {
  computeEsReport,
  detectTwoMonthRule,
  salesFromTransactions,
  savingsQuota,
  isCryptoTicker,
  EMPTY_ES_ANSWERS,
} from "./es";
import { ES_YEARS } from "./es-config";

function txn(over: Partial<Transaction>): Transaction {
  return {
    ticker: "AAPL",
    shares: 10,
    buyPrice: 100,
    buyValue: 1000,
    buyDate: "2024-01-10",
    sellShares: null,
    sellPrice: null,
    sellValue: null,
    sellDate: null,
    result: null,
    portfolio: "test",
    ...over,
  };
}

describe("salesFromTransactions", () => {
  it("derives proceeds, cost and gain from the row pairing", () => {
    const sales = salesFromTransactions([
      txn({ sellShares: 4, sellPrice: 150, sellDate: "2025-03-01" }),
    ]);
    expect(sales).toHaveLength(1);
    expect(sales[0].proceeds).toBe(600);
    expect(sales[0].cost).toBe(400);
    expect(sales[0].gain).toBe(200);
  });

  it("falls back to the Excel Resultat when prices are missing", () => {
    const sales = salesFromTransactions([
      txn({
        buyPrice: null,
        buyValue: null,
        sellShares: 4,
        sellPrice: null,
        sellValue: null,
        result: 123,
        sellDate: "2025-03-01",
      }),
    ]);
    expect(sales[0].gain).toBe(123);
  });

  it("skips rows without a sale", () => {
    expect(salesFromTransactions([txn({})])).toHaveLength(0);
  });
});

describe("savingsQuota", () => {
  const cfg = ES_YEARS[2025];
  it("applies progressive brackets (10.000 € → 1.980 €)", () => {
    const { total, steps } = savingsQuota(10_000, cfg);
    expect(total).toBeCloseTo(6000 * 0.19 + 4000 * 0.21, 2);
    expect(steps).toHaveLength(2);
  });
  it("reaches the 30% top bracket in 2025", () => {
    const { steps } = savingsQuota(350_000, cfg);
    expect(steps.at(-1)?.rate).toBe(0.3);
    expect(steps.at(-1)?.amount).toBeCloseTo(50_000, 2);
  });
  it("2024 keeps the 28% top rate", () => {
    const { steps } = savingsQuota(350_000, ES_YEARS[2024]);
    expect(steps.at(-1)?.rate).toBe(0.28);
  });
  it("zero base → zero quota", () => {
    expect(savingsQuota(0, cfg).total).toBe(0);
  });
});

describe("computeEsReport — compensation flow", () => {
  it("caps cross-compensation of net losses at 25% of RCM", () => {
    const r = computeEsReport({
      year: 2025,
      transactions: [
        // one losing sale: −1.000 €
        txn({ sellShares: 10, sellPrice: 0, sellDate: "2025-05-02", buyDate: "2023-01-05" }),
      ],
      dividends: [{ ticker: "AAPL", amount: 2000, date: "2025-06-01" }],
      interests: [],
      answers: EMPTY_ES_ANSWERS,
    });
    expect(r.netSales).toBe(-1000);
    expect(r.rcmTotal).toBe(2000);
    expect(r.crossCompensationCap).toBeCloseTo(500, 2); // 25% de 2.000
    expect(r.crossCompensationUsed).toBeCloseTo(500, 2);
    expect(r.lossesCarriedForward).toBeCloseTo(500, 2);
    expect(r.savingsBase).toBeCloseTo(1500, 2);
  });

  it("applies prior-year negative balances against their own component first", () => {
    const r = computeEsReport({
      year: 2025,
      transactions: [
        txn({ sellShares: 10, sellPrice: 200, sellDate: "2025-04-01", buyDate: "2022-02-01" }),
      ],
      dividends: [],
      interests: [],
      answers: { ...EMPTY_ES_ANSWERS, carryLossesGains: 400 },
    });
    expect(r.netSales).toBe(1000);
    expect(r.carryLossesApplied).toBe(400);
    expect(r.savingsBase).toBe(600);
  });

  it("ignores events outside the exercise and flags undated ones", () => {
    const r = computeEsReport({
      year: 2025,
      transactions: [
        txn({ sellShares: 5, sellPrice: 200, sellDate: "2024-06-01", buyDate: "2022-02-01" }),
        txn({ sellShares: 5, sellPrice: 200, sellDate: null }),
      ],
      dividends: [{ ticker: "AAPL", amount: 100, date: null }],
      interests: [],
      answers: EMPTY_ES_ANSWERS,
    });
    expect(r.salesCount).toBe(0);
    expect(r.dividendsTotal).toBe(0);
    expect(r.warnings.some((w) => w.code === "undated-events")).toBe(true);
  });
});

describe("computeEsReport — foreign withholding", () => {
  it("caps the deduction at 15% of foreign gross and warns when over-withheld", () => {
    const r = computeEsReport({
      year: 2025,
      transactions: [
        txn({ sellShares: 10, sellPrice: 500, sellDate: "2025-03-01", buyDate: "2022-01-01" }),
      ],
      dividends: [{ ticker: "KO", amount: 1000, date: "2025-02-01" }],
      interests: [],
      answers: {
        ...EMPTY_ES_ANSWERS,
        foreignDividendGross: 1000,
        foreignWithholding: 300, // 30% US sense W-8BEN
      },
    });
    expect(r.foreignDeduction).toBeCloseTo(150, 2);
    expect(r.warnings.some((w) => w.code === "withholding-over-treaty")).toBe(true);
    expect(r.warnings.some((w) => w.code === "no-w8ben-hint")).toBe(true);
  });

  it("never deducts more than the estimated quota", () => {
    const r = computeEsReport({
      year: 2025,
      transactions: [],
      dividends: [{ ticker: "KO", amount: 100, date: "2025-02-01" }],
      interests: [],
      answers: {
        ...EMPTY_ES_ANSWERS,
        foreignDividendGross: 10_000,
        foreignWithholding: 1500,
      },
    });
    expect(r.foreignDeduction).toBeLessThanOrEqual(r.estimatedQuota);
  });
});

describe("detectTwoMonthRule", () => {
  it("flags a losing sale with a repurchase inside the window", () => {
    const txns = [
      txn({ sellShares: 10, sellPrice: 50, sellDate: "2025-03-10", buyDate: "2023-01-01" }),
      txn({ buyDate: "2025-04-01" }), // repurchase 22 days later
    ];
    const flagged = detectTwoMonthRule(
      salesFromTransactions(txns),
      txns,
      2025,
    );
    expect(flagged).toEqual(["AAPL"]);
  });

  it("does not flag when the repurchase is far away or the sale gains", () => {
    const losing = [
      txn({ sellShares: 10, sellPrice: 50, sellDate: "2025-03-10", buyDate: "2023-01-01" }),
      txn({ buyDate: "2025-08-01" }),
    ];
    expect(
      detectTwoMonthRule(salesFromTransactions(losing), losing, 2025),
    ).toEqual([]);
    const winning = [
      txn({ sellShares: 10, sellPrice: 500, sellDate: "2025-03-10", buyDate: "2023-01-01" }),
      txn({ buyDate: "2025-04-01" }),
    ];
    expect(
      detectTwoMonthRule(salesFromTransactions(winning), winning, 2025),
    ).toEqual([]);
  });
});

describe("isCryptoTicker", () => {
  it("detects pair-style and bare crypto tickers", () => {
    expect(isCryptoTicker("BTC-EUR")).toBe(true);
    expect(isCryptoTicker("eth-usd")).toBe(true);
    expect(isCryptoTicker("BTC")).toBe(true);
    expect(isCryptoTicker("AAPL")).toBe(false);
  });
});
