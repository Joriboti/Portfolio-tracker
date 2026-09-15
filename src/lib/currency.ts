import { convertMoney } from "./money";

export type Currency = "EUR" | "USD" | "GBP" | "CHF";
export const SUPPORTED_CURRENCIES: Currency[] = ["EUR", "USD", "GBP", "CHF"];

export function formatMoney(
  amount: number | null | undefined,
  currency: Currency,
  locale = "ca-ES",
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPct(
  ratio: number | null | undefined,
  locale = "ca-ES",
): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(ratio);
}

// Convert an amount expressed in `from` currency to `to` using a map of
// {SYMBOL: rate} where rate = "price of SYMBOL in USD" (e.g. EUR rate = 1.17
// means 1 EUR = 1.17 USD — the format Yahoo returns for EURUSD=X). USD is the
// pivot. The math lives in src/lib/money.ts (which also brings pence to pounds
// first); this wrapper keeps the historical contract of returning the amount
// unchanged when no rate is known — but says so once in the console, because
// an unconverted number under the wrong currency label is exactly the bug it
// used to hide. New code should prefer `convertMoney`, which returns null.
export function convert(
  amount: number,
  from: Currency | string,
  to: Currency | string,
  ratesAgainstUSD: Partial<Record<Currency, number>> | Record<string, number>,
): number {
  const conv = convertMoney(amount, from, to, ratesAgainstUSD as Record<string, number>);
  if (conv) return conv.value;
  if (from !== to) {
    warnMissingRate(`[money] no FX rate to convert ${from} → ${to}; showing the ${from} amount unconverted`);
  }
  return amount;
}

const warnedPairs = new Set<string>();
function warnMissingRate(message: string): void {
  if (warnedPairs.has(message)) return;
  warnedPairs.add(message);
  console.warn(message);
}
