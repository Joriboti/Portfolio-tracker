import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

// Yahoo Finance has no documented rate limit on the unofficial endpoints
// yahoo-finance2 uses, and supports batched quote requests, so we can pull
// all positions + FX in a single Vercel invocation without paging.

const FX_PAIRS = ["EUR/USD", "GBP/USD", "CHF/USD"];

// Map portfolio tickers to Yahoo Finance symbols. Yahoo uses suffixes for
// non-US exchanges (e.g. ".MC" Madrid, ".L" London, ".DE" Xetra, ".AS"
// Amsterdam, ".PA" Paris, ".SW" SIX Swiss). For commodities and crypto,
// Yahoo expects "<base>-USD" (crypto) or futures like "GC=F" (gold).
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

// Tickers to skip. Yahoo's continuous-futures symbols (GC=F gold, SI=F
// silver, PL=F platinum) quote the full troy-ounce price while the broker
// records these positions in a different unit, so the resulting market
// value would be inflated by orders of magnitude.
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

// "EUR/USD" -> "EURUSD=X" (Yahoo's FX symbol format).
function fxToYahoo(pair: string): string {
  return pair.replace("/", "") + "=X";
}

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number | null;
  currency?: string | null;
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

    // yahoo-finance2 v3 exports a class — instantiate per-invocation. The
    // dynamic import keeps cold-start cost off the rest of the API surface.
    const yfMod = await import("yahoo-finance2");
    const YahooFinance = yfMod.default as unknown as new (
      opts?: { suppressNotices?: string[] },
    ) => {
      quote: (symbol: string | string[]) => Promise<unknown>;
      setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
    };
    const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    yahooFinance.setGlobalConfig?.({ validation: { logErrors: false } });

    // Wipe any stale rows for tickers we no longer try to fetch — otherwise
    // an old (and possibly wrong-unit) price keeps surfacing on the
    // dashboard even though we won't refresh it.
    const skipList = Array.from(SKIP_TICKERS);
    if (skipList.length > 0) {
      await sql`DELETE FROM prices WHERE UPPER(ticker) = ANY(${skipList}::text[])`;
    }

    const tickers = (await sql`
      SELECT DISTINCT ticker FROM transactions
    `) as Array<{ ticker: string }>;

    // Build (original ticker, yahoo symbol) pairs, deduping by original.
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
    const fxSymbols = FX_PAIRS.map(fxToYahoo);

    // Yahoo accepts arrays and returns one quote per symbol. The lib also
    // gracefully handles partial failures.
    let quotesArr: YahooQuote[] = [];
    let fxArr: YahooQuote[] = [];
    try {
      const all = (await yahooFinance.quote([...symbols, ...fxSymbols])) as
        | YahooQuote
        | YahooQuote[];
      const list = Array.isArray(all) ? all : [all];
      const symSet = new Set(symbols);
      const fxSet = new Set(fxSymbols);
      for (const q of list) {
        if (symSet.has(q.symbol)) quotesArr.push(q);
        else if (fxSet.has(q.symbol)) fxArr.push(q);
      }
    } catch (e) {
      // Fall back to per-symbol calls if the batched call fails entirely.
      for (const s of symbols) {
        try {
          const q = (await yahooFinance.quote(s)) as YahooQuote;
          quotesArr.push(q);
        } catch {
          /* skipped below */
        }
      }
      for (const s of fxSymbols) {
        try {
          const q = (await yahooFinance.quote(s)) as YahooQuote;
          fxArr.push(q);
        } catch {
          /* skipped below */
        }
      }
      console.warn("Yahoo batched quote failed, fell back to per-symbol", e);
    }

    const bySymbol = new Map(quotesArr.map((q) => [q.symbol, q]));
    const fxBySymbol = new Map(fxArr.map((q) => [q.symbol, q]));

    let updated = 0;
    const errors: string[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();

    // Normalize Yahoo's sub-unit currencies (London prices come in GBp =
     // pence, JSE in ZAc = cents, Tel Aviv in ILA = agorot, etc.) to the
     // major unit so EUR conversion downstream stays sane.
    const SUB_UNIT_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
      GBp: { major: "GBP", divisor: 100 },
      ZAc: { major: "ZAR", divisor: 100 },
      ILA: { major: "ILS", divisor: 100 },
    };
    function normalizePrice(q: YahooQuote): { price: number; currency: string } | null {
      if (q.regularMarketPrice == null) return null;
      const ccy = q.currency ?? "USD";
      const conv = SUB_UNIT_TO_MAJOR[ccy];
      if (conv) {
        return { price: q.regularMarketPrice / conv.divisor, currency: conv.major };
      }
      return { price: q.regularMarketPrice, currency: ccy };
    }

    for (const { original, mapped } of work) {
      const q = bySymbol.get(mapped);
      const norm = q ? normalizePrice(q) : null;
      if (!norm) {
        skipped.push(`${original} (${mapped})`);
        continue;
      }
      const stored = storageKey(original);
      try {
        await sql`
          INSERT INTO prices (ticker, as_of, price, currency, source)
          VALUES (${stored}, ${now}, ${norm.price}, ${norm.currency}, 'yahoo')
          ON CONFLICT (ticker, as_of) DO UPDATE
            SET price = EXCLUDED.price,
                currency = EXCLUDED.currency
        `;
        updated++;
      } catch (e) {
        errors.push(`${original}: ${(e as Error).message}`);
      }
    }

    let fxOk = 0;
    for (const pair of FX_PAIRS) {
      const ySym = fxToYahoo(pair);
      const q = fxBySymbol.get(ySym);
      if (!q || q.regularMarketPrice == null) continue;
      const currency = pair.split("/")[0];
      try {
        await sql`
          INSERT INTO fx_rates (currency, as_of, rate)
          VALUES (${currency}, ${now}, ${q.regularMarketPrice})
          ON CONFLICT (currency, as_of) DO UPDATE
            SET rate = EXCLUDED.rate
        `;
        fxOk++;
      } catch (e) {
        errors.push(`fx ${pair}: ${(e as Error).message}`);
      }
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    res.status(200).end(
      JSON.stringify({
        ok: true,
        updated,
        skipped,
        fxOk,
        tickers: work.length,
        elapsed: `${elapsed}s`,
        errors,
      }),
    );
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .end(JSON.stringify({ error: err?.message ?? "Update failed" }));
  }
}
