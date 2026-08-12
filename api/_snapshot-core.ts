// Shared logic for issuing and checking verified portfolio snapshots.
// Imported by api/snapshot-create.ts and api/snapshot-get.ts.
//
// The digest recipe here MUST stay identical to src/lib/verify.ts
// (digestInput/sha256Hex), because the public verify page recomputes the digest
// in the browser and compares it with the stored one. It is deliberately a
// plain concatenation of three stored fields: the server never re-serialises
// the body, it hashes exactly the bytes it was handed, so no serialisation
// difference between browser and server can ever invalidate a real card.

/** Alphabet without I and O — codes get read aloud and typed off screenshots. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 10;

/** Must match CODE_RE in src/lib/verify.ts. */
export const CODE_RE = /^[0-9A-HJ-NP-Z]{10}$/;

/** Largest canonical body we will store (a 40-row portfolio is ~3 kB). */
export const MAX_CANONICAL_BYTES = 8000;

export type SnapshotTier = "self" | "broker";

/**
 * Random code, rejection-sampled so every character is equally likely. A modulo
 * over 256 would bias the first 18 letters of the alphabet, which is a poor
 * look for the identifier of a verification system.
 */
export function generateCode(): string {
  const max = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let out = "";
  const buf = new Uint8Array(CODE_LENGTH * 2);
  while (out.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= max) continue;
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

export function digestInput(code: string, issuedAt: string, canonical: string): string {
  return `${code}\n${issuedAt}\n${canonical}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 of `message` under `secret`, lowercase hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time hex comparison — no early return on the first differing byte. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type ValidatedBody = {
  tier: SnapshotTier;
  broker: string | null;
  amounts: boolean;
};

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isWeight = (v: unknown): v is number => isFiniteNum(v) && v >= -0.0001 && v <= 1.0001;

/**
 * Structural + sanity check on a canonical body before it is signed.
 *
 * The client computes the figures (they come from the user's own imported
 * Excel either way, which is exactly what the "self" tier says), so this is not
 * an integrity check on the numbers — it is a guard against signing something
 * malformed or absurd, which would then be displayed on a public page under our
 * name. Anything that fails here is rejected rather than clamped: a snapshot
 * must be the figures the user saw, or nothing at all.
 *
 * Returns the fields the row denormalises for querying, or throws.
 */
export function validateCanonicalBody(
  canonical: string,
  opts: { allowBrokerTier?: boolean } = {},
): ValidatedBody {
  if (typeof canonical !== "string" || canonical.length === 0) {
    throw new Error("Missing snapshot body");
  }
  if (new TextEncoder().encode(canonical).length > MAX_CANONICAL_BYTES) {
    throw new Error("Snapshot body too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    throw new Error("Snapshot body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Snapshot body must be an object");
  }
  const b = parsed as Record<string, unknown>;

  if (b.v !== 1) throw new Error("Unsupported snapshot version");
  if (b.tier !== "self" && b.tier !== "broker") throw new Error("Invalid tier");
  // Only the server may mint a broker-tier snapshot, and it only does that from
  // data it fetched from the broker itself — snapshot-create-broker opts in
  // explicitly. A client asking for one is either a bug or someone trying to
  // award themselves a badge.
  if (b.tier === "broker" && !opts.allowBrokerTier) {
    throw new Error("Broker tier cannot be self-issued");
  }
  if (b.broker !== null && typeof b.broker !== "string") throw new Error("Invalid broker");
  if (typeof b.amounts !== "boolean") throw new Error("Invalid amounts flag");

  if (!isFiniteNum(b.holdingsCount) || b.holdingsCount < 1 || b.holdingsCount > 10000) {
    throw new Error("Invalid holdings count");
  }
  if (!Array.isArray(b.holdings) || b.holdings.length < 1 || b.holdings.length > 40) {
    throw new Error("Invalid holdings");
  }
  let weightSum = 0;
  for (const h of b.holdings) {
    if (!h || typeof h !== "object") throw new Error("Invalid holding");
    const row = h as Record<string, unknown>;
    if (typeof row.t !== "string" || row.t.length === 0 || row.t.length > 32) {
      throw new Error("Invalid holding ticker");
    }
    if (!isWeight(row.w)) throw new Error("Invalid holding weight");
    if (row.v !== undefined && !isFiniteNum(row.v)) throw new Error("Invalid holding value");
    if (b.amounts === false && row.v !== undefined) {
      throw new Error("Amounts present but not disclosed");
    }
    weightSum += row.w;
  }
  // Weights are a distribution over the whole portfolio; the remainder row makes
  // them add up. A body that doesn't sum to 1 would render a misleading chart.
  if (Math.abs(weightSum - 1) > 0.02) throw new Error("Holding weights must sum to 1");

  for (const key of ["regions", "sectors"] as const) {
    const slices = b[key];
    if (key === "sectors" && slices === null) continue;
    if (!Array.isArray(slices) || slices.length > 32) throw new Error(`Invalid ${key}`);
    for (const s of slices) {
      if (!s || typeof s !== "object") throw new Error(`Invalid ${key} slice`);
      const row = s as Record<string, unknown>;
      if (typeof row.k !== "string" || row.k.length === 0 || row.k.length > 64) {
        throw new Error(`Invalid ${key} key`);
      }
      if (!isWeight(row.w)) throw new Error(`Invalid ${key} weight`);
    }
  }

  const conc = b.conc as Record<string, unknown> | undefined;
  if (!conc || !isWeight(conc.top1) || !isWeight(conc.top3) || !isFiniteNum(conc.effN)) {
    throw new Error("Invalid concentration");
  }
  const ret = b.ret as Record<string, unknown> | undefined;
  if (!ret) throw new Error("Invalid returns");
  for (const k of ["total", "irr"] as const) {
    if (ret[k] !== null && !isFiniteNum(ret[k])) throw new Error("Invalid returns");
  }

  if (b.amounts) {
    const totals = b.totals as Record<string, unknown> | undefined;
    if (!totals) throw new Error("Missing totals");
    for (const k of ["value", "cost"] as const) {
      if (!isFiniteNum(totals[k])) throw new Error("Invalid totals");
    }
    // A broker positions statement carries no realised P&L or dividend history,
    // so these are legitimately absent rather than zero.
    for (const k of ["realized", "dividends"] as const) {
      if (totals[k] !== null && !isFiniteNum(totals[k])) throw new Error("Invalid totals");
    }
  } else if (b.totals !== null) {
    throw new Error("Totals present but amounts not disclosed");
  }

  if (!isFiniteNum(b.score) || b.score < 0 || b.score > 100) throw new Error("Invalid score");
  if (typeof b.grade !== "string" || b.grade.length > 2) throw new Error("Invalid grade");

  return {
    tier: b.tier,
    broker: typeof b.broker === "string" ? b.broker : null,
    amounts: b.amounts,
  };
}

/** The signing secret, or null when the deployment has not configured one. */
export function getSecret(): string | null {
  const s = process.env.SNAPSHOT_SECRET;
  return s && s.length >= 16 ? s : null;
}
