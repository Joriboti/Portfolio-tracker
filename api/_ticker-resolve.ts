// Ticker resolution — the one place that turns a broker-style ticker (what the
// user's Excel says: EXO, ITX, LVMH, "BANCO SANTANDER") into the symbol Yahoo
// Finance quotes it under (EXO.AS, ITX.MC, MC.PA, SAN.MC).
//
// Three layers, cheapest first:
//   1. STATIC_SYMBOLS — the hand-curated map. Always wins; never cached.
//   2. ticker_symbols  — Postgres cache of what a previous Yahoo search found,
//      including the misses, so each unknown ticker costs one search ever.
//   3. Yahoo search    — the fallback for a ticker neither layer knows.
//
// Every price/history/fundamentals route imports from here (static import with
// the explicit `.js` extension — the only sibling-import form the Vercel Node
// runtime resolves; see the deployment notes in the repo memory). Underscore
// prefix = not exposed as a route, so it doesn't count against the 12-function
// cap.

export type SqlClient = (
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<unknown>;

export type ResolutionStatus =
  | "static" // hand-curated map
  | "cached" // found by a previous Yahoo search, read back from Postgres
  | "search" // found by Yahoo search in this call (and now cached)
  | "unresolved" // searched, nothing acceptable came back
  | "skipped"; // deliberately never priced (see SKIP_TICKERS)

export type Resolution = {
  ticker: string;
  symbol: string | null;
  status: ResolutionStatus;
  name: string | null;
};

// Broker ticker / company name → Yahoo symbol. Yahoo suffixes non-US listings
// (.MC Madrid, .AS Amsterdam, .PA Paris, .MI Milan, .L London) and writes
// crypto as <base>-USD.
export const STATIC_SYMBOLS: Record<string, string> = {
  // --- The broker's short tickers that need an exchange suffix ---
  EXO: "EXO.AS",
  EXOR: "EXO.AS",
  ITX: "ITX.MC",
  TEF: "TEF.MC",
  CLNX: "CLNX.MC",
  SAN: "SAN.MC",
  FER: "FER.MC",
  IAG: "IAG.MC",
  BKT: "BKT.MC",
  HOME: "HOME.MC",
  LVMH: "MC.PA",
  MC: "MC.PA",
  CABK: "CABK.MC",
  ENG: "ENG.MC",
  MAP: "MAP.MC",
  GRF: "GRF.MC",
  REP: "REP.MC",
  NGY: "NTGY.MC",
  NTGY: "NTGY.MC",
  AEDAS: "AEDAS.MC",
  CASH: "CASH.MC",
  LOG: "LOG.MC",
  MEL: "MEL.MC",
  ORY: "ORY.MC",
  PUIG: "PUIG.MC",
  SCYR: "SCYR.MC",
  SLR: "SLR.MC",
  TUB: "TUB.MC",
  TL5: "TL5.MC",
  LRE: "LRE.MC",
  IBE: "IBE.MC",
  ELE: "ELE.MC",
  AMS: "AMS.MC",
  COL: "COL.MC",
  ANA: "ANA.MC",
  SAB: "SAB.MC",
  BME: "BME.MC",
  BBVA: "BBVA.MC",
  ACS: "ACS.MC",
  NBIS: "NBIS",
  NBUS: "NBIS",
  // The stored ticker is PPFA (see STORAGE_ALIASES) — map it back to the
  // Milan listing; Yahoo's own "PPFA" symbol is a sparse OTC line.
  PPFA: "SPDM.MI",
  PALLADIUM: "SPDM.MI",
  "PHYSICAL PALLADIUM ETF": "SPDM.MI",

  // --- Company names as older broker exports wrote them ---
  TESLA: "TSLA",
  ABERCROMBIE: "ANF",
  PINDUODUO: "PDD",
  SABADELL: "SAB.MC",
  SANTANDER: "SAN.MC",
  "BANCO SANTANDER": "SAN.MC",
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
  GRIFOLS: "GRF.MC",
  NATURGY: "NTGY.MC",
  "GAS NATURAL": "NTGY.MC",
  ENAGAS: "ENG.MC",
  COLONIAL: "COL.MC",
  ACCIONA: "ANA.MC",
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

  // --- Crypto ---
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  ADA: "ADA-USD",
  SOL: "SOL-USD",
  DOT: "DOT-USD",
};

// Never priced. Yahoo's continuous-futures symbols (GC=F gold, SI=F silver,
// PL=F platinum) quote the full troy-ounce price while the broker records
// these positions in a different unit, so the market value would be off by
// orders of magnitude. The rest are funds/structured products Yahoo lacks.
export const SKIP_TICKERS = new Set<string>([
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

// Broker name → the key the transactions table stores it under. Must stay in
// sync with POSITION_ALIASES in src/lib/excel-parser.ts (the parser applies
// the same aliases before upload; this copy covers rows imported before it
// did).
export const STORAGE_ALIASES: Record<string, string> = {
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

export function normaliseTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

export function storageKey(raw: string): string {
  const key = normaliseTicker(raw);
  return STORAGE_ALIASES[key] ?? key;
}

/** Layer 1 only: `null` = deliberately skipped, `undefined` = not in the map. */
export function staticSymbol(raw: string): string | null | undefined {
  const key = normaliseTicker(raw);
  if (SKIP_TICKERS.has(key)) return null;
  return STATIC_SYMBOLS[key];
}

// ---------------------------------------------------------------------------
// Yahoo search fallback

export type SearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
};

export type SearchClient = {
  search: (
    query: string,
    q?: unknown,
    m?: { validateResult?: boolean },
  ) => Promise<{ quotes?: SearchQuote[] }>;
};

const TRADEABLE = new Set(["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY"]);

function symbolBase(symbol: string): string {
  return symbol.split(/[.-]/)[0] ?? symbol;
}

// A short, space-free ticker is a symbol; anything else reads as a name.
function looksLikeSymbol(ticker: string): boolean {
  return ticker.length <= 5 && !/\s/.test(ticker);
}

/**
 * Pick the search result that is credibly the same instrument, or nothing.
 *
 * For a symbol-shaped ticker (EXO, ITX) only a result whose symbol IS the
 * ticker, or whose exchange-less base is (EXO.AS → EXO), is accepted — the
 * name-matched tail of a Yahoo search is where the wrong company hides. A
 * name-shaped ticker ("BANCO SANTANDER") accepts the first tradeable result,
 * which is what Yahoo ranks the query as. Yahoo's own order breaks ties.
 */
export function pickSearchMatch(
  ticker: string,
  quotes: SearchQuote[],
): { symbol: string; name: string | null } | null {
  const key = normaliseTicker(ticker);
  const candidates = quotes.filter(
    (q): q is SearchQuote & { symbol: string } =>
      typeof q.symbol === "string" &&
      q.symbol.length > 0 &&
      (!q.quoteType || TRADEABLE.has(q.quoteType)),
  );
  if (candidates.length === 0) return null;

  const score = (q: SearchQuote & { symbol: string }): number => {
    const sym = q.symbol.toUpperCase();
    if (sym === key) return 3;
    if (symbolBase(sym) === key) return 2;
    return 0;
  };

  let best: (SearchQuote & { symbol: string }) | null = null;
  let bestScore = 0;
  for (const q of candidates) {
    const s = score(q);
    if (s > bestScore) {
      best = q;
      bestScore = s;
    }
  }
  if (!best) {
    if (looksLikeSymbol(key)) return null;
    best = candidates[0];
  }
  return { symbol: best.symbol, name: best.longname ?? best.shortname ?? null };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Postgres cache

// Once per warm instance is enough: the statement is idempotent and a round
// trip per call would be the single most expensive thing in the fast path.
let tableEnsured = false;

export async function ensureSymbolTable(sql: SqlClient): Promise<void> {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS ticker_symbols (
      ticker      TEXT PRIMARY KEY,
      symbol      TEXT,
      status      TEXT NOT NULL,
      name        TEXT,
      resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  tableEnsured = true;
}

type CachedRow = { ticker: string; symbol: string | null; status: string; name: string | null };

/** Layer 2 only. Missing table → empty map (the caller falls through). */
export async function loadCachedSymbols(
  sql: SqlClient,
  tickers: string[],
): Promise<Map<string, Resolution>> {
  const out = new Map<string, Resolution>();
  const keys = Array.from(new Set(tickers.map(normaliseTicker))).filter(Boolean);
  if (keys.length === 0) return out;
  let rows: CachedRow[] = [];
  try {
    rows = (await sql`
      SELECT ticker, symbol, status, name FROM ticker_symbols
      WHERE ticker = ANY(${keys}::text[])
    `) as CachedRow[];
  } catch {
    return out;
  }
  for (const r of rows) {
    const status: ResolutionStatus =
      r.symbol && r.status !== "unresolved" && r.status !== "skipped"
        ? "cached"
        : r.status === "skipped"
          ? "skipped"
          : "unresolved";
    out.set(r.ticker, {
      ticker: r.ticker,
      symbol: status === "cached" ? r.symbol : null,
      status,
      name: r.name ?? null,
    });
  }
  return out;
}

/**
 * Resolve every ticker through the three layers. Only unknown tickers reach
 * Yahoo, and what Yahoo says (hit or miss) is written back in one statement so
 * the next call for that ticker is a cache read. Pass `force` to re-search
 * tickers the cache already has an answer for.
 */
export async function resolveTickers(
  sql: SqlClient,
  yahoo: SearchClient | null,
  tickers: string[],
  opts: { force?: boolean; concurrency?: number } = {},
): Promise<Map<string, Resolution>> {
  const out = new Map<string, Resolution>();
  const keys = Array.from(new Set(tickers.map(normaliseTicker))).filter(Boolean);
  const pending: string[] = [];

  for (const key of keys) {
    const s = staticSymbol(key);
    if (s === null) {
      out.set(key, { ticker: key, symbol: null, status: "skipped", name: null });
    } else if (s !== undefined) {
      out.set(key, { ticker: key, symbol: s, status: "static", name: null });
    } else {
      pending.push(key);
    }
  }
  if (pending.length === 0) return out;

  await ensureSymbolTable(sql);
  const cached = opts.force ? new Map<string, Resolution>() : await loadCachedSymbols(sql, pending);
  const toSearch: string[] = [];
  for (const key of pending) {
    const hit = cached.get(key);
    if (hit) out.set(key, hit);
    else toSearch.push(key);
  }
  if (toSearch.length === 0) return out;

  if (!yahoo) {
    // Read-only caller (history/dividends refresh): an unknown ticker is tried
    // verbatim, exactly as before the cache existed, and nothing is written.
    for (const key of toSearch) {
      out.set(key, { ticker: key, symbol: key, status: "static", name: null });
    }
    return out;
  }

  const found = await mapLimit(toSearch, opts.concurrency ?? 4, async (key) => {
    let quotes: SearchQuote[] = [];
    try {
      const r = await yahoo.search(key, {}, { validateResult: false });
      quotes = r.quotes ?? [];
    } catch {
      quotes = [];
    }
    const match = pickSearchMatch(key, quotes);
    const res: Resolution = match
      ? { ticker: key, symbol: match.symbol, status: "search", name: match.name }
      : { ticker: key, symbol: null, status: "unresolved", name: null };
    return res;
  });

  for (const r of found) out.set(r.ticker, r);

  try {
    await sql`
      INSERT INTO ticker_symbols (ticker, symbol, status, name, resolved_at)
      SELECT t, s, st, n, NOW()
      FROM unnest(
        ${found.map((r) => r.ticker)}::text[],
        ${found.map((r) => r.symbol)}::text[],
        ${found.map((r) => (r.status === "search" ? "search" : "unresolved"))}::text[],
        ${found.map((r) => r.name)}::text[]
      ) AS u(t, s, st, n)
      ON CONFLICT (ticker) DO UPDATE
        SET symbol = EXCLUDED.symbol,
            status = EXCLUDED.status,
            name = EXCLUDED.name,
            resolved_at = EXCLUDED.resolved_at
    `;
  } catch (e) {
    // The cache is an optimisation: a failed write costs one more search next
    // time, never a wrong price.
    console.warn("ticker_symbols upsert failed", (e as Error).message);
  }
  return out;
}

/**
 * Convenience for the read-only refresh routes: (stored key, Yahoo symbol)
 * pairs for a list of broker tickers, deduped by stored key, with skipped and
 * unresolved tickers dropped so no Yahoo call is wasted on them.
 */
export async function symbolPairs(
  sql: SqlClient,
  tickers: string[],
): Promise<Array<{ original: string; stored: string; symbol: string }>> {
  const resolved = await resolveTickers(sql, null, tickers);
  const out: Array<{ original: string; stored: string; symbol: string }> = [];
  const seen = new Set<string>();
  for (const raw of tickers) {
    const original = normaliseTicker(raw);
    if (seen.has(original)) continue;
    seen.add(original);
    const r = resolved.get(original);
    if (!r?.symbol) continue;
    out.push({ original, stored: storageKey(original), symbol: r.symbol });
  }
  return out;
}
