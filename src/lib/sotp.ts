// Pure Sum-of-the-Parts / NAV engine for holding companies.
//
// A holding (EXOR, Prosus, Softbank…) can't be sensibly valued on a P/E — you
// value each stake and add them up. The user enters the stakes manually (Yahoo
// doesn't know what a holding owns), but for listed stakes the app pulls a live
// market cap so the NAV updates on its own; unlisted stakes use a manual value.
//
//   GAV            = Σ stakeValue_i
//   stakeValue_i   = marketCap_i × stake_i   (listed, FX-converted)  OR  manualValue_i
//   NAV            = GAV − net debt
//   NAV per share  = NAV / shares outstanding
//   discountToNAV  = 1 − price / NAVperShare   (>0 = trades below NAV)
//
// Unit-agnostic like its siblings: every monetary result is expressed in the
// parent's quote currency. The component FX-converts each listed stake's market
// cap from its own currency; manual values are assumed already in that currency.

import { convert, type Currency } from "./currency";

/** One stake in the holding. stakePct is a fraction (0.195 = 19.5%). */
export type SotpHolding = {
  id: string;
  name: string;
  /** Yahoo symbol of the stake, or null when it isn't listed. */
  ticker: string | null;
  stakePct: number;
  /** Manual value (parent currency) for unlisted stakes or as a fallback. */
  manualValue: number | null;
};

/** Live quote for one listed stake (market cap in its own currency). */
export type SotpQuote = {
  marketCap: number | null;
  currency: string | null;
};

/** Editable, persisted SoTP config for one holding. */
export type SotpConfig = {
  holdings: SotpHolding[];
  /** Net debt at the holding level, parent currency. */
  netDebt: number;
  /** Parent shares outstanding. */
  sharesOutstanding: number;
};

export type SotpBreakdownRow = {
  id: string;
  name: string;
  value: number;
  /** value / GAV, in [0,1]; 0 when GAV is 0. */
  weight: number;
  /** True when the value fell back to the manual figure (no live market cap). */
  fromManual: boolean;
};

export type SotpResult = {
  gav: number;
  nav: number;
  navPerShare: number | null;
  breakdown: SotpBreakdownRow[];
  /** 1 − price/navPerShare, or null when either side is unusable. */
  discountToNav: number | null;
};

function isUsable(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n !== 0;
}

/**
 * Compute the NAV from the stakes + live quotes. Pure: no I/O. Listed stakes
 * with a usable market cap are valued live (FX-converted into `targetCurrency`);
 * everything else degrades to the manual value (0 when absent).
 */
export function calculateNAV(
  config: SotpConfig,
  quotes: Record<string, SotpQuote>,
  fxRates: Record<string, number>,
  targetCurrency: Currency,
): SotpResult {
  let gav = 0;
  const rows: SotpBreakdownRow[] = [];

  for (const h of config.holdings) {
    let value = 0;
    let fromManual = true;
    const q = h.ticker ? quotes[h.ticker.toUpperCase()] : undefined;
    if (h.ticker && q && isUsable(q.marketCap)) {
      const ccy = (q.currency || targetCurrency) as Currency;
      const stakeInCcy = q.marketCap * h.stakePct;
      value = convert(stakeInCcy, ccy, targetCurrency, fxRates);
      fromManual = false;
    } else {
      value = h.manualValue ?? 0;
    }
    gav += value;
    rows.push({ id: h.id, name: h.name, value, weight: 0, fromManual });
  }

  for (const r of rows) r.weight = gav !== 0 ? r.value / gav : 0;

  const nav = gav - config.netDebt;
  const navPerShare = isUsable(config.sharesOutstanding)
    ? nav / config.sharesOutstanding
    : null;

  return { gav, nav, navPerShare, breakdown: rows, discountToNav: null };
}

/** Attach the discount-to-NAV given the parent's live price. Kept separate so
 *  `calculateNAV` stays price-agnostic and easy to test. */
export function withDiscount(
  result: SotpResult,
  currentPrice: number | null,
): SotpResult {
  const discountToNav =
    result.navPerShare != null && isUsable(result.navPerShare) && isUsable(currentPrice)
      ? 1 - currentPrice / result.navPerShare
      : null;
  return { ...result, discountToNav };
}

let seq = 0;
export function newHolding(): SotpHolding {
  seq += 1;
  return {
    id: `h-${Date.now()}-${seq}`,
    name: "",
    ticker: null,
    stakePct: 0,
    manualValue: null,
  };
}

export function defaultSotpConfig(): SotpConfig {
  return { holdings: [], netDebt: 0, sharesOutstanding: 0 };
}
