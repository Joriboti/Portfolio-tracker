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

// Dated cash flow from the investor's perspective: negative = money out of
// pocket (a buy), positive = money received (a sell, dividend, interest, or
// the terminal market value if liquidated today).
export type CashFlow = { date: string; amount: number };

// Build the dated cash-flow series used for the money-weighted return (XIRR).
// Buys with no recorded date fall back to the earliest known date (parser
// convention: an undated buy was held "from the beginning"); undated sells
// fall back to `asOf` (treated as recent). The terminal market value is added
// by the caller.
export function buildCashFlows(
  txns: Transaction[],
  dividends: Dividend[],
  interests: Interest[],
): CashFlow[] {
  const deduped = dedupeTransactions(txns);
  const dates: string[] = [];
  for (const t of deduped) {
    if (t.buyDate) dates.push(t.buyDate);
    if (t.sellDate) dates.push(t.sellDate);
  }
  for (const d of dividends) if (d.date) dates.push(d.date);
  for (const i of interests) if (i.date) dates.push(i.date);
  const earliest = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  const today = new Date().toISOString().slice(0, 10);

  const flows: CashFlow[] = [];
  for (const t of deduped) {
    if (t.buyPrice != null && t.shares > 0) {
      const amt = t.buyValue ?? t.shares * t.buyPrice;
      if (amt > 0) flows.push({ date: t.buyDate ?? earliest ?? today, amount: -amt });
    }
    if (t.sellShares != null && t.sellShares > 0) {
      const amt = t.sellValue ?? t.sellShares * (t.sellPrice ?? 0);
      if (amt > 0) flows.push({ date: t.sellDate ?? today, amount: amt });
    }
  }
  for (const d of dividends) if (d.amount > 0) flows.push({ date: d.date ?? today, amount: d.amount });
  for (const i of interests) if (i.amount > 0) flows.push({ date: i.date ?? today, amount: i.amount });
  return flows;
}

function yearsBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return (tb - ta) / (365 * 86400000);
}

// Money-weighted annualised return (XIRR): the rate r that makes the dated
// cash flows' net present value zero. Newton-Raphson from 10%, with a
// bisection fallback for the cases where Newton diverges. Returns null when
// the flows don't bracket a solution (e.g. all same sign).
export function computeXIRR(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasNeg = flows.some((f) => f.amount < 0);
  const hasPos = flows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = flows.reduce((m, f) => (f.date < m ? f.date : m), flows[0].date);
  const ts = flows.map((f) => yearsBetween(t0, f.date));

  const npv = (r: number): number => {
    let s = 0;
    for (let i = 0; i < flows.length; i++) s += flows[i].amount / Math.pow(1 + r, ts[i]);
    return s;
  };
  const dNpv = (r: number): number => {
    let s = 0;
    for (let i = 0; i < flows.length; i++) {
      s += (-ts[i] * flows[i].amount) / Math.pow(1 + r, ts[i] + 1);
    }
    return s;
  };

  // Newton-Raphson
  let r = 0.1;
  for (let i = 0; i < 60; i++) {
    const f = npv(r);
    const d = dNpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-7) return next;
    r = next;
  }

  // Bisection fallback over a wide bracket.
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
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
  returnPct: number | null; // totalGain / netInvested (cumulative, simple)
  irr: number | null; // money-weighted annualised return (XIRR)
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

  // XIRR: dated cash flows plus the current market value as a terminal inflow
  // (as if the portfolio were liquidated today). Only meaningful once there's
  // a live valuation — without prices the terminal value is 0 and the rate
  // would be nonsense, so we skip it.
  let irr: number | null = null;
  if (input.currentValue > 0) {
    const flows = buildCashFlows(input.txns, input.dividends, input.interests);
    flows.push({
      date: new Date().toISOString().slice(0, 10),
      amount: input.currentValue,
    });
    irr = computeXIRR(flows);
  }

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
    irr,
  };
}
