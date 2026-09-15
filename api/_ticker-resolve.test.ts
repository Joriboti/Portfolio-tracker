import { describe, expect, it } from "vitest";
import {
  STATIC_SYMBOLS,
  pickSearchMatch,
  resolveTickers,
  staticSymbol,
  storageKey,
  type SearchQuote,
  type SqlClient,
} from "./_ticker-resolve";

describe("static map", () => {
  it("covers the broker tickers the Excel uses", () => {
    expect(STATIC_SYMBOLS.EXO).toBe("EXO.AS");
    expect(STATIC_SYMBOLS.ITX).toBe("ITX.MC");
    expect(STATIC_SYMBOLS.TEF).toBe("TEF.MC");
    expect(STATIC_SYMBOLS.CLNX).toBe("CLNX.MC");
    expect(STATIC_SYMBOLS.SAN).toBe("SAN.MC");
    expect(STATIC_SYMBOLS.FER).toBe("FER.MC");
    expect(STATIC_SYMBOLS.IAG).toBe("IAG.MC");
    expect(STATIC_SYMBOLS.BKT).toBe("BKT.MC");
    expect(STATIC_SYMBOLS.HOME).toBe("HOME.MC");
    expect(STATIC_SYMBOLS.LVMH).toBe("MC.PA");
  });

  it("distinguishes skipped from unknown", () => {
    expect(staticSymbol("gold")).toBeNull();
    expect(staticSymbol(" exo ")).toBe("EXO.AS");
    expect(staticSymbol("ZZZZ")).toBeUndefined();
  });

  it("maps broker names to the stored key", () => {
    expect(storageKey("Banco Santander")).toBe("SAN");
    expect(storageKey("AAPL")).toBe("AAPL");
  });
});

describe("pickSearchMatch", () => {
  const exo: SearchQuote[] = [
    { symbol: "EXO.AS", longname: "Exor N.V.", quoteType: "EQUITY", exchange: "AMS" },
    { symbol: "EXO.MI", longname: "Exor N.V.", quoteType: "EQUITY", exchange: "MIL" },
    { symbol: "EXOR.SW", quoteType: "EQUITY" },
  ];

  it("takes the exact symbol over a base match", () => {
    const q: SearchQuote[] = [
      { symbol: "ITX.MC", quoteType: "EQUITY" },
      { symbol: "ITX", longname: "Inditex ADR", quoteType: "EQUITY" },
    ];
    expect(pickSearchMatch("ITX", q)?.symbol).toBe("ITX");
  });

  it("accepts an exchange-suffixed symbol whose base is the ticker", () => {
    expect(pickSearchMatch("EXO", exo)).toEqual({ symbol: "EXO.AS", name: "Exor N.V." });
  });

  it("keeps Yahoo's order between equally good matches", () => {
    expect(pickSearchMatch("exo", [exo[1], exo[0]])?.symbol).toBe("EXO.MI");
  });

  it("refuses a name-only hit for a symbol-shaped ticker", () => {
    const q: SearchQuote[] = [{ symbol: "HD", longname: "Home Depot", quoteType: "EQUITY" }];
    expect(pickSearchMatch("HOMX", q)).toBeNull();
  });

  it("accepts the top tradeable hit for a name-shaped ticker", () => {
    const q: SearchQuote[] = [
      { symbol: "^IBEX", quoteType: "INDEX" },
      { symbol: "MC.PA", longname: "LVMH Moët Hennessy", quoteType: "EQUITY" },
    ];
    expect(pickSearchMatch("MOET HENNESSY", q)).toEqual({
      symbol: "MC.PA",
      name: "LVMH Moët Hennessy",
    });
  });

  it("drops indices, options and symbol-less rows", () => {
    const q: SearchQuote[] = [{ symbol: "^GSPC", quoteType: "INDEX" }, { quoteType: "EQUITY" }];
    expect(pickSearchMatch("GSPC", q)).toBeNull();
  });
});

type Call = { text: string; params: unknown[] };

function fakeSql(rows: Record<string, unknown>[] = []): { sql: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const sql: SqlClient = async (strings, ...params) => {
    calls.push({ text: strings.join("?"), params });
    if (/SELECT ticker, symbol/.test(strings.join(""))) return rows;
    return [];
  };
  return { sql, calls };
}

describe("resolveTickers", () => {
  it("answers static and skipped tickers without touching the DB or Yahoo", async () => {
    const { sql, calls } = fakeSql();
    const out = await resolveTickers(sql, null, ["exo", "GOLD"]);
    expect(out.get("EXO")).toEqual({ ticker: "EXO", symbol: "EXO.AS", status: "static", name: null });
    expect(out.get("GOLD")?.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("serves an unknown ticker from the cache without searching", async () => {
    const { sql, calls } = fakeSql([
      { ticker: "ZZZZ", symbol: "ZZZZ.L", status: "search", name: "Zed" },
      { ticker: "NOPE", symbol: null, status: "unresolved", name: null },
    ]);
    let searched = 0;
    const yahoo = { search: async () => ((searched++), { quotes: [] }) };
    const out = await resolveTickers(sql, yahoo, ["ZZZZ", "NOPE"]);
    expect(out.get("ZZZZ")).toMatchObject({ symbol: "ZZZZ.L", status: "cached" });
    expect(out.get("NOPE")).toMatchObject({ symbol: null, status: "unresolved" });
    expect(searched).toBe(0);
    // ensure table + one cache read, no upsert
    expect(calls.filter((c) => /INSERT INTO ticker_symbols/.test(c.text))).toHaveLength(0);
  });

  it("searches only the misses and writes hits and misses back in one statement", async () => {
    const { sql, calls } = fakeSql([]);
    const queries: string[] = [];
    const yahoo = {
      search: async (q: string) => {
        queries.push(q);
        return q === "ABCD"
          ? { quotes: [{ symbol: "ABCD.MC", quoteType: "EQUITY", shortname: "Abcd SA" }] }
          : { quotes: [] };
      },
    };
    const out = await resolveTickers(sql, yahoo, ["ABCD", "QQQQ", "EXO"]);
    expect(queries.sort()).toEqual(["ABCD", "QQQQ"]);
    expect(out.get("ABCD")).toEqual({ ticker: "ABCD", symbol: "ABCD.MC", status: "search", name: "Abcd SA" });
    expect(out.get("QQQQ")?.status).toBe("unresolved");
    const upserts = calls.filter((c) => /INSERT INTO ticker_symbols/.test(c.text));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].params[0]).toEqual(["ABCD", "QQQQ"]);
    expect(upserts[0].params[2]).toEqual(["search", "unresolved"]);
  });

  it("without a search client, tries an unknown ticker verbatim and writes nothing", async () => {
    const { sql, calls } = fakeSql([]);
    const out = await resolveTickers(sql, null, ["ZZZZ"]);
    expect(out.get("ZZZZ")).toMatchObject({ symbol: "ZZZZ", status: "static" });
    expect(calls.filter((c) => /INSERT/.test(c.text))).toHaveLength(0);
  });

  it("survives a failing search", async () => {
    const { sql } = fakeSql([]);
    const yahoo = {
      search: async () => {
        throw new Error("boom");
      },
    };
    const out = await resolveTickers(sql, yahoo, ["ZZZZ"]);
    expect(out.get("ZZZZ")?.status).toBe("unresolved");
  });
});
