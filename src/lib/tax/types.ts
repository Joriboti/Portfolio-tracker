// Shared shapes for the multi-country tax engine. Each country module turns a
// TaxInput (derived from the user's book — always EUR for the Spanish book)
// into a TaxReport the wizard can render as "box → amount" cards. Pure data,
// no country logic here.

export type TaxCountry = "es" | "us";

/** One realized disposal, in book currency (EUR). Derived from the Excel row
 *  pairing (each row is a buy lot with its optional sale), which is how the
 *  whole app computes realized P&L — the tax engine stays consistent with it. */
export type SaleEvent = {
  ticker: string;
  sellDate: string | null; // ISO yyyy-mm-dd; null = undated in the source
  shares: number;
  proceeds: number; // what the sale returned, EUR
  cost: number; // FIFO cost basis of the sold shares, EUR
  gain: number; // proceeds − cost (falls back to the Excel "Resultat")
};

export type IncomeEvent = {
  ticker?: string;
  date: string | null;
  amount: number; // EUR
};

/** Answers to the wizard's guided questions (all optional/manual). */
export type EsAnswers = {
  /** Saldos negatius de guanys i pèrdues d'exercicis anteriors pendents. */
  carryLossesGains: number;
  /** Saldo negatiu de rendiments del capital mobiliari pendent. */
  carryLossesRcm: number;
  /** Part bruta dels dividends que ve de valors estrangers. */
  foreignDividendGross: number;
  /** Retencions practicades a l'estranger sobre aquests dividends. */
  foreignWithholding: number;
  /** Retencions espanyoles ja practicades (a compte). */
  spanishWithholding: number;
  assetsAbroadOver50k: boolean;
  cryptoAbroadOver50k: boolean;
};

export type TaxWarningCode =
  | "two-month-rule"
  | "model-720"
  | "model-721"
  | "crypto-regime"
  | "withholding-over-treaty"
  | "undated-events"
  | "no-w8ben-hint";

export type TaxWarning = {
  code: TaxWarningCode;
  /** Tickers or values the warning refers to, for interpolation in the UI. */
  detail?: string;
};

/** One "put this number in this box" line of the final report. */
export type BoxLine = {
  /** Stable key for i18n lookup (taxes.report.lines.<key>). */
  key: string;
  /** Official box number(s), orientative — lives in per-year config. */
  box: string;
  amount: number;
};

export type BracketStep = {
  rate: number;
  /** Portion of the base taxed at this rate. */
  amount: number;
  tax: number;
};

export type EsTaxReport = {
  year: number;
  // Gains & losses on transmissions (base de l'estalvi, G2).
  salesCount: number;
  gainsPositive: number;
  lossesNegative: number; // ≤ 0
  netSales: number;
  // Rendiments del capital mobiliari.
  dividendsTotal: number;
  interestsTotal: number;
  rcmTotal: number;
  // Compensation flow.
  carryLossesApplied: number;
  crossCompensationUsed: number; // losses offset against the other component (25% cap)
  crossCompensationCap: number;
  lossesCarriedForward: number; // remaining to future years (≥ 0)
  // Result.
  savingsBase: number;
  bracketSteps: BracketStep[];
  estimatedQuota: number;
  foreignDeduction: number;
  spanishWithholding: number;
  estimatedBalance: number; // quota − deduction − withholding (orientative)
  lines: BoxLine[];
  warnings: TaxWarning[];
};
