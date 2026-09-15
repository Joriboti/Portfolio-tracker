import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRowCurrency,
  buildPositionRow,
  checkConversion,
  convertMoney,
  formatLargeMoney,
  fxFactor,
  normalizeQuote,
  setMoneyWarningSink,
} from "./money";

const EN = "en-US";

describe("formatLargeMoney", () => {
  it("uses short-scale K/M/B/T with two decimals and the code after", () => {
    expect(formatLargeMoney(4.8171e12, "USD", EN)).toBe("4.82 T USD");
    expect(formatLargeMoney(1.0518e12, "USD", EN)).toBe("1.05 T USD");
    expect(formatLargeMoney(31.2e9, "EUR", EN)).toBe("31.20 B EUR");
    expect(formatLargeMoney(7.6395e9, "USD", EN)).toBe("7.64 B USD");
    expect(formatLargeMoney(2.5e6, "GBP", EN)).toBe("2.50 M GBP");
    expect(formatLargeMoney(1e3, "USD", EN)).toBe("1.00 K USD");
    expect(formatLargeMoney(950, "USD", EN)).toBe("950.00 USD");
  });

  it("never renders a value at or above 1e12 as B", () => {
    expect(formatLargeMoney(999.99e9, "USD", EN)).toBe("999.99 B USD");
    expect(formatLargeMoney(1e12, "USD", EN)).toBe("1.00 T USD");
    expect(formatLargeMoney(1e12 - 1, "USD", EN)).toBe("1.00 T USD"); // rounds up past 999.99 B
    expect(formatLargeMoney(999.994e9, "USD", EN)).toBe("999.99 B USD");
    expect(formatLargeMoney(999.996e9, "USD", EN)).toBe("1.00 T USD");
    for (const v of [1e12, 1.5e12, 4.81e12, 9.99e14, 1e15]) {
      expect(formatLargeMoney(v, "USD", EN)).not.toMatch(/ B /);
      expect(formatLargeMoney(v, "USD", EN)).toMatch(/ T USD$/);
    }
  });

  it("keeps the sign, follows the locale, and tolerates missing input", () => {
    expect(formatLargeMoney(-2.5e9, "EUR", EN)).toBe("-2.50 B EUR");
    expect(formatLargeMoney(4.81e12, "USD", "ca-ES")).toBe("4,81 T USD");
    expect(formatLargeMoney(4.81e12, null, EN)).toBe("4.81 T");
    expect(formatLargeMoney(null, "USD", EN)).toBe("—");
    expect(formatLargeMoney(Number.NaN, "USD", EN)).toBe("—");
  });
});

describe("normalizeQuote / fxFactor / convertMoney", () => {
  const rates = { EUR: 1.15, GBP: 1.35, CHF: 1.2, JPY: 0.0068 };

  it("brings London pence to pounds", () => {
    expect(normalizeQuote(2650, "GBp")).toEqual({ price: 26.5, currency: "GBP" });
    expect(normalizeQuote(2650, "GBX")).toEqual({ price: 26.5, currency: "GBP" });
    expect(normalizeQuote(934.48, "USD")).toEqual({ price: 934.48, currency: "USD" });
    expect(normalizeQuote(10, null).currency).toBe("USD");
  });

  it("pivots through USD in Yahoo's CCYUSD=X convention", () => {
    expect(fxFactor("USD", "EUR", rates)).toBeCloseTo(1 / 1.15, 10);
    expect(fxFactor("EUR", "USD", rates)).toBeCloseTo(1.15, 10);
    expect(fxFactor("GBP", "EUR", rates)).toBeCloseTo(1.35 / 1.15, 10);
    expect(fxFactor("GBp", "EUR", rates)).toBeCloseTo(1.35 / 1.15, 10); // pence handled before FX
    expect(fxFactor("EUR", "EUR", rates)).toBe(1);
    expect(fxFactor("DKK", "EUR", rates)).toBeNull();
  });

  it("converts once and refuses instead of guessing", () => {
    expect(convertMoney(934.48, "USD", "EUR", rates)?.value).toBeCloseTo(812.59, 2);
    expect(convertMoney(2650, "GBp", "EUR", rates)?.value).toBeCloseTo(31.11, 2);
    expect(convertMoney(100, "DKK", "EUR", rates)).toBeNull();
    expect(convertMoney(Number.NaN, "USD", "EUR", rates)).toBeNull();
  });
});

describe("checkConversion", () => {
  const log: string[] = [];
  beforeEach(() => {
    log.length = 0;
    setMoneyWarningSink((m) => log.push(m));
  });
  afterEach(() => setMoneyWarningSink(null));

  it("is quiet for a sane rate", () => {
    expect(checkConversion({ value: 1, rate: 1 / 1.15, from: "USD", to: "EUR" }, "MU")).toBeNull();
    expect(checkConversion({ value: 1, rate: 0.0068 / 1.15, from: "JPY", to: "EUR" }, "7203")).toBeNull();
    expect(log).toEqual([]);
  });

  it("flags an inverted or wrong-unit rate, once", () => {
    const bad = { value: 1, rate: 150 / 1.15, from: "JPY", to: "EUR" }; // JPY per USD, not USD per JPY
    expect(checkConversion(bad, "7203")).toMatch(/implausible|double conversion|inverted/);
    checkConversion(bad, "7203");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^\[money\] 7203: converted JPY→EUR/);
  });

  it("falls back to a wide band for currencies it has no magnitude for", () => {
    expect(checkConversion({ value: 1, rate: 3, from: "XAU", to: "EUR" }, "GOLD")).toBeNull();
    expect(checkConversion({ value: 1, rate: 5000, from: "XAU", to: "EUR" }, "GOLD")).not.toBeNull();
  });
});

describe("buildPositionRow — mixed EUR / USD / GBp portfolio", () => {
  const rates = { EUR: 1.15, GBP: 1.35 };
  const log: string[] = [];
  beforeEach(() => {
    log.length = 0;
    setMoneyWarningSink((m) => log.push(m));
  });
  afterEach(() => setMoneyWarningSink(null));

  const itx = { ticker: "ITX", shares: 100, avgCost: 40, totalCost: 4000, quote: { price: 52.86, currency: "EUR" } };
  const mu = { ticker: "MU", shares: 10, avgCost: 90.3, totalCost: 903, quote: { price: 934.48, currency: "USD" } };
  const shel = { ticker: "SHEL", shares: 200, avgCost: 25, totalCost: 5000, quote: { price: 2650, currency: "GBp" } };

  it("puts every figure of every row in the display currency (EUR)", () => {
    const rows = [itx, mu, shel].map((p) => buildPositionRow({ ...p, displayCurrency: "EUR", fxRates: rates }));
    for (const r of rows) {
      expect(r.currency).toBe("EUR");
      expect(r.status).toBe("ok");
      expect(r.problems).toEqual([]);
      expect(assertRowCurrency(r)).toEqual([]);
    }
    const [a, b, c] = rows;
    // EUR-quoted: untouched, native equals display.
    expect(a.price).toBeCloseTo(52.86, 10);
    expect(a.nativeDiffers).toBe(false);
    expect(a.marketValue).toBeCloseTo(5286, 6);
    expect(a.cost).toBe(4000);
    expect(a.pl).toBeCloseTo(1286, 6);
    // USD-quoted: converted once, native kept beside it.
    expect(b.native).toEqual({ price: 934.48, currency: "USD" });
    expect(b.nativeDiffers).toBe(true);
    expect(b.price).toBeCloseTo(934.48 / 1.15, 6);
    expect(b.marketValue).toBeCloseTo((934.48 / 1.15) * 10, 6);
    expect(b.cost).toBe(903);
    expect(b.pl).toBeCloseTo((934.48 / 1.15) * 10 - 903, 6);
    // Pence-quoted: /100 then GBP→EUR.
    expect(c.native).toEqual({ price: 26.5, currency: "GBP" });
    expect(c.nativeDiffers).toBe(true);
    expect(c.price).toBeCloseTo((26.5 * 1.35) / 1.15, 6);
    expect(c.marketValue).toBeCloseTo(((26.5 * 1.35) / 1.15) * 200, 6);
    expect(c.pl).toBeCloseTo(((26.5 * 1.35) / 1.15) * 200 - 5000, 6);
    expect(log).toEqual([]);
  });

  it("converts the EUR book too when the display currency is USD", () => {
    const r = buildPositionRow({ ...mu, displayCurrency: "USD", fxRates: rates });
    expect(r.currency).toBe("USD");
    expect(r.price).toBeCloseTo(934.48, 10);
    expect(r.nativeDiffers).toBe(false);
    expect(r.avgCost).toBeCloseTo(90.3 * 1.15, 6);
    expect(r.cost).toBeCloseTo(903 * 1.15, 6);
    expect(r.pl).toBeCloseTo(9344.8 - 903 * 1.15, 6);
    expect(assertRowCurrency(r)).toEqual([]);
  });

  it("refuses to mix currencies when a rate is missing", () => {
    const r = buildPositionRow({
      ticker: "NOVO-B",
      shares: 5,
      avgCost: 80,
      totalCost: 400,
      quote: { price: 620, currency: "DKK" },
      displayCurrency: "EUR",
      fxRates: rates,
    });
    expect(r.status).toBe("no-fx");
    expect(r.native).toEqual({ price: 620, currency: "DKK" });
    expect(r.price).toBeNull();
    expect(r.marketValue).toBeNull();
    expect(r.pl).toBeNull();
    expect(r.cost).toBe(400); // the book side still converts
    expect(assertRowCurrency(r)).toEqual([]);
  });

  it("marks a position with no quote without inventing a zero", () => {
    const r = buildPositionRow({ ...itx, quote: null, displayCurrency: "EUR", fxRates: rates });
    expect(r.status).toBe("no-quote");
    expect(r.price).toBeNull();
    expect(r.marketValue).toBeNull();
    expect(r.cost).toBe(4000);
  });

  it("warns when the FX table is in the wrong unit", () => {
    const r = buildPositionRow({ ...mu, displayCurrency: "EUR", fxRates: { EUR: 115 } }); // 100× off
    expect(r.problems.length).toBeGreaterThan(0);
    expect(log.some((m) => /MU: converted USD→EUR/.test(m))).toBe(true);
  });
});
