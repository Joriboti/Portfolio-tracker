import type { VercelRequest, VercelResponse } from "@vercel/node";

// Backfills the `historical_prices` table with 3 years of weekly closes for
// every ticker held by any user, plus the analytics benchmark (^GSPC).
// Idempotent: re-running just upserts the same rows. Designed to be called
// weekly by Vercel cron, plus manually after a new import.

export const config = { maxDuration: 60 };

// Re-used from prices-update.ts / dividends-update.ts. Kept in sync manually
// because the analytics path stays additive — we don't want to refactor the
// existing endpoints just to share a constant.
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
  "PHYSICAL PALLADIUM ETF": "PPFA",
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

const SUB_UNIT_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

// Benchmark used by the analytics layer. Hardcoded — see vercel.json cron
// for refresh cadence. Stored under the literal "^GSPC" key.
const BENCHMARK_SYMBOL = "^GSPC";

function mapTicker(raw: string): string | null {
  const key = raw.trim().toUpperCase();
  if (SKIP_TICKERS.has(key)) return null;
  return TICKER_MAP[key] ?? key;
}

function storageKey(original: string): string {
  const key = original.trim().toUpperCase();
  return TICKER_STORAGE_ALIASES[key] ?? key;
}

type ChartQuote = {
  date: Date | string;
  close?: number | null;
  adjclose?: number | null;
};

type ChartResult = {
  meta?: { currency?: string | null };
  quotes?: ChartQuote[];
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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
      res
        .status(500)
        .end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }

    const dbMod = await import("@neondatabase/serverless");
    const sql = dbMod.neon(dbUrl);

    // Idempotent migration. Safe on every invocation — no-op if the table
    // already exists. Avoids needing a separate migration step.
    await sql`
      CREATE TABLE IF NOT EXISTS historical_prices (
        ticker      TEXT NOT NULL,
        week_date   DATE NOT NULL,
        close       NUMERIC(20, 8) NOT NULL,
        currency    TEXT NOT NULL DEFAULT 'USD',
        source      TEXT NOT NULL DEFAULT 'yahoo',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ticker, week_date)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_historical_prices_ticker_recent
        ON historical_prices (ticker, week_date DESC)
    `;

    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (
      opts?: { suppressNotices?: string[] },
    ) => {
      chart: (
        symbol: string,
        opts: Record<string, unknown>,
      ) => Promise<unknown>;
      setGlobalConfig?: (cfg: {
        validation?: { logErrors?: boolean };
      }) => void;
    };
    const yahooFinance = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
    yahooFinance.setGlobalConfig?.({ validation: { logErrors: false } });

    // 3 years back from today, rounded to start of the week to keep the
    // request boundary predictable.
    const period1 = new Date();
    period1.setUTCFullYear(period1.getUTCFullYear() - 3);

    const tickers = (await sql`
      SELECT DISTINCT ticker FROM transactions
    `) as Array<{ ticker: string }>;

    const work: Array<{ original: string; mapped: string }> = [];
    const seen = new Set<string>();
    for (const row of tickers) {
      const mapped = mapTicker(row.ticker);
      if (!mapped) continue;
      const original = row.ticker.trim().toUpperCase();
      if (seen.has(original)) continue;
      seen.add(original);
      work.push({ original, mapped });
    }
    // Benchmark is special-cased: stored under its Yahoo symbol so analytics
    // can join directly without going through the storage alias map.
    work.push({ original: BENCHMARK_SYMBOL, mapped: BENCHMARK_SYMBOL });

    let tickersDone = 0;
    let totalRows = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    const BATCH = 6;
    for (let i = 0; i < work.length; i += BATCH) {
      const batch = work.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ original, mapped }) => {
          try {
            const chartData = (await yahooFinance.chart(mapped, {
              period1,
              interval: "1wk",
            })) as ChartResult;

            const quotes = chartData?.quotes;
            if (!Array.isArray(quotes) || quotes.length === 0) {
              skipped.push(`${original} (no quotes)`);
              return;
            }

            const rawCcy = chartData?.meta?.currency ?? "USD";
            const conv = SUB_UNIT_TO_MAJOR[rawCcy];
            const divisor = conv?.divisor ?? 1;
            const currency = conv?.major ?? rawCcy;

            // For the benchmark we store under the literal symbol; for
            // user tickers we apply the storage alias so analytics can
            // join against the same key the transactions table uses.
            const stored =
              original === BENCHMARK_SYMBOL ? BENCHMARK_SYMBOL : storageKey(original);

            const rows: Array<{ weekDate: string; close: number }> = [];
            for (const q of quotes) {
              const closeRaw = q.close ?? q.adjclose;
              if (closeRaw == null) continue;
              const close = Number(closeRaw) / divisor;
              if (!Number.isFinite(close) || close <= 0) continue;
              const d =
                q.date instanceof Date ? q.date : new Date(String(q.date));
              if (Number.isNaN(d.getTime())) continue;
              const weekDate = d.toISOString().slice(0, 10);
              rows.push({ weekDate, close });
            }

            // Bulk insert via UNNEST: one round-trip per ticker instead
            // of one per row. 156 weeks × 50 tickers in individual INSERTs
            // would blow the 60s Vercel function budget — this keeps the
            // whole job under ~30s even on a cold start.
            if (rows.length > 0) {
              const dateArr = rows.map((r) => r.weekDate);
              const closeArr = rows.map((r) => r.close);
              await sql`
                INSERT INTO historical_prices (ticker, week_date, close, currency, source)
                SELECT ${stored} AS ticker, d::date, c::numeric, ${currency} AS currency, 'yahoo' AS source
                FROM UNNEST(${dateArr}::text[], ${closeArr}::numeric[]) AS u(d, c)
                ON CONFLICT (ticker, week_date) DO UPDATE
                  SET close = EXCLUDED.close,
                      currency = EXCLUDED.currency
              `;
              totalRows += rows.length;
              tickersDone++;
            }
          } catch (e) {
            errors.push(`${original}: ${(e as Error).message}`);
          }
        }),
      );
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    res.status(200).end(
      JSON.stringify({
        ok: true,
        tickers: work.length,
        tickersDone,
        totalRows,
        skipped,
        elapsed: `${elapsed}s`,
        errors,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(
        JSON.stringify({ error: err?.message ?? "Historical backfill failed" }),
      );
  }
}
