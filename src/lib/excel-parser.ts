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

export type ParsedWorkbook = {
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  wealth: WealthEntry[];
  warnings: string[];
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

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i] ?? [];
    const cells = row.map((c) => String(c ?? "").toLowerCase());
    if (cells.some((c) => c === "nom") && cells.some((c) => c.includes("titol"))) {
      return i;
    }
  }
  return -1;
}

function parsePortfolioSheet(
  sheet: XLSX.WorkSheet,
  portfolioName: string,
): { txns: Transaction[]; warnings: string[] } {
  const matrix = rowsToMatrix(sheet);
  const headerRow = findHeaderRow(matrix);
  const warnings: string[] = [];

  if (headerRow === -1) {
    warnings.push(
      `Sheet "${portfolioName}": no header row with "Nom" + "titols" found.`,
    );
    return { txns: [], warnings };
  }

  const txns: Transaction[] = [];
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const ticker = asString(row[0]);
    if (!ticker) continue;

    const buyShares = asNumber(row[1]);
    const buyPrice = asNumber(row[2]);
    const buyValue = asNumber(row[3]);
    const buyDate = asNumber(row[4]);

    const sellShares = asNumber(row[5]);
    const sellPrice = asNumber(row[6]);
    const sellValue = asNumber(row[7]);
    const sellDate = asNumber(row[8]);
    const result = asNumber(row[9]);

    const isBuy = buyShares != null && buyPrice != null;
    const isSell = sellShares != null && sellPrice != null;
    if (!isBuy && !isSell) continue;

    txns.push({
      ticker,
      shares: isBuy ? (buyShares ?? 0) : 0,
      buyPrice: isBuy ? buyPrice : null,
      buyValue: isBuy ? buyValue : null,
      buyDate: isBuy && buyDate != null ? excelSerialToISO(buyDate) : null,
      sellShares: isSell ? sellShares : null,
      sellPrice: isSell ? sellPrice : null,
      sellValue: isSell ? sellValue : null,
      sellDate: isSell && sellDate != null ? excelSerialToISO(sellDate) : null,
      result,
      portfolio: portfolioName,
    });
  }

  return { txns, warnings };
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

    const intDate = asNumber(row[0]);
    const intAmount = asNumber(row[1]);
    if (intDate != null && intAmount != null) {
      interests.push({
        date: excelSerialToISO(intDate),
        amount: intAmount,
      });
    }

    const divTicker = asString(row[4]);
    const divAmount = asNumber(row[5]);
    const divDate = asNumber(row[6]);
    if (
      divTicker &&
      divTicker.toLowerCase() !== "dividends" &&
      divAmount != null
    ) {
      dividends.push({
        ticker: divTicker,
        amount: divAmount,
        date: divDate != null ? excelSerialToISO(divDate) : null,
      });
    }
  }

  return { dividends, interests };
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
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const transactions: Transaction[] = [];
  const warnings: string[] = [];

  for (const name of workbook.SheetNames) {
    const lower = name.trim().toLowerCase();
    if (lower.startsWith("portfolio")) {
      const { txns, warnings: w } = parsePortfolioSheet(
        workbook.Sheets[name],
        name.trim(),
      );
      transactions.push(...txns);
      warnings.push(...w);
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

  // Suppress unused symbol warning for the lookup helper
  void PORTFOLIO_SHEETS;

  return { transactions, dividends, interests, wealth, warnings };
}

export type Position = {
  ticker: string;
  shares: number;
  totalCost: number;
  avgCost: number;
  realizedPL: number;
  isOpen: boolean;
};

// Drop transactions that are byte-for-byte the same record. The user's
// brokerage exports sometimes list the same buy in two sheets (e.g.
// "Portfolio 1" and "Portfolio 2"), which would double-count cost basis
// and inflate avg-cost. We dedupe on every numeric/date field but ignore
// the `portfolio` source so cross-sheet duplicates collapse.
function dedupeTransactions(txns: Transaction[]): Transaction[] {
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
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }

  const positions: Position[] = [];
  for (const [ticker, tlist] of byTicker) {
    const events: Event[] = [];
    for (const t of tlist) {
      if (t.buyPrice != null && t.shares > 0) {
        events.push({
          kind: "buy",
          date: t.buyDate ?? "9999-12-31",
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

    for (const ev of events) {
      if (ev.kind === "buy") {
        lots.push({ shares: ev.shares, cost: ev.cost });
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
      realizedPL += ev.result;
    }

    const remainingShares = lots.reduce((s, l) => s + l.shares, 0);
    const remainingCost = lots.reduce((s, l) => s + l.cost, 0);

    if (remainingShares <= 1e-6 && realizedPL === 0) continue;

    const avgCost = remainingShares > 0 ? remainingCost / remainingShares : 0;
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
    });
  }

  return positions.sort((a, b) => b.totalCost - a.totalCost);
}
