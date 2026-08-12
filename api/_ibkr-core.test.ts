import { describe, it, expect } from "vitest";
import {
  describeFlexError,
  mergePositions,
  parseSendRequest,
  parseStatement,
  toYahooTicker,
  type IbkrPosition,
} from "./_ibkr-core";

const SEND_OK = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="12 August, 2026 10:31 AM EDT">
  <Status>Success</Status>
  <ReferenceCode>4283910576</ReferenceCode>
  <Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>
</FlexStatementResponse>`;

const SEND_EXPIRED = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="12 August, 2026 10:31 AM EDT">
  <Status>Fail</Status>
  <ErrorCode>1012</ErrorCode>
  <ErrorMessage>Token has expired.</ErrorMessage>
</FlexStatementResponse>`;

const IN_PROGRESS = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="12 August, 2026 10:31 AM EDT">
  <Status>Warn</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;

const STATEMENT = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Positions" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="2026-01-01" toDate="2026-08-12" period="YearToDate">
<OpenPositions>
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" listingExchange="NASDAQ" position="40" markPrice="228.5" positionValue="9140" costBasisPrice="150.25" costBasisMoney="6010" fifoPnlUnrealized="3130" />
<OpenPosition accountId="U1234567" currency="EUR" assetCategory="STK" symbol="ITX" description="INDUSTRIA DE DISENO TEXTIL" conid="1234" listingExchange="BM" position="90" markPrice="46.2" positionValue="4158" costBasisPrice="38.1" costBasisMoney="3429" fifoPnlUnrealized="729" />
<OpenPosition accountId="U1234567" currency="GBP" assetCategory="STK" symbol="SHEL" description="SHELL PLC" conid="5678" listingExchange="LSE" position="120" markPrice="27.4" positionValue="3288" costBasisPrice="24" costBasisMoney="2880" fifoPnlUnrealized="408" />
</OpenPositions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

describe("parseSendRequest", () => {
  it("pulls the reference code and url out of a success", () => {
    const r = parseSendRequest(SEND_OK);
    expect(r).toEqual({
      ok: true,
      referenceCode: "4283910576",
      url: "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement",
    });
  });

  it("reports an expired token instead of looking like an empty account", () => {
    const r = parseSendRequest(SEND_EXPIRED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(1012);
    expect(r.retryable).toBe(false);
    expect(describeFlexError(r)).toMatch(/expired/i);
  });

  it("marks statement-generation as retryable and nothing else", () => {
    const warn = parseSendRequest(IN_PROGRESS);
    expect(warn.ok).toBe(false);
    if (warn.ok) return;
    expect(warn.retryable).toBe(true);

    const expired = parseSendRequest(SEND_EXPIRED);
    expect(expired.ok === false && expired.retryable).toBe(false);
  });

  it("refuses a Url pointing anywhere but IBKR", () => {
    // The Url arrives over the wire and we then send the user's token to it.
    const evil = SEND_OK.replace(
      /<Url>[^<]*<\/Url>/,
      "<Url>https://interactivebrokers.com.attacker.test/collect</Url>",
    );
    const r = parseSendRequest(evil);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/unexpected host/i);
  });

  it("rejects a success with no reference code", () => {
    const r = parseSendRequest(SEND_OK.replace(/<ReferenceCode>[^<]*<\/ReferenceCode>/, ""));
    expect(r.ok).toBe(false);
  });
});

describe("parseStatement", () => {
  it("reads the open positions with their own currencies", () => {
    const r = parseStatement(STATEMENT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accountId).toBe("U1234567");
    expect(r.toDate).toBe("2026-08-12");
    expect(r.positions).toHaveLength(3);
    expect(r.positions[0]).toMatchObject({
      symbol: "AAPL",
      currency: "USD",
      quantity: 40,
      positionValue: 9140,
      costBasisMoney: 6010,
      unrealizedPnl: 3130,
      listingExchange: "NASDAQ",
    });
    expect(r.positions[1].currency).toBe("EUR");
    expect(r.positions[2].currency).toBe("GBP");
  });

  it("passes an in-progress statement through as retryable", () => {
    const r = parseStatement(IN_PROGRESS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });

  it("treats a real but empty account as success with no positions", () => {
    const empty = STATEMENT.replace(/<OpenPositions>[\s\S]*<\/OpenPositions>/, "<OpenPositions />");
    const r = parseStatement(empty);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.positions).toEqual([]);
  });

  it("skips rows that cannot describe a holding", () => {
    const odd = STATEMENT.replace(
      "<OpenPositions>",
      `<OpenPositions>
<OpenPosition currency="USD" symbol="" position="10" />
<OpenPosition currency="USD" symbol="ZERO" position="0" />
<OpenPosition currency="USD" symbol="NOQTY" />`,
    );
    const r = parseStatement(odd);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.positions.map((p) => p.symbol)).toEqual(["AAPL", "ITX", "SHEL"]);
  });

  it("unescapes descriptions", () => {
    const amp = STATEMENT.replace("APPLE INC", "JOHNSON &amp; JOHNSON");
    const r = parseStatement(amp);
    if (r.ok) expect(r.positions[0].description).toBe("JOHNSON & JOHNSON");
  });

  it("refuses something that is not a Flex statement at all", () => {
    const r = parseStatement("<html><body>Service unavailable</body></html>");
    expect(r.ok).toBe(false);
  });
});

describe("mergePositions", () => {
  const lot = (over: Partial<IbkrPosition>): IbkrPosition => ({
    symbol: "AAPL",
    description: "APPLE INC",
    conid: "265598",
    currency: "USD",
    assetCategory: "STK",
    listingExchange: "NASDAQ",
    quantity: 10,
    markPrice: 228.5,
    positionValue: 2285,
    costBasisMoney: 1500,
    unrealizedPnl: 785,
    ...over,
  });

  it("folds several lots of the same instrument into one holding", () => {
    const merged = mergePositions([lot({}), lot({ quantity: 30, positionValue: 6855, costBasisMoney: 4510, unrealizedPnl: 2345 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      quantity: 40,
      positionValue: 9140,
      costBasisMoney: 6010,
      unrealizedPnl: 3130,
    });
  });

  it("keeps different instruments apart", () => {
    const merged = mergePositions([lot({}), lot({ conid: "999", symbol: "MSFT" })]);
    expect(merged.map((p) => p.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("falls back to symbol+currency when the query omits conid", () => {
    const merged = mergePositions([
      lot({ conid: null }),
      lot({ conid: null, quantity: 5, positionValue: 1142.5 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(15);
  });

  it("leaves a total unknown rather than half-summed", () => {
    const merged = mergePositions([lot({}), lot({ costBasisMoney: null })]);
    expect(merged[0].costBasisMoney).toBeNull();
    expect(merged[0].quantity).toBe(20);
  });

  it("does not mutate the input rows", () => {
    const rows = [lot({}), lot({})];
    mergePositions(rows);
    expect(rows[0].quantity).toBe(10);
  });
});

describe("toYahooTicker", () => {
  const p = (over: Partial<IbkrPosition>): IbkrPosition => ({
    symbol: "X",
    description: null,
    conid: null,
    currency: "USD",
    assetCategory: "STK",
    listingExchange: null,
    quantity: 1,
    markPrice: null,
    positionValue: null,
    costBasisMoney: null,
    unrealizedPnl: null,
    ...over,
  });

  it("leaves US listings bare and suffixes the venues we know", () => {
    expect(toYahooTicker(p({ symbol: "AAPL", listingExchange: "NASDAQ" }))).toBe("AAPL");
    expect(toYahooTicker(p({ symbol: "ITX", listingExchange: "BM" }))).toBe("ITX.MC");
    expect(toYahooTicker(p({ symbol: "SHEL", listingExchange: "LSE" }))).toBe("SHEL.L");
  });

  it("keeps the bare symbol for a venue we have no mapping for", () => {
    // Guessing a suffix here would name a different company on another market.
    expect(toYahooTicker(p({ symbol: "FOO", listingExchange: "MADEUP" }))).toBe("FOO");
  });

  it("pairs crypto with its currency the way Yahoo does", () => {
    expect(toYahooTicker(p({ symbol: "BTC", assetCategory: "CRYPTO", currency: "EUR" }))).toBe(
      "BTC-EUR",
    );
  });
});
