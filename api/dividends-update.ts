import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const TICKER_MAP: Record<string, string> = {
  // --- Original names from "Moviments Jordi" format ---
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

  // --- Original full names from "CARTERA PROVES" format ---
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

  // --- Normalized short tickers that need exchange suffixes ---
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

  // --- Crypto ---
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
  "BTC",
  "ETH",
  "ADA",
  "SOL",
  "DOT",
  "ETF IBEX",
  "ETF IBEX INVERSA",
  "FONS DE PENSIONS",
  "LYXOR VIX",
  "LYXOR DOBLE SHORT",
  "ABE",
  "LDK",
  "IBR",
]);

// Must stay in sync with POSITION_ALIASES in src/lib/excel-parser.ts.
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

const SUB_UNIT_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 },
  ZAc: { major: "ZAR", divisor: 100 },
  ILA: { major: "ILS", divisor: 100 },
};

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number | null;
  currency?: string | null;
};

type ChartDivEvent = { date: Date | string; amount: number };
type ChartResult = {
  events?: { dividends?: ChartDivEvent[] };
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

    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (
      opts?: { suppressNotices?: string[] },
    ) => {
      quote: (symbol: string | string[]) => Promise<unknown>;
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

    const symbols = work.map((w) => w.mapped);

    const rawCurrencyBySymbol = new Map<string, string>();
    try {
      const all = (await yahooFinance.quote(symbols)) as
        | YahooQuote
        | YahooQuote[];
      const list = Array.isArray(all) ? all : [all];
      for (const q of list) {
        if (q.symbol && q.currency) {
          rawCurrencyBySymbol.set(q.symbol, q.currency);
        }
      }
    } catch {
      // proceed without — will default to USD
    }

    function normalizeCurrency(symbol: string): {
      divisor: number;
      currency: string;
    } {
      const rawCcy = rawCurrencyBySymbol.get(symbol) ?? "USD";
      const conv = SUB_UNIT_TO_MAJOR[rawCcy];
      if (conv) return { divisor: conv.divisor, currency: conv.major };
      return { divisor: 1, currency: rawCcy };
    }

    let tickersWithDividends = 0;
    let totalEvents = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    const BATCH = 8;
    for (let i = 0; i < work.length; i += BATCH) {
      const batch = work.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ original, mapped }) => {
          try {
            const chartData = (await yahooFinance.chart(mapped, {
              period1: "2010-01-01",
              events: "div",
            })) as ChartResult;

            const divEvents = chartData?.events?.dividends;
            if (!Array.isArray(divEvents) || divEvents.length === 0) {
              skipped.push(`${original} (no dividends)`);
              return;
            }

            const stored = storageKey(original);
            const { divisor, currency } = normalizeCurrency(mapped);

            const rows: Array<{ exDate: string; amount: number }> = [];
            for (const row of divEvents) {
              if (!row.date || !row.amount) continue;
              const exDate =
                row.date instanceof Date
                  ? row.date.toISOString().slice(0, 10)
                  : String(row.date).slice(0, 10);
              rows.push({ exDate, amount: row.amount / divisor });
            }

            for (const { exDate, amount } of rows) {
              await sql`
                INSERT INTO dividend_events (ticker, ex_date, amount, currency, source)
                VALUES (${stored}, ${exDate}, ${amount}, ${currency}, 'yahoo')
                ON CONFLICT (ticker, ex_date) DO UPDATE
                  SET amount = EXCLUDED.amount,
                      currency = EXCLUDED.currency
              `;
            }
            totalEvents += rows.length;
            tickersWithDividends++;
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
        tickersWithDividends,
        totalEvents,
        skipped,
        tickers: work.length,
        elapsed: `${elapsed}s`,
        errors,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(
        JSON.stringify({ error: err?.message ?? "Dividend update failed" }),
      );
  }
}
