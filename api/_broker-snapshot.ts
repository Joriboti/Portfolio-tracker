// Builds a snapshot body from broker-supplied positions, server-side.
//
// Why here and not in the browser: the "broker" tier is the app's strongest
// claim, and snapshot-create refuses a client-issued one on purpose. So the
// figures behind a broker-tier card have to be derived where the broker data
// lands — in the function that fetched it — with the client never in a position
// to adjust a weight on the way past.
//
// The scoring and region classification are imported from src/lib/xray-core,
// the same code the browser runs, so a self-tier and a broker-tier card of the
// same portfolio grade identically. That module has no imports at all, and
// src/lib/verify's only import is a type, so nothing here drags the Excel
// parser into a serverless bundle.

import {
  concentrationOf,
  regionForTicker,
  scoreDiversification,
  slicesFrom,
} from "../src/lib/xray-core.js";
import {
  REMAINDER_KEY,
  SNAPSHOT_TOP_HOLDINGS,
  roundTo,
  type SnapshotBody,
  type SnapshotHolding,
} from "../src/lib/verify.js";

/** One position as normalised by the broker adapter, in its own currency. */
export type BrokerPosition = {
  ticker: string;
  currency: string;
  quantity: number;
  /** Market value in `currency`. */
  value: number | null;
  /** Cost basis in `currency`. */
  cost: number | null;
};

/**
 * FX map as stored in `fx_rates`: USD per 1 unit of the currency.
 *
 * Note this is the opposite of what db/schema.sql's comment says — the rows are
 * written from Yahoo's `EURUSD=X` quote, which is USD per 1 EUR. The convention
 * is verified against prices-update.ts, and getting it backwards would silently
 * mis-scale every non-EUR holding on the card.
 */
export type UsdPerUnit = Record<string, number>;

/** Convert an amount in `ccy` to EUR. Null when a needed rate is missing. */
export function toEur(amount: number, ccy: string, rates: UsdPerUnit): number | null {
  const eur = rates.EUR;
  if (!eur) return null;
  const c = ccy.toUpperCase();
  let usd: number;
  if (c === "USD") usd = amount;
  else if (c === "GBP") usd = amount * (rates.GBP ?? NaN);
  // Some venues quote in pence/cents of the major unit.
  else if (c === "GBX" || c === "GBP.PENCE") usd = (amount / 100) * (rates.GBP ?? NaN);
  else usd = amount * (rates[c] ?? NaN);
  if (!Number.isFinite(usd)) return null;
  return usd / eur;
}

export type BrokerBodyResult =
  | { ok: true; body: SnapshotBody; skipped: string[] }
  | { ok: false; error: string };

/**
 * Assemble the signed body for a broker-tier snapshot.
 *
 * `sectors` maps ticker → Yahoo sector, from our own fundamentals cache; it is
 * descriptive metadata about instruments, not a claim about the account, so
 * using cached data for it is fair. Positions whose currency we cannot convert
 * are reported in `skipped` rather than silently valued at zero: a card that
 * quietly dropped a holding would understate concentration.
 */
export function buildBrokerBody(input: {
  positions: BrokerPosition[];
  rates: UsdPerUnit;
  sectors: Record<string, string | null>;
  amounts: boolean;
  broker: string;
}): BrokerBodyResult {
  const priced: Array<{ ticker: string; currency: string; valueEur: number; costEur: number | null }> = [];
  const skipped: string[] = [];

  for (const p of input.positions) {
    // Value at market; fall back to cost so a position that the statement did
    // not price still carries its weight instead of vanishing.
    const nativeValue = p.value ?? p.cost;
    if (nativeValue == null) {
      skipped.push(p.ticker);
      continue;
    }
    const valueEur = toEur(nativeValue, p.currency, input.rates);
    if (valueEur == null || valueEur <= 0) {
      skipped.push(p.ticker);
      continue;
    }
    const costEur = p.cost != null ? toEur(p.cost, p.currency, input.rates) : null;
    priced.push({ ticker: p.ticker, currency: p.currency, valueEur, costEur });
  }

  if (priced.length === 0) {
    return { ok: false, error: "No positions could be valued in EUR" };
  }

  const totalValue = priced.reduce((s, p) => s + p.valueEur, 0);
  const sorted = [...priced].sort((a, b) => b.valueEur - a.valueEur);
  const weights = sorted.map((p) => p.valueEur / totalValue);

  // Holdings: top N individually, the tail folded into one neutral bucket.
  const top = sorted.slice(0, SNAPSHOT_TOP_HOLDINGS);
  const rest = sorted.slice(SNAPSHOT_TOP_HOLDINGS);
  const holdings: SnapshotHolding[] = top.map((p) => ({
    t: p.ticker,
    w: roundTo(p.valueEur / totalValue, 6),
    ...(input.amounts ? { v: roundTo(p.valueEur, 2) } : {}),
  }));
  if (rest.length > 0) {
    const restValue = rest.reduce((s, p) => s + p.valueEur, 0);
    holdings.push({
      t: REMAINDER_KEY,
      w: roundTo(restValue / totalValue, 6),
      ...(input.amounts ? { v: roundTo(restValue, 2) } : {}),
    });
  }

  const regionMap = new Map<string, number>();
  for (const p of sorted) {
    const r = regionForTicker(p.ticker, p.currency);
    regionMap.set(r, (regionMap.get(r) ?? 0) + p.valueEur);
  }
  const regions = slicesFrom(regionMap, totalValue);

  const sectorMap = new Map<string, number>();
  let sectorCovered = 0;
  for (const p of sorted) {
    const sector = input.sectors[p.ticker.toUpperCase()];
    if (sector) {
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + p.valueEur);
      sectorCovered += p.valueEur;
    }
  }
  // Same 40% threshold as the browser: below it the breakdown misleads.
  const sectors =
    sectorCovered / totalValue >= 0.4 ? slicesFrom(sectorMap, sectorCovered) : null;

  const conc = concentrationOf(weights);
  const { score, grade } = scoreDiversification({
    effectiveN: conc.effectiveN,
    count: priced.length,
    regions,
    sectors,
  });

  // A positions statement carries cost basis but no cash-flow history, so the
  // money-weighted return the self tier reports cannot be computed here. What we
  // can state exactly is the unrealised return on cost — reported in `total`
  // with `irr` left null, and labelled as unrealised on the artefacts so the two
  // tiers never present different measures under the same word.
  const totalCost = priced.every((p) => p.costEur != null)
    ? priced.reduce((s, p) => s + (p.costEur ?? 0), 0)
    : null;
  const totalReturn =
    totalCost != null && totalCost > 0 ? (totalValue - totalCost) / totalCost : null;

  return {
    ok: true,
    skipped,
    body: {
      v: 1,
      tier: "broker",
      broker: input.broker,
      amounts: input.amounts,
      holdingsCount: priced.length,
      holdings,
      regions: regions.map((r) => ({ k: r.key, w: roundTo(r.weight, 6) })),
      sectors: sectors ? sectors.map((s) => ({ k: s.key, w: roundTo(s.weight, 6) })) : null,
      conc: {
        top1: roundTo(conc.top1, 6),
        top3: roundTo(conc.top3, 6),
        effN: roundTo(conc.effectiveN, 3),
      },
      ret: {
        total: totalReturn == null ? null : roundTo(totalReturn, 6),
        irr: null,
      },
      totals: input.amounts
        ? {
            value: roundTo(totalValue, 2),
            cost: totalCost == null ? 0 : roundTo(totalCost, 2),
            // Absent from a positions statement, so absent here. The artefacts
            // omit the line rather than printing a zero we were never told.
            realized: null,
            dividends: null,
          }
        : null,
      score,
      grade,
    },
  };
}
