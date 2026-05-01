import type { Transaction, Dividend, Interest, WealthEntry } from "./excel-parser";

export type PriceQuote = {
  ticker: string;
  price: number;
  currency: string;
  asOf: string; // ISO timestamp
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function getPrices(tickers: string[]): Promise<{ quotes: PriceQuote[] }> {
  if (tickers.length === 0) return Promise.resolve({ quotes: [] });
  const params = new URLSearchParams({ symbols: tickers.join(",") });
  return jsonFetch(`/api/prices/current?${params.toString()}`);
}

export function importPortfolio(payload: {
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  wealth: WealthEntry[];
}): Promise<{ ok: true }> {
  return jsonFetch("/api/portfolio/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPortfolio(): Promise<{
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  wealth: WealthEntry[];
  lastPriceUpdate: string | null;
}> {
  return jsonFetch("/api/portfolio");
}
