// The forecast series behind the "what analysts expect" charts: reported
// periods and un-reported ones on one axis, each estimate carrying the range
// analysts span rather than only their average. Pure — no API, no React;
// covered by estimates.test.ts.
//
// Two rules decide everything here, and both exist because breaking them
// produces a chart that looks right and says something false:
//
//   1. An estimate never sits on a period that has already reported. Yahoo's
//      "0q" is the quarter in progress at the time of ITS snapshot, which is a
//      quarter we may already have the actual for.
//   2. A beat/miss is only drawn between two figures from the same dataset.
//      Consensus is quoted on an adjusted basis and the income statement is
//      GAAP, so the reported-vs-expected markers come from Yahoo's own
//      earnings history, never from the statements.

import {
  annualLabel,
  quarterLabel,
  type CompanyStatements,
  type EstimateBand,
  type StatementRow,
} from "@/lib/statements";

/** One bar of a forecast chart: reported, expected, or (never) both. */
export type ForecastBar = {
  periodEnd: string;
  label: string;
  /** What the period actually did. Null for a period still ahead. */
  actual: number | null;
  /** What analysts expect. Null for a period already reported. */
  estimate: EstimateBand | null;
  /** What analysts HAD expected of a reported period, for the marker. */
  consensus: number | null;
  /** (actual − consensus) / |consensus|, or null when either side is missing. */
  surprise: number | null;
};

const DAY = 24 * 3600 * 1000;

/**
 * How far apart two dates may be and still mean the same fiscal period.
 *
 * Yahoo dates its earnings history by the quarter's calendar end and its trend
 * rows by the fiscal one, and the two drift by a few weeks for anyone whose
 * year does not end in December. Wide enough to pair those, far short of the
 * ~90 days that would let a neighbouring quarter be mistaken for this one.
 */
const SAME_PERIOD_DAYS = 25;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
}

/**
 * Reported periods, then expected ones, as a single ascending axis.
 *
 * `consensusHistory` is optional and only ever attaches to periods that have
 * an actual: it is what makes a bar say "expected 2.31, delivered 2.40" rather
 * than just "2.40".
 */
export function buildForecast(input: {
  actuals: Array<{ periodEnd: string; value: number }>;
  estimates: Array<{ periodEnd: string; band: EstimateBand }>;
  consensusHistory?: Array<{ periodEnd: string; estimate: number | null }>;
  annual?: boolean;
  /** Reported periods to keep, newest-first. Older ones are the trend chart's job. */
  maxActuals?: number;
}): ForecastBar[] {
  const label = input.annual ? annualLabel : quarterLabel;
  const actuals = [...input.actuals].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  );
  const kept = actuals.slice(-(input.maxActuals ?? (input.annual ? 5 : 8)));
  const lastReported = actuals[actuals.length - 1]?.periodEnd ?? null;

  const bars: ForecastBar[] = kept.map((a) => {
    const match = input.consensusHistory?.find(
      (h) => daysApart(h.periodEnd, a.periodEnd) <= SAME_PERIOD_DAYS,
    );
    const consensus = match?.estimate ?? null;
    return {
      periodEnd: a.periodEnd,
      label: label(a.periodEnd),
      actual: a.value,
      estimate: null,
      consensus,
      surprise:
        consensus != null && Math.abs(consensus) > 1e-9
          ? (a.value - consensus) / Math.abs(consensus)
          : null,
    };
  });

  const seen = new Set(bars.map((b) => b.periodEnd));
  for (const e of [...input.estimates].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  )) {
    // Rule 1: anything that has reported, or is close enough to a reported
    // period to be it, is not a forecast any more.
    if (lastReported && e.periodEnd <= lastReported) continue;
    if (lastReported && daysApart(e.periodEnd, lastReported) <= SAME_PERIOD_DAYS) {
      continue;
    }
    if (seen.has(e.periodEnd)) continue;
    seen.add(e.periodEnd);
    bars.push({
      periodEnd: e.periodEnd,
      label: label(e.periodEnd),
      actual: null,
      estimate: e.band,
      consensus: null,
      surprise: null,
    });
  }
  return bars;
}

/** The trend rows for one period type, as the builder wants them. */
function bands(
  data: CompanyStatements,
  annual: boolean,
  key: "eps" | "revenue",
  scale = 1,
): Array<{ periodEnd: string; band: EstimateBand }> {
  const wanted = annual ? ["0y", "+1y"] : ["0q", "+1q"];
  return (data.panel?.forecast?.periods ?? [])
    .filter((p) => wanted.includes(p.period) && p[key] != null)
    .map((p) => {
      const b = p[key] as EstimateBand;
      return {
        periodEnd: p.periodEnd,
        band:
          scale === 1
            ? b
            : {
                ...b,
                avg: b.avg * scale,
                low: b.low == null ? null : b.low * scale,
                high: b.high == null ? null : b.high * scale,
              },
      };
    });
}

function reported(
  rows: StatementRow[],
  key: "eps" | "revenue",
): Array<{ periodEnd: string; value: number }> {
  return rows
    .filter((r) => r.metrics[key] != null)
    .map((r) => ({ periodEnd: r.periodEnd, value: r.metrics[key] as number }));
}

/**
 * Revenue, reported and expected, in the currency the company files in.
 *
 * No conversion anywhere: a revenue estimate is a company-level total in the
 * same currency as the income statement it will land on, even for an ADR that
 * quotes elsewhere.
 */
export function revenueForecast(
  data: CompanyStatements,
  period: "q" | "a",
): ForecastBar[] {
  const annual = period === "a";
  return buildForecast({
    actuals: reported(annual ? data.annual : data.quarters, "revenue"),
    estimates: bands(data, annual, "revenue"),
    annual,
  });
}

/**
 * The factor that puts a trend EPS in the quote currency.
 *
 * Only the ADRs need it, and only they get the measured one: for a company
 * that files and trades in the same currency the estimate is already in that
 * currency, and applying a ratio derived from a possibly-stale forwardPE would
 * shift the forecast bars a percent or two away from the actuals beside them
 * for no reason. Null means "cannot be stated honestly" — the caller draws
 * nothing rather than a figure off by a factor of thirty.
 */
export function epsEstimateScale(data: CompanyStatements): number | null {
  const filing = data.panel?.financialCurrency ?? null;
  const quote = data.panel?.quoteCurrency ?? null;
  if (!filing || !quote || filing === quote) return 1;
  const measured = data.panel?.forecast?.epsScale ?? null;
  return measured != null && measured > 0 ? measured : null;
}

/**
 * Earnings per share, reported and expected.
 *
 * Quarterly is built entirely from Yahoo's estimates dataset — its own record
 * of what each quarter earned, beside what had been expected of it — so the
 * beat/miss markers compare like with like. Annual has no such record, so it
 * pairs the reported fiscal years with consensus and draws no markers; both
 * sides are put into the quote currency first, `toQuote` for the filings and
 * the estimate scale for the forecasts.
 */
export function epsForecast(
  data: CompanyStatements,
  period: "q" | "a",
  toQuote: (date: string) => number | null = () => 1,
): ForecastBar[] {
  const scale = epsEstimateScale(data);
  if (scale == null) return [];

  if (period === "q") {
    const history = data.panel?.forecast?.epsHistory ?? [];
    if (history.length === 0) return [];
    return buildForecast({
      actuals: history.map((h) => ({ periodEnd: h.periodEnd, value: h.actual })),
      estimates: bands(data, false, "eps", scale),
      consensusHistory: history,
      maxActuals: 8,
    });
  }

  const actuals: Array<{ periodEnd: string; value: number }> = [];
  for (const r of data.annual) {
    const eps = r.metrics.eps;
    if (eps == null) continue;
    const rate = toQuote(r.periodEnd);
    if (rate == null) continue;
    actuals.push({ periodEnd: r.periodEnd, value: eps * rate });
  }
  return buildForecast({
    actuals,
    estimates: bands(data, true, "eps", scale),
    annual: true,
  });
}

/**
 * Two forecast series cut to the same number of reported periods.
 *
 * Revenue can show eight quarters and EPS only four — the consensus dataset is
 * that shallow, and the deeper series cannot be borrowed for it without mixing
 * an adjusted figure with a GAAP one. Side by side under one heading and one
 * toggle, two different spans read as a bug rather than as two datasets, and
 * the reader who wants the long revenue history has the statements grid right
 * below. The pair is worth more here than the depth.
 *
 * A series with nothing reported is left alone: it has no history to trim, and
 * cutting the other one to match would leave both empty.
 */
export function alignReported(
  a: ForecastBar[],
  b: ForecastBar[],
): [ForecastBar[], ForecastBar[]] {
  const reportedCount = (bars: ForecastBar[]) =>
    bars.filter((x) => x.actual != null).length;
  const na = reportedCount(a);
  const nb = reportedCount(b);
  if (na === 0 || nb === 0) return [a, b];
  const keep = Math.min(na, nb);
  return [a.slice(na - keep), b.slice(nb - keep)];
}

/** The first period still ahead, which is the one a reader is looking for. */
export function nextEstimate(bars: ForecastBar[]): ForecastBar | null {
  return bars.find((b) => b.estimate != null) ?? null;
}
