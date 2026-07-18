// Spanish IRPF engine (pure, vitest-covered). Turns the user's book —
// transactions/dividends/interests, all EUR — into an orientative report of
// what goes in each Modelo 100 box for one exercise, plus warnings for the
// special cases people miss (two-month rule, 720/721, over-withheld foreign
// dividends). Informative only, never tax advice; the UI carries the
// disclaimer.

import type { Dividend, Interest, Transaction } from "../excel-parser";
import type {
  EsAnswers,
  EsTaxReport,
  IncomeEvent,
  SaleEvent,
  TaxWarning,
} from "./types";
import { ES_YEARS, type EsYearConfig } from "./es-config";

export const EMPTY_ES_ANSWERS: EsAnswers = {
  carryLossesGains: 0,
  carryLossesRcm: 0,
  foreignDividendGross: 0,
  foreignWithholding: 0,
  spanishWithholding: 0,
  assetsAbroadOver50k: false,
  cryptoAbroadOver50k: false,
};

const yearOf = (iso: string | null): number | null =>
  iso ? Number(iso.slice(0, 4)) : null;

/** BTC-EUR / ETH-USD style pairs (how the app stores crypto) + bare majors. */
const CRYPTO_BARE = new Set(["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE"]);
export function isCryptoTicker(ticker: string): boolean {
  const t = ticker.trim().toUpperCase();
  return /-(USD|EUR)$/.test(t) || CRYPTO_BARE.has(t);
}

/**
 * Realized disposals from the Excel row pairing: each row is a buy lot with an
 * optional sale of part of that lot, so the cost basis of a sale is the row's
 * own buy price — consistent with how the rest of the app books realized P&L.
 * Rows whose prices are missing fall back to the sheet's "Resultat" column.
 */
export function salesFromTransactions(txns: Transaction[]): SaleEvent[] {
  const sales: SaleEvent[] = [];
  for (const t of txns) {
    const shares = t.sellShares ?? 0;
    if (shares <= 0) continue;
    const proceeds =
      t.sellValue ?? (t.sellPrice != null ? shares * t.sellPrice : null);
    const unitCost =
      t.buyPrice ??
      (t.buyValue != null && t.shares > 0 ? t.buyValue / t.shares : null);
    const cost = unitCost != null ? shares * unitCost : null;
    const gain =
      proceeds != null && cost != null ? proceeds - cost : (t.result ?? 0);
    sales.push({
      ticker: t.ticker.trim().toUpperCase(),
      sellDate: t.sellDate,
      shares,
      proceeds: proceeds ?? (cost != null ? cost + gain : gain),
      cost: cost ?? 0,
      gain,
    });
  }
  return sales;
}

export function dividendsToIncome(dividends: Dividend[]): IncomeEvent[] {
  return dividends.map((d) => ({
    ticker: d.ticker.trim().toUpperCase(),
    date: d.date,
    amount: d.amount,
  }));
}

export function interestsToIncome(interests: Interest[]): IncomeEvent[] {
  return interests.map((i) => ({ date: i.date, amount: i.amount }));
}

/** Split events into the ones dated inside the exercise and undated ones. */
export function inExercise<T extends { date?: string | null; sellDate?: string | null }>(
  events: T[],
  year: number,
): { inYear: T[]; undated: T[] } {
  const inYear: T[] = [];
  const undated: T[] = [];
  for (const e of events) {
    const d = "sellDate" in e && e.sellDate !== undefined ? e.sellDate : e.date ?? null;
    const y = yearOf(d ?? null);
    if (y === null) undated.push(e);
    else if (y === year) inYear.push(e);
  }
  return { inYear, undated };
}

const TWO_MONTHS_MS = 62 * 86400 * 1000;

/**
 * Two-month anti-application rule (valors homogenis cotitzats): a loss is not
 * deductible yet when the same security was (re)acquired within two months
 * before or after the losing sale. We flag — never silently exclude — because
 * the actual deferral mechanics (loss surfaces when the repurchased shares are
 * finally sold) are for the user and Renta Web to resolve.
 * Returns the tickers of flagged losing sales.
 */
export function detectTwoMonthRule(
  sales: SaleEvent[],
  allTxns: Transaction[],
  year: number,
): string[] {
  const flagged = new Set<string>();
  for (const s of sales) {
    if (s.gain >= 0 || !s.sellDate) continue;
    if (yearOf(s.sellDate) !== year) continue;
    const sellMs = Date.parse(s.sellDate);
    for (const t of allTxns) {
      if (t.ticker.trim().toUpperCase() !== s.ticker || !t.buyDate) continue;
      const buyMs = Date.parse(t.buyDate);
      if (Number.isNaN(buyMs)) continue;
      const delta = buyMs - sellMs;
      // Any acquisition inside the window other than a lot bought long before.
      if (delta !== 0 && Math.abs(delta) <= TWO_MONTHS_MS) {
        flagged.add(s.ticker);
        break;
      }
    }
  }
  return [...flagged].sort();
}

/** Progressive tax over the savings-base brackets. */
export function savingsQuota(
  base: number,
  config: EsYearConfig,
): { total: number; steps: { rate: number; amount: number; tax: number }[] } {
  const steps: { rate: number; amount: number; tax: number }[] = [];
  let remaining = Math.max(0, base);
  let floor = 0;
  let total = 0;
  for (const { upTo, rate } of config.brackets) {
    if (remaining <= 0) break;
    const span = upTo === null ? remaining : Math.min(remaining, upTo - floor);
    if (span > 0) {
      const tax = span * rate;
      steps.push({ rate, amount: span, tax });
      total += tax;
      remaining -= span;
    }
    if (upTo !== null) floor = upTo;
  }
  return { total, steps };
}

export type EsInput = {
  year: number;
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  answers: EsAnswers;
  /** Sales the user unchecked on the review step (index into year sales). */
  excludedSaleIdx?: Set<number>;
};

export function computeEsReport(input: EsInput): EsTaxReport {
  const config = ES_YEARS[input.year] ?? ES_YEARS[2025];
  const warnings: TaxWarning[] = [];
  const a = input.answers;

  const allSales = salesFromTransactions(input.transactions);
  const { inYear: rawYearSales, undated: undatedSales } = inExercise(
    allSales,
    input.year,
  );
  const yearSales = rawYearSales.filter(
    (_, i) => !input.excludedSaleIdx?.has(i),
  );
  const { inYear: yearDividends, undated: undatedDivs } = inExercise(
    dividendsToIncome(input.dividends),
    input.year,
  );
  const { inYear: yearInterests, undated: undatedInts } = inExercise(
    interestsToIncome(input.interests),
    input.year,
  );

  if (undatedSales.length + undatedDivs.length + undatedInts.length > 0) {
    warnings.push({
      code: "undated-events",
      detail: String(undatedSales.length + undatedDivs.length + undatedInts.length),
    });
  }

  // --- G&P on transmissions ---------------------------------------------
  const gainsPositive = yearSales
    .filter((s) => s.gain > 0)
    .reduce((s, x) => s + x.gain, 0);
  const lossesNegative = yearSales
    .filter((s) => s.gain < 0)
    .reduce((s, x) => s + x.gain, 0);
  const netSales = gainsPositive + lossesNegative;

  // --- RCM ---------------------------------------------------------------
  const dividendsTotal = yearDividends.reduce((s, x) => s + x.amount, 0);
  const interestsTotal = yearInterests.reduce((s, x) => s + x.amount, 0);
  const rcmTotal = dividendsTotal + interestsTotal;

  // --- Compensation flow -------------------------------------------------
  // 1) Prior-year negative balances first, each against its own component.
  const carryGainsApplied = Math.min(
    Math.max(0, netSales),
    Math.max(0, a.carryLossesGains),
  );
  const carryRcmApplied = Math.min(
    Math.max(0, rcmTotal),
    Math.max(0, a.carryLossesRcm),
  );
  const gainsAfterCarry = netSales - carryGainsApplied;
  const rcmAfterCarry = rcmTotal - carryRcmApplied;

  // 2) Cross-compensation, capped at 25% of the positive component.
  let crossUsed = 0;
  let crossCap = 0;
  if (gainsAfterCarry < 0 && rcmAfterCarry > 0) {
    crossCap = rcmAfterCarry * config.crossCompensationCap;
    crossUsed = Math.min(-gainsAfterCarry, crossCap);
  } else if (rcmAfterCarry < 0 && gainsAfterCarry > 0) {
    crossCap = gainsAfterCarry * config.crossCompensationCap;
    crossUsed = Math.min(-rcmAfterCarry, crossCap);
  }

  const negativeComponent = Math.min(0, gainsAfterCarry) + Math.min(0, rcmAfterCarry);
  const lossesCarriedForward = Math.max(0, -negativeComponent - crossUsed);

  const savingsBase =
    Math.max(0, gainsAfterCarry) + Math.max(0, rcmAfterCarry) - crossUsed;

  // --- Quota & deductions -----------------------------------------------
  const { total: estimatedQuota, steps: bracketSteps } = savingsQuota(
    savingsBase,
    config,
  );

  const treatyLimit = a.foreignDividendGross * config.treatyCap;
  const foreignDeduction = Math.min(
    Math.max(0, a.foreignWithholding),
    treatyLimit,
    estimatedQuota,
  );
  if (a.foreignWithholding > treatyLimit + 0.005 && a.foreignDividendGross > 0) {
    warnings.push({
      code: "withholding-over-treaty",
      detail: (a.foreignWithholding - treatyLimit).toFixed(2),
    });
    warnings.push({ code: "no-w8ben-hint" });
  }

  const spanishWithholding = Math.max(0, a.spanishWithholding);
  const estimatedBalance = estimatedQuota - foreignDeduction - spanishWithholding;

  // --- Warnings ----------------------------------------------------------
  const twoMonth = detectTwoMonthRule(allSales, input.transactions, input.year);
  if (twoMonth.length > 0) {
    warnings.push({ code: "two-month-rule", detail: twoMonth.join(", ") });
  }
  if (a.assetsAbroadOver50k) warnings.push({ code: "model-720" });
  if (a.cryptoAbroadOver50k) warnings.push({ code: "model-721" });
  const cryptoTickers = [
    ...new Set(
      yearSales.map((s) => s.ticker).filter(isCryptoTicker),
    ),
  ];
  if (cryptoTickers.length > 0) {
    warnings.push({ code: "crypto-regime", detail: cryptoTickers.join(", ") });
  }

  // --- Box lines ---------------------------------------------------------
  const lines = [
    { key: "interests", box: config.boxes.interests, amount: interestsTotal },
    { key: "dividends", box: config.boxes.dividends, amount: dividendsTotal },
    { key: "salesListed", box: config.boxes.salesListed, amount: netSales },
    {
      key: "foreignDeduction",
      box: config.boxes.foreignDeduction,
      amount: foreignDeduction,
    },
  ].filter((l) => l.amount !== 0 || l.key === "salesListed");

  return {
    year: input.year,
    salesCount: yearSales.length,
    gainsPositive,
    lossesNegative,
    netSales,
    dividendsTotal,
    interestsTotal,
    rcmTotal,
    carryLossesApplied: carryGainsApplied + carryRcmApplied,
    crossCompensationUsed: crossUsed,
    crossCompensationCap: crossCap,
    lossesCarriedForward,
    savingsBase,
    bracketSteps,
    estimatedQuota,
    foreignDeduction,
    spanishWithholding,
    estimatedBalance,
    lines,
    warnings,
  };
}
