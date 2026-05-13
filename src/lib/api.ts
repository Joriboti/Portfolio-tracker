import type { Transaction, Dividend, Interest, WealthEntry, DividendEvent } from "./excel-parser";

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
