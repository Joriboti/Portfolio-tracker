import { describe, expect, it } from "vitest";
import { chunk, runPriceRefresh, type ChunkResult } from "./price-refresh";
import type { PriceQuote } from "./api";

const q = (ticker: string, price = 1): PriceQuote => ({
  ticker,
  price,
  currency: "EUR",
  asOf: "2026-09-15T00:00:00Z",
});

describe("chunk", () => {
  it("splits evenly with a remainder", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("runPriceRefresh", () => {
  it("reports progress per chunk and merges the quotes", async () => {
    const calls: Array<{ symbols: string[]; fx: boolean }> = [];
    const progress: Array<{ done: number; total: number; keys: string[] }> = [];
    const out = await runPriceRefresh({
      tickers: ["a", "B", "c", "d", "e"],
      chunkSize: 2,
      concurrency: 1,
      fetchChunk: async (symbols, { fx }) => {
        calls.push({ symbols, fx });
        return { quotes: symbols.map((s) => q(s)) };
      },
      onProgress: (p) => progress.push({ done: p.done, total: p.total, keys: Object.keys(p.quotes) }),
    });
    expect(calls.map((c) => c.symbols)).toEqual([["A", "B"], ["C", "D"], ["E"]]);
    expect(calls.map((c) => c.fx)).toEqual([true, false, false]);
    expect(progress).toEqual([
      { done: 2, total: 5, keys: ["A", "B"] },
      { done: 4, total: 5, keys: ["C", "D"] },
      { done: 5, total: 5, keys: ["E"] },
    ]);
    expect(Object.keys(out.quotes).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(out.failed).toEqual([]);
  });

  it("runs chunks in parallel up to the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPriceRefresh({
      tickers: ["a", "b", "c", "d", "e", "f"],
      chunkSize: 1,
      concurrency: 3,
      fetchChunk: async (symbols) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { quotes: symbols.map((s) => q(s)) };
      },
    });
    expect(peak).toBe(3);
  });

  it("keeps going after a failed chunk and names its tickers", async () => {
    const out = await runPriceRefresh({
      tickers: ["a", "b", "c", "d"],
      chunkSize: 2,
      concurrency: 1,
      fetchChunk: async (symbols): Promise<ChunkResult> => {
        if (symbols[0] === "A") throw new Error("network");
        return { quotes: symbols.map((s) => q(s)) };
      },
    });
    expect(out.failed).toEqual(["A", "B"]);
    expect(out.errors).toEqual(["network"]);
    expect(Object.keys(out.quotes)).toEqual(["C", "D"]);
  });

  it("collects unavailable tickers and FX from the responses", async () => {
    const out = await runPriceRefresh({
      tickers: ["a", "zzz"],
      chunkSize: 5,
      fetchChunk: async () => ({
        quotes: [q("A")],
        fxRates: { EUR: 1.1 },
        unresolved: [{ ticker: "ZZZ", status: "unresolved" }],
      }),
    });
    expect(out.unavailable).toEqual({ ZZZ: "unresolved" });
    expect(out.fxRates).toEqual({ EUR: 1.1 });
    expect(out.total).toBe(2);
  });

  it("handles an empty list without calling anything", async () => {
    let called = 0;
    const out = await runPriceRefresh({
      tickers: [],
      fetchChunk: async () => ((called++), { quotes: [] }),
    });
    expect(called).toBe(0);
    expect(out.total).toBe(0);
  });
});
