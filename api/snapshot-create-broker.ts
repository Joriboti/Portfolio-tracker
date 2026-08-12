import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  digestInput,
  generateCode,
  getSecret,
  hmacHex,
  sha256Hex,
  validateCanonicalBody,
} from "./_snapshot-core.js";
import { buildBrokerBody, type UsdPerUnit } from "./_broker-snapshot.js";
import { describeThrown, fetchIbkrPositions, validateCredentials } from "./_ibkr-fetch.js";
import { canonicalizeBody } from "../src/lib/verify.js";

// Issues a broker-tier snapshot: fetches the account's real positions from
// IBKR, derives the figures here, signs them and stores the row.
//
// The whole thing happens in one request on purpose. If the client fetched the
// positions and posted back a body, it could adjust a weight in between, and
// the tier that is supposed to mean "these came from the broker" would mean
// "these were reported by a browser that had once spoken to a broker".

const DAILY_LIMIT = 50;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      res.status(500).end(JSON.stringify({ error: "DATABASE_URL not configured" }));
      return;
    }
    const secret = getSecret();
    if (!secret) {
      res.status(500).end(
        JSON.stringify({
          error: "SNAPSHOT_SECRET not configured (needs a random string of 16+ chars)",
        }),
      );
      return;
    }

    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId || userId.length === 0 || userId.length > 128) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

    const body = (req.body ?? {}) as {
      token?: unknown;
      queryId?: unknown;
      amounts?: unknown;
    };
    const creds = validateCredentials(body.token, body.queryId);
    if (!creds.ok) {
      res.status(400).end(JSON.stringify({ error: creds.error }));
      return;
    }
    const amounts = body.amounts === true;

    const mod = await import("@neondatabase/serverless");
    const sql = mod.neon(dbUrl);

    const recent = (await sql`
      SELECT COUNT(*)::int AS n
      FROM portfolio_snapshots
      WHERE user_id = ${userId} AND created_at > NOW() - INTERVAL '1 day'
    `) as Array<{ n: number }>;
    if ((recent[0]?.n ?? 0) >= DAILY_LIMIT) {
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
    // broker's own currencies into the card's EUR; sectors are descriptive
    // facts about instruments, not claims about the account.
    const tickers = [...new Set(fetched.positions.map((p) => p.ticker.toUpperCase()))];
    const [fxRows, sectorRows] = await Promise.all([
      sql`SELECT currency, rate FROM latest_fx_rates`,
      sql`SELECT ticker, sector FROM fundamentals WHERE ticker = ANY(${tickers})`,
    ]);

    const rates: UsdPerUnit = {};
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

    const canonical = canonicalizeBody(built.body);
    // Same gate the self-tier bodies pass, minus the broker-tier refusal: a body
    // this function built is by definition server-issued. Running it anyway
    // catches a malformed body before it is signed and published.
    try {
      validateCanonicalBody(canonical, { allowBrokerTier: true });
    } catch (e) {
      res.status(500).end(JSON.stringify({ error: (e as Error).message }));
      return;
    }

    const issuedAt = new Date().toISOString();
    let code = "";
    let digest = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      digest = await sha256Hex(digestInput(candidate, issuedAt, canonical));
      const signature = await hmacHex(secret, digest);
      const inserted = (await sql`
        INSERT INTO portfolio_snapshots
          (code, user_id, issued_at_iso, tier, broker, amounts, canonical, digest, signature)
        VALUES
          (${candidate}, ${userId}, ${issuedAt}, 'broker', 'ibkr',
           ${amounts}, ${canonical}, ${digest}, ${signature})
        ON CONFLICT (code) DO NOTHING
        RETURNING code
      `) as Array<{ code: string }>;
      if (inserted.length > 0) {
        code = inserted[0].code;
        break;
      }
    }
    if (!code) {
      res.status(500).end(JSON.stringify({ error: "Could not allocate a snapshot code" }));
      return;
    }

    res.status(200).end(
      JSON.stringify({
        code,
        issuedAt,
        digest,
        canonical,
        account: fetched.account,
        asOf: fetched.asOf,
        // Positions we could not value in EUR, so the user learns the card is
        // missing something rather than wondering why the weights look off.
        skipped: built.skipped,
      }),
    );
  } catch (e) {
    res.status(502).end(JSON.stringify({ error: describeThrown(e) }));
  }
}
