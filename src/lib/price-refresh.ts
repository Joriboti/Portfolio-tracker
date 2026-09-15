// Runs a price refresh as several small parallel requests instead of one big
// one, so the caller can show "updating 9/17" and paint each row's new price
// the moment its chunk lands. Pure orchestration — the request itself is
// injected — so the chunking, ordering and failure handling are testable.

import type { PriceQuote } from "./api";

export type ChunkResult = {
  quotes: PriceQuote[];
  fxRates?: Record<string, number>;
  unresolved?: Array<{ ticker: string; status: string }>;
};

export type RefreshProgress = {
  done: number;
  total: number;
  /** Quotes that arrived in this chunk (keyed by ticker). */
  quotes: Record<string, PriceQuote>;
  fxRates: Record<string, number>;
};

export type RefreshOutcome = {
  quotes: Record<string, PriceQuote>;
  fxRates: Record<string, number>;
  /** Tickers the server reported as having no market symbol → reason. */
  unavailable: Record<string, string>;
  /** Tickers whose chunk request failed outright. */
  failed: string[];
  errors: string[];
  total: number;
};

export type RunPriceRefreshOptions = {
  tickers: string[];
  fetchChunk: (symbols: string[], opts: { fx: boolean }) => Promise<ChunkResult>;
  onProgress?: (p: RefreshProgress) => void;
  chunkSize?: number;
  concurrency?: number;
};

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runPriceRefresh(opts: RunPriceRefreshOptions): Promise<RefreshOutcome> {
  const tickers = Array.from(new Set(opts.tickers.map((t) => t.trim().toUpperCase()))).filter(
    Boolean,
  );
  const chunks = chunk(tickers, Math.max(1, opts.chunkSize ?? 5));
  const outcome: RefreshOutcome = {
    quotes: {},
    fxRates: {},
    unavailable: {},
    failed: [],
    errors: [],
    total: tickers.length,
  };
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      const symbols = chunks[i];
      const arrived: Record<string, PriceQuote> = {};
      let fx: Record<string, number> = {};
      try {
        // FX rides along with the first chunk only — one write, not one per chunk.
        const r = await opts.fetchChunk(symbols, { fx: i === 0 });
        for (const q of r.quotes) {
          arrived[q.ticker] = q;
          outcome.quotes[q.ticker] = q;
        }
        fx = r.fxRates ?? {};
        Object.assign(outcome.fxRates, fx);
        for (const u of r.unresolved ?? []) outcome.unavailable[u.ticker] = u.status;
      } catch (e) {
        outcome.failed.push(...symbols);
        outcome.errors.push((e as Error).message);
      }
      done += symbols.length;
      opts.onProgress?.({ done, total: tickers.length, quotes: arrived, fxRates: fx });
    }
  };

  const n = Math.max(1, Math.min(opts.concurrency ?? 4, chunks.length));
  await Promise.all(Array.from({ length: n }, worker));
  return outcome;
}
