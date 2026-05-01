import type { Transaction, Dividend, Interest, WealthEntry } from "./excel-parser";

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

export function getPrices(tickers: string[]): Promise<{ quotes: PriceQuote[] }> {
  if (tickers.length === 0) return Promise.resolve({ quotes: [] });
  const params = new URLSearchParams({ symbols: tickers.join(",") });
  return jsonFetch(`/api/prices/current?${params.toString()}`);
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
  return jsonFetch("/api/portfolio/import", {
    method: "POST",
    body: JSON.stringify(payload),
    userId,
  });
}

export function getPortfolio(userId: string): Promise<{
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  wealth: WealthEntry[];
  lastPriceUpdate: string | null;
}> {
  return jsonFetch("/api/portfolio", { userId });
}
