import { describe, it, expect } from "vitest";
import {
  buildSnapshotBody,
  canonicalizeBody,
  digestInput,
  recomputeDigest,
  sha256Hex,
  shortDigest,
  isValidCode,
  REMAINDER_KEY,
  SNAPSHOT_TOP_HOLDINGS,
  type SnapshotBody,
} from "./verify";
import type { XrayReport } from "./xray";

function makeReport(overrides: Partial<XrayReport> = {}): XrayReport {
  const weights = [
    { ticker: "AAPL", weight: 0.4, valueEur: 4000 },
    { ticker: "MSFT", weight: 0.35, valueEur: 3500 },
    { ticker: "ASML", weight: 0.25, valueEur: 2500 },
  ];
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
      realized: 150,
      dividends: 90,
      interests: 0,
      totalGain: 2240,
      returnPct: 0.28,
      irr: 0.1234567,
    },
    weights,
    concentration: { hhi: 0.345, effectiveN: 2.898551, top1: 0.4, top3: 1 },
    regions: [
      { key: "US", weight: 0.75 },
      { key: "Europe", weight: 0.25 },
    ],
    sectors: [{ key: "Technology", weight: 1 }],
    sectorCoverage: 1,
    weightedPe: 28.4,
    peCoverage: 1,
    score: 61,
    grade: "C+",
    scoreParts: { concentration: 20, count: 15, region: 16, sector: 10 },
    flags: [],
    ...overrides,
  };
}

describe("buildSnapshotBody", () => {
  it("omits every euro figure when amounts are not disclosed", () => {
    const body = buildSnapshotBody({ report: makeReport(), amounts: false });
    expect(body.totals).toBeNull();
    expect(body.holdings.every((h) => h.v === undefined)).toBe(true);
    // Weights and percentages are always present — that's the point of the card.
    expect(body.holdings[0]).toEqual({ t: "AAPL", w: 0.4 });
    expect(body.ret.total).toBe(0.28);
  });

  it("includes euro figures when amounts are disclosed", () => {
    const body = buildSnapshotBody({ report: makeReport(), amounts: true });
    expect(body.totals).toEqual({
      value: 10000,
      cost: 8000,
      realized: 150,
      dividends: 90,
    });
    expect(body.holdings[0]).toEqual({ t: "AAPL", w: 0.4, v: 4000 });
  });

  it("aggregates everything past the top N into one remainder row", () => {
    const weights = Array.from({ length: SNAPSHOT_TOP_HOLDINGS + 5 }, (_, i) => ({
      ticker: `T${i}`,
      weight: 1 / (SNAPSHOT_TOP_HOLDINGS + 5),
      valueEur: 100,
    }));
    const body = buildSnapshotBody({
      report: makeReport({ weights, holdingsCount: weights.length }),
      amounts: true,
    });
    expect(body.holdings).toHaveLength(SNAPSHOT_TOP_HOLDINGS + 1);
    const last = body.holdings[body.holdings.length - 1];
    expect(last.t).toBe(REMAINDER_KEY);
    expect(last.w).toBeCloseTo(5 / (SNAPSHOT_TOP_HOLDINGS + 5), 6);
    expect(last.v).toBe(500);
    // The remainder must not swallow the real holdings count.
    expect(body.holdingsCount).toBe(weights.length);
  });

  it("adds no remainder row when every holding fits", () => {
    const body = buildSnapshotBody({ report: makeReport(), amounts: false });
    expect(body.holdings.map((h) => h.t)).toEqual(["AAPL", "MSFT", "ASML"]);
  });

  it("rounds the numbers that get printed, so the card shows what was signed", () => {
    const body = buildSnapshotBody({ report: makeReport(), amounts: false });
    expect(body.ret.irr).toBe(0.123457);
    expect(body.conc.effN).toBe(2.899);
  });

  it("defaults to the self tier and carries the broker at the broker tier", () => {
    expect(buildSnapshotBody({ report: makeReport(), amounts: false }).tier).toBe("self");
    const broker = buildSnapshotBody({
      report: makeReport(),
      amounts: false,
      tier: "broker",
      broker: "ibkr",
    });
    expect(broker.tier).toBe("broker");
    expect(broker.broker).toBe("ibkr");
  });
});

describe("canonicalizeBody", () => {
  it("does not depend on the order the fields were assigned in", () => {
    const a = buildSnapshotBody({ report: makeReport(), amounts: true });
    // Same body, rebuilt with the keys in a different insertion order.
    const shuffled = JSON.parse(
      JSON.stringify({
        grade: a.grade,
        v: a.v,
        totals: { dividends: a.totals!.dividends, value: a.totals!.value, cost: a.totals!.cost, realized: a.totals!.realized },
        holdings: a.holdings.map((h) => ({ w: h.w, v: h.v, t: h.t })),
        score: a.score,
        ret: { total: a.ret.total, irr: a.ret.irr },
        sectors: a.sectors,
        regions: a.regions.map((r) => ({ w: r.w, k: r.k })),
        conc: { top3: a.conc.top3, effN: a.conc.effN, top1: a.conc.top1 },
        holdingsCount: a.holdingsCount,
        amounts: a.amounts,
        broker: a.broker,
        tier: a.tier,
      }),
    ) as SnapshotBody;
    expect(canonicalizeBody(shuffled)).toBe(canonicalizeBody(a));
  });

  it("changes whenever a disclosed figure changes", async () => {
    const base = buildSnapshotBody({ report: makeReport(), amounts: false });
    const tweaked = buildSnapshotBody({
      report: makeReport({ score: 62 }),
      amounts: false,
    });
    expect(canonicalizeBody(tweaked)).not.toBe(canonicalizeBody(base));
    expect(await sha256Hex(canonicalizeBody(tweaked))).not.toBe(
      await sha256Hex(canonicalizeBody(base)),
    );
  });

  it("distinguishes a self-tier body from an otherwise identical broker-tier one", () => {
    const self = buildSnapshotBody({ report: makeReport(), amounts: false });
    const broker = buildSnapshotBody({
      report: makeReport(),
      amounts: false,
      tier: "broker",
      broker: "ibkr",
    });
    expect(canonicalizeBody(self)).not.toBe(canonicalizeBody(broker));
  });
});

describe("digest", () => {
  it("binds the body to its code and issue time", async () => {
    const canonical = canonicalizeBody(
      buildSnapshotBody({ report: makeReport(), amounts: false }),
    );
    const a = await recomputeDigest({ code: "ABCDEFGHJK", issuedAt: "2026-08-12T10:00:00.000Z", canonical });
    const sameBodyLaterDate = await recomputeDigest({ code: "ABCDEFGHJK", issuedAt: "2026-08-13T10:00:00.000Z", canonical });
    const sameBodyOtherCode = await recomputeDigest({ code: "KJHGFEDCBA", issuedAt: "2026-08-12T10:00:00.000Z", canonical });
    expect(a).not.toBe(sameBodyLaterDate);
    expect(a).not.toBe(sameBodyOtherCode);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is a plain concatenation the server can reproduce without re-serialising", () => {
    expect(digestInput("ABCDEFGHJK", "2026-08-12T10:00:00.000Z", "{}")).toBe(
      "ABCDEFGHJK\n2026-08-12T10:00:00.000Z\n{}",
    );
  });

  it("formats a readable fragment for the printed card", () => {
    expect(shortDigest("0123456789abcdef".repeat(4))).toBe("0123-4567-89AB");
  });
});

describe("isValidCode", () => {
  it("accepts issued codes and rejects ambiguous or wrong-length ones", () => {
    expect(isValidCode("ABCDEFGHJK")).toBe(true);
    expect(isValidCode("0123456789")).toBe(true);
    expect(isValidCode("ABCDEFGHI0")).toBe(false); // I is excluded
    expect(isValidCode("ABCDEFGHJ")).toBe(false); // too short
    expect(isValidCode("abcdefghjk")).toBe(false); // lowercase
  });
});
