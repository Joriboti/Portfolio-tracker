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
// {SYMBOL: rateAgainstUSD}. We treat USD as pivot; the price API returns
// EUR/USD, GBP/USD, etc.
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  ratesAgainstUSD: Partial<Record<Currency, number>>,
): number {
  if (from === to) return amount;
  const rateFrom = from === "USD" ? 1 : ratesAgainstUSD[from];
  const rateTo = to === "USD" ? 1 : ratesAgainstUSD[to];
  if (!rateFrom || !rateTo) return amount;
  // amount in `from` -> USD -> `to`
  const inUSD = amount / rateFrom;
  return inUSD * rateTo;
}
