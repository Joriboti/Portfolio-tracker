import type { VercelRequest, VercelResponse } from "@vercel/node";

// Refreshes the `fundamentals` table (one row per held ticker) from Yahoo's
// quoteSummary. Called two ways:
//   (a) manually from the dashboard button, and
//   (b) at the end of the weekly historical-backfill cron (see
//       api/historical-backfill.ts), wrapped in try/catch so a fundamentals
//       failure never breaks the price backfill.
//
// Yahoo quoteSummary is fetched IN SERIES with a delay between tickers (it
// rate-limits aggressive parallel use), oldest-updated first, and stops
// before the serverless time budget runs out — the next invocation (next
// click or next weekly cron) continues where it left off. Every field can be
// null/undefined; rows are written with whatever came back.

export const config = { maxDuration: 60 };

// Time budget: leave headroom inside maxDuration for the DB writes + response.
const TIME_BUDGET_MS = 50_000;
const DELAY_BETWEEN_TICKERS_MS = 400;

// transactions.ticker (raw broker name) → Yahoo symbol. Kept in sync manually
// with prices-update / historical-backfill, same additive convention.
const TICKER_MAP: Record<string, string> = {
  TESLA: "TSLA",
  ABERCROMBIE: "ANF",
  PINDUODUO: "PDD",
  SABADELL: "SAB.MC",
  IAG: "IAG.MC",
  BBVA: "BBVA.MC",
  SANTANDER: "SAN.MC",
  TELEFONICA: "TEF.MC",
  INDITEX: "ITX.MC",
  REPSOL: "REP.MC",
  CAIXABANK: "CABK.MC",
  CAIXABANC: "CABK.MC",
  IBERDROLA: "IBE.MC",
  ENDESA: "ELE.MC",
  AMADEUS: "AMS.MC",
  CELLNEX: "CLNX.MC",
  MAPFRE: "MAP.MC",
  BANKINTER: "BKT.MC",
  FERROVIAL: "FER.MC",
  ACS: "ACS.MC",
  GRIFOLS: "GRF.MC",
  NATURGY: "NTGY.MC",
  COLONIAL: "COL.MC",
  ACCIONA: "ANA.MC",
  NBUS: "NBIS",
  PALLADIUM: "SPDM.MI",
  "PHYSICAL PALLADIUM ETF": "SPDM.MI",
  "BANCO SANTANDER": "SAN.MC",
  ENAGAS: "ENG.MC",
  "GAS NATURAL": "NTGY.MC",
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
  "AEDAS HOMES": "AEDAS.MC",
  "PROSEGUR CASH": "CASH.MC",
  LOGISTA: "LOG.MC",
  MELIA: "MEL.MC",
  NEINOR: "HOME.MC",
  "ORYZON GENOMICS": "ORY.MC",
  "PUIG BRANDS": "PUIG.MC",
  SACYR: "SCYR.MC",
  SOLARIA: "SLR.MC",
  SOLTEC: "SOL.MC",
  TUBACEX: "TUB.MC",
  MEDIASET: "TL5.MC",
  "LAR ESPAÑA": "LRE.MC",
  LVMH: "MC.PA",
  SAN: "SAN.MC",
  CABK: "CABK.MC",
  ENG: "ENG.MC",
  MAP: "MAP.MC",
  GRF: "GRF.MC",
  REP: "REP.MC",
  NGY: "NTGY.MC",
  CLNX: "CLNX.MC",
  AEDAS: "AEDAS.MC",
  CASH: "CASH.MC",
  LOG: "LOG.MC",
  MEL: "MEL.MC",
  HOME: "HOME.MC",
  ORY: "ORY.MC",
  PUIG: "PUIG.MC",
  SCYR: "SCYR.MC",
  SLR: "SLR.MC",
  TUB: "TUB.MC",
  TL5: "TL5.MC",
  LRE: "LRE.MC",
  MC: "MC.PA",
  IBE: "IBE.MC",
  ELE: "ELE.MC",
  AMS: "AMS.MC",
  BKT: "BKT.MC",
  FER: "FER.MC",
  COL: "COL.MC",
  ANA: "ANA.MC",
  SAB: "SAB.MC",
  TEF: "TEF.MC",
  ITX: "ITX.MC",
  BME: "BME.MC",
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  ADA: "ADA-USD",
  SOL: "SOL-USD",
  DOT: "DOT-USD",
  NBIS: "NBIS",
};

const SKIP_TICKERS = new Set<string>([
  "GOLD",
  "SILVER",
  "PLATINUM",
  "ETF IBEX",
  "ETF IBEX INVERSA",
  "FONS DE PENSIONS",
  "LYXOR VIX",
  "LYXOR DOBLE SHORT",
  "ABE",
  "LDK",
  "IBR",
]);

// Crypto pseudo-tickers have no earnings/fundamentals — skip the Yahoo call
// entirely but still write a row (sector "Crypto") so the UI can group them.
const CRYPTO_TICKERS = new Set<string>(["BTC", "ETH", "ADA", "SOL", "DOT"]);

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

function mapTicker(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  if (SKIP_TICKERS.has(key)) return null;
  return TICKER_MAP[key] ?? key;
}

function storageKey(original: string): string {
  const key = original.trim().toUpperCase();
  return TICKER_STORAGE_ALIASES[key] ?? key;
}

// Yahoo numbers sometimes arrive as {raw: n} wrappers depending on module —
// yahoo-finance2 usually unwraps, but be defensive. null/undefined → null.
function pickNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    return pickNum((v as Record<string, unknown>).raw);
  }
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

type QuoteSummaryShape = {
  summaryDetail?: Record<string, unknown>;
  defaultKeyStatistics?: Record<string, unknown>;
  financialData?: Record<string, unknown>;
  assetProfile?: Record<string, unknown>;
  price?: Record<string, unknown>;
};

type YahooClient = {
  quoteSummary: (
    symbol: string,
    opts: { modules: string[] },
  ) => Promise<QuoteSummaryShape>;
  setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SqlClient = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<unknown>;

export async function ensureFundamentalsTable(sql: SqlClient): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS fundamentals (
      ticker          TEXT PRIMARY KEY,
      trailing_pe     NUMERIC(14, 4),
      forward_pe      NUMERIC(14, 4),
      price_to_book   NUMERIC(14, 4),
      roe             NUMERIC(14, 6),
      profit_margin   NUMERIC(14, 6),
      debt_to_equity  NUMERIC(14, 4),
      dividend_yield  NUMERIC(14, 6),
      market_cap      NUMERIC(24, 0),
      eps             NUMERIC(14, 4),
      sector          TEXT,
      industry        TEXT,
      currency        TEXT,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export type FundamentalsRefreshStats = {
  tickers: number;
  refreshed: number;
  skipped: string[];
  errors: string[];
  exhausted: boolean; // true = stopped on time budget, more pending
};

// Serial refresh with per-ticker isolation: one bad ticker (delisted,
// invented, Yahoo hiccup) is recorded in `errors` and the loop continues.
export async function refreshFundamentals(
  sql: SqlClient,
  yahoo: YahooClient,
  deadlineMs: number,
): Promise<FundamentalsRefreshStats> {
  await ensureFundamentalsTable(sql);

  const rows = (await sql`
    SELECT DISTINCT ticker FROM transactions
  `) as Array<{ ticker: string }>;

  // original broker name → (stored key, yahoo symbol), deduped by stored key.
  const work = new Map<string, { yahoo: string; crypto: boolean }>();
  for (const row of rows) {
    const mapped = mapTicker(row.ticker);
    if (!mapped) continue;
    const stored = storageKey(row.ticker);
    if (!work.has(stored)) {
      work.set(stored, {
        yahoo: mapped,
        crypto: CRYPTO_TICKERS.has(stored),
      });
    }
  }

  // Stale-first: tickers with no row yet, then oldest updated_at. This makes
  // repeated invocations converge even when one run can't cover everything.
  const updatedAt = new Map<string, string>();
  try {
    const existing = (await sql`
      SELECT ticker, updated_at AS "updatedAt" FROM fundamentals
    `) as Array<{ ticker: string; updatedAt: string }>;
    for (const r of existing) updatedAt.set(r.ticker.toUpperCase(), r.updatedAt);
  } catch {
    /* table just created — everything is stale */
  }
  const queue = [...work.entries()].sort((a, b) => {
    const ua = updatedAt.get(a[0]) ?? "";
    const ub = updatedAt.get(b[0]) ?? "";
    return ua < ub ? -1 : ua > ub ? 1 : 0;
  });

  const stats: FundamentalsRefreshStats = {
    tickers: queue.length,
    refreshed: 0,
    skipped: [],
    errors: [],
    exhausted: false,
  };

  for (const [stored, info] of queue) {
    if (Date.now() > deadlineMs) {
      stats.exhausted = true;
      break;
    }
    try {
      if (info.crypto) {
        // No fundamentals to fetch; keep a typed row so sector grouping works.
        await sql`
          INSERT INTO fundamentals (ticker, sector, updated_at)
          VALUES (${stored}, 'Crypto', NOW())
          ON CONFLICT (ticker) DO UPDATE
            SET sector = 'Crypto', updated_at = NOW()
        `;
        stats.refreshed++;
        continue;
      }

      const qs = await yahoo.quoteSummary(info.yahoo, {
        modules: [
          "summaryDetail",
          "defaultKeyStatistics",
          "financialData",
          "assetProfile",
        ],
      });

      const sd = qs.summaryDetail ?? {};
      const ks = qs.defaultKeyStatistics ?? {};
      const fd = qs.financialData ?? {};
      const ap = qs.assetProfile ?? {};

      const trailingPe = pickNum(sd.trailingPE) ?? pickNum(ks.trailingPE);
      const forwardPe = pickNum(sd.forwardPE) ?? pickNum(ks.forwardPE);
      const priceToBook = pickNum(ks.priceToBook);
      const roe = pickNum(fd.returnOnEquity);
      const profitMargin = pickNum(fd.profitMargins) ?? pickNum(ks.profitMargins);
      const debtToEquity = pickNum(fd.debtToEquity);
      const dividendYield = pickNum(sd.dividendYield);
      const marketCap = pickNum(sd.marketCap) ?? pickNum(fd.marketCap);
      const eps = pickNum(ks.trailingEps);
      const sector = pickStr(ap.sector);
      const industry = pickStr(ap.industry);
      const currency = pickStr(fd.financialCurrency) ?? pickStr(sd.currency);

      await sql`
        INSERT INTO fundamentals (
          ticker, trailing_pe, forward_pe, price_to_book, roe, profit_margin,
          debt_to_equity, dividend_yield, market_cap, eps, sector, industry,
          currency, updated_at
        ) VALUES (
          ${stored}, ${trailingPe}, ${forwardPe}, ${priceToBook}, ${roe},
          ${profitMargin}, ${debtToEquity}, ${dividendYield}, ${marketCap},
          ${eps}, ${sector}, ${industry}, ${currency}, NOW()
        )
        ON CONFLICT (ticker) DO UPDATE SET
          trailing_pe = EXCLUDED.trailing_pe,
          forward_pe = EXCLUDED.forward_pe,
          price_to_book = EXCLUDED.price_to_book,
          roe = EXCLUDED.roe,
          profit_margin = EXCLUDED.profit_margin,
          debt_to_equity = EXCLUDED.debt_to_equity,
          dividend_yield = EXCLUDED.dividend_yield,
          market_cap = EXCLUDED.market_cap,
          eps = EXCLUDED.eps,
          sector = EXCLUDED.sector,
          industry = EXCLUDED.industry,
          currency = EXCLUDED.currency,
          updated_at = NOW()
      `;
      stats.refreshed++;
    } catch (e) {
      stats.errors.push(`${stored}: ${(e as Error).message}`);
    }
    await sleep(DELAY_BETWEEN_TICKERS_MS);
  }

  return stats;
}

export async function makeYahooClient(): Promise<YahooClient> {
  const yfMod = await import("yahoo-finance2");
  const YahooFinance = yfMod.default as unknown as new (opts?: {
    suppressNotices?: string[];
  }) => YahooClient;
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  yahoo.setGlobalConfig?.({ validation: { logErrors: false } });
  return yahoo;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startMs = Date.now();
  try {
    res.setHeader("Content-Type", "application/json");

    const cronSecret = process.env.CRON_SECRET;
    const authz = req.headers.authorization ?? "";
    const cronOk = !cronSecret || authz === `Bearer ${cronSecret}`;
    const userId = req.headers["x-user-id"];
    if (!cronOk && !userId) {
      res.status(401).end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const dbMod = await import("@neondatabase/serverless");
    const sql = dbMod.neon(dbUrl) as unknown as SqlClient;
    const yahoo = await makeYahooClient();

    const stats = await refreshFundamentals(sql, yahoo, startMs + TIME_BUDGET_MS);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    res.status(200).end(JSON.stringify({ ok: true, ...stats, elapsed: `${elapsed}s` }));
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Fundamentals refresh failed" }));
  }
}
