// Verified portfolio snapshots — the data model behind the shareable card, the
// one-page PDF and the public /verify/:code page.
//
// WHAT THE BADGE CLAIMS (and what it doesn't)
// -------------------------------------------
// Every figure in this app ultimately comes from an Excel the user imported
// themselves, so nothing here can attest that the holdings are real. What a
// snapshot *does* prove is narrower and honest:
//
//   1. TrimmTrack issued this exact set of figures, at this exact time
//      (the server HMACs the digest with a secret the client never sees), and
//   2. the card/PDF you are looking at has not been edited since
//      (its printed digest must match the one recomputed from the stored body).
//
// That is the "self" tier. When a broker adapter lands (IBKR Flex, Trading 212,
// …) the server will rebuild the body straight from broker data and issue the
// same structure at the "broker" tier — the card then also attests where the
// numbers came from. Tier is part of the digested body precisely so a self-tier
// card can never be passed off as a broker-tier one.
//
// DIGEST RECIPE (must stay identical here and on the server)
// ---------------------------------------------------------
//   digest = sha256Hex(`${code}\n${issuedAt}\n${canonicalBody}`)
// where canonicalBody is the exact string produced by canonicalizeBody() and
// stored verbatim. Keeping the recipe a plain concatenation of three stored
// fields means the server never re-serialises anything: it digests bytes it was
// given, and the verify page can redo the same computation in the browser.

import type { XrayReport } from "./xray";

/** How much the issuer could attest about the numbers. */
export type VerifiedTier = "self" | "broker";

/** One row of the distribution. `v` (value in EUR) only when amounts are shown. */
export type SnapshotHolding = { t: string; w: number; v?: number };
export type SnapshotSlice = { k: string; w: number };

/**
 * The digested body. Deliberately compact: it is stored, transmitted and
 * hashed, and every field is visible on the public verify page — so nothing
 * goes in here that the user has not agreed to disclose.
 */
export type SnapshotBody = {
  v: 1;
  tier: VerifiedTier;
  /** Broker the data came from, at the "broker" tier. */
  broker: string | null;
  /** Whether euro figures are disclosed (weights and % are always shown). */
  amounts: boolean;
  holdingsCount: number;
  /** Top holdings by weight, plus a single aggregated remainder row. */
  holdings: SnapshotHolding[];
  regions: SnapshotSlice[];
  sectors: SnapshotSlice[] | null;
  conc: { top1: number; top3: number; effN: number };
  ret: { total: number | null; irr: number | null };
  /** Euro totals — null unless `amounts` is true. */
  totals: { value: number; cost: number; realized: number; dividends: number } | null;
  score: number;
  grade: string;
};

/** A snapshot as issued: the body plus the fields the server assigns. */
export type IssuedSnapshot = {
  code: string;
  issuedAt: string;
  body: SnapshotBody;
  /** The exact canonical string that was digested. */
  canonical: string;
  digest: string;
  /** Whether the stored HMAC matched — computed server-side, where the key is. */
  signatureValid: boolean;
  /** Set once the owner has withdrawn the card. */
  revokedAt?: string | null;
};

/**
 * How many individual holdings the card and PDF show before the rest is folded
 * into one bucket. Eight because that is how many categorical colours can be
 * told apart — including by a colourblind reader — without cycling hues; the
 * ninth slice is the neutral remainder, never a made-up tenth colour.
 */
export const SNAPSHOT_TOP_HOLDINGS = 8;
/** Bucket key for everything past the top N. Not a ticker — rendered as "Other". */
export const REMAINDER_KEY = "__rest__";

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};
const roundOrNull = (x: number | null | undefined, dp: number): number | null =>
  x == null || !Number.isFinite(x) ? null : round(x, dp);

/**
 * Turn an X-ray report into a snapshot body.
 *
 * Weights are rounded to 6 dp and euro amounts to cents *here*, before the body
 * is ever serialised, so the digest is taken over the same numbers the card
 * prints. Anything rounded afterwards could print a figure that isn't the one
 * that was signed.
 */
export function buildSnapshotBody(input: {
  report: XrayReport;
  amounts: boolean;
  tier?: VerifiedTier;
  broker?: string | null;
}): SnapshotBody {
  const { report, amounts } = input;
  const tier = input.tier ?? "self";

  const top = report.weights.slice(0, SNAPSHOT_TOP_HOLDINGS);
  const rest = report.weights.slice(SNAPSHOT_TOP_HOLDINGS);
  const holdings: SnapshotHolding[] = top.map((w) => ({
    t: w.ticker,
    w: round(w.weight, 6),
    ...(amounts ? { v: round(w.valueEur, 2) } : {}),
  }));
  if (rest.length > 0) {
    holdings.push({
      t: REMAINDER_KEY,
      w: round(
        rest.reduce((s, w) => s + w.weight, 0),
        6,
      ),
      ...(amounts
        ? { v: round(rest.reduce((s, w) => s + w.valueEur, 0), 2) }
        : {}),
    });
  }

  const si = report.sinceInception;
  return {
    v: 1,
    tier,
    broker: input.broker ?? null,
    amounts,
    holdingsCount: report.holdingsCount,
    holdings,
    regions: report.regions.map((r) => ({ k: r.key, w: round(r.weight, 6) })),
    sectors: report.sectors
      ? report.sectors.map((s) => ({ k: s.key, w: round(s.weight, 6) }))
      : null,
    conc: {
      top1: round(report.concentration.top1, 6),
      top3: round(report.concentration.top3, 6),
      effN: round(report.concentration.effectiveN, 3),
    },
    ret: {
      total: roundOrNull(si.returnPct, 6),
      irr: roundOrNull(si.irr, 6),
    },
    totals: amounts
      ? {
          value: round(report.totalValueEur, 2),
          cost: round(report.totalCostEur, 2),
          realized: round(si.realized, 2),
          dividends: round(si.dividends, 2),
        }
      : null,
    score: report.score,
    grade: report.grade,
  };
}

/**
 * Serialise a body to the canonical string that gets digested.
 *
 * JSON.stringify with an explicit key list, not object order: the digest must
 * not depend on the order the fields happened to be assigned in, or a body
 * rebuilt field-by-field elsewhere would hash differently. Nested objects get
 * the same treatment via their own ordered replacers.
 */
export function canonicalizeBody(body: SnapshotBody): string {
  const holding = (h: SnapshotHolding): unknown =>
    h.v === undefined ? { t: h.t, w: h.w } : { t: h.t, v: h.v, w: h.w };
  const slice = (s: SnapshotSlice): unknown => ({ k: s.k, w: s.w });
  return JSON.stringify({
    amounts: body.amounts,
    broker: body.broker,
    conc: { effN: body.conc.effN, top1: body.conc.top1, top3: body.conc.top3 },
    grade: body.grade,
    holdings: body.holdings.map(holding),
    holdingsCount: body.holdingsCount,
    regions: body.regions.map(slice),
    ret: { irr: body.ret.irr, total: body.ret.total },
    score: body.score,
    sectors: body.sectors ? body.sectors.map(slice) : null,
    tier: body.tier,
    totals: body.totals
      ? {
          cost: body.totals.cost,
          dividends: body.totals.dividends,
          realized: body.totals.realized,
          value: body.totals.value,
        }
      : null,
    v: body.v,
  });
}

/** The exact string the digest is taken over. */
export function digestInput(code: string, issuedAt: string, canonical: string): string {
  return `${code}\n${issuedAt}\n${canonical}`;
}

/**
 * SHA-256 of a UTF-8 string, lowercase hex. Uses Web Crypto, which is global in
 * both the browser and Node 18+, so the browser and the serverless function run
 * byte-identical code.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Recompute the digest of an issued snapshot from its stored parts. */
export async function recomputeDigest(s: {
  code: string;
  issuedAt: string;
  canonical: string;
}): Promise<string> {
  return sha256Hex(digestInput(s.code, s.issuedAt, s.canonical));
}

/**
 * The digest fragment printed on the card and PDF. Long enough that forging a
 * card whose body hashes to the same prefix is not worth anyone's afternoon,
 * short enough to read off a screenshot and compare by eye.
 */
export function shortDigest(digest: string): string {
  return digest.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

/** Public verification URL for a snapshot code. */
export function verifyUrl(code: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/verify/${code}`;
}

/** Codes are uppercase Crockford-ish base32, generated server-side. */
export const CODE_RE = /^[0-9A-HJ-NP-Z]{10}$/;

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}
