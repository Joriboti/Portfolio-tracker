import type { VercelRequest, VercelResponse } from "@vercel/node";

// Value-based annual return of the portfolio.
//
// Reconstructs the portfolio's market value (in EUR) at each year boundary
// from the shared `historical_prices` table — for every ticker the user has
// ever held, FX-converted at the historical EUR/USD (etc.) rate stored under
// the pseudo-tickers "EURUSD=X" / "GBPUSD=X" / "CHFUSD=X" — then computes a
// Modified-Dietz return per calendar year that accounts for the buys/sells
// (external cash flows) made during that year.
//
// Read-only. The price history is produced by `api/historical-backfill.ts`
// (which the frontend can trigger). The exact "euros realised per year" and
// the since-inception total live on the frontend (src/lib/performance.ts);
// this endpoint only adds the part that needs server-side price history.
//
// The math is inlined on purpose: importing from `../src/lib/*` at module top
// level triggers FUNCTION_INVOCATION_FAILED at cold start on Vercel — same
// reason analytics.ts inlines its math.

// Storage-key aliasing mirrors prices-update / historical-backfill /
// analytics: `transactions.ticker` keeps the raw broker name ("TESLA"), but
// `historical_prices` stores under the short Yahoo symbol ("TSLA").
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

// Days between two ISO yyyy-mm-dd dates (b − a), via UTC to avoid DST drift.
function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(
    +a.slice(0, 4),
    +a.slice(5, 7) - 1,
    +a.slice(8, 10),
  );
  const tb = Date.UTC(
    +b.slice(0, 4),
    +b.slice(5, 7) - 1,
    +b.slice(8, 10),
  );
  return Math.round((tb - ta) / 86400000);
}

type Point = { weekDate: string; close: number };

// Most recent close in `points` (ascending by weekDate) with weekDate <= d.
// Returns null if the ticker had no price on or before d (i.e. not yet
// trading), so the caller can treat the holding as worth 0 at that date.
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
  buyValue: string | number | null;
  buyDate: string | null;
  sellShares: string | number | null;
  sellPrice: string | number | null;
  sellValue: string | number | null;
  sellDate: string | null;
};

type HistRow = { ticker: string; weekDate: string; close: string | number; currency: string };

type Holding = {
  // chronological buy/sell events for net-share-as-of-date reconstruction
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

    // 1. Transactions → per-ticker holdings timeline + cash flows.
    const txnRows = (await sql`
      SELECT
        ticker, shares,
        buy_value AS "buyValue",
        to_char(buy_date, 'YYYY-MM-DD') AS "buyDate",
        sell_shares AS "sellShares",
        sell_price AS "sellPrice",
        sell_value AS "sellValue",
        to_char(sell_date, 'YYYY-MM-DD') AS "sellDate"
      FROM transactions
      WHERE user_id = ${userId}
    `) as TxnRow[];

    if (txnRows.length === 0) {
      res.status(200).end(JSON.stringify({ ok: true, ready: false, reason: "no transactions" }));
      return;
    }

    const holdings = new Map<string, Holding>();
    const flows: Flow[] = [];
    const ensure = (t: string): Holding => {
      let h = holdings.get(t);
      if (!h) {
        h = { buys: [], sells: [] };
        holdings.set(t, h);
      }
      return h;
    };

    for (const t of txnRows) {
      const ticker = storageKey(t.ticker);
      const shares = toNum(t.shares);
      const buyValue = toNum(t.buyValue);
      const sellShares = toNum(t.sellShares);
      const sellValue = toNum(t.sellValue) || sellShares * toNum(t.sellPrice);

      // Null buy date → held from before the window (parser convention).
      // Null sell date → not yet sold within the window.
      if (shares > 0) {
        const date = t.buyDate ?? "1900-01-01";
        ensure(ticker).buys.push({ date, shares });
        if (buyValue > 0 && t.buyDate) flows.push({ date: t.buyDate, amount: buyValue });
      }
      if (sellShares > 0) {
        const date = t.sellDate ?? "9999-12-31";
        ensure(ticker).sells.push({ date, shares: sellShares });
        if (sellValue > 0 && t.sellDate) flows.push({ date: t.sellDate, amount: -sellValue });
      }
    }

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
      res.status(200).end(JSON.stringify({ ok: true, ready: false, reason: "no price history" }));
      return;
    }

    // Multiplier to convert a value expressed in `ccy` into EUR, as-of `d`.
    // value_EUR = value_native × rate(ccy→USD) / rate(EUR→USD).
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

    // Portfolio market value in EUR as-of date `d`.
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

    // 3. Determine the year range we can cover. We need a price anchor at the
    // prior year-end for V_start, so the first full year is the one whose
    // Jan-1 (= prior Dec-31) sits within price coverage.
    let firstHist = "9999-12-31";
    for (const arr of priceByTicker.values()) {
      if (arr.length > 0 && arr[0].weekDate < firstHist) firstHist = arr[0].weekDate;
    }
    const today = new Date().toISOString().slice(0, 10);
    const currentYear = +today.slice(0, 4);
    const firstHistYear = +firstHist.slice(0, 4);
    // Prior Dec-31 must be >= firstHist, so first reconstructable full year is
    // firstHistYear + 1 (its V_start = Dec-31 of firstHistYear).
    const startYear = firstHistYear + 1;

    type YearResult = {
      year: number;
      startValue: number;
      endValue: number;
      netFlow: number;
      gain: number;
      returnPct: number | null;
      partial: boolean;
    };
    const years: YearResult[] = [];

    for (let y = startYear; y <= currentYear; y++) {
      const yearStart = `${y}-01-01`;
      const priorEnd = `${y - 1}-12-31`;
      const partial = y === currentYear;
      const yearEnd = partial ? today : `${y}-12-31`;

      const startValue = valueAt(priorEnd);
      const endValue = valueAt(yearEnd);

      // Flows strictly inside (yearStart, yearEnd]. Modified-Dietz weights each
      // flow by the fraction of the period remaining after it occurs.
      const T = Math.max(daysBetween(yearStart, yearEnd), 1);
      let netFlow = 0;
      let weighted = 0;
      for (const f of flows) {
        if (f.date < yearStart || f.date > yearEnd) continue;
        netFlow += f.amount;
        const elapsed = Math.min(Math.max(daysBetween(yearStart, f.date), 0), T);
        weighted += f.amount * ((T - elapsed) / T);
      }

      const gain = endValue - startValue - netFlow;
      const denom = startValue + weighted;
      const returnPct = denom > 1 ? gain / denom : null;

      // Skip years with no economic activity and no value at either end
      // (pure pre-history padding).
      if (startValue <= 0 && endValue <= 0 && netFlow === 0) continue;

      years.push({ year: y, startValue, endValue, netFlow, gain, returnPct, partial });
    }

    years.sort((a, b) => b.year - a.year);

    res.status(200).end(
      JSON.stringify({
        ok: true,
        ready: years.length > 0,
        baseCurrency: "EUR",
        firstYear: years.length > 0 ? years[years.length - 1].year : null,
        years,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res.status(500).end(JSON.stringify({ error: err?.message ?? "Performance failed" }));
  }
}
