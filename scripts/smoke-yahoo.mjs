// Quick smoke test for yahoo-finance2 against a representative slice of the
// user's tickers. Run with: node scripts/smoke-yahoo.mjs
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();
yahooFinance.suppressNotices?.(["yahooSurvey"]);
yahooFinance.setGlobalConfig?.({ validation: { logErrors: false } });

const SAMPLES = [
  "TSLA",
  "AAPL",
  "BBVA.MC",
  "SAB.MC",
  "IAG.L",
  "ASML.AS",
  "GC=F", // gold futures
  "SI=F", // silver futures
  "BTC-USD",
  "ETH-USD",
  "EURUSD=X",
  "GBPUSD=X",
  "CHFUSD=X",
];

const t0 = Date.now();
try {
  const quotes = await yahooFinance.quote(SAMPLES);
  const list = Array.isArray(quotes) ? quotes : [quotes];
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`Fetched ${list.length}/${SAMPLES.length} symbols in ${elapsed}s\n`);
  for (const s of SAMPLES) {
    const q = list.find((x) => x.symbol === s);
    if (!q) console.log(`  ${s.padEnd(12)} ❌ MISSING`);
    else
      console.log(
        `  ${s.padEnd(12)} ${String(q.regularMarketPrice).padEnd(10)} ${q.currency ?? ""}`,
      );
  }
} catch (e) {
  console.error("FAILED:", e);
  process.exit(1);
}
