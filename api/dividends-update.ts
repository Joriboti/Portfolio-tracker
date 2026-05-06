import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

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
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  ADA: "ADA-USD",
  SOL: "SOL-USD",
  DOT: "DOT-USD",
  NBUS: "NBIS",
  NBIS: "NBIS",
  PALLADIUM: "SPDM.MI",
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
]);

const TICKER_STORAGE_ALIASES: Record<string, string> = {
  TESLA: "TSLA",
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

    for (const { original, mapped } of work) {
      try {
        const chartData = (await yahooFinance.chart(mapped, {
          period1: "2010-01-01",
          events: "div",
        })) as ChartResult;

        const divEvents = chartData?.events?.dividends;
        if (!Array.isArray(divEvents) || divEvents.length === 0) {
          skipped.push(`${original} (no dividends)`);
          continue;
        }

        const stored = storageKey(original);
        const { divisor, currency } = normalizeCurrency(mapped);

        for (const row of divEvents) {
          if (!row.date || !row.amount) continue;
          const exDate =
            row.date instanceof Date
              ? row.date.toISOString().slice(0, 10)
              : String(row.date).slice(0, 10);
          const amount = row.amount / divisor;

          await sql`
            INSERT INTO dividend_events (ticker, ex_date, amount, currency, source)
            VALUES (${stored}, ${exDate}, ${amount}, ${currency}, 'yahoo')
            ON CONFLICT (ticker, ex_date) DO UPDATE
              SET amount = EXCLUDED.amount,
                  currency = EXCLUDED.currency
          `;
          totalEvents++;
        }
        tickersWithDividends++;
      } catch (e) {
        errors.push(`${original}: ${(e as Error).message}`);
      }
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
