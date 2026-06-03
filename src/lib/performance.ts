import type { Transaction, Dividend, Interest } from "./excel-parser";
import { computeRealizedPLByYear, dedupeTransactions } from "./excel-parser";

// Pure, side-effect-free performance math used by the dashboard. All amounts
// are treated in the user's account currency (EUR): transaction buy/sell
// values, realized results, recorded dividends and interests are stored in
// EUR in the source spreadsheet, so the figures here add up exactly without
// any FX conversion. The value-based annual return % (which DOES need
// historical prices + FX) lives in the `api/performance.ts` endpoint instead.

export type YearlyBreakdown = {
  year: number;
  realized: number; // realized P&L from closed sales that year
  dividends: number; // recorded dividends received that year
  interests: number; // recorded interest received that year
  total: number; // realized + dividends + interests
};

// Sum of every euro ever deployed into buys (deduped — the broker sometimes
// lists the same buy in two sheets). Falls back to shares × buyPrice when the
// line-total is missing. This is the GROSS purchase total, not the money out
// of pocket (see netInvested below).
export function sumBuyCost(txns: Transaction[]): number {
  let total = 0;
  for (const t of dedupeTransactions(txns)) {
    if (t.buyPrice != null && t.shares > 0) {
      total += t.buyValue ?? t.shares * t.buyPrice;
    }
  }
  return total;
}

// Sum of every euro ever returned by sells (deduped). Used to derive the net
// capital actually contributed: buys − sells. Money returned by a sale and
// reinvested into another position should not be counted twice as "invested".
export function sumSellProceeds(txns: Transaction[]): number {
  let total = 0;
  for (const t of dedupeTransactions(txns)) {
    if (t.sellShares != null && t.sellShares > 0) {
      total += t.sellValue ?? t.sellShares * (t.sellPrice ?? 0);
    }
  }
  return total;
}

function yearOf(date: string | null): number | null {
  if (!date) return null;
  const y = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

// Exact "euros realised" per calendar year: realized sale results + recorded
// dividends + recorded interest, each bucketed by the date they happened.
export function computeYearlyBreakdown(
  txns: Transaction[],
  dividends: Dividend[],
  interests: Interest[],
): YearlyBreakdown[] {
  const realizedByYear = computeRealizedPLByYear(txns);

  const map = new Map<number, YearlyBreakdown>();
  const ensure = (year: number): YearlyBreakdown => {
    let row = map.get(year);
    if (!row) {
      row = { year, realized: 0, dividends: 0, interests: 0, total: 0 };
      map.set(year, row);
    }
    return row;
  };

  for (const r of realizedByYear) ensure(r.year).realized += r.total;

  for (const d of dividends) {
    const y = yearOf(d.date);
    if (y == null) continue;
    ensure(y).dividends += d.amount;
  }

  for (const i of interests) {
    const y = yearOf(i.date);
    if (y == null) continue;
    ensure(y).interests += i.amount;
  }

  const out = [...map.values()];
  for (const row of out) row.total = row.realized + row.dividends + row.interests;
  return out.sort((a, b) => b.year - a.year);
}

export type SinceInception = {
  grossInvested: number; // lifetime gross buy total (EUR), all operations
  sellProceeds: number; // lifetime gross sell proceeds (EUR)
  netInvested: number; // grossInvested − sellProceeds = money out of pocket
  openCost: number; // cost basis of currently open positions
  currentValue: number; // current market value of open positions
  unrealized: number; // currentValue − openCost
  realized: number; // lifetime realized P&L from all closed sales
  dividends: number; // lifetime recorded dividends
  interests: number; // lifetime recorded interest
  totalGain: number; // unrealized + realized + dividends + interests
  returnPct: number | null; // totalGain / netInvested
};

export function computeSinceInception(input: {
  txns: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  currentValue: number;
  openCost: number;
  realized: number;
}): SinceInception {
  const grossInvested = sumBuyCost(input.txns);
  const sellProceeds = sumSellProceeds(input.txns);
  // Net capital the user actually contributed from their own pocket. Capital
  // recycled through a sale into a new position is not double-counted. With
  // this base the identity holds: totalGain ≈ currentValue − netInvested
  // (+ income), so the % return is economically meaningful.
  const netInvested = grossInvested - sellProceeds;
  const dividends = input.dividends.reduce((s, d) => s + d.amount, 0);
  const interests = input.interests.reduce((s, i) => s + i.amount, 0);
  const unrealized = input.currentValue > 0 ? input.currentValue - input.openCost : 0;
  const totalGain = unrealized + input.realized + dividends + interests;
  return {
    grossInvested,
    sellProceeds,
    netInvested,
    openCost: input.openCost,
    currentValue: input.currentValue,
    unrealized,
    realized: input.realized,
    dividends,
    interests,
    totalGain,
    returnPct: netInvested > 0 ? totalGain / netInvested : null,
  };
}
