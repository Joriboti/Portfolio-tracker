import { describe, it, expect } from "vitest";
import {
  calculateNAV,
  withDiscount,
  defaultSotpConfig,
  type SotpConfig,
  type SotpQuote,
} from "./sotp";

function config(over: Partial<SotpConfig> = {}): SotpConfig {
  return {
    holdings: [
      { id: "a", name: "Listed A", ticker: "AAA", stakePct: 0.2, manualValue: null },
      { id: "b", name: "Unlisted B", ticker: null, stakePct: 0.5, manualValue: 1000 },
    ],
    netDebt: 500,
    sharesOutstanding: 100,
    targetDiscount: 0,
    ...over,
  };
}

describe("calculateNAV", () => {
  it("values listed stakes live and unlisted from manual", () => {
    const quotes: Record<string, SotpQuote> = {
      AAA: { marketCap: 10_000, currency: "EUR" },
    };
    const r = calculateNAV(config(), quotes, {}, "EUR");
    // AAA: 10000 × 0.20 = 2000 ; B manual 1000 → GAV 3000
    expect(r.gav).toBeCloseTo(3000, 6);
    expect(r.nav).toBeCloseTo(2500, 6); // − net debt 500
    expect(r.navPerShare).toBeCloseTo(25, 6); // / 100 shares
    const [a, b] = r.breakdown;
    expect(a.value).toBeCloseTo(2000, 6);
    expect(a.fromManual).toBe(false);
    expect(b.fromManual).toBe(true);
    expect(a.weight + b.weight).toBeCloseTo(1, 10);
  });

  it("FX-converts a listed stake in another currency", () => {
    const quotes: Record<string, SotpQuote> = {
      AAA: { marketCap: 10_000, currency: "USD" },
    };
    // 1 EUR = 1.25 USD → USD amount / 1.25 = EUR
    const r = calculateNAV(config(), quotes, { EUR: 1.25 }, "EUR");
    // 10000 × 0.2 = 2000 USD → 1600 EUR ; + 1000 = 2600 GAV
    expect(r.breakdown[0].value).toBeCloseTo(1600, 6);
    expect(r.gav).toBeCloseTo(2600, 6);
  });

  it("degrades to manual value when the live cap is missing", () => {
    const withFallback = config({
      holdings: [{ id: "a", name: "A", ticker: "AAA", stakePct: 0.2, manualValue: 700 }],
      netDebt: 0,
      sharesOutstanding: 10,
    });
    const r = calculateNAV(withFallback, {}, {}, "EUR"); // no quote for AAA
    expect(r.breakdown[0].value).toBeCloseTo(700, 6);
    expect(r.breakdown[0].fromManual).toBe(true);
  });

  it("returns null navPerShare when shares are zero", () => {
    const r = calculateNAV(config({ sharesOutstanding: 0 }), {}, {}, "EUR");
    expect(r.navPerShare).toBeNull();
  });

  it("target price equals NAV/share with no discount", () => {
    const r = calculateNAV(config(), { AAA: { marketCap: 10_000, currency: "EUR" } }, {}, "EUR");
    expect(r.targetPrice).toBeCloseTo(r.navPerShare as number, 6);
  });

  it("applies the holding discount to the target price", () => {
    // navPerShare 25 with a 40% holding discount → 15
    const r = calculateNAV(
      config({ targetDiscount: 0.4 }),
      { AAA: { marketCap: 10_000, currency: "EUR" } },
      {},
      "EUR",
    );
    expect(r.navPerShare).toBeCloseTo(25, 6);
    expect(r.targetPrice).toBeCloseTo(15, 6);
  });

  it("target price is null when shares are zero", () => {
    const r = calculateNAV(config({ sharesOutstanding: 0, targetDiscount: 0.3 }), {}, {}, "EUR");
    expect(r.targetPrice).toBeNull();
  });
});

describe("withDiscount", () => {
  it("computes the discount to NAV from the live price", () => {
    const base = calculateNAV(config(), { AAA: { marketCap: 10_000, currency: "EUR" } }, {}, "EUR");
    // navPerShare 25, price 20 → discount = 1 − 20/25 = 0.20
    const r = withDiscount(base, 20);
    expect(r.discountToNav).toBeCloseTo(0.2, 6);
  });

  it("is null without a usable price", () => {
    const base = calculateNAV(config(), {}, {}, "EUR");
    expect(withDiscount(base, null).discountToNav).toBeNull();
  });
});

describe("defaults", () => {
  it("starts empty", () => {
    expect(defaultSotpConfig().holdings).toHaveLength(0);
  });
});
