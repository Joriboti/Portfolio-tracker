import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateCronOrUser } from "./_auth.js";
import {
  SKIP_TICKERS,
  normaliseTicker,
  resolveTickers,
  storageKey,
  type Resolution,
} from "./_ticker-resolve.js";

export const config = { maxDuration: 60 };

// Refreshes current prices (+ FX) from Yahoo Finance. Three ways in:
//
//   • cron (Bearer CRON_SECRET, no user)  → every ticker of every user.
//   • signed-in user, no `symbols`        → that user's tickers.
//   • signed-in user, `?symbols=A,B,C`    → exactly those. The dashboard and
//     the upload flow send their tickers in small chunks, in parallel, so the
//     rows fill in as each chunk lands instead of all at once at the end.
//
// `?mode=resolve` runs only the ticker→symbol resolution (static map →
// Postgres cache → Yahoo search) and reports it, without quoting anything —
// the upload flow's "resolving tickers" phase. `?force=1` re-resolves cached
// tickers. `?fx=1` (or no `symbols`) also refreshes the FX pairs.
//
// Yahoo supports batched quotes, so one chunk costs one Yahoo call plus ONE
// multi-row upsert — not one INSERT per ticker.

// USD per one unit of each currency (Yahoo's CCYUSD=X). The first three are
// the display currencies; the rest are the markets a searched-for ticker can
// land on, so a quote in those can still be brought into the display currency
// instead of showing up unconverted.
const FX_PAIRS = [
  "EUR/USD",
  "GBP/USD",
  "CHF/USD",
  "JPY/USD",
  "CAD/USD",
  "AUD/USD",
  "DKK/USD",
  "SEK/USD",
  "NOK/USD",
  "HKD/USD",
];

// "EUR/USD" -> "EURUSD=X" (Yahoo's FX symbol format).
function fxToYahoo(pair: string): string {
  return pair.replace("/", "") + "=X";
}

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number | null;
  currency?: string | null;
};

// Yahoo's sub-unit currencies (London prices come in GBp = pence, JSE in ZAc
// = cents, Tel Aviv in ILA = agorot) normalised to the major unit so EUR
// conversion downstream stays sane.
const SUB_UNIT_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

function normalizePrice(q: YahooQuote): { price: number; currency: string } | null {
  if (q.regularMarketPrice == null || !Number.isFinite(q.regularMarketPrice)) return null;
  const ccy = q.currency ?? "USD";
  const conv = SUB_UNIT_TO_MAJOR[ccy];
  if (conv) return { price: q.regularMarketPrice / conv.divisor, currency: conv.major };
  return { price: q.regularMarketPrice, currency: ccy };
}

function queryString(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function truthy(v: string | string[] | undefined): boolean {
  const s = queryString(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const startMs = Date.now();

  try {
    res.setHeader("Content-Type", "application/json");

    const caller = await authenticateCronOrUser(req, res);
    if (!caller) return;
    const userId = caller.userId;

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const symbolsParam = queryString(req.query.symbols)
      .split(",")
      .map(normaliseTicker)
      .filter(Boolean);
    const explicit = symbolsParam.length > 0;
    const resolveOnly = queryString(req.query.mode).trim().toLowerCase() === "resolve";
    const force = truthy(req.query.force);
    const includeFx = !resolveOnly && (!explicit || truthy(req.query.fx));

    const dbMod = await import("@neondatabase/serverless");
    const sql = dbMod.neon(dbUrl);

    // yahoo-finance2 v3 exports a class — instantiate per-invocation. The
    // dynamic import keeps cold-start cost off the rest of the API surface.
    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (opts?: {
      suppressNotices?: string[];
    }) => {
      quote: (symbol: string | string[]) => Promise<unknown>;
      search: (
        query: string,
        q?: unknown,
        m?: { validateResult?: boolean },
      ) => Promise<{ quotes?: Array<Record<string, unknown>> }>;
      setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
    };
    const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    yahooFinance.setGlobalConfig?.({ validation: { logErrors: false } });

    // Which tickers.
    let tickers: string[];
    if (explicit) {
      tickers = symbolsParam;
    } else if (userId) {
      const rows = (await sql`
        SELECT DISTINCT ticker FROM transactions WHERE user_id = ${userId}
      `) as Array<{ ticker: string }>;
      tickers = rows.map((r) => normaliseTicker(r.ticker));
    } else {
      // Cron: everyone. Also wipe stale rows for tickers we no longer try to
      // fetch, otherwise an old (and possibly wrong-unit) price keeps
      // surfacing on the dashboard even though we won't refresh it.
      const skipList = Array.from(SKIP_TICKERS);
      await sql`DELETE FROM prices WHERE UPPER(ticker) = ANY(${skipList}::text[])`;
      const rows = (await sql`SELECT DISTINCT ticker FROM transactions`) as Array<{
        ticker: string;
      }>;
      tickers = rows.map((r) => normaliseTicker(r.ticker));
    }
    tickers = Array.from(new Set(tickers)).filter(Boolean);

    const resolution = await resolveTickers(sql, yahooFinance, tickers, { force });
    const resolutionList: Resolution[] = tickers.map(
      (tk) =>
        resolution.get(tk) ?? { ticker: tk, symbol: null, status: "unresolved", name: null },
    );
    const unresolved = resolutionList
      .filter((r) => !r.symbol)
      .map((r) => ({ ticker: r.ticker, status: r.status }));

    if (resolveOnly) {
      res.status(200).end(
        JSON.stringify({
          ok: true,
          resolution: resolutionList,
          unresolved,
          elapsed: `${((Date.now() - startMs) / 1000).toFixed(1)}s`,
        }),
      );
      return;
    }

    // (stored key, yahoo symbol) pairs, deduped by stored key.
    const work: Array<{ stored: string; symbol: string }> = [];
    const seenStored = new Set<string>();
    for (const r of resolutionList) {
      if (!r.symbol) continue;
      const stored = storageKey(r.ticker);
      if (seenStored.has(stored)) continue;
      seenStored.add(stored);
      work.push({ stored, symbol: r.symbol });
    }

    const symbols = work.map((w) => w.symbol);
    const fxSymbols = includeFx ? FX_PAIRS.map(fxToYahoo) : [];

    // Yahoo accepts arrays and returns one quote per symbol. The lib also
    // gracefully handles partial failures.
    const quotesArr: YahooQuote[] = [];
    const fxArr: YahooQuote[] = [];
    const errors: string[] = [];
    const wanted = [...symbols, ...fxSymbols];
    if (wanted.length > 0) {
      try {
        const all = (await yahooFinance.quote(wanted)) as YahooQuote | YahooQuote[];
        const list = Array.isArray(all) ? all : [all];
        const symSet = new Set(symbols);
        const fxSet = new Set(fxSymbols);
        for (const q of list) {
          if (!q?.symbol) continue;
          if (symSet.has(q.symbol)) quotesArr.push(q);
          else if (fxSet.has(q.symbol)) fxArr.push(q);
        }
      } catch (e) {
        // Fall back to per-symbol calls if the batched call fails entirely.
        console.warn("Yahoo batched quote failed, falling back per-symbol", e);
        const single = async (s: string, into: YahooQuote[]) => {
          try {
            into.push((await yahooFinance.quote(s)) as YahooQuote);
          } catch (err) {
            errors.push(`${s}: ${(err as Error).message}`);
          }
        };
        await Promise.all([
          ...symbols.map((s) => single(s, quotesArr)),
          ...fxSymbols.map((s) => single(s, fxArr)),
        ]);
      }
    }

    const bySymbol = new Map(quotesArr.map((q) => [q.symbol, q]));
    const now = new Date().toISOString();

    const priced: Array<{ ticker: string; price: number; currency: string; asOf: string }> = [];
    const skipped: string[] = [];
    for (const { stored, symbol } of work) {
      const q = bySymbol.get(symbol);
      const norm = q ? normalizePrice(q) : null;
      if (!norm) {
        skipped.push(`${stored} (${symbol})`);
        continue;
      }
      priced.push({ ticker: stored, price: norm.price, currency: norm.currency, asOf: now });
    }

    // One statement for the whole chunk.
    let updated = 0;
    if (priced.length > 0) {
      try {
        await sql`
          INSERT INTO prices (ticker, as_of, price, currency, source)
          SELECT t, ${now}::timestamptz, p, c, 'yahoo'
          FROM unnest(
            ${priced.map((r) => r.ticker)}::text[],
            ${priced.map((r) => r.price)}::numeric[],
            ${priced.map((r) => r.currency)}::text[]
          ) AS u(t, p, c)
          ON CONFLICT (ticker, as_of) DO UPDATE
            SET price = EXCLUDED.price,
                currency = EXCLUDED.currency
        `;
        updated = priced.length;
      } catch (e) {
        errors.push(`prices upsert: ${(e as Error).message}`);
      }
    }

    const fxRates: Record<string, number> = {};
    let fxOk = 0;
    if (includeFx) {
      const fxBySymbol = new Map(fxArr.map((q) => [q.symbol, q]));
      const fxRows: Array<{ currency: string; rate: number }> = [];
      for (const pair of FX_PAIRS) {
        const q = fxBySymbol.get(fxToYahoo(pair));
        if (!q || q.regularMarketPrice == null) continue;
        fxRows.push({ currency: pair.split("/")[0], rate: q.regularMarketPrice });
      }
      if (fxRows.length > 0) {
        try {
          await sql`
            INSERT INTO fx_rates (currency, as_of, rate)
            SELECT c, ${now}::timestamptz, r
            FROM unnest(
              ${fxRows.map((r) => r.currency)}::text[],
              ${fxRows.map((r) => r.rate)}::numeric[]
            ) AS u(c, r)
            ON CONFLICT (currency, as_of) DO UPDATE
              SET rate = EXCLUDED.rate
          `;
          fxOk = fxRows.length;
          for (const r of fxRows) fxRates[r.currency] = r.rate;
        } catch (e) {
          errors.push(`fx upsert: ${(e as Error).message}`);
        }
      }
    }

    res.status(200).end(
      JSON.stringify({
        ok: true,
        updated,
        tickers: work.length,
        quotes: priced,
        unresolved,
        skipped,
        fxOk,
        fxRates,
        elapsed: `${((Date.now() - startMs) / 1000).toFixed(1)}s`,
        errors,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res.status(500).end(JSON.stringify({ error: err?.message ?? "Update failed" }));
  }
}
