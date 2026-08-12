import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CODE_RE } from "./_snapshot-core.js";

// Everything the verified-portfolio feature needs, behind one route.
//
// Six operations were six files until the Hobby plan's 12-function ceiling said
// otherwise — the same reason fundamentals-get carries ?search, ?quote,
// ?statements, ?live and ?research. Dispatch is by method + ?action, and each
// branch lazy-imports only its own core, so reading a card never loads the
// broker adapter and issuing one never loads anything it doesn't use.
//
//   GET  ?code=XXXXXXXXXX      public read for /verify/:code (no auth)
//   GET                        the caller's own issued cards
//   POST ?action=create        self-reported card from a client-computed body
//   POST ?action=broker        broker-verified card, fetched and derived here
//   POST ?action=revoke        withdraw a card
//   POST ?action=ibkr-preview  show the positions IBKR reports, issuing nothing

/** Ceiling on cards issued per account per day. */
const DAILY_LIMIT = 50;

function userIdOf(req: VercelRequest): string | null {
  const raw = req.headers["x-user-id"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value && value.length > 0 && value.length <= 128 ? value : null;
}

function requireDb(res: VercelResponse): string | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
    return null;
  }
  return dbUrl;
}

async function neonSql(dbUrl: string) {
  const mod = await import("@neondatabase/serverless");
  return mod.neon(dbUrl);
}

type Sql = Awaited<ReturnType<typeof neonSql>>;

/** True when the account has already issued its allowance today. */
async function overDailyLimit(sql: Sql, userId: string): Promise<boolean> {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM portfolio_snapshots
    WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 day'
  `) as Array<{ n: number }>;
  return (rows[0]?.n ?? 0) >= DAILY_LIMIT;
}

/**
 * Insert a signed row under a fresh random code, retrying on the (vanishingly
 * unlikely) collision. Returns the issued code and digest.
 */
async function insertSnapshot(
  sql: Sql,
  row: {
    userId: string;
    issuedAt: string;
    tier: "self" | "broker";
    broker: string | null;
    amounts: boolean;
    canonical: string;
    secret: string;
  },
): Promise<{ code: string; digest: string } | null> {
  const { digestInput, generateCode, hmacHex, sha256Hex } = await import("./_snapshot-core.js");
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateCode();
    const digest = await sha256Hex(digestInput(candidate, row.issuedAt, row.canonical));
    const signature = await hmacHex(row.secret, digest);
    const inserted = (await sql`
      INSERT INTO portfolio_snapshots
        (code, user_id, issued_at_iso, tier, broker, amounts, canonical, digest, signature)
      VALUES
        (${candidate}, ${row.userId}, ${row.issuedAt}, ${row.tier}, ${row.broker},
         ${row.amounts}, ${row.canonical}, ${digest}, ${signature})
      ON CONFLICT (code) DO NOTHING
      RETURNING code
    `) as Array<{ code: string }>;
    if (inserted.length > 0) return { code: inserted[0].code, digest };
  }
  return null;
}

// --- GET: public read -------------------------------------------------------

async function handleRead(res: VercelResponse, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    res.status(400).end(JSON.stringify({ error: "Invalid code" }));
    return;
  }
  const dbUrl = requireDb(res);
  if (!dbUrl) return;

  const { digestInput, getSecret, hmacHex, sha256Hex, timingSafeEqualHex } = await import(
    "./_snapshot-core.js"
  );
  const sql = await neonSql(dbUrl);
  const rows = (await sql`
    SELECT code, issued_at_iso AS "issuedAt", tier, broker, amounts,
           canonical, digest, signature,
           to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "revokedAt"
    FROM portfolio_snapshots
    WHERE code = ${code}
  `) as Array<{
    code: string;
    issuedAt: string;
    tier: string;
    broker: string | null;
    amounts: boolean;
    canonical: string;
    digest: string;
    signature: string;
    revokedAt: string | null;
  }>;

  const row = rows[0];
  if (!row) {
    res.status(404).end(JSON.stringify({ error: "Unknown code" }));
    return;
  }

  const recomputed = await sha256Hex(digestInput(row.code, row.issuedAt, row.canonical));
  const digestValid = timingSafeEqualHex(recomputed, row.digest);
  const secret = getSecret();
  const signatureValid = secret
    ? timingSafeEqualHex(await hmacHex(secret, row.digest), row.signature)
    : false;

  // Cards are immutable once issued, but revocation can flip, so only a short
  // shared cache.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.status(200).end(
    JSON.stringify({
      code: row.code,
      issuedAt: row.issuedAt,
      tier: row.tier,
      broker: row.broker,
      amounts: row.amounts,
      canonical: row.canonical,
      digest: row.digest,
      digestValid,
      signatureValid,
      revokedAt: row.revokedAt,
    }),
  );
}

// --- GET: the caller's own cards --------------------------------------------

async function handleList(res: VercelResponse, userId: string) {
  const dbUrl = requireDb(res);
  if (!dbUrl) return;
  const sql = await neonSql(dbUrl);
  const rows = await sql`
    SELECT code, issued_at_iso AS "issuedAt", tier, broker, amounts, digest,
           to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "revokedAt"
    FROM portfolio_snapshots
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  res.status(200).end(JSON.stringify({ snapshots: rows }));
}

// --- POST: self-reported card -----------------------------------------------

async function handleCreate(req: VercelRequest, res: VercelResponse, userId: string) {
  const dbUrl = requireDb(res);
  if (!dbUrl) return;

  const { getSecret, validateCanonicalBody } = await import("./_snapshot-core.js");
  const secret = getSecret();
  if (!secret) {
    // Without a key we could still store a snapshot, but the badge would be
    // unsigned — a verification feature that verifies nothing. Fail loudly.
    res.status(500).end(
      JSON.stringify({
        error: "SNAPSHOT_SECRET not configured (needs a random string of 16+ chars)",
      }),
    );
    return;
  }

  const body = (req.body ?? {}) as { canonical?: unknown };
  const canonical = typeof body.canonical === "string" ? body.canonical : "";
  let meta;
  try {
    meta = validateCanonicalBody(canonical);
  } catch (e) {
    res.status(400).end(JSON.stringify({ error: (e as Error).message }));
    return;
  }

  const sql = await neonSql(dbUrl);
  if (await overDailyLimit(sql, userId)) {
    res.status(429).end(JSON.stringify({ error: "Daily snapshot limit reached" }));
    return;
  }

  // Generated here and stored as the exact string that goes into the digest, so
  // the verify page can rebuild the hash byte-for-byte.
  const issuedAt = new Date().toISOString();
  const issued = await insertSnapshot(sql, {
    userId,
    issuedAt,
    tier: meta.tier,
    broker: meta.broker,
    amounts: meta.amounts,
    canonical,
    secret,
  });
  if (!issued) {
    res.status(500).end(JSON.stringify({ error: "Could not allocate a snapshot code" }));
    return;
  }
  res.status(200).end(JSON.stringify({ code: issued.code, issuedAt, digest: issued.digest }));
}

// --- POST: broker-verified card ---------------------------------------------

async function handleBroker(req: VercelRequest, res: VercelResponse, userId: string) {
  const dbUrl = requireDb(res);
  if (!dbUrl) return;

  const { getSecret, validateCanonicalBody } = await import("./_snapshot-core.js");
  const secret = getSecret();
  if (!secret) {
    res.status(500).end(
      JSON.stringify({
        error: "SNAPSHOT_SECRET not configured (needs a random string of 16+ chars)",
      }),
    );
    return;
  }

  const { fetchIbkrPositions, validateCredentials } = await import("./_ibkr-fetch.js");
  const body = (req.body ?? {}) as { token?: unknown; queryId?: unknown; amounts?: unknown };
  const creds = validateCredentials(body.token, body.queryId);
  if (!creds.ok) {
    res.status(400).end(JSON.stringify({ error: creds.error }));
    return;
  }
  const amounts = body.amounts === true;

  const sql = await neonSql(dbUrl);
  if (await overDailyLimit(sql, userId)) {
    res.status(429).end(JSON.stringify({ error: "Daily snapshot limit reached" }));
    return;
  }

  const fetched = await fetchIbkrPositions(creds.token, creds.queryId);
  if (!fetched.ok) {
    res.status(502).end(JSON.stringify({ error: fetched.error, code: fetched.code }));
    return;
  }
  if (fetched.positions.length === 0) {
    res.status(400).end(JSON.stringify({ error: "IBKR reported no open positions" }));
    return;
  }

  // FX and sector metadata come from our own caches. FX is what converts the
  // broker's own currencies into the card's EUR; sectors are descriptive facts
  // about instruments, not claims about the account.
  const tickers = [...new Set(fetched.positions.map((p) => p.ticker.toUpperCase()))];
  const [fxRows, sectorRows] = await Promise.all([
    sql`SELECT currency, rate FROM latest_fx_rates`,
    sql`SELECT ticker, sector FROM fundamentals WHERE ticker = ANY(${tickers})`,
  ]);

  const { buildBrokerBody } = await import("./_broker-snapshot.js");
  const rates: Record<string, number> = {};
  for (const r of fxRows as Array<{ currency: string; rate: unknown }>) {
    const n = typeof r.rate === "number" ? r.rate : parseFloat(String(r.rate));
    if (Number.isFinite(n)) rates[r.currency.toUpperCase()] = n;
  }
  const sectors: Record<string, string | null> = {};
  for (const s of sectorRows as Array<{ ticker: string; sector: string | null }>) {
    sectors[s.ticker.toUpperCase()] = s.sector;
  }

  const built = buildBrokerBody({
    positions: fetched.positions.map((p) => ({
      ticker: p.ticker,
      currency: p.currency,
      quantity: p.quantity,
      value: p.value,
      cost: p.cost,
    })),
    rates,
    sectors,
    amounts,
    broker: "ibkr",
  });
  if (!built.ok) {
    res.status(422).end(JSON.stringify({ error: built.error }));
    return;
  }

  const { canonicalizeBody } = await import("../src/lib/verify.js");
  const canonical = canonicalizeBody(built.body);
  // The same gate the self-tier bodies pass, minus the broker-tier refusal: a
  // body this branch built is by definition server-issued. Running it anyway
  // catches a malformed body before it is signed and published.
  try {
    validateCanonicalBody(canonical, { allowBrokerTier: true });
  } catch (e) {
    res.status(500).end(JSON.stringify({ error: (e as Error).message }));
    return;
  }

  const issuedAt = new Date().toISOString();
  const issued = await insertSnapshot(sql, {
    userId,
    issuedAt,
    tier: "broker",
    broker: "ibkr",
    amounts,
    canonical,
    secret,
  });
  if (!issued) {
    res.status(500).end(JSON.stringify({ error: "Could not allocate a snapshot code" }));
    return;
  }

  res.status(200).end(
    JSON.stringify({
      code: issued.code,
      issuedAt,
      digest: issued.digest,
      canonical,
      account: fetched.account,
      asOf: fetched.asOf,
      // Positions we could not value in EUR, so the user learns the card is
      // missing something rather than wondering why the weights look off.
      skipped: built.skipped,
    }),
  );
}

// --- POST: revoke -----------------------------------------------------------

async function handleRevoke(req: VercelRequest, res: VercelResponse, userId: string) {
  const dbUrl = requireDb(res);
  if (!dbUrl) return;

  const body = (req.body ?? {}) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) {
    res.status(400).end(JSON.stringify({ error: "Invalid code" }));
    return;
  }

  const sql = await neonSql(dbUrl);
  // The user_id predicate is the authorisation: a code you do not own simply
  // does not match, and is reported as unknown. Revoking twice keeps the first
  // timestamp.
  const updated = (await sql`
    UPDATE portfolio_snapshots
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE code = ${code} AND user_id = ${userId}
    RETURNING code,
      to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "revokedAt"
  `) as Array<{ code: string; revokedAt: string }>;

  if (updated.length === 0) {
    res.status(404).end(JSON.stringify({ error: "Unknown code" }));
    return;
  }
  res.status(200).end(JSON.stringify(updated[0]));
}

// --- POST: IBKR preview -----------------------------------------------------

async function handleIbkrPreview(req: VercelRequest, res: VercelResponse) {
  const { fetchIbkrPositions, validateCredentials } = await import("./_ibkr-fetch.js");
  const body = (req.body ?? {}) as { token?: unknown; queryId?: unknown };
  const creds = validateCredentials(body.token, body.queryId);
  if (!creds.ok) {
    res.status(400).end(JSON.stringify({ error: creds.error }));
    return;
  }
  const result = await fetchIbkrPositions(creds.token, creds.queryId);
  if (!result.ok) {
    res.status(502).end(JSON.stringify({ error: result.error, code: result.code }));
    return;
  }
  res.status(200).end(
    JSON.stringify({
      account: result.account,
      asOf: result.asOf,
      positions: result.positions,
    }),
  );
}

// --- dispatch ---------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET") {
      const raw = req.query.code;
      const code = Array.isArray(raw) ? raw[0] : raw;
      if (code) {
        // Public by design: anyone handed a card must be able to check it.
        await handleRead(res, code);
        return;
      }
      const userId = userIdOf(req);
      if (!userId) {
        res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      await handleList(res, userId);
      return;
    }

    if (req.method !== "POST") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Every write, and every read of somebody's holdings, is per-request.
    res.setHeader("Cache-Control", "no-store");

    const userId = userIdOf(req);
    if (!userId) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

    const rawAction = req.query.action;
    const action = (Array.isArray(rawAction) ? rawAction[0] : rawAction) ?? "create";
    switch (action) {
      case "create":
        await handleCreate(req, res, userId);
        return;
      case "broker":
        await handleBroker(req, res, userId);
        return;
      case "revoke":
        await handleRevoke(req, res, userId);
        return;
      case "ibkr-preview":
        await handleIbkrPreview(req, res);
        return;
      default:
        res.status(400).end(JSON.stringify({ error: `Unknown action "${action}"` }));
        return;
    }
  } catch (e) {
    const err = e as Error;
    const message =
      err?.name === "AbortError" ? "The upstream request timed out" : (err?.message ?? "Snapshot request failed");
    res.status(500).end(JSON.stringify({ error: message }));
  }
}
