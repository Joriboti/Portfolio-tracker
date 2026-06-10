import type { VercelRequest, VercelResponse } from "@vercel/node";

// Weekly portfolio value history since inception.
//
// For every weekly snapshot date in `historical_prices`, reconstructs the
// net shares held per ticker (cumulative buys − sells up to that date — no
// FIFO lot replay needed, quantities only), values each position with the
// most recent close AS OF that date, converts to EUR with the FX rate AS OF
// that date, and pairs it with the net capital contributed up to that date
// (cumulative buy values − cumulative sell proceeds, same definition as the
// dashboard's "Capital aportat (net)" in src/lib/performance.ts).
//
// The final point is valued from the daily `latest_prices` + `fx_rates`
// tables (when available) so it matches the dashboard's live total instead
// of the possibly-week-old Saturday close.
//
// Read-only and additive: no existing endpoint changes. The math is inlined
// on purpose — importing from `../src/lib/*` at module top level triggers
// FUNCTION_INVOCATION_FAILED at cold start on Vercel, same reason
// performance.ts and analytics.ts inline theirs.

// Storage-key aliasing mirrors prices-update / historical-backfill /
// performance: `transactions.ticker` keeps the raw broker name ("TESLA"),
// but `historical_prices` stores under the short Yahoo symbol ("TSLA").
const TICKER_STORAGE_ALIASES: Record<string, string> = {
  TESLA: "TSLA",
  "BANCO SANTANDER": "SAN",
  CAIXABANK: "CABK",
  CAIXABANC: "CABK",
  ENAGAS: "ENG",
  MAPFRE: "MAP",
  GRIFOLS: "GRF",
  REPSOL: "REP",
  "GAS NATURAL": "NGY",
  NATURGY: "NGY",
  ALIBABA: "BABA",
  ALPHABET: "GOOGL",
  AMAZON: "AMZN",
  AMBARELLA: "AMBA",
  APPLE: "AAPL",
  "ASTERA LABS": "ALAB",
  "AURA BIOSCIENCE": "AURA",
  BIOGEN: "BIIB",
  "CATALYST PHARMACEUTICAL": "CPRX",
  "COMCAST CORP": "CMCSA",
  "CONSTELLATION BRANDS": "STZ",
  INTUIT: "INTU",
  "JD.COM": "JD",
  "MARVELL TECHNOLOGY": "MRVL",
  MICRON: "MU",
  "NEBIUS GROUP": "NBIS",
  "NOVO NORDISK": "NVO",
  NVIDIA: "NVDA",
  PEPSICO: "PEP",
  "PLUG POWER": "PLUG",
  "RECURSION PHARMACEUTICAL": "RXRX",
  "REGENERON PHARMACEUTICAL": "REGN",
  RIVIAN: "RIVN",
  "SERVE ROBOTICS": "SERV",
  "SOUNDHOUND AI": "SOUN",
  "TREND MICRO": "TMICY",
  "ZETA GLOBAL": "ZETA",
  "AEDAS HOMES": "AEDAS",
  CELLNEX: "CLNX",
  "PROSEGUR CASH": "CASH",
  LOGISTA: "LOG",
  MELIA: "MEL",
  NEINOR: "HOME",
  "ORYZON GENOMICS": "ORY",
  "PUIG BRANDS": "PUIG",
  SACYR: "SCYR",
  SOLARIA: "SLR",
  SOLTEC: "SOL",
  TUBACEX: "TUB",
  MEDIASET: "TL5",
  "LAR ESPAÑA": "LRE",
  LVMH: "MC",
  NBUS: "NBIS",
  "PHYSICAL PALLADIUM ETF": "PPFA",
};

const EUR_FX = "EURUSD=X";
const FX_SYMBOLS = [EUR_FX, "GBPUSD=X", "CHFUSD=X"];
// currency → the historical_prices pseudo-ticker holding its USD rate.
const CCY_FX_SYMBOL: Record<string, string> = {
  GBP: "GBPUSD=X",
  CHF: "CHFUSD=X",
};

function storageKey(original: string): string {
  const key = original.trim().toUpperCase();
  return TICKER_STORAGE_ALIASES[key] ?? key;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

type Point = { weekDate: string; close: number };

// Most recent close in `points` (ascending by weekDate) with weekDate <= d.
function asOf(points: Point[], d: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].weekDate <= d) {
      ans = points[mid].close;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

type TxnRow = {
  ticker: string;
  shares: string | number;
  buyPrice: string | number | null;
  buyValue: string | number | null;
  buyDate: string | null;
  sellShares: string | number | null;
  sellPrice: string | number | null;
  sellValue: string | number | null;
  sellDate: string | null;
  result: string | number | null;
};

type HistRow = {
  ticker: string;
  weekDate: string;
  close: string | number;
  currency: string;
};

type Holding = {
  buys: Array<{ date: string; shares: number }>;
  sells: Array<{ date: string; shares: number }>;
};

type Flow = { date: string; amount: number }; // +buy / −sell, EUR

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const tableCheck = (await sql`
      SELECT to_regclass('public.historical_prices') AS exists
    `) as Array<{ exists: string | null }>;
    if (!tableCheck[0]?.exists) {
      res.status(200).end(
        JSON.stringify({
          ok: true,
          ready: false,
          reason: "historical_prices table not yet created",
        }),
      );
      return;
    }

    const txnRows = (await sql`
      SELECT
        ticker, shares,
        buy_price AS "buyPrice",
        buy_value AS "buyValue",
        to_char(buy_date, 'YYYY-MM-DD') AS "buyDate",
        sell_shares AS "sellShares",
        sell_price AS "sellPrice",
        sell_value AS "sellValue",
        to_char(sell_date, 'YYYY-MM-DD') AS "sellDate",
        result
      FROM transactions
      WHERE user_id = ${userId}
    `) as TxnRow[];

    if (txnRows.length === 0) {
      res.status(200).end(
        JSON.stringify({ ok: true, ready: false, reason: "no transactions" }),
      );
      return;
    }

    // Dedupe with the same composite key the frontend uses
    // (src/lib/excel-parser.ts dedupeTransactions), so the net-capital series
    // converges to the dashboard's "Capital aportat (net)" figure.
    const seen = new Set<string>();
    const txns: TxnRow[] = [];
    for (const t of txnRows) {
      const key = [
        t.ticker,
        toNum(t.shares),
        t.buyPrice ?? "",
        t.buyValue ?? "",
        t.buyDate ?? "",
        t.sellShares ?? "",
        t.sellPrice ?? "",
        t.sellValue ?? "",
        t.sellDate ?? "",
        t.result ?? "",
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      txns.push(t);
    }

    // 1. Transactions → per-ticker share timeline + dated capital flows.
    const holdings = new Map<string, Holding>();
    const flows: Flow[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const ensure = (t: string): Holding => {
      let h = holdings.get(t);
      if (!h) {
        h = { buys: [], sells: [] };
        holdings.set(t, h);
      }
      return h;
    };

    for (const t of txns) {
      const ticker = storageKey(t.ticker);
      const shares = toNum(t.shares);
      const buyValue = toNum(t.buyValue) || shares * toNum(t.buyPrice);
      const sellShares = toNum(t.sellShares);
      const sellValue = toNum(t.sellValue) || sellShares * toNum(t.sellPrice);

      // Null buy date → held from before the window (parser convention):
      // shares and capital count from the very first point. Null sell date →
      // sale happened but the date is unknown: both the shares and the
      // proceeds land on the LAST point (today), so the final point reflects
      // the truly-open positions and the final net capital equals the
      // dashboard's "Capital aportat (net)" figure. Intermediate points keep
      // the shares — the least-bad assumption without a date.
      if (shares > 0) {
        ensure(ticker).buys.push({ date: t.buyDate ?? "1900-01-01", shares });
        if (buyValue > 0) {
          flows.push({ date: t.buyDate ?? "1900-01-01", amount: buyValue });
        }
      }
      if (sellShares > 0) {
        ensure(ticker).sells.push({
          date: t.sellDate ?? today,
          shares: sellShares,
        });
        if (sellValue > 0) {
          flows.push({ date: t.sellDate ?? today, amount: -sellValue });
        }
      }
    }
    flows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // 2. Historical prices for the held tickers + FX pseudo-tickers.
    const tickerList = [...holdings.keys()];
    const histRows = (await sql`
      SELECT ticker, to_char(week_date, 'YYYY-MM-DD') AS "weekDate", close, currency
      FROM historical_prices
      WHERE ticker = ANY(${[...tickerList, ...FX_SYMBOLS]}::text[])
      ORDER BY ticker, week_date ASC
    `) as HistRow[];

    const priceByTicker = new Map<string, Point[]>();
    const ccyByTicker = new Map<string, string>();
    const fxBySymbol = new Map<string, Point[]>();
    for (const r of histRows) {
      const tk = r.ticker.toUpperCase();
      const pt = { weekDate: r.weekDate, close: toNum(r.close) };
      if (FX_SYMBOLS.includes(tk)) {
        const arr = fxBySymbol.get(tk) ?? [];
        arr.push(pt);
        fxBySymbol.set(tk, arr);
        continue;
      }
      const arr = priceByTicker.get(tk) ?? [];
      arr.push(pt);
      priceByTicker.set(tk, arr);
      if (!ccyByTicker.has(tk)) ccyByTicker.set(tk, (r.currency || "USD").toUpperCase());
    }

    if (priceByTicker.size === 0) {
      res.status(200).end(
        JSON.stringify({ ok: true, ready: false, reason: "no price history" }),
      );
      return;
    }

    // Multiplier to convert a value expressed in `ccy` into EUR, as-of `d`.
    const eurFx = fxBySymbol.get(EUR_FX) ?? [];
    function fxToEUR(ccy: string, d: string): number {
      if (ccy === "EUR") return 1;
      const eurRate = asOf(eurFx, d) ?? eurFx[0]?.close ?? 1.08;
      if (ccy === "USD") return 1 / eurRate;
      const sym = CCY_FX_SYMBOL[ccy];
      const series = sym ? fxBySymbol.get(sym) : undefined;
      const ccyRate = series ? (asOf(series, d) ?? series[0]?.close) : null;
      if (!ccyRate) return 1 / eurRate; // best-effort: treat as USD
      return ccyRate / eurRate;
    }

    function netShares(h: Holding, d: string): number {
      let s = 0;
      for (const b of h.buys) if (b.date <= d) s += b.shares;
      for (const sl of h.sells) if (sl.date <= d) s -= sl.shares;
      return s > 1e-9 ? s : 0;
    }

    // Portfolio market value in EUR as-of date `d`, from weekly history.
    function valueAt(d: string): number {
      let total = 0;
      for (const [ticker, h] of holdings) {
        const sh = netShares(h, d);
        if (sh <= 0) continue;
        const series = priceByTicker.get(ticker);
        if (!series) continue;
        const close = asOf(series, d);
        if (close == null || close <= 0) continue;
        const ccy = ccyByTicker.get(ticker) ?? "USD";
        total += sh * close * fxToEUR(ccy, d);
      }
      return total;
    }

    // 3. Snapshot axis: every distinct weekly date across the held tickers.
    const axisSet = new Set<string>();
    for (const arr of priceByTicker.values()) {
      for (const p of arr) axisSet.add(p.weekDate);
    }
    const axis = [...axisSet].sort();

    // 4. Live valuation for the final point: daily latest prices + FX, so the
    // last point matches the dashboard total. Falls back per-ticker to the
    // weekly close, and entirely to weekly data if these tables are missing.
    let liveValue: number | null = null;
    try {
      const liveRows = (await sql`
        SELECT ticker, price, currency
        FROM latest_prices
        WHERE ticker = ANY(${tickerList}::text[])
      `) as Array<{ ticker: string; price: string | number; currency: string }>;
      const fxRows = (await sql`
        SELECT DISTINCT ON (currency) currency, rate
        FROM fx_rates
        ORDER BY currency, as_of DESC
      `) as Array<{ currency: string; rate: string | number }>;

      const liveByTicker = new Map<string, { price: number; ccy: string }>();
      for (const r of liveRows) {
        const p = toNum(r.price);
        if (p > 0) {
          liveByTicker.set(r.ticker.toUpperCase(), {
            price: p,
            ccy: (r.currency || "USD").toUpperCase(),
          });
        }
      }
      const liveFx: Record<string, number> = {};
      for (const r of fxRows) {
        const n = toNum(r.rate);
        if (n > 0) liveFx[r.currency.toUpperCase()] = n;
      }
      // rate maps are CURRENCY→USD; EUR value = native × rate(ccy) / rate(EUR)
      const eurRate = liveFx["EUR"];
      if (liveByTicker.size > 0 && eurRate) {
        let total = 0;
        for (const [ticker, h] of holdings) {
          const sh = netShares(h, today);
          if (sh <= 0) continue;
          const live = liveByTicker.get(ticker);
          if (live) {
            const ccyRate = live.ccy === "USD" ? 1 : liveFx[live.ccy];
            if (live.ccy === "EUR") {
              total += sh * live.price;
            } else if (ccyRate) {
              total += sh * live.price * (ccyRate / eurRate);
            } else {
              total += sh * live.price * fxToEUR(live.ccy, today);
            }
            continue;
          }
          // No live quote → weekly as-of fallback for this ticker.
          const series = priceByTicker.get(ticker);
          const close = series ? asOf(series, today) : null;
          if (close != null && close > 0) {
            total += sh * close * fxToEUR(ccyByTicker.get(ticker) ?? "USD", today);
          }
        }
        liveValue = total;
      }
    } catch {
      // latest_prices / fx_rates unavailable — weekly closes only.
    }

    // 5. Build the series. Net capital is a running sum over the sorted flows.
    type SeriesPoint = { date: string; value: number; netCapital: number; pnl: number };
    const series: SeriesPoint[] = [];
    let flowIdx = 0;
    let netCapital = 0;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const pushPoint = (d: string, value: number) => {
      while (flowIdx < flows.length && flows[flowIdx].date <= d) {
        netCapital += flows[flowIdx].amount;
        flowIdx++;
      }
      series.push({
        date: d,
        value: round2(value),
        netCapital: round2(netCapital),
        pnl: round2(value - netCapital),
      });
    };

    for (const d of axis) {
      if (d > today) continue;
      const value = valueAt(d);
      // Skip pre-history padding: dates before any capital was deployed and
      // before any position had value.
      const hasFlow = flows.length > 0 && flows[0].date <= d;
      if (value <= 0 && !hasFlow) continue;
      pushPoint(d, value);
    }

    // Final live point (today), only when newer than the last weekly close.
    const lastWeekly = series.length > 0 ? series[series.length - 1].date : null;
    if (liveValue != null && liveValue > 0 && (!lastWeekly || lastWeekly < today)) {
      pushPoint(today, liveValue);
    }

    // Drop leading zero-value points where capital was already deployed but
    // no price history covers it yet (price history is ~3y; the txn log can
    // be older). Showing value 0 against capital > 0 would be misleading —
    // the chart shows the covered range and a "partial history" warning.
    while (series.length > 0 && series[0].value <= 0) series.shift();

    // 6. Coverage warnings, so the frontend can show a notice instead of a
    // silently wrong chart.
    const warnings: string[] = [];
    const holdsNonEUR = [...ccyByTicker.values()].some((c) => c !== "EUR");
    if (holdsNonEUR && eurFx.length === 0) {
      warnings.push("fx-history-missing");
    } else if (
      holdsNonEUR &&
      series.length > 0 &&
      eurFx.length > 0 &&
      eurFx[0].weekDate > series[0].date
    ) {
      warnings.push("fx-history-partial");
    }
    let firstTxnDate: string | null = null;
    for (const f of flows) {
      if (f.date > "1900-01-01") {
        firstTxnDate = f.date;
        break;
      }
    }
    if (firstTxnDate && series.length > 0 && series[0].date > firstTxnDate) {
      // Price history starts after the first transaction → chart shows the
      // available range only.
      warnings.push("price-history-partial");
    }

    const ready = series.length > 1;
    res.status(200).end(
      JSON.stringify({
        ok: true,
        ready,
        ...(ready ? {} : { reason: "not enough price history" }),
        baseCurrency: "EUR",
        firstTxnDate,
        series,
        warnings,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Portfolio history failed" }));
  }
}
