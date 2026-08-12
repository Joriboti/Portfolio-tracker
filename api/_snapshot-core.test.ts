import { describe, it, expect } from "vitest";
import {
  CODE_RE,
  digestInput,
  generateCode,
  hmacHex,
  sha256Hex,
  timingSafeEqualHex,
  validateCanonicalBody,
} from "./_snapshot-core";
import {
  buildSnapshotBody,
  canonicalizeBody,
  digestInput as clientDigestInput,
  sha256Hex as clientSha256Hex,
  isValidCode,
} from "../src/lib/verify";
import type { XrayReport } from "../src/lib/xray";

function report(): XrayReport {
  return {
    holdingsCount: 3,
    totalValueEur: 10000,
    totalCostEur: 8000,
    unrealizedEur: 2000,
    sinceInception: {
      grossInvested: 8000,
      sellProceeds: 0,
      netInvested: 8000,
      openCost: 8000,
      currentValue: 10000,
      unrealized: 2000,
      realized: 0,
      dividends: 0,
      interests: 0,
      totalGain: 2000,
      returnPct: 0.25,
      irr: 0.1,
    },
    weights: [
      { ticker: "AAPL", weight: 0.5, valueEur: 5000 },
      { ticker: "MSFT", weight: 0.3, valueEur: 3000 },
      { ticker: "ASML", weight: 0.2, valueEur: 2000 },
    ],
    concentration: { hhi: 0.38, effectiveN: 2.63, top1: 0.5, top3: 1 },
    regions: [{ key: "US", weight: 0.8 }, { key: "Europe", weight: 0.2 }],
    sectors: null,
    sectorCoverage: 0,
    weightedPe: null,
    peCoverage: 0,
    score: 55,
    grade: "C",
    scoreParts: { concentration: 15, count: 12, region: 14, sector: null },
    flags: [],
  };
}

const canonicalOf = (amounts = false) =>
  canonicalizeBody(buildSnapshotBody({ report: report(), amounts }));

describe("digest recipe", () => {
  // The browser recomputes the digest on the public verify page. If these two
  // implementations ever drift, every card in the wild reads as tampered.
  it("is byte-identical to the client's", async () => {
    const canonical = canonicalOf();
    const code = "H7K2M9QX4B";
    const at = "2026-08-12T09:30:00.000Z";
    expect(digestInput(code, at, canonical)).toBe(clientDigestInput(code, at, canonical));
    expect(await sha256Hex(digestInput(code, at, canonical))).toBe(
      await clientSha256Hex(clientDigestInput(code, at, canonical)),
    );
  });
});

describe("generateCode", () => {
  it("emits codes both sides agree are well formed", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(CODE_RE.test(code)).toBe(true);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, generateCode));
    expect(seen.size).toBe(500);
  });
});

describe("hmac", () => {
  it("changes with the key, and compares in constant time", async () => {
    const a = await hmacHex("secret-key-of-decent-length", "abc");
    const b = await hmacHex("another-key-of-decent-length", "abc");
    expect(a).not.toBe(b);
    expect(timingSafeEqualHex(a, a)).toBe(true);
    expect(timingSafeEqualHex(a, b)).toBe(false);
    expect(timingSafeEqualHex(a, a.slice(0, -1))).toBe(false);
  });
});

describe("validateCanonicalBody", () => {
  it("accepts a body the client just built", () => {
    expect(validateCanonicalBody(canonicalOf())).toEqual({
      tier: "self",
      broker: null,
      amounts: false,
    });
    expect(validateCanonicalBody(canonicalOf(true)).amounts).toBe(true);
  });

  it("refuses a self-issued broker tier", () => {
    const body = JSON.parse(canonicalOf());
    body.tier = "broker";
    body.broker = "ibkr";
    expect(() => validateCanonicalBody(JSON.stringify(body))).toThrow(/Broker tier/);
  });

  it("refuses euro figures that were supposed to be withheld", () => {
    const body = JSON.parse(canonicalOf());
    body.holdings[0].v = 5000;
    expect(() => validateCanonicalBody(JSON.stringify(body))).toThrow(/not disclosed/);

    const withTotals = JSON.parse(canonicalOf());
    withTotals.totals = { value: 1, cost: 1, realized: 0, dividends: 0 };
    expect(() => validateCanonicalBody(JSON.stringify(withTotals))).toThrow(/not disclosed/);
  });

  it("refuses weights that do not describe a whole portfolio", () => {
    const body = JSON.parse(canonicalOf());
    body.holdings = body.holdings.slice(0, 1); // 50% — the rest went missing
    expect(() => validateCanonicalBody(JSON.stringify(body))).toThrow(/sum to 1/);
  });

  it("refuses malformed, oversized and nonsensical bodies", () => {
    expect(() => validateCanonicalBody("")).toThrow(/Missing/);
    expect(() => validateCanonicalBody("not json")).toThrow(/valid JSON/);
    expect(() => validateCanonicalBody("[]")).toThrow(/object/);
    expect(() => validateCanonicalBody(JSON.stringify({ v: 2 }))).toThrow(/version/);
    expect(() => validateCanonicalBody(JSON.stringify({ x: "y".repeat(9000) }))).toThrow(
      /too large/,
    );

    const badScore = JSON.parse(canonicalOf());
    badScore.score = 140;
    expect(() => validateCanonicalBody(JSON.stringify(badScore))).toThrow(/score/);

    const badWeight = JSON.parse(canonicalOf());
    badWeight.holdings[0].w = 1.4;
    expect(() => validateCanonicalBody(JSON.stringify(badWeight))).toThrow(/weight/);

    const nanReturn = JSON.parse(canonicalOf());
    nanReturn.ret.total = "lots";
    expect(() => validateCanonicalBody(JSON.stringify(nanReturn))).toThrow(/returns/);
  });

  it("keeps accepting a body with a null sector breakdown", () => {
    const body = JSON.parse(canonicalOf());
    expect(body.sectors).toBeNull();
    expect(() => validateCanonicalBody(JSON.stringify(body))).not.toThrow();
  });
});
