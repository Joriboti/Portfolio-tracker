// Search Yahoo for palladium ETFs that might match the user's
// "preu mig" of ~34.61 EUR per share on 2025-10-21.
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const queries = ["physical palladium ETF", "palladium ETC", "palladium WisdomTree"];

const seen = new Set();
const candidates = [];
for (const q of queries) {
  try {
    const res = await yahooFinance.search(q, { quotesCount: 20, newsCount: 0 });
    for (const item of res.quotes ?? []) {
      const sym = item.symbol;
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      candidates.push({
        symbol: sym,
        shortName: item.shortname ?? item.longname ?? "",
        exchange: item.exchange ?? "",
        type: item.quoteType ?? "",
      });
    }
  } catch (e) {
    console.error("search failed for", q, e.message);
  }
}

console.log(`Found ${candidates.length} candidate symbols. Fetching quotes...\n`);

// Filter: prefer ETFs/ETCs only, drop futures/indices
const filtered = candidates.filter(
  (c) => c.type === "ETF" || c.type === "ETC" || c.shortName.toLowerCase().includes("palladium"),
);

const symbols = filtered.map((c) => c.symbol);
let quotes = [];
try {
  const r = await yahooFinance.quote(symbols);
  quotes = Array.isArray(r) ? r : [r];
} catch (e) {
  console.error("batch quote failed:", e.message);
  for (const s of symbols) {
    try {
      const q = await yahooFinance.quote(s);
      quotes.push(q);
    } catch {
      /* ignore */
    }
  }
}

console.log("Symbol".padEnd(14), "Price".padEnd(10), "Ccy".padEnd(5), "Exchange".padEnd(8), "Name");
for (const c of filtered) {
  const q = quotes.find((x) => x?.symbol === c.symbol);
  if (!q) continue;
  console.log(
    c.symbol.padEnd(14),
    String(q.regularMarketPrice ?? "?").padEnd(10),
    String(q.currency ?? "?").padEnd(5),
    String(q.fullExchangeName ?? c.exchange ?? "?").slice(0, 7).padEnd(8),
    c.shortName,
  );
}
