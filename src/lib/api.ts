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

export type TickerSearchResult = {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
};

// Ticker autocomplete for the manual "Add holding" form. Served by
// fundamentals-get's `?search=` mode (folded in to stay under the Hobby plan's
// serverless-function limit).
export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const params = new URLSearchParams({ search: q });
  const data = await jsonFetch<{ results: TickerSearchResult[] }>(
    `/api/fundamentals-get?${params.toString()}`,
  );
  return data.results ?? [];
}

// Append a single manually-entered holding to the existing portfolio (does NOT
// replace it — uses portfolio-import's append mode).
export function addHolding(
  userId: string,
  txn: Transaction,
): Promise<{ ok: true; counts?: Record<string, number> }> {
  return jsonFetch("/api/portfolio-import", {
    method: "POST",
    body: JSON.stringify({ transactions: [txn], append: true }),
    userId,
  });
}

// Append several transactions at once (append mode) — used to carry an
// anonymous trial portfolio into a freshly created account on sign-up.
export function appendHoldings(
  userId: string,
  txns: Transaction[],
): Promise<{ ok: true; counts?: Record<string, number> }> {
  return jsonFetch("/api/portfolio-import", {
    method: "POST",
    body: JSON.stringify({ transactions: txns, append: true }),
    userId,
  });
}

export type RenameTickerResult = {
  ok: true;
  from: string;
  to: string;
  renamed: { transactions: number; dividends: number };
};

// Re-point a holding at a different market symbol — the fix for a broker Excel
// that names a company something Yahoo doesn't know. Rewrites the user's own
// rows (transactions, dividends and the saved valuation model); the shared
// price caches are keyed by ticker, so a price + history refresh afterwards
// fills the new symbol in.
export function renameTicker(
  userId: string,
  from: string,
  to: string,
): Promise<RenameTickerResult> {
  return jsonFetch("/api/portfolio-import", {
    method: "POST",
    body: JSON.stringify({ rename: { from, to } }),
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
  /** Company website, used to derive a logo domain on the dashboard. */
  website: string | null;
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

export type LiveCompany = {
  ticker: string;
  price: number | null;
  currency: string | null;
  fundamentals: Fundamentals;
};

// Live full fundamentals + price for an arbitrary symbol (not necessarily in
// the user's portfolio) — powers the "Explore" page's valuation models. Served
// by fundamentals-get's `?quote=` mode (folded in to stay under the Hobby
// plan's serverless-function limit). Returns null when Yahoo has no data.
export async function getLiveCompany(ticker: string): Promise<LiveCompany | null> {
  const q = ticker.trim().toUpperCase();
  if (q.length === 0) return null;
  const params = new URLSearchParams({ quote: q });
  const data = await jsonFetch<{
    company: {
      ticker: string;
      price: unknown;
      currency: string | null;
      fundamentals: Fundamentals;
    } | null;
  }>(`/api/fundamentals-get?${params.toString()}`);
  if (!data.company) return null;
  return {
    ticker: data.company.ticker.toUpperCase(),
    price: num(data.company.price),
    currency: data.company.currency,
    fundamentals: normaliseFundamentals(data.company.fundamentals),
  };
}

// Quarterly/annual statements + panel extras for the company dashboard
// ("Resum" tab on /explore/:ticker). Served by fundamentals-get's
// `?statements=` mode (folded in — 12-function limit). Types live in
// src/lib/statements.ts next to the display math.
export async function getStatements(
  ticker: string,
): Promise<import("./statements").CompanyStatements | null> {
  const q = ticker.trim().toUpperCase();
  if (q.length === 0) return null;
  const params = new URLSearchParams({ statements: q });
  const data = await jsonFetch<
    { ticker: string | null } & import("./statements").CompanyStatements
  >(`/api/fundamentals-get?${params.toString()}`);
  if (!data.ticker) return null;
  return {
    ticker: data.ticker,
    panel: data.panel ?? null,
    prices: data.prices ?? [],
    // Left undefined rather than defaulted to []: for an ADR the two are
    // opposite answers. An empty series says "same currency, nothing to
    // convert"; absent says "these figures cannot be compared to this price
    // yet", and the P/E charts draw nothing rather than a number thirty times
    // out. Older cached payloads carry no `fx` at all, and that is the case
    // this distinction exists for.
    fx: data.fx,
    quarters: data.quarters ?? [],
    annual: data.annual ?? [],
  };
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
  return jsonFetch("/api/fundamentals-get?refresh=1", { method: "GET", userId });
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

export type SotpLiveQuote = {
  ticker: string;
  marketCap: number | null;
  price: number | null;
  currency: string | null;
};

// Live market caps for the Sum-of-the-Parts / NAV valuation. Hits Yahoo
// directly (the stakes aren't in the user's own portfolio), returning one row
// per requested sub-holding ticker; a bad symbol comes back with null figures.
// Served by fundamentals-get's `?live=` mode (folded in to stay under the
// Hobby plan's serverless-function limit).
// No client for `?median=1` any more. The rating charts used to draw the
// median multiple across every company this site covers as a second benchmark;
// they now read each company against its own median and its own mean, which is
// the question those charts are actually asked. The API mode stays — it is one
// branch of an existing function and costs nothing unused.

export async function getSotpQuotes(
  tickers: string[],
): Promise<Record<string, SotpLiveQuote>> {
  const list = tickers.map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return {};
  const params = new URLSearchParams({ live: list.join(",") });
  const data = await jsonFetch<{ quotes: SotpLiveQuote[] }>(
    `/api/fundamentals-get?${params.toString()}`,
  );
  const map: Record<string, SotpLiveQuote> = {};
  for (const q of data.quotes ?? []) {
    map[q.ticker.toUpperCase()] = {
      ...q,
      marketCap: num(q.marketCap),
      price: num(q.price),
    };
  }
  return map;
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

// --- Verified portfolio snapshots -------------------------------------------

export type SnapshotListRow = {
  code: string;
  issuedAt: string;
  tier: "self" | "broker";
  broker: string | null;
  amounts: boolean;
  digest: string;
  revokedAt: string | null;
};

export type FetchedSnapshot = SnapshotListRow & {
  /** The exact string the digest was taken over — re-hashed in the browser. */
  canonical: string;
  digestValid: boolean;
  signatureValid: boolean;
};

/** Issue a signed snapshot. `canonical` must be the string that will be
 *  digested — never a re-serialised copy of it. */
export function createSnapshot(
  userId: string,
  canonical: string,
): Promise<{ code: string; issuedAt: string; digest: string }> {
  return jsonFetch("/api/snapshots?action=create", {
    method: "POST",
    body: JSON.stringify({ canonical }),
    userId,
  });
}

/** Public read for the verify page — deliberately unauthenticated. */
export function getSnapshot(code: string): Promise<FetchedSnapshot> {
  return jsonFetch(`/api/snapshots?code=${encodeURIComponent(code)}`);
}

export function listSnapshots(userId: string): Promise<{ snapshots: SnapshotListRow[] }> {
  return jsonFetch("/api/snapshots", { userId });
}

export function revokeSnapshot(
  userId: string,
  code: string,
): Promise<{ code: string; revokedAt: string }> {
  return jsonFetch("/api/snapshots?action=revoke", {
    method: "POST",
    body: JSON.stringify({ code }),
    userId,
  });
}

// --- Broker-verified snapshots (IBKR Flex) ----------------------------------

export type IbkrPositionPreview = {
  ticker: string;
  symbol: string;
  description: string | null;
  currency: string;
  assetCategory: string | null;
  quantity: number;
  markPrice: number | null;
  value: number | null;
  cost: number | null;
  unrealized: number | null;
};

/** Read the account's open positions so the user can check them before issuing.
 *  The token is sent for this call only — the server never stores it. */
export function fetchIbkrPositions(
  userId: string,
  token: string,
  queryId: string,
): Promise<{ account: string | null; asOf: string | null; positions: IbkrPositionPreview[] }> {
  return jsonFetch("/api/snapshots?action=ibkr-preview", {
    method: "POST",
    body: JSON.stringify({ token, queryId }),
    userId,
  });
}

/** Issue a broker-tier snapshot. The figures are derived server-side from the
 *  broker's own data, so unlike the self tier there is no body to send. */
export function createBrokerSnapshot(
  userId: string,
  token: string,
  queryId: string,
  amounts: boolean,
): Promise<{
  code: string;
  issuedAt: string;
  digest: string;
  canonical: string;
  account: string | null;
  asOf: string | null;
  skipped: string[];
}> {
  return jsonFetch("/api/snapshots?action=broker", {
    method: "POST",
    body: JSON.stringify({ token, queryId, amounts }),
    userId,
  });
}
