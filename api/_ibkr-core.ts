// Interactive Brokers Flex Web Service — the free, official way to read a
// user's real positions without ever touching their credentials.
//
// How the handshake works. The user creates two things inside their own IBKR
// account: an Activity Flex Query (which fields to include) and a Flex Web
// Service token. Both are read-only by construction — the endpoint can fetch
// reports and nothing else, so a leaked token cannot place an order or move
// money. They hand us the token and the query id, and we do:
//
//   1. SendRequest(t=token, q=queryId)  → a ReferenceCode + a Url
//   2. GetStatement(t=token, q=refCode) → the statement XML
//
// Step 2 usually is not ready on the first call: IBKR answers 1019 "statement
// generation in progress" and expects a retry a moment later. That is normal
// operation, not an error, which is why retryability is part of the parsed
// result rather than something the caller has to pattern-match on a message.
//
// Parsing is done with targeted regexes rather than an XML library. The format
// is small, fixed and attribute-only, and a serverless function should not pull
// a parser dependency for four tags. Everything here is pure — the network
// lives in the route — so the awkward cases are covered by fixtures in tests.

/** Flex responses are attribute-based; values are XML-escaped. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? unescapeXml(m[1]) : null;
}

function tagText(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unescapeXml(m[1]).trim() : null;
}

const num = (v: string | null): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type FlexError = {
  ok: false;
  code: number | null;
  message: string;
  /** IBKR is still building the statement — the same request will work shortly. */
  retryable: boolean;
};

export type SendRequestResult = { ok: true; referenceCode: string; url: string } | FlexError;

/** Statement generation in progress — the only code worth retrying. */
const RETRYABLE_CODES = new Set([1019]);

/**
 * IBKR reports failures as a 200 with <Status>Fail</Status>, so a caller that
 * only checks the HTTP status would treat an expired token as a valid empty
 * portfolio. Errors are extracted here, not inferred upstream.
 */
function parseError(xml: string): FlexError | null {
  const status = tagText(xml, "Status");
  if (status && /^success$/i.test(status)) return null;
  const code = num(tagText(xml, "ErrorCode"));
  const message = tagText(xml, "ErrorMessage") ?? "Unknown Flex error";
  if (!status && code == null) return null;
  return {
    ok: false,
    code,
    message,
    retryable: code != null && RETRYABLE_CODES.has(code),
  };
}

export function parseSendRequest(xml: string): SendRequestResult {
  const err = parseError(xml);
  if (err) return err;
  const referenceCode = tagText(xml, "ReferenceCode");
  const url = tagText(xml, "Url");
  if (!referenceCode || !url) {
    return {
      ok: false,
      code: null,
      message: "Flex response missing ReferenceCode or Url",
      retryable: false,
    };
  }
  // Only ever follow IBKR's own host back — the Url arrives over the wire and
  // is used to build a request that carries the user's token.
  if (!/^https:\/\/[a-z0-9.-]*\binteractivebrokers\.com\//i.test(url)) {
    return {
      ok: false,
      code: null,
      message: "Flex response pointed at an unexpected host",
      retryable: false,
    };
  }
  return { ok: true, referenceCode, url };
}

export type IbkrPosition = {
  /** IBKR's own symbol, e.g. "AAPL", "ITX". */
  symbol: string;
  description: string | null;
  conid: string | null;
  /** Currency the position is priced in. */
  currency: string;
  /** STK, CASH, FUND, OPT, CRYPTO… */
  assetCategory: string | null;
  listingExchange: string | null;
  quantity: number;
  markPrice: number | null;
  /** Market value in the position's own currency. */
  positionValue: number | null;
  /** Cost basis in the position's own currency. */
  costBasisMoney: number | null;
  unrealizedPnl: number | null;
};

export type StatementResult =
  | { ok: true; accountId: string | null; toDate: string | null; positions: IbkrPosition[] }
  | FlexError;

export function parseStatement(xml: string): StatementResult {
  const err = parseError(xml);
  if (err) return err;

  // A statement with no <FlexStatement> at all is a malformed response, which
  // is different from a real account that simply holds nothing.
  const stmt = xml.match(/<FlexStatement\b([^>]*)>/i);
  if (!stmt && !/<FlexQueryResponse\b/i.test(xml)) {
    return { ok: false, code: null, message: "Not a Flex statement", retryable: false };
  }

  const positions: IbkrPosition[] = [];
  const re = /<OpenPosition\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    const symbol = attr(tag, "symbol");
    const quantity = num(attr(tag, "position"));
    // A row without a symbol or a quantity is not something we can put on a
    // card; skipping beats inventing a holding.
    if (!symbol || quantity == null || quantity === 0) continue;
    positions.push({
      symbol,
      description: attr(tag, "description"),
      conid: attr(tag, "conid"),
      currency: attr(tag, "currency") ?? "USD",
      assetCategory: attr(tag, "assetCategory"),
      listingExchange: attr(tag, "listingExchange"),
      quantity,
      markPrice: num(attr(tag, "markPrice")),
      positionValue: num(attr(tag, "positionValue")),
      costBasisMoney: num(attr(tag, "costBasisMoney")),
      unrealizedPnl: num(attr(tag, "fifoPnlUnrealized")),
    });
  }

  return {
    ok: true,
    accountId: stmt ? attr(stmt[1], "accountId") : null,
    toDate: stmt ? attr(stmt[1], "toDate") : null,
    positions,
  };
}

/**
 * Merge rows that describe the same instrument.
 *
 * A Flex statement can carry one row per lot or per sub-account, and a card
 * that listed AAPL three times would be both wrong-looking and wrong: the
 * weights would be computed per lot. Quantities and money add up; the mark
 * price is shared, so it is taken from the first row.
 */
export function mergePositions(positions: IbkrPosition[]): IbkrPosition[] {
  const byKey = new Map<string, IbkrPosition>();
  for (const p of positions) {
    // conid is IBKR's stable instrument id; symbol+currency is the fallback for
    // queries that don't include it.
    const key = p.conid ? `c:${p.conid}` : `s:${p.symbol}|${p.currency}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...p });
      continue;
    }
    existing.quantity += p.quantity;
    existing.positionValue = addOrNull(existing.positionValue, p.positionValue);
    existing.costBasisMoney = addOrNull(existing.costBasisMoney, p.costBasisMoney);
    existing.unrealizedPnl = addOrNull(existing.unrealizedPnl, p.unrealizedPnl);
  }
  return [...byKey.values()];
}

/** Sum two optional numbers, treating "one side unknown" as unknown. */
function addOrNull(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a + b;
}

/** IBKR exchange → Yahoo suffix, for the tickers the rest of the app speaks. */
const EXCHANGE_SUFFIX: Record<string, string> = {
  BVME: ".MI",
  "BVME.ETF": ".MI",
  IBIS: ".DE",
  IBIS2: ".DE",
  GETTEX: ".DE",
  SBF: ".PA",
  AEB: ".AS",
  EBS: ".VI",
  BM: ".MC",
  BVLP: ".LS",
  LSE: ".L",
  LSEETF: ".L",
  SEHK: ".HK",
  TSE: ".TO",
  SFB: ".ST",
  ENEXT: ".BR",
  HEX: ".HE",
  CPH: ".CO",
  OSE: ".OL",
  SWX: ".SW",
  EBS2: ".VI",
};

/**
 * Best-effort Yahoo ticker for an IBKR position, used so a verified card names
 * instruments the same way the rest of the app does.
 *
 * US listings need no suffix. Anything we don't have a mapping for keeps the
 * bare IBKR symbol rather than guessing a suffix that would resolve to a
 * different company somewhere else.
 */
export function toYahooTicker(p: IbkrPosition): string {
  const symbol = p.symbol.trim().toUpperCase().replace(/\s+/g, "-");
  if (p.assetCategory === "CRYPTO") return `${symbol}-${p.currency.toUpperCase()}`;
  const exchange = p.listingExchange?.trim().toUpperCase();
  if (!exchange) return symbol;
  const suffix = EXCHANGE_SUFFIX[exchange];
  return suffix ? `${symbol}${suffix}` : symbol;
}

/** Human-readable reason for a Flex failure, for the message we show the user. */
export function describeFlexError(err: FlexError): string {
  switch (err.code) {
    case 1003:
      return "IBKR has no statement for that query yet.";
    case 1012:
    case 1013:
      return "That Flex token has expired — generate a new one in IBKR.";
    case 1018:
      return "IBKR is rate-limiting the token; wait a minute and try again.";
    case 1019:
      return "IBKR is still generating the statement.";
    case 1020:
      return "IBKR rejected the request — check the query id.";
    default:
      return err.message;
  }
}
