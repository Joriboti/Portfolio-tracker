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

// A plausible market symbol: letters, digits, and the dot/dash that suffix
// exchanges (AIR.PA) and share classes (BRK-B). Narrow enough that "garbage" or
// a stray path segment never becomes a page.
const SYMBOL = /^[A-Z0-9]{1,8}([.-][A-Z0-9]{1,4})?$/;

/**
 * "aapl-vs-msft" → { a: "AAPL", b: "MSFT" }, or null when the slug isn't two
 * distinct, plausible symbols.
 *
 * Any pair parses, not just the curated ones — the picker lets a visitor put
 * two companies of their own choosing side by side, exactly as /explore/:ticker
 * resolves any symbol. What keeps the unbounded URL space out of search is
 * indexing, not routing: only `isCuratedPair` pages are sitemapped,
 * prerendered and indexable; everything else is a working page marked noindex.
 */
export function parsePairSlug(slug: string): Pair | null {
  const i = slug.toLowerCase().indexOf(SEP);
  if (i <= 0) return null;
  // Symbols can contain "-" (BRK-B), so split on the first separator only.
  const a = slug.slice(0, i).toUpperCase();
  const b = slug.slice(i + SEP.length).toUpperCase();
  if (a === b || !SYMBOL.test(a) || !SYMBOL.test(b)) return null;
  return { a, b };
}

/** The curated entry for these two symbols, in its curated direction. */
export function curatedPair({ a, b }: Pair): Pair | null {
  const [x, y] = [a.toUpperCase(), b.toUpperCase()];
  return (
    COMPARE_PAIRS.find(
      (p) => (p.a === x && p.b === y) || (p.a === y && p.b === x),
    ) ?? null
  );
}

export function isCuratedPair(pair: Pair): boolean {
  return curatedPair(pair) != null;
}

/**
 * The one spelling of a pair that gets a page, so A-vs-B and B-vs-A never
 * compete as duplicates: the curated direction when there is one, alphabetical
 * otherwise. The page redirects anything else here.
 */
export function canonicalPair(pair: Pair): Pair {
  const curated = curatedPair(pair);
  if (curated) return curated;
  const [a, b] = [pair.a.toUpperCase(), pair.b.toUpperCase()].sort();
  return { a, b };
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
