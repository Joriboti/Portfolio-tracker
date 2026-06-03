import * as XLSX from "xlsx";

export type Transaction = {
  ticker: string;
  shares: number;
  buyPrice: number | null;
  buyValue: number | null;
  buyDate: string | null; // ISO yyyy-mm-dd
  sellShares: number | null;
  sellPrice: number | null;
  sellValue: number | null;
  sellDate: string | null;
  result: number | null;
  portfolio: string; // sheet origin
};

export type Dividend = {
  ticker: string;
  amount: number;
  date: string | null;
};

export type Interest = {
  date: string | null;
  amount: number;
};

export type WealthEntry = {
  category: "stocks" | "cash";
  label: string;
  value: number;
};

export type ExcludedRow = {
  ticker: string;
  portfolio: string;
  row: number; // 1-based, so it matches the row number Excel shows
  color: string; // hex without alpha (e.g. "D0E0E3")
};

export type ParsedWorkbook = {
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  wealth: WealthEntry[];
  warnings: string[];
  /**
   * Rows the user explicitly opted out of by giving column A a coloured
   * fill in the source spreadsheet. Surfaced on the upload preview so the
   * user can sanity-check what's being skipped.
   */
  excluded: ExcludedRow[];
};

const PORTFOLIO_SHEETS = [
  "Portfolio 1 (TR)",
  "Portfolio 2 (operacions i transaccions)",
  "Portfolio 2 (operacions)",
];
const DIV_SHEET_CANDIDATES = ["Interessos i dividends", "Dividends"];
const WEALTH_SHEET_CANDIDATES = ["Patrimoni", "Wealth"];

// Excel serial date -> ISO string. Excel epoch starts 1900-01-01 (with the
// well-known 1900 leap-year bug — we use the standard 25569 offset).
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const utcDays = serial - 25569;
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function findSheet(
  workbook: XLSX.WorkBook,
  candidates: string[],
): { name: string; sheet: XLSX.WorkSheet } | null {
  for (const name of workbook.SheetNames) {
    const norm = name.trim().toLowerCase();
    for (const cand of candidates) {
      if (norm.startsWith(cand.toLowerCase().slice(0, 12))) {
        return { name, sheet: workbook.Sheets[name] };
      }
    }
  }
  return null;
}

function rowsToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Date columns get special treatment because `cellStyles: true` (which we
// need for the row-exclusion feature) makes `sheet_to_json` return JS
// Date objects for date-typed cells *despite* `cellDates: false`. A plain
// `asNumber(row[i])` therefore yields null and the FIFO sort sends every
// transaction to "9999-12-31", scrambling cost basis. This helper accepts
// the cell as either an Excel serial (number), a Date object (interpreted
// in local time so the spreadsheet's calendar day is preserved), or a
// pre-formatted ISO string, and always emits an ISO yyyy-mm-dd or null.
function asDateISO(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === "number") return excelSerialToISO(v);
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const n = parseFloat(v.replace(",", "."));
    if (Number.isFinite(n)) return excelSerialToISO(n);
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function asTickerString(v: unknown): string | null {
  if (v == null || v instanceof Date) return null;
  if (typeof v === "number") return null;
  const s = String(v).trim();
  if (!s.length) return null;

  const lower = s.toLowerCase();
  const NON_STOCK = [
    /^hipoteca/,
    /^plan\s/,
    /^fp\s/,
    /^cb\s/,
    /^fondo/,
    /monetari/,
    /^empleo/,
    /evoluc/,
    /patrimoni/,
    /^nens$/,
    /^cartera/,
    /^enviat$/,
    /^retirat/,
    /^transferencia$/,
    /^venda\s/,
    /^jordi/,
    /^mama$/,
    /^susi$/,
    /^mum$/,
    /bankinter\s/,
    /^bbva\s+(monetari|empleo)/,
    /^entrades\s/,
  ];
  for (const pat of NON_STOCK) {
    if (pat.test(lower)) return null;
  }

  return s;
}

// SheetJS exposes per-cell styles via `cell.s` when read with
// `cellStyles: true`. We treat any solid fill on column A as "the user
// asked to exclude this row from the portfolio." That convention is
// documented on the upload page.
type CellStyle = {
  patternType?: string;
  fgColor?: { rgb?: string };
  bgColor?: { rgb?: string };
};
type StyledCell = { v?: unknown; s?: CellStyle };

function getRowExclusionColor(
  sheet: XLSX.WorkSheet,
  rowIndex: number,
): string | null {
  const addr = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
  const cell = sheet[addr] as StyledCell | undefined;
  const style = cell?.s;
  if (!style || style.patternType !== "solid") return null;
  const rgb = style.fgColor?.rgb ?? style.bgColor?.rgb;
  if (!rgb) return null;
  // Strip alpha prefix if present ("FFD0E0E3" -> "D0E0E3").
  return rgb.length === 8 ? rgb.slice(2) : rgb;
}

type SheetFormat = "moviments" | "cartera";

function findHeaderRow(
  matrix: unknown[][],
): { row: number; format: SheetFormat } | null {
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i] ?? [];
    const cells = row.map((c) => String(c ?? "").toLowerCase());
    if (cells.some((c) => c === "nom") && cells.some((c) => c.includes("titol"))) {
      return { row: i, format: "moviments" };
    }
    const col1 = cells[1] ?? "";
    if (col1.includes("titol") && cells.some((c) => c.includes("preu"))) {
      return { row: i, format: "cartera" };
    }
  }
  return null;
}

function parsePortfolioSheet(
  sheet: XLSX.WorkSheet,
  portfolioName: string,
): { txns: Transaction[]; warnings: string[]; excluded: ExcludedRow[] } {
  const matrix = rowsToMatrix(sheet);
  const header = findHeaderRow(matrix);
  const warnings: string[] = [];
  const excluded: ExcludedRow[] = [];

  if (!header) {
    warnings.push(
      `Sheet "${portfolioName}": no header row with "Nom" + "titols" found.`,
    );
    return { txns: [], warnings, excluded };
  }

  const txns: Transaction[] = [];
  let sellYear: number | null = null;
  for (let i = header.row + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];

    if (header.format === "cartera") {
      const rawLabel = asString(row[0]);
      if (rawLabel) {
        const yearMatch = rawLabel.match(/^Vendes\s+(\d{4})$/i);
        if (yearMatch) {
          sellYear = parseInt(yearMatch[1], 10);
          continue;
        }
      }
    }

    const ticker =
      header.format === "cartera"
        ? asTickerString(row[0])
        : asString(row[0]);
    if (!ticker) continue;

    const exclusionColor = getRowExclusionColor(sheet, i);
    if (exclusionColor) {
      excluded.push({
        ticker,
        portfolio: portfolioName,
        row: i + 1,
        color: exclusionColor,
      });
      continue;
    }

    if (header.format === "cartera") {

      const shares = asNumber(row[1]);
      const buyPrice = asNumber(row[2]);
      const buyValue = asNumber(row[3]);
      if (shares == null || shares <= 0 || buyPrice == null) continue;

      if (sellYear) {
        const sellPrice = asNumber(row[4]);
        const sellValue = asNumber(row[5]);
        const result = asNumber(row[6]);
        txns.push({
          ticker,
          shares,
          buyPrice,
          buyValue,
          buyDate: null,
          sellShares: shares,
          sellPrice,
          sellValue,
          sellDate: `${sellYear}-07-01`,
          result,
          portfolio: portfolioName,
        });
      } else {
        txns.push({
          ticker,
          shares,
          buyPrice,
          buyValue,
          buyDate: null,
          sellShares: null,
          sellPrice: null,
          sellValue: null,
          sellDate: null,
          result: null,
          portfolio: portfolioName,
        });
      }
      continue;
    }

    const buyShares = asNumber(row[1]);
    const buyPrice = asNumber(row[2]);
    const buyValue = asNumber(row[3]);
    const buyDate = asDateISO(row[4]);

    const sellShares = asNumber(row[5]);
    const sellPrice = asNumber(row[6]);
    const sellValue = asNumber(row[7]);
    const sellDate = asDateISO(row[8]);
    const result = asNumber(row[9]);

    const isBuy = buyShares != null && buyPrice != null;
    const isSell = sellShares != null && sellPrice != null;
    if (!isBuy && !isSell) continue;

    txns.push({
      ticker,
      shares: isBuy ? (buyShares ?? 0) : 0,
      buyPrice: isBuy ? buyPrice : null,
      buyValue: isBuy ? buyValue : null,
      buyDate: isBuy ? buyDate : null,
      sellShares: isSell ? sellShares : null,
      sellPrice: isSell ? sellPrice : null,
      sellValue: isSell ? sellValue : null,
      sellDate: isSell ? sellDate : null,
      result,
      portfolio: portfolioName,
    });
  }

  return { txns, warnings, excluded };
}

function parseDividendsSheet(sheet: XLSX.WorkSheet): {
  dividends: Dividend[];
  interests: Interest[];
} {
  const matrix = rowsToMatrix(sheet);
  const dividends: Dividend[] = [];
  const interests: Interest[] = [];

  // Layout (per the user's Excel):
  //  Col 0: interest date | Col 1: interest amount
  //  Col 4: dividend ticker | Col 5: amount | Col 6: date
  for (const row of matrix) {
    if (!row) continue;

    const intDate = asDateISO(row[0]);
    const intAmount = asNumber(row[1]);
    if (intDate != null && intAmount != null) {
      interests.push({
        date: intDate,
        amount: intAmount,
      });
    }

    const divTicker = asString(row[4]);
    const divAmount = asNumber(row[5]);
    const divDate = asDateISO(row[6]);
    if (
      divTicker &&
      divTicker.toLowerCase() !== "dividends" &&
      divAmount != null
    ) {
      dividends.push({
        ticker: divTicker,
        amount: divAmount,
        date: divDate,
      });
    }
  }

  return { dividends, interests };
}

function parseFiscalitatSheet(sheet: XLSX.WorkSheet): Transaction[] {
  const matrix = rowsToMatrix(sheet);
  const txns: Transaction[] = [];
  let currentYear: number | null = null;

  for (const row of matrix) {
    if (!row) continue;
    const col0 = asString(row[0]);
    if (!col0) continue;

    const yearMatch = col0.match(/^VENDES\s+(\d{4})$/i);
    if (yearMatch) {
      currentYear = parseInt(yearMatch[1], 10);
      continue;
    }

    if (currentYear == null) continue;

    const shares = asNumber(row[1]);
    const buyPrice = asNumber(row[2]);
    const buyCost = asNumber(row[3]);
    const sellPrice = asNumber(row[4]);
    const sellValue = asNumber(row[5]);
    const result = asNumber(row[6]);

    if (shares == null || shares <= 0 || buyPrice == null) continue;

    txns.push({
      ticker: col0,
      shares,
      buyPrice,
      buyValue: buyCost,
      buyDate: null,
      sellShares: shares,
      sellPrice,
      sellValue,
      sellDate: `${currentYear}-07-01`,
      result,
      portfolio: "FISCALITAT",
    });
  }

  return txns;
}

function parseWealthSheet(sheet: XLSX.WorkSheet): WealthEntry[] {
  const matrix = rowsToMatrix(sheet);
  const entries: WealthEntry[] = [];
  let currentCategory: "stocks" | "cash" | null = null;

  for (const row of matrix) {
    if (!row) continue;
    const colA = asString(row[0]);
    const colB = asString(row[1]);
    const colC = asNumber(row[2]);

    if (colA) {
      const lower = colA.toLowerCase();
      if (lower.includes("accion") || lower.includes("stock")) {
        currentCategory = "stocks";
      } else if (
        lower.includes("efectiu") ||
        lower.includes("cash") ||
        lower.includes("compte")
      ) {
        currentCategory = "cash";
      }
    }

    if (
      colB &&
      colC != null &&
      currentCategory &&
      !colB.toLowerCase().includes("total")
    ) {
      entries.push({
        category: currentCategory,
        label: colB,
        value: colC,
      });
    }
  }

  return entries;
}

export function parseWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  // `cellStyles: true` is what makes per-cell `s` (style) available, which
  // we use to detect rows the user marked with a coloured fill in column A
  // to opt out of the import.
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    cellStyles: true,
  });
  const transactions: Transaction[] = [];
  const warnings: string[] = [];
  const excluded: ExcludedRow[] = [];

  const skipSheets = new Set<string>();

  for (const name of workbook.SheetNames) {
    const lower = name.trim().toLowerCase();
    if (lower.startsWith("portfolio")) {
      const { txns, warnings: w, excluded: ex } = parsePortfolioSheet(
        workbook.Sheets[name],
        name.trim(),
      );
      transactions.push(...txns);
      warnings.push(...w);
      excluded.push(...ex);
      skipSheets.add(name);
    }
  }

  // If no "Portfolio …" sheets matched, try the CARTERA PROVES format:
  // any sheet whose header row has "Nº Titols" / "Titols" in col 1 and
  // a FISCALITAT sheet with "VENDES XXXX" year sections.
  if (transactions.length === 0) {
    for (const name of workbook.SheetNames) {
      const lower = name.trim().toLowerCase();
      if (lower === "fiscalitat" || lower.includes("dades") || lower.includes("hoja")) continue;
      const sheet = workbook.Sheets[name];
      const matrix = rowsToMatrix(sheet);
      const header = findHeaderRow(matrix);
      if (header && header.format === "cartera") {
        const { txns, warnings: w, excluded: ex } = parsePortfolioSheet(
          sheet,
          name.trim(),
        );
        transactions.push(...txns);
        warnings.push(...w);
        excluded.push(...ex);
        skipSheets.add(name);
      }
    }

    for (const name of workbook.SheetNames) {
      if (name.trim().toLowerCase() === "fiscalitat") {
        const sellTxns = parseFiscalitatSheet(workbook.Sheets[name]);
        transactions.push(...sellTxns);
        skipSheets.add(name);
      }
    }
  }

  const divHit = findSheet(workbook, DIV_SHEET_CANDIDATES);
  const { dividends, interests } = divHit
    ? parseDividendsSheet(divHit.sheet)
    : { dividends: [], interests: [] };

  const wealthHit = findSheet(workbook, WEALTH_SHEET_CANDIDATES);
  const wealth = wealthHit ? parseWealthSheet(wealthHit.sheet) : [];

  if (transactions.length === 0) {
    warnings.push("No portfolio sheet was successfully parsed.");
  }

  void PORTFOLIO_SHEETS;

  return { transactions, dividends, interests, wealth, warnings, excluded };
}

export type DividendEvent = {
  ticker: string;
  exDate: string;
  amount: number;
  currency: string;
};

export type ComputedDividend = {
  ticker: string;
  exDate: string;
  sharesHeld: number;
  amountPerShare: number;
  total: number;
  currency: string;
};

export type Position = {
  ticker: string;
  shares: number;
  totalCost: number;
  avgCost: number;
  realizedPL: number;
  isOpen: boolean;
  /**
   * Weighted average buy price across ALL historical buys for the
   * ticker (not just the FIFO lots that remain). Used for closed
   * positions where `avgCost` is meaningless because there are no
   * remaining lots — this lets the closed table still show "I bought
   * this at X on average" rather than 0,00 € or a dust-induced number.
   */
  historicalAvgCost: number;
};

// Some brokerage exports use a longer name for a well-known ticker (e.g.
// "TESLA" instead of "TSLA"). These aliases are applied at the position-
// aggregation level so that buys and sells for the same company are always
// matched against each other regardless of which name the broker used.
const POSITION_ALIASES: Record<string, string> = {
  // Duplicates within the spreadsheet (same stock, different label)
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

  // US stocks — full name → ticker
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

  // Spanish/European stocks — full/alt name → short ticker
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
  "PHYSICAL PALLADIUM ETF": "PPFA",
};

function normalizeTicker(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return POSITION_ALIASES[upper] ?? upper;
}

// Drop transactions that are byte-for-byte the same record. The user's
// brokerage exports sometimes list the same buy in two sheets (e.g.
// "Portfolio 1" and "Portfolio 2"), which would double-count cost basis
// and inflate avg-cost. We dedupe on every numeric/date field but ignore
// the `portfolio` source so cross-sheet duplicates collapse.
export function dedupeTransactions(txns: Transaction[]): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  for (const t of txns) {
    const key = [
      t.ticker,
      t.shares,
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
    out.push(t);
  }
  return out;
}

// Dust threshold: any remaining position worth less than this many EUR at
// cost is treated as effectively closed. Catches share-fraction residues
// from partial sales (e.g. 0.0001 SMCI shares left over) without hiding
// genuinely small but valuable holdings (e.g. 0.001 BTC).
const DUST_COST_EUR = 1;

type Lot = { shares: number; cost: number };
type Event =
  | { kind: "buy"; date: string; shares: number; cost: number }
  | { kind: "sell"; date: string; shares: number; result: number };

export function aggregatePositions(txns: Transaction[]): Position[] {
  // FIFO lot accounting. Each buy adds a lot; each sell consumes shares
  // from the OLDEST lots first, removing their proportional cost basis.
  // The avg cost shown for an open position is the weighted average of
  // the lots that actually remain — so a ticker that was fully sold and
  // later rebought at different prices reflects only the new lots, like
  // Trading 212 / IBKR / etc. would show. Realized P&L still sums the
  // broker-reported `result` column directly.
  const deduped = dedupeTransactions(txns);

  const byTicker = new Map<string, Transaction[]>();
  for (const t of deduped) {
    const ticker = normalizeTicker(t.ticker);
    const list = byTicker.get(ticker) ?? [];
    list.push(t);
    byTicker.set(ticker, list);
  }

  const positions: Position[] = [];
  for (const [ticker, tlist] of byTicker) {
    const events: Event[] = [];
    for (const t of tlist) {
      if (t.buyPrice != null && t.shares > 0) {
        events.push({
          kind: "buy",
          // Null buy dates are placed at the very beginning of history so
          // they participate in FIFO and can be consumed by subsequent sells
          // (a null date means the broker omitted it, not that it's in the
          // future). Null sell dates remain at 9999 — if we don't know when
          // a sale happened we conservatively place it last.
          date: t.buyDate ?? "1900-01-01",
          shares: t.shares,
          cost: t.buyValue ?? t.shares * t.buyPrice,
        });
      }
      if (t.sellShares != null && t.sellShares > 0) {
        events.push({
          kind: "sell",
          date: t.sellDate ?? "9999-12-31",
          shares: t.sellShares,
          result: t.result ?? 0,
        });
      }
    }
    // Sort events chronologically. Buys before sells on the same day so
    // a same-day buy-and-sell can be matched against the new lot.
    events.sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      return a.kind === "buy" ? -1 : 1;
    });

    const lots: Lot[] = [];
    let realizedPL = 0;
    // Track the historical buy totals before any FIFO consumption, so
    // we can still report a meaningful "average buy price" for closed
    // positions where the FIFO lots are gone.
    let buyTotalShares = 0;
    let buyTotalCost = 0;
    // "Owed" shares accumulate when a sell arrives before any matching buy
    // lot exists (e.g. a position opened before the Excel history starts,
    // or a trade whose buy and sell rows appear out of date order). The owed
    // counter absorbs the FRONT of subsequent buy lots so that those shares
    // do not artificially inflate the open position.
    let owedShares = 0;

    for (const ev of events) {
      if (ev.kind === "buy") {
        buyTotalShares += ev.shares;
        buyTotalCost += ev.cost;
        if (owedShares > 0) {
          const absorbed = Math.min(owedShares, ev.shares);
          owedShares -= absorbed;
          const remainder = ev.shares - absorbed;
          if (remainder > 1e-9) {
            lots.push({ shares: remainder, cost: ev.cost * (remainder / ev.shares) });
          }
        } else {
          lots.push({ shares: ev.shares, cost: ev.cost });
        }
        continue;
      }
      let remaining = ev.shares;
      while (remaining > 1e-9 && lots.length > 0) {
        const lot = lots[0];
        if (lot.shares <= remaining + 1e-9) {
          remaining -= lot.shares;
          lots.shift();
        } else {
          const pct = remaining / lot.shares;
          lot.cost = lot.cost - lot.cost * pct;
          lot.shares = lot.shares - remaining;
          remaining = 0;
        }
      }
      // Shares that couldn't be matched against any lot — record the debt so
      // future buys can cover them without creating phantom open positions.
      if (remaining > 1e-9) owedShares += remaining;
      realizedPL += ev.result;
    }

    const remainingShares = lots.reduce((s, l) => s + l.shares, 0);
    const remainingCost = lots.reduce((s, l) => s + l.cost, 0);

    if (remainingShares <= 1e-6 && realizedPL === 0) continue;

    const avgCost = remainingShares > 0 ? remainingCost / remainingShares : 0;
    const historicalAvgCost =
      buyTotalShares > 0 ? buyTotalCost / buyTotalShares : 0;
    // A position counts as "open" only if there's a meaningful amount of
    // cost left in it. Collapses dust (e.g. 0.0001 shares left over from
    // rounding in a "sold all" transaction) into the closed bucket.
    const isOpen = remainingCost >= DUST_COST_EUR;
    positions.push({
      ticker,
      shares: Math.max(remainingShares, 0),
      totalCost: Math.max(remainingCost, 0),
      avgCost,
      realizedPL,
      isOpen,
      historicalAvgCost,
    });
  }

  return positions.sort((a, b) => b.totalCost - a.totalCost);
}

export type YearlyPL = {
  year: number;
  total: number;
  byTicker: { ticker: string; pl: number }[];
};

export function computeRealizedPLByYear(txns: Transaction[]): YearlyPL[] {
  const deduped = dedupeTransactions(txns);
  const yearMap = new Map<number, Map<string, number>>();

  for (const t of deduped) {
    if (t.sellShares == null || t.sellShares <= 0 || t.result == null) continue;
    const year = t.sellDate ? parseInt(t.sellDate.slice(0, 4), 10) : null;
    if (!year || !Number.isFinite(year)) continue;

    const ticker = normalizeTicker(t.ticker);
    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const tickerMap = yearMap.get(year)!;
    tickerMap.set(ticker, (tickerMap.get(ticker) ?? 0) + t.result);
  }

  const results: YearlyPL[] = [];
  for (const [year, tickerMap] of yearMap) {
    const byTicker = [...tickerMap.entries()]
      .map(([ticker, pl]) => ({ ticker, pl }))
      .sort((a, b) => b.pl - a.pl);
    results.push({ year, total: byTicker.reduce((s, t) => s + t.pl, 0), byTicker });
  }

  return results.sort((a, b) => b.year - a.year);
}

export function computeAutoDividends(
  txns: Transaction[],
  events: DividendEvent[],
): ComputedDividend[] {
  const deduped = dedupeTransactions(txns);

  const txnsByTicker = new Map<string, Transaction[]>();
  for (const t of deduped) {
    const ticker = normalizeTicker(t.ticker);
    const list = txnsByTicker.get(ticker) ?? [];
    list.push(t);
    txnsByTicker.set(ticker, list);
  }

  const results: ComputedDividend[] = [];

  for (const ev of events) {
    const evTicker = normalizeTicker(ev.ticker);
    const tickerTxns = txnsByTicker.get(evTicker);
    if (!tickerTxns) continue;

    let shares = 0;
    for (const t of tickerTxns) {
      if (t.buyPrice != null && t.shares > 0 && t.buyDate != null) {
        if (t.buyDate < ev.exDate) shares += t.shares;
      }
      if (t.sellShares != null && t.sellShares > 0) {
        if ((t.sellDate ?? "9999-12-31") < ev.exDate) shares -= t.sellShares;
      }
    }
    shares = Math.max(shares, 0);

    if (shares > 0) {
      results.push({
        ticker: evTicker,
        exDate: ev.exDate,
        sharesHeld: shares,
        amountPerShare: ev.amount,
        total: shares * ev.amount,
        currency: ev.currency,
      });
    }
  }

  return results;
}
