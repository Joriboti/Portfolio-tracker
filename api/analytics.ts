import type { VercelRequest, VercelResponse } from "@vercel/node";

// Reads the user's open positions + the latest-quote weight derivation +
// the shared `historical_prices` rows for those tickers and the benchmark,
// then runs computeAnalytics() to produce {beta, alpha, etc.}.
//
// This endpoint is read-only. It never writes to the DB. Backfill is a
// separate endpoint (`api/historical-backfill.ts`).
//
// The analytics math is inlined here on purpose: importing from
// `../src/lib/analytics` at module top-level triggers FUNCTION_INVOCATION_FAILED
// at cold start on Vercel (returns HTML, not JSON). The pure-math twin lives
// at src/lib/analytics.ts so the frontend / tests can still use it.

const BENCHMARK_KEY = "^GSPC";
const DEFAULT_RISK_FREE = 0.03;
const MIN_WEEKS = 26;

// Mirror of TICKER_STORAGE_ALIASES from prices-update.ts /
// historical-backfill.ts / dividends-update.ts. `transactions.ticker` keeps
// the raw broker name ("TESLA"), but `historical_prices` and `latest_prices`
// store under the short Yahoo symbol ("TSLA"). The analytics joins by
// ticker, so we must normalize before joining.
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

function storageKey(original: string): string {
  const key = original.trim().toUpperCase();
  return TICKER_STORAGE_ALIASES[key] ?? key;
}

// ---------- inlined pure math (mirror of src/lib/analytics.ts) ----------

type WeeklyPoint = { weekDate: string; close: number };

type AnalyticsMetricsLocal = {
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

type AnalyticsResultLocal = {
  metrics: AnalyticsMetricsLocal | null;
  excludedTickers: string[];
  includedTickers: string[];
  reweightedWeightSum: number;
};

// For each date in `axis` (ascending), return the most recent close in
// `points` (ascending by weekDate) with weekDate <= that axis date. As-of
// alignment lets a mixed portfolio (US Mondays, crypto Sundays, European
// holiday calendars) map onto the benchmark axis without requiring identical
// date strings — a strict intersection collapses to ~0 for such portfolios.
function asOfCloses(axis: string[], points: WeeklyPoint[]): number[] {
  const out: number[] = [];
  let i = 0;
  let last = points.length > 0 ? points[0].close : 0;
  for (const d of axis) {
    while (i < points.length && points[i].weekDate <= d) {
      last = points[i].close;
      i++;
    }
    out.push(last);
  }
  return out;
}

function toReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(curr)) {
      out.push(0);
      continue;
    }
    out.push((curr - prev) / prev);
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return s / (xs.length - 1);
}

function stddev(xs: number[]): number {
  return Math.sqrt(variance(xs));
}

function covariance(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (xs[i] - mx) * (ys[i] - my);
  }
  return s / (xs.length - 1);
}

function correlation(xs: number[], ys: number[]): number {
  const sx = stddev(xs);
  const sy = stddev(ys);
  if (sx === 0 || sy === 0) return 0;
  return covariance(xs, ys) / (sx * sy);
}

function betaCalc(portfolioReturns: number[], marketReturns: number[]): number {
  const varM = variance(marketReturns);
  if (varM === 0) return 0;
  return covariance(portfolioReturns, marketReturns) / varM;
}

function rSquaredCalc(portfolioReturns: number[], marketReturns: number[]): number {
  const r = correlation(portfolioReturns, marketReturns);
  return r * r;
}

function annualizedMean(returns: number[], periodsPerYear = 52): number {
  return mean(returns) * periodsPerYear;
}

function annualizedStddev(returns: number[], periodsPerYear = 52): number {
  return stddev(returns) * Math.sqrt(periodsPerYear);
}

function jensensAlpha(p: {
  portfolioAnnualReturn: number;
  marketAnnualReturn: number;
  beta: number;
  riskFreeRate: number;
}): number {
  const expected = p.riskFreeRate + p.beta * (p.marketAnnualReturn - p.riskFreeRate);
  return p.portfolioAnnualReturn - expected;
}

function sharpeRatio(p: {
  portfolioAnnualReturn: number;
  portfolioAnnualStddev: number;
  riskFreeRate: number;
}): number {
  if (p.portfolioAnnualStddev === 0) return 0;
  return (p.portfolioAnnualReturn - p.riskFreeRate) / p.portfolioAnnualStddev;
}

function maxDrawdownCalc(returns: number[]): number {
  let peak = 1;
  let wealth = 1;
  let maxDD = 0;
  for (const r of returns) {
    wealth *= 1 + r;
    if (wealth > peak) peak = wealth;
    const dd = (peak - wealth) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function weightedPortfolioReturns(
  returnsByTicker: Record<string, number[]>,
  weightByTicker: Record<string, number>,
): number[] {
  const tickers = Object.keys(returnsByTicker);
  if (tickers.length === 0) return [];
  const len = returnsByTicker[tickers[0]].length;
  const out = new Array(len).fill(0);
  for (const ticker of tickers) {
    const w = weightByTicker[ticker] ?? 0;
    if (w === 0) continue;
    const series = returnsByTicker[ticker];
    for (let i = 0; i < len; i++) {
      out[i] += w * series[i];
    }
  }
  return out;
}

function computeAnalytics(input: {
  pricesByTicker: Record<string, WeeklyPoint[]>;
  weightByTicker: Record<string, number>;
  benchmarkKey: string;
  riskFreeRate: number;
  periodsPerYear?: number;
  minWeeks?: number;
}): AnalyticsResultLocal {
  const {
    pricesByTicker,
    weightByTicker,
    benchmarkKey,
    riskFreeRate,
    periodsPerYear = 52,
    minWeeks = 26,
  } = input;

  const benchmarkSeries = pricesByTicker[benchmarkKey];
  if (!benchmarkSeries || benchmarkSeries.length < minWeeks) {
    return { metrics: null, excludedTickers: [], includedTickers: [], reweightedWeightSum: 0 };
  }

  const userTickers = Object.keys(weightByTicker).filter((t) => t !== benchmarkKey);
  const included: string[] = [];
  const excluded: string[] = [];
  for (const t of userTickers) {
    const series = pricesByTicker[t];
    if (series && series.length >= minWeeks) included.push(t);
    else excluded.push(t);
  }

  if (included.length === 0) {
    return { metrics: null, excludedTickers: excluded, includedTickers: [], reweightedWeightSum: 0 };
  }

  let includedWeight = 0;
  for (const t of included) includedWeight += weightByTicker[t] ?? 0;
  const reweighted: Record<string, number> = {};
  if (includedWeight > 0) {
    for (const t of included) reweighted[t] = (weightByTicker[t] ?? 0) / includedWeight;
  }

  // As-of alignment to the benchmark's weekly axis (see asOfCloses). A strict
  // same-date intersection collapses for mixed US/crypto/EU portfolios.
  const sortedByName: Record<string, WeeklyPoint[]> = {};
  sortedByName[benchmarkKey] = [...benchmarkSeries].sort((a, b) =>
    a.weekDate.localeCompare(b.weekDate),
  );
  for (const t of included) {
    sortedByName[t] = [...pricesByTicker[t]].sort((a, b) =>
      a.weekDate.localeCompare(b.weekDate),
    );
  }

  let windowStart = sortedByName[benchmarkKey][0].weekDate;
  for (const t of included) {
    const first = sortedByName[t][0].weekDate;
    if (first > windowStart) windowStart = first;
  }

  const axis = sortedByName[benchmarkKey]
    .map((p) => p.weekDate)
    .filter((d) => d >= windowStart);
  if (axis.length < minWeeks) {
    return { metrics: null, excludedTickers: excluded, includedTickers: [], reweightedWeightSum: 0 };
  }

  const series: Record<string, number[]> = {};
  for (const name of [benchmarkKey, ...included]) {
    series[name] = asOfCloses(axis, sortedByName[name]);
  }

  const returnsByTicker: Record<string, number[]> = {};
  for (const t of included) returnsByTicker[t] = toReturns(series[t]);
  const marketReturns = toReturns(series[benchmarkKey]);
  const portfolioReturns = weightedPortfolioReturns(returnsByTicker, reweighted);

  const b = betaCalc(portfolioReturns, marketReturns);
  const r2 = rSquaredCalc(portfolioReturns, marketReturns);
  const portAnnualReturn = annualizedMean(portfolioReturns, periodsPerYear);
  const marketAnnualReturn = annualizedMean(marketReturns, periodsPerYear);
  const portAnnualStddev = annualizedStddev(portfolioReturns, periodsPerYear);

  const alpha = jensensAlpha({
    portfolioAnnualReturn: portAnnualReturn,
    marketAnnualReturn,
    beta: b,
    riskFreeRate,
  });
  const sharpe = sharpeRatio({
    portfolioAnnualReturn: portAnnualReturn,
    portfolioAnnualStddev: portAnnualStddev,
    riskFreeRate,
  });
  const dd = maxDrawdownCalc(portfolioReturns);

  return {
    metrics: {
      weeks: portfolioReturns.length,
      beta: b,
      alpha,
      sharpe,
      volatility: portAnnualStddev,
      maxDrawdown: dd,
      rSquared: r2,
      portfolioAnnualReturn: portAnnualReturn,
      marketAnnualReturn,
    },
    excludedTickers: excluded,
    includedTickers: included,
    reweightedWeightSum: includedWeight,
  };
}

// ---------- handler ----------

type FxRow = { currency: string; rate: string | number };
type PriceRow = { ticker: string; price: string | number; currency: string };
type TxnRow = {
  ticker: string;
  shares: string | number;
  buyShares: string | number | null;
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
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    // Optional ?rf= query param (e.g. ?rf=0.04 for 4%). Clamped to a sane
    // range so junk input doesn't produce nonsense alpha.
    const rfParam = req.query.rf;
    const rfRaw =
      typeof rfParam === "string"
        ? parseFloat(rfParam)
        : Array.isArray(rfParam) && rfParam[0]
          ? parseFloat(rfParam[0])
          : DEFAULT_RISK_FREE;
    const riskFreeRate =
      Number.isFinite(rfRaw) && rfRaw >= -0.05 && rfRaw <= 0.2
        ? rfRaw
        : DEFAULT_RISK_FREE;

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    // Detect missing table gracefully. If the backfill endpoint has never
    // been called, historical_prices simply won't exist and we want the
    // frontend to see a clear "needs-backfill" state instead of a 500.
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

    // 1. Pull the user's transactions (same shape portfolio-get returns).
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

    // 2. Compute net shares per ticker (same logic as the parser, but
    // simpler: we only need open positions for weight derivation).
    // Tickers are normalized to their storage key here so that "TESLA" and
    // "TSLA" rows in `transactions` aggregate together AND so the downstream
    // joins against `latest_prices` / `historical_prices` find the rows.
    const sharesByTicker = new Map<string, number>();
    for (const t of txnRows) {
      const ticker = storageKey(t.ticker);
      const buyShares = toNum(t.shares);
      const sellShares = toNum(t.sellShares);
      const prev = sharesByTicker.get(ticker) ?? 0;
      sharesByTicker.set(ticker, prev + buyShares - sellShares);
    }
    // Drop closed/zero positions
    const openTickers = [...sharesByTicker.entries()]
      .filter(([, s]) => s > 1e-6)
      .map(([ticker, shares]) => ({ ticker, shares }));

    if (openTickers.length === 0) {
      res
        .status(200)
        .end(JSON.stringify({ ok: true, ready: false, reason: "no positions" }));
      return;
    }

    const tickerList = openTickers.map((p) => p.ticker);

    // 3. Latest quotes for weight derivation
    const priceRows = (await sql`
      SELECT ticker, price, currency
      FROM latest_prices
      WHERE ticker = ANY(${tickerList}::text[])
    `) as PriceRow[];
    const priceByTicker = new Map<
      string,
      { price: number; currency: string }
    >();
    for (const r of priceRows) {
      priceByTicker.set(r.ticker.toUpperCase(), {
        price: toNum(r.price),
        currency: r.currency,
      });
    }

    // FX rates (CURRENCY per 1 USD). Used to normalize position values
    // to EUR so weights are comparable across listing currencies.
    const fxRows = (await sql`
      SELECT DISTINCT ON (currency) currency, rate
      FROM fx_rates
      ORDER BY currency, as_of DESC
    `) as FxRow[];
    const fxRates: Record<string, number> = {};
    for (const r of fxRows) fxRates[r.currency] = toNum(r.rate);

    function toEUR(amount: number, fromCcy: string): number {
      if (fromCcy === "EUR") return amount;
      const rateFrom = fromCcy === "USD" ? 1 : fxRates[fromCcy];
      const rateEUR = fxRates["EUR"];
      if (!rateFrom || !rateEUR) return amount;
      const inUSD = fromCcy === "USD" ? amount : amount * rateFrom;
      return inUSD / rateEUR;
    }

    // 4. Build weights from market value in EUR. Tickers without a quote
    // are weighted by their cost basis (the buyValue sum in EUR) as a
    // best-effort fallback.
    const costByTicker = new Map<string, number>();
    for (const t of txnRows) {
      const ticker = storageKey(t.ticker);
      const cost = toNum(t.buyValue);
      costByTicker.set(ticker, (costByTicker.get(ticker) ?? 0) + cost);
    }

    const valueByTicker = new Map<string, number>();
    for (const { ticker, shares } of openTickers) {
      const q = priceByTicker.get(ticker);
      let value: number;
      if (q && q.price > 0) {
        value = toEUR(q.price * shares, q.currency);
      } else {
        value = costByTicker.get(ticker) ?? 0;
      }
      if (value > 0) valueByTicker.set(ticker, value);
    }

    const totalValue = [...valueByTicker.values()].reduce((s, v) => s + v, 0);
    if (totalValue <= 0) {
      res
        .status(200)
        .end(JSON.stringify({ ok: true, ready: false, reason: "zero value" }));
      return;
    }

    const weightByTicker: Record<string, number> = {};
    for (const [ticker, value] of valueByTicker) {
      weightByTicker[ticker] = value / totalValue;
    }

    // 5. Pull historical prices for all those tickers + the benchmark
    const histTickers = [...Object.keys(weightByTicker), BENCHMARK_KEY];
    const histRows = (await sql`
      SELECT ticker, to_char(week_date, 'YYYY-MM-DD') AS "weekDate", close
      FROM historical_prices
      WHERE ticker = ANY(${histTickers}::text[])
      ORDER BY ticker, week_date ASC
    `) as HistRow[];

    const pricesByTicker: Record<
      string,
      Array<{ weekDate: string; close: number }>
    > = {};
    for (const r of histRows) {
      const t = r.ticker.toUpperCase();
      const arr = pricesByTicker[t] ?? [];
      arr.push({ weekDate: r.weekDate, close: toNum(r.close) });
      pricesByTicker[t] = arr;
    }

    // 6. Run the pure math
    const result = computeAnalytics({
      pricesByTicker,
      weightByTicker,
      benchmarkKey: BENCHMARK_KEY,
      riskFreeRate,
      periodsPerYear: 52,
      minWeeks: MIN_WEEKS,
    });

    res.status(200).end(
      JSON.stringify({
        ok: true,
        ready: result.metrics != null,
        metrics: result.metrics,
        excludedTickers: result.excludedTickers,
        includedTickers: result.includedTickers,
        includedWeight: result.reweightedWeightSum,
        benchmark: BENCHMARK_KEY,
        riskFreeRate,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Analytics failed" }));
  }
}
