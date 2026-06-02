import type { Transaction, Dividend, Interest } from "./excel-parser";
import { computeRealizedPLByYear } from "./excel-parser";

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

// Sum of every euro ever deployed into buys. Falls back to shares × buyPrice
// when the broker omitted the line-total. This is the "capital invertit"
// denominator for the since-inception return.
export function sumBuyCost(txns: Transaction[]): number {
  let total = 0;
  for (const t of txns) {
    if (t.buyPrice != null && t.shares > 0) {
      total += t.buyValue ?? t.shares * t.buyPrice;
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
  grossInvested: number; // lifetime buy cost (EUR)
  openCost: number; // cost basis of currently open positions
  currentValue: number; // current market value of open positions
  unrealized: number; // currentValue − openCost
  realized: number; // lifetime realized P&L from all closed sales
  dividends: number; // lifetime recorded dividends
  interests: number; // lifetime recorded interest
  totalGain: number; // unrealized + realized + dividends + interests
  returnPct: number | null; // totalGain / grossInvested
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
  const dividends = input.dividends.reduce((s, d) => s + d.amount, 0);
  const interests = input.interests.reduce((s, i) => s + i.amount, 0);
  const unrealized = input.currentValue > 0 ? input.currentValue - input.openCost : 0;
  const totalGain = unrealized + input.realized + dividends + interests;
  return {
    grossInvested,
    openCost: input.openCost,
    currentValue: input.currentValue,
    unrealized,
    realized: input.realized,
    dividends,
    interests,
    totalGain,
    returnPct: grossInvested > 0 ? totalGain / grossInvested : null,
  };
}
