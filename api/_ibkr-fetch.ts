// The networked half of the IBKR Flex adapter: the two-step handshake, the
// retry-while-generating loop, and the token hygiene that goes with holding a
// read-only brokerage credential for the duration of two HTTP calls.
//
// Shared by broker-ibkr-positions (preview) and snapshot-create-broker
// (issuing) so the two cannot drift — a preview that showed different holdings
// from the card it produced would be worse than no preview at all.

import {
  describeFlexError,
  mergePositions,
  parseSendRequest,
  parseStatement,
  toYahooTicker,
  type FlexError,
} from "./_ibkr-core.js";

const SEND_REQUEST_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";

/** IBKR answers 1019 until the statement is built; it usually takes seconds. */
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;
/** Each leg, so the function cannot hang on a stalled socket. */
const FETCH_TIMEOUT_MS = 15000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type NormalisedPosition = {
  ticker: string;
  symbol: string;
  description: string | null;
  currency: string;
  assetCategory: string | null;
  quantity: number;
  markPrice: number | null;
  value: number | null;
  cost: number | null;
  unrealized: number | null;
};

export type IbkrFetchResult =
  | { ok: true; account: string | null; asOf: string | null; positions: NormalisedPosition[] }
  | { ok: false; error: string; code: number | null };

/** Credentials are digit strings in IBKR's UI; validated before they reach a URL. */
export function validateCredentials(
  token: unknown,
  queryId: unknown,
): { ok: true; token: string; queryId: string } | { ok: false; error: string } {
  const t = typeof token === "string" ? token.trim() : "";
  const q = typeof queryId === "string" ? queryId.trim() : "";
  if (!/^\d{6,64}$/.test(t)) return { ok: false, error: "Invalid Flex token" };
  if (!/^\d{3,32}$/.test(q)) return { ok: false, error: "Invalid Flex query id" };
  return { ok: true, token: t, queryId: q };
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "TrimmTrack/1.0" },
    });
    if (!res.ok) throw new Error(`IBKR responded ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Error text for the client, with the token scrubbed in case it appears. */
function safeMessage(err: FlexError, token: string): string {
  return describeFlexError(err).split(token).join("<token>");
}

/**
 * Fetch and normalise a user's open positions.
 *
 * The token is used for these calls and then goes out of scope: it is never
 * persisted, never logged and never returned. A leaked read-only Flex token
 * still exposes someone's holdings, and the user can regenerate one in seconds,
 * so there is nothing to gain by keeping it.
 */
export async function fetchIbkrPositions(
  token: string,
  queryId: string,
): Promise<IbkrFetchResult> {
  const t = encodeURIComponent(token);
  const q = encodeURIComponent(queryId);

  const sent = parseSendRequest(await fetchText(`${SEND_REQUEST_URL}?t=${t}&q=${q}&v=3`));
  if (!sent.ok) return { ok: false, error: safeMessage(sent, token), code: sent.code };

  const statementUrl = `${sent.url}?t=${t}&q=${encodeURIComponent(sent.referenceCode)}&v=3`;
  let statement = parseStatement(await fetchText(statementUrl));
  for (let attempt = 1; attempt < MAX_ATTEMPTS && !statement.ok && statement.retryable; attempt++) {
    await sleep(RETRY_DELAY_MS);
    statement = parseStatement(await fetchText(statementUrl));
  }
  if (!statement.ok) {
    return { ok: false, error: safeMessage(statement, token), code: statement.code };
  }

  return {
    ok: true,
    // The full account number identifies a real brokerage account and the
    // caller has no use for it; only the tail goes back, so the user can tell
    // which account answered.
    account: statement.accountId ? `…${statement.accountId.slice(-4)}` : null,
    asOf: statement.toDate,
    positions: mergePositions(statement.positions).map((p) => ({
      ticker: toYahooTicker(p),
      symbol: p.symbol,
      description: p.description,
      currency: p.currency,
      assetCategory: p.assetCategory,
      quantity: p.quantity,
      markPrice: p.markPrice,
      value: p.positionValue,
      cost: p.costBasisMoney,
      unrealized: p.unrealizedPnl,
    })),
  };
}

/** Turn a thrown fetch failure into the message the client should see. */
export function describeThrown(e: unknown): string {
  const err = e as Error;
  return err?.name === "AbortError"
    ? "IBKR did not respond in time"
    : (err?.message ?? "IBKR request failed");
}
