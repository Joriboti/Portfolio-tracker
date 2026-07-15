// Pure logic for the programmatic comparison pages (/explore/compare/:pair).
// Slug parsing + aligning two companies' statements onto one axis. No API or
// React here — covered by compare.test.ts.

import pairs from "@/data/compare-pairs.json";
import tickers from "@/data/tickers.json";
import {
  annualLabel,
  quarterLabel,
  type StatementMetrics,
  type StatementRow,
} from "@/lib/statements";

export type Pair = { a: string; b: string };

export const COMPARE_PAIRS = pairs as Pair[];

const NAMES: Record<string, string> = Object.fromEntries(
  (tickers as { symbol: string; name: string }[]).map((t) => [
    t.symbol.toUpperCase(),
    t.name,
  ]),
);

export function companyName(symbol: string): string {
  return NAMES[symbol.toUpperCase()] ?? symbol.toUpperCase();
}

const SEP = "-vs-";

/** { a: "AAPL", b: "MSFT" } → "aapl-vs-msft". */
export function pairSlug({ a, b }: Pair): string {
  return `${a.toLowerCase()}${SEP}${b.toLowerCase()}`;
}

/**
 * "aapl-vs-msft" → { a: "AAPL", b: "MSFT" }, or null.
 *
 * Only curated pairs resolve: the page needs both sides to be tickers we
 * actually cover, and leaving it open would mint an unbounded number of thin,
 * near-duplicate URLs — exactly the programmatic-SEO pattern search engines
 * penalise. Order-insensitive, so /msft-vs-aapl finds the same pair (the page
 * canonicalises to the curated direction).
 */
export function parsePairSlug(slug: string): Pair | null {
  const i = slug.toLowerCase().indexOf(SEP);
  if (i <= 0) return null;
  // Symbols can contain "-" (BRK-B), so split on the first separator only.
  const a = slug.slice(0, i).toUpperCase();
  const b = slug.slice(i + SEP.length).toUpperCase();
  if (!a || !b || a === b) return null;
  return (
    COMPARE_PAIRS.find(
      (p) =>
        (p.a === a && p.b === b) || (p.a === b && p.b === a),
    ) ?? null
  );
}

export type AlignedSeries = {
  labels: string[];
  a: Array<number | null>;
  b: Array<number | null>;
};

/**
 * One metric for two companies on a shared axis.
 *
 * Periods are keyed by calendar-quarter label, which is what makes companies on
 * different fiscal calendars comparable: Apple's quarter ending 28 Dec and
 * Microsoft's ending 31 Dec are both "Q4 25" and line up as one pair of bars.
 * A period only either side reports still gets a slot, with a null on the
 * missing side, so the axis never silently drops history.
 */
export function alignSeries(
  rowsA: StatementRow[],
  rowsB: StatementRow[],
  key: keyof StatementMetrics,
  opts?: { annual?: boolean; last?: number },
): AlignedSeries {
  const label = opts?.annual ? annualLabel : quarterLabel;
  type Slot = { sort: string; a: number | null; b: number | null };
  const slots = new Map<string, Slot>();

  const add = (rows: StatementRow[], side: "a" | "b") => {
    for (const r of rows) {
      const v = r.metrics[key];
      if (v == null) continue;
      const l = label(r.periodEnd);
      const slot = slots.get(l) ?? { sort: r.periodEnd, a: null, b: null };
      slot[side] = v;
      // Sort by the earliest period end seen for the label, so the two sides'
      // few-day fiscal drift can't reorder the axis.
      if (r.periodEnd < slot.sort) slot.sort = r.periodEnd;
      slots.set(l, slot);
    }
  };
  add(rowsA, "a");
  add(rowsB, "b");

  const ordered = [...slots.entries()].sort((x, y) =>
    x[1].sort.localeCompare(y[1].sort),
  );
  const kept = opts?.last ? ordered.slice(-opts.last) : ordered;
  return {
    labels: kept.map(([l]) => l),
    a: kept.map(([, s]) => s.a),
    b: kept.map(([, s]) => s.b),
  };
}

/** Pairs featuring `symbol`, for cross-linking from its /explore page. */
export function pairsFor(symbol: string): Pair[] {
  const s = symbol.toUpperCase();
  return COMPARE_PAIRS.filter((p) => p.a === s || p.b === s);
}

/**
 * Yahoo symbol for the `from` → `to` rate, or null when no conversion is needed.
 *
 * Yahoo names USD-base crosses without the "USD" prefix — asking for USDEUR=X
 * answers as EUR=X, which would then miss a lookup keyed by the requested
 * symbol — so USD bases are built in that short form directly.
 */
export function fxSymbol(from: string, to: string): string | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (!f || !t || f === t) return null;
  return f === "USD" ? `${t}=X` : `${f}${t}=X`;
}

/** Multiply the non-null values of a series by `rate`. */
export function convertValues(
  values: Array<number | null>,
  rate: number,
): Array<number | null> {
  return values.map((v) => (v == null ? null : v * rate));
}
