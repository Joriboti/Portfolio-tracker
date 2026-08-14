// Price-derived history: the rebased price series behind a head-to-head, and
// the trailing-P/E series behind the rating charts. Pure — no API, no React;
// covered by pe-history.test.ts.
//
// Nobody publishes a P/E time series, so it is reconstructed the only way the
// data allows: a weekly close divided by the trailing-twelve-month EPS that had
// actually been REPORTED by that week. Using today's TTM EPS across the whole
// history would draw a curve that is just the price in disguise, and would
// quietly claim the market knew figures it could not have seen.

import type { PricePoint, StatementRow } from "@/lib/statements";

export type Point = { date: string; value: number };

/**
 * Trailing-twelve-month EPS as of `date`, or null.
 *
 * Four quarters ending on or before the date, and all four must be present:
 * a partial sum would understate earnings and inflate the P/E, which is worse
 * than a gap in the line. Results are unreliable for a quarter reported but not
 * yet filed on that exact day — a few weeks of lag at each boundary — which is
 * acceptable for a shape, not for a screenshot of a single week.
 */
export function ttmEpsAt(quarters: StatementRow[], date: string): number | null {
  const eligible: number[] = [];
  for (const q of quarters) {
    if (q.periodEnd > date) break;
    const eps = q.metrics.eps;
    if (eps != null) eligible.push(eps);
  }
  if (eligible.length < 4) return null;
  return eligible.slice(-4).reduce((s, v) => s + v, 0);
}

/**
 * Weekly trailing P/E. Quarters must be ascending by periodEnd (the API returns
 * them that way).
 *
 * Loss-making periods are dropped rather than plotted: a negative P/E is not a
 * cheap company, and one such point rescales the whole axis.
 */
export function peSeries(
  prices: PricePoint[],
  quarters: StatementRow[],
): Point[] {
  const out: Point[] = [];
  for (const p of prices) {
    const ttm = ttmEpsAt(quarters, p.date);
    if (ttm == null || ttm <= 0) continue;
    out.push({ date: p.date, value: p.close / ttm });
  }
  return out;
}

/**
 * Prices indexed to 100 at the first point, which is what makes two companies
 * comparable on one axis when one trades at $8 and the other at $800.
 */
export function rebase(prices: PricePoint[]): Point[] {
  const base = prices[0]?.close;
  if (!base) return [];
  return prices.map((p) => ({ date: p.date, value: (p.close / base) * 100 }));
}

/**
 * Both series cut to the window they share, so a company with five years of
 * history isn't drawn against one with two as if they started together.
 */
export function alignFrom<T extends { date: string }>(a: T[], b: T[]): [T[], T[]] {
  const from = a[0] && b[0] ? (a[0].date > b[0].date ? a[0].date : b[0].date) : null;
  if (!from) return [a, b];
  return [a.filter((p) => p.date >= from), b.filter((p) => p.date >= from)];
}

export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
