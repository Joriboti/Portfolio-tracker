import { describe, it, expect } from "vitest";
import { buildBrokerBody, toEur, type BrokerPosition, type UsdPerUnit } from "./_broker-snapshot";
import { validateCanonicalBody } from "./_snapshot-core";
import { canonicalizeBody, REMAINDER_KEY, SNAPSHOT_TOP_HOLDINGS } from "../src/lib/verify";

// USD per 1 unit — the convention fx_rates actually stores (see prices-update).
const RATES: UsdPerUnit = { EUR: 1.1, GBP: 1.27, USD: 1, JPY: 0.0064 };

const pos = (over: Partial<BrokerPosition> = {}): BrokerPosition => ({
  ticker: "AAPL",
  currency: "USD",
  quantity: 10,
  value: 1100,
  cost: 800,
  ...over,
});

describe("toEur", () => {
  it("converts through USD in the right direction", () => {
    // 1100 USD ÷ 1.1 USD-per-EUR = 1000 EUR. Inverting would give 1210.
    expect(toEur(1100, "USD", RATES)).toBeCloseTo(1000, 6);
    // 100 EUR is 100 EUR.
    expect(toEur(100, "EUR", RATES)).toBeCloseTo(100, 6);
    // 100 GBP → 127 USD → 115.45 EUR. A weaker currency must not become richer.
    expect(toEur(100, "GBP", RATES)).toBeCloseTo(115.4545, 3);
    expect(toEur(100, "GBP", RATES)!).toBeGreaterThan(100);
    expect(toEur(1000, "JPY", RATES)!).toBeLessThan(10);
  });

  it("treats pence as a hundredth of a pound", () => {
    expect(toEur(10000, "GBX", RATES)).toBeCloseTo(toEur(100, "GBP", RATES)!, 6);
  });

  it("returns null rather than guessing when a rate is missing", () => {
    expect(toEur(100, "SEK", RATES)).toBeNull();
    expect(toEur(100, "USD", { GBP: 1.27 })).toBeNull(); // no EUR base
  });
});

describe("buildBrokerBody", () => {
  const build = (positions: BrokerPosition[], amounts = false) =>
    buildBrokerBody({ positions, rates: RATES, sectors: {}, amounts, broker: "ibkr" });

  it("issues at the broker tier and records which broker", () => {
    const r = build([pos(), pos({ ticker: "MSFT", value: 2200, cost: 1500 })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.tier).toBe("broker");
    expect(r.body.broker).toBe("ibkr");
  });

  it("weights holdings by EUR value across mixed currencies", () => {
    const r = build([
      pos({ ticker: "AAPL", currency: "USD", value: 1100 }), // 1000 EUR
      pos({ ticker: "ITX.MC", currency: "EUR", value: 1000 }), // 1000 EUR
    ]);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.holdings.map((h) => h.w)).toEqual([0.5, 0.5]);
  });

  it("reports the unrealised return on cost and no IRR", () => {
    // 2000 EUR value against 1600 EUR cost = +25%.
    const r = build([
      pos({ currency: "EUR", value: 2000, cost: 1600 }),
    ]);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.ret.total).toBeCloseTo(0.25, 6);
    // A positions statement has no cash-flow history, so a money-weighted
    // return cannot be computed and must not be invented.
    expect(r.body.ret.irr).toBeNull();
  });

  it("leaves the return unknown when any position lacks a cost basis", () => {
    const r = build([pos(), pos({ ticker: "MSFT", cost: null })]);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.ret.total).toBeNull();
  });

  it("omits realised and dividend totals instead of claiming zero", () => {
    const r = build([pos({ currency: "EUR", value: 1000, cost: 800 })], true);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.totals).toMatchObject({ realized: null, dividends: null });
    expect(r.body.totals!.value).toBeGreaterThan(0);
  });

  it("withholds every euro figure unless amounts were requested", () => {
    const r = build([pos()], false);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.totals).toBeNull();
    expect(r.body.holdings.every((h) => h.v === undefined)).toBe(true);
  });

  it("folds the tail into the neutral remainder bucket", () => {
    const many = Array.from({ length: SNAPSHOT_TOP_HOLDINGS + 4 }, (_, i) =>
      pos({ ticker: `T${i}`, currency: "EUR", value: 100, cost: 80 }),
    );
    const r = build(many);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.holdings).toHaveLength(SNAPSHOT_TOP_HOLDINGS + 1);
    expect(r.body.holdings.at(-1)!.t).toBe(REMAINDER_KEY);
    expect(r.body.holdingsCount).toBe(many.length);
  });

  it("reports positions it could not value rather than dropping them silently", () => {
    const r = build([pos(), pos({ ticker: "NOKIA.HE", currency: "SEK", value: 500 })]);
    if (!r.ok) return expect.fail("expected ok");
    // A dropped holding would understate concentration on a card that claims
    // to describe the whole account.
    expect(r.skipped).toEqual(["NOKIA.HE"]);
    expect(r.body.holdingsCount).toBe(1);
  });

  it("fails outright when nothing can be valued", () => {
    const r = build([pos({ currency: "SEK" })]);
    expect(r.ok).toBe(false);
  });

  it("classifies regions from the ticker suffix", () => {
    const r = build([
      pos({ ticker: "AAPL", currency: "USD", value: 1100 }),
      pos({ ticker: "ITX.MC", currency: "EUR", value: 1000 }),
    ]);
    if (!r.ok) return expect.fail("expected ok");
    expect(r.body.regions.map((x) => x.k).sort()).toEqual(["Europe", "US"]);
  });

  it("hides the sector split when coverage is too thin to be honest", () => {
    const thin = buildBrokerBody({
      positions: [
        pos({ ticker: "AAPL", currency: "EUR", value: 900 }),
        pos({ ticker: "MSFT", currency: "EUR", value: 100 }),
      ],
      rates: RATES,
      sectors: { MSFT: "Technology" }, // only 10% of value
      amounts: false,
      broker: "ibkr",
    });
    if (!thin.ok) return expect.fail("expected ok");
    expect(thin.body.sectors).toBeNull();
  });

  it("produces a body the signing gate accepts", () => {
    const r = build([
      pos({ ticker: "AAPL", currency: "USD", value: 1100 }),
      pos({ ticker: "ITX.MC", currency: "EUR", value: 900 }),
    ], true);
    if (!r.ok) return expect.fail("expected ok");
    const canonical = canonicalizeBody(r.body);
    // Rejected without the opt-in, accepted with it — the check that stops a
    // client awarding itself the broker badge.
    expect(() => validateCanonicalBody(canonical)).toThrow(/Broker tier/);
    expect(validateCanonicalBody(canonical, { allowBrokerTier: true })).toMatchObject({
      tier: "broker",
      broker: "ibkr",
      amounts: true,
    });
  });
});
