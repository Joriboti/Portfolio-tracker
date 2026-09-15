// Money, in one place: the native price a market quotes, the conversion into
// the currency a page displays, the row a position becomes once every figure
// on it is in that one currency, and the compact "4.81 T USD" label for big
// balance-sheet numbers.
//
// The rules this file exists to enforce:
//   • A quote is stored and passed around as (price, currency) exactly as the
//     market gives it — never overwritten with a converted value.
//   • Conversion happens once, at the point of display, and either succeeds
//     with a known rate or fails loudly (status "no-fx"); it never silently
//     returns the unconverted number under the wrong currency label.
//   • Sub-unit quotes (London in pence, GBp) are normalised to the major unit
//     before anything else looks at them.
//   • Every figure on a position row (avg cost, current price, market value,
//     cost, P&L) is in the row's single `currency`, and the row says so.

import i18next from "i18next";

/** The currency the transaction book (cost basis, avg cost) is recorded in. */
export const BOOK_CURRENCY = "EUR";

/** Markets that quote in a sub-unit of the major currency. */
export const SUB_UNITS: Record<string, { major: string; divisor: number }> = {
  GBp: { major: "GBP", divisor: 100 }, // London, pence
  GBX: { major: "GBP", divisor: 100 }, // London, pence (broker spelling)
  ZAc: { major: "ZAR", divisor: 100 }, // Johannesburg, cents
  ILA: { major: "ILS", divisor: 100 }, // Tel Aviv, agorot
};

export type NativePrice = { price: number; currency: string };

/** A quote as the market gives it, brought to the major unit of its currency. */
export function normalizeQuote(
  price: number,
  currency: string | null | undefined,
  fallback = "USD",
): NativePrice {
  const ccy = (currency ?? "").trim() || fallback;
  const sub = SUB_UNITS[ccy];
  if (sub) return { price: price / sub.divisor, currency: sub.major };
  return { price, currency: ccy.toUpperCase() };
}

/**
 * {CCY: USD per 1 CCY} — the EURUSD=X convention Yahoo returns (EUR: 1.15 means
 * 1 EUR = 1.15 USD). USD itself is implied as 1.
 */
export type FxRates = Record<string, number>;

/** Multiplier taking 1 unit of `from` to `to`, or null when a rate is missing. */
export function fxFactor(from: string, to: string, rates: FxRates): number | null {
  const f = normalizeQuote(1, from).currency;
  const t = normalizeQuote(1, to).currency;
  if (f === t) return 1;
  const usdPerFrom = f === "USD" ? 1 : rates[f];
  const usdPerTo = t === "USD" ? 1 : rates[t];
  if (!usdPerFrom || !usdPerTo || !Number.isFinite(usdPerFrom) || !Number.isFinite(usdPerTo)) {
    return null;
  }
  return usdPerFrom / usdPerTo;
}

export type Converted = { value: number; rate: number; from: string; to: string };

/**
 * `amount` of `from` in `to`, or null when no rate is known. Pence and other
 * sub-units are handled here, so a 2,650 GBp quote comes out as 26.50 GBP
 * before any FX is applied.
 */
export function convertMoney(
  amount: number,
  from: string | null | undefined,
  to: string,
  rates: FxRates,
): Converted | null {
  if (!Number.isFinite(amount)) return null;
  const native = normalizeQuote(amount, from);
  const target = normalizeQuote(1, to).currency;
  const rate = fxFactor(native.currency, target, rates);
  if (rate == null) return null;
  return { value: native.price * rate, rate, from: native.currency, to: target };
}

// ---------------------------------------------------------------------------
// Plausibility: a converted figure that is wildly off the native one means a
// bad rate (inverted, stale, in the wrong unit) or a conversion applied on top
// of another. The check is by magnitude, so it catches pence-vs-pounds and an
// inverted JPY rate; it cannot see a 15% error, which is what a EUR/USD double
// conversion looks like — that case is prevented structurally (one conversion,
// here) rather than detected.

/** Rough USD value of one unit, generous enough to survive years of drift. */
const ROUGH_USD: Record<string, number> = {
  USD: 1, EUR: 1.1, GBP: 1.3, CHF: 1.15, JPY: 0.0068, CAD: 0.73, AUD: 0.66,
  NZD: 0.6, DKK: 0.15, SEK: 0.095, NOK: 0.095, HKD: 0.128, SGD: 0.75,
  CNY: 0.14, INR: 0.012, KRW: 0.00073, TWD: 0.031, BRL: 0.18, MXN: 0.055,
  PLN: 0.25, CZK: 0.043, HUF: 0.0027, ILS: 0.27, ZAR: 0.055, TRY: 0.03,
};
const TOLERANCE = 2.5; // ×/÷ around the rough rate — FX moves, but not 2.5×.

let warnSink: ((message: string) => void) | null = (m) => console.warn(m);
const warned = new Set<string>();

/** Tests (and a quiet production) can redirect or silence the warnings. */
export function setMoneyWarningSink(sink: ((message: string) => void) | null): void {
  warnSink = sink;
  warned.clear();
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  warnSink?.(message);
}

/**
 * Returns a problem description when `conv` implies an implausible FX factor,
 * and logs it once per (label, pair). Null when the conversion looks sane.
 */
export function checkConversion(conv: Converted, label: string): string | null {
  const a = ROUGH_USD[conv.from];
  const b = ROUGH_USD[conv.to];
  const expected = a && b ? a / b : null;
  const lo = expected != null ? expected / TOLERANCE : 1 / 2000;
  const hi = expected != null ? expected * TOLERANCE : 2000;
  if (conv.rate >= lo && conv.rate <= hi) return null;
  const problem =
    `${label}: converted ${conv.from}→${conv.to} at ${conv.rate.toPrecision(4)}` +
    (expected != null ? ` but a plausible rate is ≈${expected.toPrecision(3)}` : "") +
    " — inverted/stale FX rate or a double conversion?";
  warnOnce(`${label}|${conv.from}|${conv.to}`, `[money] ${problem}`);
  return problem;
}

// ---------------------------------------------------------------------------
// Number locale

const NUMBER_LOCALES: Record<string, string> = { ca: "ca-ES", es: "es-ES", en: "en-US" };

/** The Intl locale for the UI language ("4,81" in ca/es, "4.81" in en). */
export function numberLocale(lang?: string): string {
  const l = (lang ?? i18next.language ?? "ca").slice(0, 2);
  return NUMBER_LOCALES[l] ?? "ca-ES";
}

// ---------------------------------------------------------------------------
// Big figures

const SCALES: Array<[number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * "4.81 T USD", "31.20 B EUR", "950.00 USD": short scale (K/M/B/T), two
 * decimals, currency code after. Short scale on purpose — Intl's compact
 * notation under a Catalan/Spanish locale prints "B" for 10^12 (bilió), which
 * is how Apple's 4.8 trillion market cap turned into "4,81 B USD".
 * A mantissa that rounds up to 1000 moves to the next unit (999.999 B → 1.00 T).
 */
export function formatLargeMoney(
  value: number | null | undefined,
  currency?: string | null,
  locale: string = numberLocale(),
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let div = 1;
  let unit = "";
  for (const [threshold, letter] of SCALES) {
    if (abs >= threshold) {
      div = threshold;
      unit = letter;
      break;
    }
  }
  let mantissa = value / div;
  if (unit && unit !== "T" && Math.abs(Math.round(mantissa * 100) / 100) >= 1000) {
    const idx = SCALES.findIndex(([, l]) => l === unit);
    const [nextDiv, nextUnit] = SCALES[idx - 1];
    div = nextDiv;
    unit = nextUnit;
    mantissa = value / div;
  }
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(mantissa);
  return [n, unit, currency ?? ""].filter(Boolean).join(" ");
}

/** A native quote with its own currency: "934,48 US$" / "2.650,00 GBp"-safe. */
export function formatNative(
  price: number,
  currency: string,
  locale: string = numberLocale(),
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(price)} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// A position, with every figure in one currency

export type PositionRowInput = {
  ticker: string;
  shares: number;
  /** Per share, in `costCurrency` (the book). */
  avgCost: number;
  /** Total, in `costCurrency` (the book). */
  totalCost: number;
  /** The latest quote as the market gives it, or null when there is none. */
  quote: { price: number; currency?: string | null } | null;
  /** The currency the page displays. */
  displayCurrency: string;
  fxRates: FxRates;
  costCurrency?: string;
};

export type PositionRowStatus =
  | "ok" // priced and converted
  | "no-quote" // nothing to price it with
  | "no-fx"; // quoted, but no rate to bring it (or the cost) into `currency`

export type PositionRow = {
  ticker: string;
  shares: number;
  /** Every monetary figure below is in this currency. */
  currency: string;
  /** The quote as the market gives it (major units), for showing next to the price. */
  native: NativePrice | null;
  /** True when the market's currency is not the display currency. */
  nativeDiffers: boolean;
  status: PositionRowStatus;
  price: number | null;
  avgCost: number | null;
  cost: number | null;
  marketValue: number | null;
  pl: number | null;
  plPct: number | null;
  /** Consistency problems found while building the row (also logged once). */
  problems: string[];
};

export function buildPositionRow(input: PositionRowInput): PositionRow {
  const currency = normalizeQuote(1, input.displayCurrency).currency;
  const costCcy = input.costCurrency ?? BOOK_CURRENCY;
  const problems: string[] = [];

  const native = input.quote ? normalizeQuote(input.quote.price, input.quote.currency) : null;

  const costConv = convertMoney(input.totalCost, costCcy, currency, input.fxRates);
  const avgConv = convertMoney(input.avgCost, costCcy, currency, input.fxRates);
  const priceConv = native ? convertMoney(native.price, native.currency, currency, input.fxRates) : null;

  if (priceConv) {
    const p = checkConversion(priceConv, input.ticker);
    if (p) problems.push(p);
  }
  if (costConv) {
    const p = checkConversion(costConv, `${input.ticker} cost`);
    if (p) problems.push(p);
  }

  const price = priceConv?.value ?? null;
  const cost = costConv?.value ?? null;
  const avgCost = avgConv?.value ?? null;
  const marketValue = price != null ? price * input.shares : null;
  const pl = marketValue != null && cost != null ? marketValue - cost : null;
  const plPct = pl != null && cost != null && cost > 0 ? pl / cost : null;

  const status: PositionRowStatus = !native
    ? "no-quote"
    : price == null || cost == null
      ? "no-fx"
      : "ok";

  const row: PositionRow = {
    ticker: input.ticker,
    shares: input.shares,
    currency,
    native,
    nativeDiffers: native != null && native.currency !== currency,
    status,
    price,
    avgCost,
    cost,
    marketValue,
    pl,
    plPct,
    problems,
  };
  for (const p of assertRowCurrency(row)) {
    row.problems.push(p);
    warnOnce(`${row.ticker}|row|${p}`, `[money] ${row.ticker}: ${p}`);
  }
  return row;
}

/**
 * The invariant every rendered row must satisfy: all figures are in
 * `row.currency` and agree with each other. Returns the violations (empty when
 * the row is sound). Cheap enough to run on every build.
 */
export function assertRowCurrency(row: PositionRow): string[] {
  const out: string[] = [];
  const fin = (v: number | null) => v == null || Number.isFinite(v);
  for (const [k, v] of Object.entries({
    price: row.price,
    avgCost: row.avgCost,
    cost: row.cost,
    marketValue: row.marketValue,
    pl: row.pl,
    plPct: row.plPct,
  })) {
    if (!fin(v)) out.push(`${k} is not a finite number`);
  }
  if (row.status === "ok") {
    if (row.price == null || row.cost == null || row.marketValue == null || row.pl == null) {
      out.push("status ok but a figure is missing");
    }
  }
  if (row.price != null && row.marketValue != null) {
    const expected = row.price * row.shares;
    if (Math.abs(row.marketValue - expected) > Math.max(1e-6, Math.abs(expected) * 1e-9)) {
      out.push(`marketValue ${row.marketValue} ≠ price × shares ${expected} (${row.currency})`);
    }
  }
  if (row.pl != null && row.marketValue != null && row.cost != null) {
    if (Math.abs(row.pl - (row.marketValue - row.cost)) > 1e-6) {
      out.push(`pl ${row.pl} ≠ marketValue − cost (${row.currency})`);
    }
  }
  if (row.avgCost != null && row.cost != null && row.shares > 0) {
    // Average cost × shares should be the cost — unless the book's avg is a
    // FIFO remainder, in which case it still must be in the same currency, so
    // only a wild ratio (a units mix-up) is flagged.
    const ratio = (row.avgCost * row.shares) / row.cost;
    if (row.cost > 0 && (ratio > 50 || ratio < 1 / 50)) {
      out.push(`avgCost × shares is ${ratio.toPrecision(3)}× the cost — mixed currencies?`);
    }
  }
  return out;
}
