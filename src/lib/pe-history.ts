// Price-derived history: the rebased price series behind a head-to-head, and
// the trailing- and forward-P/E series behind the rating charts. Pure — no API,
// no React; covered by pe-history.test.ts.
//
// Nobody publishes a P/E time series, so it is reconstructed the only way the
// data allows: a weekly close divided by the earnings per share that had
// actually been REPORTED by that week. Using today's EPS across the whole
// history would draw a curve that is just the price in disguise, and would
// quietly claim the market knew figures it could not have seen.

import type { CompanyStatements, PricePoint, StatementRow } from "@/lib/statements";

export type Point = { date: string; value: number };

/**
 * One period's earnings per share, dated by the period it covers.
 *
 * `quoted` marks a figure that is already in the currency the share trades in
 * and must not be converted again. Reported earnings are in the currency the
 * company files in; analyst consensus, by the time the API has normalised it,
 * is in the quote currency. A forward series runs through both.
 */
export type EpsPoint = { periodEnd: string; eps: number; quoted?: boolean };

/**
 * How long after a fiscal year ends before the market knows what it earned.
 *
 * Quarterly rows need no such guard: they arrive every thirteen weeks, so
 * reading one a fortnight early moves the line by less than the line's own
 * noise. An annual row does — held from the first day of the year it reports
 * on, it would put figures into the market's hands a full quarter before
 * anyone had them, across a fifth of a five-year chart.
 *
 * Six weeks, which is where the announcement lands rather than where the
 * filing does: TSM reported its 2025 year on the 16th of January, SAP on the
 * 28th, NVO and Shell on the 30th and 31st. The 10-K and the 20-F follow
 * weeks or months later, but the market had already repriced. Erring long is
 * not the safe direction it looks: holding last year's earnings past the
 * announcement leaves a stale multiple standing where the real one had
 * already dropped, which is a spike in the line that never happened.
 */
const REPORTING_LAG_DAYS = 45;

const DAY_MS = 24 * 3600 * 1000;

function plusDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Rows with a usable EPS, ascending, as bare period/value pairs. */
export function epsPoints(rows: StatementRow[]): EpsPoint[] {
  return rows
    .filter((r) => r.metrics.eps != null)
    .map((r) => ({ periodEnd: r.periodEnd, eps: r.metrics.eps as number }))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/**
 * The fiscal years a forward multiple can be read against: the ones that have
 * been reported, then consensus for the ones that haven't.
 *
 * A reported year always wins over an estimate for the same year — "0y" is
 * still a forecast for a year the company has already closed the books on if
 * the results landed between Yahoo's snapshot and ours.
 */
export function forwardEpsPoints(
  annual: EpsPoint[],
  estimates: Array<{ periodEnd: string; eps: number }> = [],
): EpsPoint[] {
  const lastReported = annual[annual.length - 1]?.periodEnd;
  const future = estimates
    .filter((e) => !lastReported || e.periodEnd > lastReported)
    .map((e) => ({ ...e, quoted: true }));
  return [...annual, ...future].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/** The longest four quarters may span and still be a year. */
const TTM_SPAN_DAYS = 340;

/**
 * Trailing-twelve-month EPS as of `date`, dated by the quarter it runs to, or
 * null.
 *
 * Four quarters ending on or before the date, and all four must be present:
 * a partial sum would understate earnings and inflate the P/E, which is worse
 * than a gap in the line. Results are unreliable for a quarter reported but not
 * yet filed on that exact day — a few weeks of lag at each boundary — which is
 * acceptable for a shape, not for a screenshot of a single week.
 *
 * They must also be four CONSECUTIVE quarters, which taking the last four of
 * whatever exists does not guarantee. A company that reports twice a year
 * leaves gaps, and EDGAR frames only some of the quarters a 20-F filer files:
 * Shell has twenty-three quarterly figures spread over nine years, and summing
 * four of those picked from three different years produced a "trailing year"
 * that was sometimes negative — which the chart then dropped, taking four
 * years of Shell's history with it.
 */
export function ttmAt(quarters: StatementRow[], date: string): EpsPoint | null {
  const eligible: EpsPoint[] = [];
  for (const q of quarters) {
    if (q.periodEnd > date) break;
    if (q.metrics.eps != null) {
      eligible.push({ periodEnd: q.periodEnd, eps: q.metrics.eps });
    }
  }
  if (eligible.length < 4) return null;
  const year = eligible.slice(-4);
  const span = Date.parse(year[3].periodEnd) - Date.parse(year[0].periodEnd);
  if (span > TTM_SPAN_DAYS * DAY_MS) return null;
  return {
    periodEnd: year[3].periodEnd,
    eps: year.reduce((s, q) => s + q.eps, 0),
  };
}

/** The same figure as a bare number, for callers that don't need its date. */
export function ttmEpsAt(quarters: StatementRow[], date: string): number | null {
  return ttmAt(quarters, date)?.eps ?? null;
}

/**
 * The freshest trailing EPS the market could see on `date`: four consecutive
 * quarters, or the last full year announced by then — whichever runs to the
 * later period.
 *
 * The annual arm is what gives the chart a past. Yahoo's free window is five
 * quarters, so four-quarters-or-nothing left every company we had not
 * backfilled from EDGAR with about two quarters of drawable history — a P/E
 * "history" six months wide, which says nothing about whether a rating is
 * high. Foreign private issuers never report quarterly at all: for them the
 * annual row is not a fallback, it is the only figure there is.
 *
 * Which arm wins is decided per week rather than once, because neither is
 * reliably ahead. A US filer's quarters are always the more recent number. A
 * company whose quarterly coverage is patchy has weeks where the last full
 * year it announced is months newer than the last four quarters on file, and
 * on those weeks that is what the market was actually pricing.
 */
export function trailingEpsAt(
  quarters: StatementRow[],
  annual: EpsPoint[],
  date: string,
): EpsPoint | null {
  const ttm = ttmAt(quarters, date);
  let year: EpsPoint | null = null;
  for (const a of annual) {
    if (plusDays(a.periodEnd, REPORTING_LAG_DAYS) > date) break;
    year = a;
  }
  if (!ttm) return year;
  if (!year) return ttm;
  return year.periodEnd > ttm.periodEnd ? year : ttm;
}

/**
 * EPS for the fiscal year the market was looking forward to on `date`: not the
 * year in progress, the one after it.
 *
 * That is a fiscal year further out than "forward" sounds, and it is chosen
 * rather than inherited. It is the year every screener means by a forward
 * multiple, Yahoo's forwardPe among them — so the end of this line lands on
 * the same number the stat panel two cards up is showing, instead of quietly
 * disagreeing with it by a fifth.
 *
 * For any date old enough, that year has since happened, so the figure is the
 * one that actually landed; for the last stretch of the chart it is the
 * analyst consensus, which the caller appends to `annual` as an estimated
 * period. Deliberately the same construction throughout: a curve half built
 * from next-twelve-month quarterly sums and half from fiscal years would
 * change meaning halfway along.
 *
 * Read the finished series for what it is. The past of a forward multiple is
 * unknowable — nobody stores what analysts USED to expect — so this is what
 * the market paid against earnings that turned out, not against the earnings
 * it was forecasting at the time. Where the two differ, the difference is
 * exactly the forecast error, and the line is drawn without it.
 */
export function forwardEpsAt(annual: EpsPoint[], date: string): EpsPoint | null {
  let ahead = 0;
  for (const a of annual) {
    if (a.periodEnd > date && ++ahead === 2) return a;
  }
  return null;
}

/**
 * Weekly P/E from a close and an EPS-as-of-that-week. Quarters must be
 * ascending by periodEnd (the API returns them that way).
 *
 * `toQuote` converts one unit of the filing currency into the currency the
 * price is quoted in. It is not optional decoration: TSM quotes in USD and
 * reports in TWD, so without it the chart divided 425.83 by 431.30 and drew a
 * confident, meaningless 1.0×. A null from it drops the week rather than
 * drawing an unconverted one.
 */
function series(
  prices: PricePoint[],
  epsAt: (date: string) => EpsPoint | null,
  toQuote: (date: string) => number | null,
): Point[] {
  const out: Point[] = [];
  for (const p of prices) {
    const eps = epsAt(p.date);
    if (eps == null) continue;
    const rate = eps.quoted ? 1 : toQuote(p.date);
    if (rate == null) continue;
    const converted = eps.eps * rate;
    // Loss-making periods are dropped rather than plotted: a negative P/E is
    // not a cheap company, and one such point rescales the whole axis.
    if (converted <= 0) continue;
    out.push({ date: p.date, value: p.close / converted });
  }
  return out;
}

const SAME_CURRENCY = () => 1;

export function peSeries(
  prices: PricePoint[],
  quarters: StatementRow[],
  annual: EpsPoint[] = [],
  toQuote: (date: string) => number | null = SAME_CURRENCY,
): Point[] {
  return series(prices, (d) => trailingEpsAt(quarters, annual, d), toQuote);
}

export function forwardPeSeries(
  prices: PricePoint[],
  annual: EpsPoint[],
  toQuote: (date: string) => number | null = SAME_CURRENCY,
): Point[] {
  return series(prices, (d) => forwardEpsAt(annual, d), toQuote);
}

/**
 * Step lookup over a weekly rate series: the last rate quoted on or before the
 * date. Steps rather than interpolates — a rate is a fact about a day, and the
 * FX weeks do not always land on the price weeks.
 *
 * Returns null before the series starts, which drops those weeks from the
 * chart. Given `null` for the whole series it converts nothing, so a ticker
 * whose rate could not be fetched draws no P/E at all rather than one off by
 * a factor of thirty.
 */
export function rateLookup(
  fx: Array<{ date: string; rate: number }> | null,
): (date: string) => number | null {
  if (fx == null) return () => null;
  if (fx.length === 0) return SAME_CURRENCY;
  const sorted = [...fx].sort((a, b) => a.date.localeCompare(b.date));
  return (date) => {
    let rate: number | null = null;
    for (const p of sorted) {
      if (p.date > date) break;
      rate = p.rate;
    }
    return rate;
  };
}

/**
 * The converter one company's payload needs, chosen from what it says about
 * itself: nothing to do when it files and trades in the same currency, the
 * weekly rate when it doesn't, and nothing drawable when it doesn't and the
 * rate is missing.
 *
 * `fallbackQuote` covers a payload cached before the API returned a quote
 * currency; the caller knows it from the company record.
 */
export function quoteConverter(
  statements: Pick<CompanyStatements, "panel" | "fx"> | null,
  fallbackQuote?: string | null,
): (date: string) => number | null {
  const filing = statements?.panel?.financialCurrency ?? null;
  const quote = statements?.panel?.quoteCurrency ?? fallbackQuote ?? null;
  const needsFx = !!filing && !!quote && filing !== quote;
  return rateLookup(needsFx ? (statements?.fx ?? null) : []);
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
