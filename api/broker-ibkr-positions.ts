import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describeThrown, fetchIbkrPositions, validateCredentials } from "./_ibkr-fetch.js";

// Preview step: shows the user which positions IBKR reports for their token
// before they commit to issuing a card from them. Reads only — nothing is
// stored, including the token (see _ibkr-fetch).

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Content-Type", "application/json");
    // The response embeds someone's holdings; no shared cache may keep it.
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.status(405).end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const rawHeader = req.headers["x-user-id"];
    const userIdRaw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const userId = userIdRaw?.trim();
    if (!userId || userId.length === 0 || userId.length > 128) {
      res.status(401).end(JSON.stringify({ error: "Missing x-user-id header" }));
      return;
    }

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
  } catch (e) {
    res.status(502).end(JSON.stringify({ error: describeThrown(e) }));
  }
}
