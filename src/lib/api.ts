import type { Transaction, Dividend, Interest, WealthEntry, DividendEvent } from "./excel-parser";
import type { ValuationModel } from "./scenarioValuation";

export type PriceQuote = {
  ticker: string;
  price: number;
  currency: string;
  asOf: string;
};

async function jsonFetch<T>(
  url: string,
  init: RequestInit & { userId?: string } = {},
): Promise<T> {
  const { userId, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
      ...(headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `API ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = `${message}: ${data.error}`;
    } catch {
      try {
        const text = await res.text();
        if (text) message = `${message}: ${text.slice(0, 200)}`;
      } catch {
        /* ignore */
      }
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// Postgres NUMERIC values come back as strings from the Neon HTTP driver.
// We coerce them here so downstream math doesn't accidentally do string
// concatenation and produce NaN.
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function numReq(v: unknown): number {
  return num(v) ?? 0;
}

function normaliseTransaction(t: Transaction): Transaction {
  return {
    ...t,
    shares: numReq(t.shares),
    buyPrice: num(t.buyPrice),
    buyValue: num(t.buyValue),
    sellShares: num(t.sellShares),
    sellPrice: num(t.sellPrice),
    sellValue: num(t.sellValue),
    result: num(t.result),
  };
}

function normaliseDividend(d: Dividend): Dividend {
  return { ...d, amount: numReq(d.amount) };
}

function normaliseInterest(i: Interest): Interest {
  return { ...i, amount: numReq(i.amount) };
}

function normaliseWealth(w: WealthEntry): WealthEntry {
  return { ...w, value: numReq(w.value) };
}

function normaliseQuote(q: PriceQuote): PriceQuote {
  return { ...q, price: numReq(q.price) };
}

function normaliseDividendEvent(e: DividendEvent): DividendEvent {
  return { ...e, amount: numReq(e.amount) };
}

export async function getPrices(
  tickers: string[],
): Promise<{ quotes: PriceQuote[]; fxRates: Record<string, number> }> {
  if (tickers.length === 0) return { quotes: [], fxRates: {} };
  const params = new URLSearchParams({ symbols: tickers.join(",") });
  const data = await jsonFetch<{
    quotes: PriceQuote[];
    fxRates?: Record<string, number>;
  }>(`/api/prices-current?${params.toString()}`);
  return {
    quotes: data.quotes.map(normaliseQuote),
    fxRates: data.fxRates ?? {},
  };
}

export function importPortfolio(
  userId: string,
  payload: {
    transactions: Transaction[];
    dividends: Dividend[];
    interests: Interest[];
    wealth: WealthEntry[];
  },
): Promise<{ ok: true; counts?: Record<string, number> }> {
  return jsonFetch("/api/portfolio-import", {
    method: "POST",
    body: JSON.stringify(payload),
    userId,
  });
}

export async function getPortfolio(userId: string): Promise<{
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  wealth: WealthEntry[];
  dividendEvents: DividendEvent[];
  lastPriceUpdate: string | null;
}> {
  const data = await jsonFetch<{
    transactions: Transaction[];
    dividends: Dividend[];
    interests: Interest[];
    wealth: WealthEntry[];
    dividendEvents: DividendEvent[];
    lastPriceUpdate: string | null;
  }>("/api/portfolio-get", { userId });
  return {
    transactions: (data.transactions ?? []).map(normaliseTransaction),
    dividends: (data.dividends ?? []).map(normaliseDividend),
    interests: (data.interests ?? []).map(normaliseInterest),
    wealth: (data.wealth ?? []).map(normaliseWealth),
    dividendEvents: (data.dividendEvents ?? []).map(normaliseDividendEvent),
    lastPriceUpdate: data.lastPriceUpdate,
  };
}

export type RefreshPricesResult = {
  ok: boolean;
  updated: number;
  tickers: number;
  fxOk: number;
  skipped?: string[];
  errors?: string[];
  elapsed?: string;
};

// Manual trigger of the price-update endpoint. Yahoo Finance has no
// effective rate limit on the unofficial endpoints used by yahoo-finance2,
// so a single invocation refreshes everything in one shot.
export function refreshPrices(userId: string): Promise<RefreshPricesResult> {
  return jsonFetch("/api/prices-update", { method: "GET", userId });
}

export function refreshDividends(
  userId: string,
): Promise<{ ok: boolean; tickersWithDividends?: number; totalEvents?: number }> {
  return jsonFetch("/api/dividends-update", { method: "GET", userId });
}

export type AnalyticsMetrics = {
  weeks: number;
  beta: number;
  alpha: number;
  sharpe: number;
  volatility: number;
  maxDrawdown: number;
  rSquared: number;
  portfolioAnnualReturn: number;
  marketAnnualReturn: number;
};

export type AnalyticsResponse = {
  ok: boolean;
  ready: boolean;
  metrics?: AnalyticsMetrics | null;
  excludedTickers?: string[];
  includedTickers?: string[];
  includedWeight?: number;
  benchmark?: string;
  riskFreeRate?: number;
  reason?: string;
};

export function getAnalytics(
  userId: string,
  riskFreeRate?: number,
): Promise<AnalyticsResponse> {
  const qs =
    riskFreeRate != null && Number.isFinite(riskFreeRate)
      ? `?rf=${encodeURIComponent(String(riskFreeRate))}`
      : "";
  return jsonFetch<AnalyticsResponse>(`/api/analytics${qs}`, { userId });
}

export function refreshHistoricalPrices(
  userId: string,
): Promise<{ ok: boolean; tickersDone?: number; totalRows?: number; elapsed?: string }> {
  return jsonFetch("/api/historical-backfill", { method: "GET", userId });
}

export type YearReturn = {
  year: number;
  startValue: number;
  endValue: number;
  netFlow: number;
  gain: number;
  returnPct: number | null;
  partial: boolean;
};

export type PerformanceResponse = {
  ok: boolean;
  ready: boolean;
  reason?: string;
  baseCurrency?: string;
  firstYear?: number | null;
  years?: YearReturn[];
};

// Value-based annual return (Modified Dietz), reconstructed server-side from
// the historical price + FX tables. Complements the exact euros-realised
// figures computed on the frontend (src/lib/performance.ts).
export function getPerformance(userId: string): Promise<PerformanceResponse> {
  return jsonFetch<PerformanceResponse>("/api/performance", { userId });
}

export type HistoryPoint = {
  date: string; // yyyy-mm-dd
  value: number; // portfolio market value, EUR
  netCapital: number; // cumulative buys − sells up to date, EUR
  pnl: number; // value − netCapital
};

export type PortfolioHistoryResponse = {
  ok: boolean;
  ready: boolean;
  reason?: string;
  baseCurrency?: string;
  firstTxnDate?: string | null;
  series?: HistoryPoint[];
  // S&P 500 path scaled to the initial net capital, for visual comparison.
  benchmark?: Array<{ date: string; value: number }> | null;
  warnings?: string[];
};

// Weekly portfolio value vs. net contributed capital since inception,
// reconstructed server-side from historical prices + FX (as-of alignment).
export function getPortfolioHistory(
  userId: string,
): Promise<PortfolioHistoryResponse> {
  return jsonFetch<PortfolioHistoryResponse>("/api/portfolio-history", { userId });
}

export type Fundamentals = {
  ticker: string;
  trailingPe: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  roe: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  marketCap: number | null;
  eps: number | null;
  forwardEps: number | null;
  // DCF inputs (quote/financial currency, absolute values). Captured from
  // Yahoo financialData / defaultKeyStatistics; null when not reported.
  freeCashflow: number | null;
  sharesOutstanding: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  updatedAt: string | null;
};

function normaliseFundamentals(f: Fundamentals): Fundamentals {
  return {
    ...f,
    ticker: f.ticker.toUpperCase(),
    trailingPe: num(f.trailingPe),
    forwardPe: num(f.forwardPe),
    priceToBook: num(f.priceToBook),
    roe: num(f.roe),
    profitMargin: num(f.profitMargin),
    debtToEquity: num(f.debtToEquity),
    dividendYield: num(f.dividendYield),
    marketCap: num(f.marketCap),
    eps: num(f.eps),
    forwardEps: num(f.forwardEps),
    freeCashflow: num(f.freeCashflow),
    sharesOutstanding: num(f.sharesOutstanding),
    totalDebt: num(f.totalDebt),
    totalCash: num(f.totalCash),
  };
}

// Cached per-company fundamentals (PER, P/B, ROE, …) for the given position
// tickers. Empty when the fundamentals table hasn't been filled yet.
export async function getFundamentals(
  tickers: string[],
): Promise<Record<string, Fundamentals>> {
  if (tickers.length === 0) return {};
  const params = new URLSearchParams({ tickers: tickers.join(",") });
  const data = await jsonFetch<{ fundamentals: Fundamentals[] }>(
    `/api/fundamentals-get?${params.toString()}`,
  );
  const map: Record<string, Fundamentals> = {};
  for (const f of data.fundamentals ?? []) {
    const n = normaliseFundamentals(f);
    map[n.ticker] = n;
  }
  return map;
}

export type FundamentalsRefreshResult = {
  ok: boolean;
  tickers?: number;
  refreshed?: number;
  errors?: string[];
  exhausted?: boolean;
  elapsed?: string;
};

// Manual trigger of the fundamentals refresh. Serial with per-ticker delay,
// time-budgeted server-side: if the portfolio is large, call again to
// continue (stale-first ordering makes repeated calls converge).
export function refreshFundamentals(
  userId: string,
): Promise<FundamentalsRefreshResult> {
  return jsonFetch("/api/fundamentals-refresh", { method: "GET", userId });
}

// Load the saved scenario valuation model for one holding, or null when the
// user hasn't created one yet.
export async function getScenarioModel(
  userId: string,
  ticker: string,
): Promise<ValuationModel | null> {
  const params = new URLSearchParams({ ticker });
  const data = await jsonFetch<{ model: ValuationModel | null }>(
    `/api/scenarios?${params.toString()}`,
    { userId },
  );
  return data.model ?? null;
}

// Upsert the scenario valuation model for one holding (debounced autosave).
export function saveScenarioModel(
  userId: string,
  ticker: string,
  model: ValuationModel,
): Promise<{ ok: boolean }> {
  return jsonFetch("/api/scenarios", {
    method: "PUT",
    body: JSON.stringify({ ticker, model }),
    userId,
  });
}
