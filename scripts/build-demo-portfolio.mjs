import yfModNs from "yahoo-finance2";
import XLSX from "xlsx";

const YahooFinance = yfModNs.default ?? yfModNs;
const yf = typeof YahooFinance === "function"
  ? new YahooFinance({ suppressNotices: ["yahooSurvey"] })
  : yfModNs;

// ---------- Tickers chosen so the parser maps them cleanly ----------
// The parser's POSITION_ALIASES (excel-parser.ts) and TICKER_MAP /
// TICKER_STORAGE_ALIASES (api/prices-update.ts & dividends-update.ts) all
// expect either the short Yahoo symbol or one of the known full names.
//
// Format: { name (what goes in column A), yahoo (only for fetching ref
// prices — the app re-derives this), currency }
const STOCKS = [
  // ---- US Tech ----
  { name: "AAPL",   yahoo: "AAPL",   currency: "USD" },
  { name: "MSFT",   yahoo: "MSFT",   currency: "USD" },
  { name: "GOOGL",  yahoo: "GOOGL",  currency: "USD" },
  { name: "AMZN",   yahoo: "AMZN",   currency: "USD" },
  { name: "NVDA",   yahoo: "NVDA",   currency: "USD" },
  { name: "TSLA",   yahoo: "TSLA",   currency: "USD" },
  { name: "META",   yahoo: "META",   currency: "USD" },
  { name: "NFLX",   yahoo: "NFLX",   currency: "USD" },
  { name: "AMD",    yahoo: "AMD",    currency: "USD" },
  { name: "INTC",   yahoo: "INTC",   currency: "USD" },
  { name: "ASML",   yahoo: "ASML",   currency: "USD" },

  // ---- US Other ----
  { name: "JPM",    yahoo: "JPM",    currency: "USD" },
  { name: "V",      yahoo: "V",      currency: "USD" },
  { name: "MA",     yahoo: "MA",     currency: "USD" },
  { name: "KO",     yahoo: "KO",     currency: "USD" },
  { name: "PEPSICO", yahoo: "PEP",   currency: "USD" }, // tests full-name aliasing -> PEP
  { name: "WMT",    yahoo: "WMT",   currency: "USD" },
  { name: "DIS",    yahoo: "DIS",   currency: "USD" },
  { name: "NKE",    yahoo: "NKE",   currency: "USD" },
  { name: "MCD",    yahoo: "MCD",   currency: "USD" },
  { name: "SBUX",   yahoo: "SBUX",  currency: "USD" },
  { name: "JNJ",    yahoo: "JNJ",   currency: "USD" },
  { name: "PFE",    yahoo: "PFE",   currency: "USD" },
  { name: "NOVO NORDISK", yahoo: "NVO",   currency: "USD" }, // full name -> NVO
  { name: "LLY",    yahoo: "LLY",   currency: "USD" },
  { name: "ALIBABA", yahoo: "BABA", currency: "USD" }, // full name -> BABA
  { name: "PINDUODUO", yahoo: "PDD", currency: "USD" }, // full name -> PDD

  // ---- BME (Spain) ----
  // For BME we pass the short ticker; prices-update.ts maps SAN -> SAN.MC etc.
  { name: "SAN",    yahoo: "SAN.MC",  currency: "EUR" },
  { name: "BBVA",   yahoo: "BBVA.MC", currency: "EUR" },
  { name: "ITX",    yahoo: "ITX.MC",  currency: "EUR" },
  { name: "IBE",    yahoo: "IBE.MC",  currency: "EUR" },
  { name: "TEF",    yahoo: "TEF.MC",  currency: "EUR" },
  { name: "REP",    yahoo: "REP.MC",  currency: "EUR" },
  { name: "IAG",    yahoo: "IAG.MC",  currency: "EUR" },
  { name: "MAP",    yahoo: "MAP.MC",  currency: "EUR" },
  { name: "CABK",   yahoo: "CABK.MC", currency: "EUR" },
  { name: "BKT",    yahoo: "BKT.MC",  currency: "EUR" },
  { name: "ELE",    yahoo: "ELE.MC",  currency: "EUR" },
  { name: "CLNX",   yahoo: "CLNX.MC", currency: "EUR" },
  { name: "FER",    yahoo: "FER.MC",  currency: "EUR" },

  // ---- European ----
  { name: "LVMH",   yahoo: "MC.PA",   currency: "EUR" }, // full name -> MC
  { name: "AIR.PA", yahoo: "AIR.PA",  currency: "EUR" }, // passes through
  { name: "SAP",    yahoo: "SAP",     currency: "USD" },

  // ---- Crypto ----
  { name: "BTC",    yahoo: "BTC-USD", currency: "USD" },
  { name: "ETH",    yahoo: "ETH-USD", currency: "USD" },
];

// ---------- 1. Fetch live prices for every Yahoo symbol -------------
const liveBySymbol = new Map();
for (const s of STOCKS) {
  try {
    const q = await yf.quote(s.yahoo);
    if (q?.regularMarketPrice) {
      liveBySymbol.set(s.yahoo, q.regularMarketPrice);
    }
  } catch (_) {
    // ignore — we'll fall back to a sensible buy price
  }
}
console.log(`Fetched ${liveBySymbol.size}/${STOCKS.length} live prices`);

// ---------- 2. Helpers -----------------------------------------------
// Excel serial dates (1900 epoch, 25569 offset to Unix)
function isoToSerial(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return Math.floor(d.getTime() / 86400000) + 25569;
}
function randBetween(a, b) {
  return a + Math.random() * (b - a);
}
function round(n, dp = 2) {
  const m = Math.pow(10, dp);
  return Math.round(n * m) / m;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Seeded RNG so the generated portfolio is reproducible
let seed = 42;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// ---------- 3. Build 80 movements ------------------------------------
// 56 open buys + 24 closed (buy + sell pairs). We'll spread buy dates
// 2023-01 .. 2025-09 and sell dates 2024-06 .. 2026-04. The reference
// "current" price drives both: buy price = current * factor (where the
// factor reflects a plausible historical entry), sell price for closed
// positions = current * sellFactor (so realized PL is realistic).

const TODAY_ISO = "2026-05-13";

function plausibleHistoricFactor(yahoo, monthsAgo) {
  const isCrypto = yahoo.endsWith("-USD");
  const isUSTech = ["AAPL","MSFT","GOOGL","AMZN","NVDA","TSLA","META","NFLX","AMD","INTC","ASML"].includes(yahoo);
  const isBME = yahoo.endsWith(".MC");
  const isEU = yahoo.endsWith(".PA") || yahoo.endsWith(".DE") || yahoo.endsWith(".SW");

  // monthsAgo: 0 → factor ~1.0 (current price), 36 → factor well below 1.0
  // (older buys were cheaper because assets appreciated over time).
  let drift;
  if (isCrypto)      drift = 1.0 - monthsAgo * 0.012;
  else if (isUSTech) drift = 1.0 - monthsAgo * 0.008;
  else if (isEU)     drift = 1.0 - monthsAgo * 0.004;
  else if (isBME)    drift = 1.0 - monthsAgo * 0.003;
  else               drift = 1.0 - monthsAgo * 0.006;

  drift *= randBetween(0.92, 1.06);
  return Math.max(0.25, Math.min(drift, 1.05));
}

function pickShares(yahoo, refPrice) {
  // Aim for trade sizes between ~80€ and ~3000€ per buy.
  const targetEUR = randBetween(150, 2200);
  const raw = targetEUR / refPrice;
  if (yahoo.endsWith("-USD")) return round(raw, 4); // crypto: fractional
  if (refPrice > 500) return round(raw, 3);          // expensive: fractional ok
  if (refPrice > 100) return round(raw, 2);
  return Math.max(1, Math.round(raw));
}

function buyDateInMonthsAgo(monthsAgo) {
  const now = new Date(TODAY_ISO + "T00:00:00Z");
  now.setUTCMonth(now.getUTCMonth() - monthsAgo);
  now.setUTCDate(1 + Math.floor(Math.random() * 27));
  return now.toISOString().slice(0, 10);
}

const rows = []; // each row: { ticker, shares, buyPrice, buyValue, buyDate, sellShares?, sellPrice?, sellValue?, sellDate?, result? }

// 56 OPEN positions
for (let i = 0; i < 56; i++) {
  const stock = pick(STOCKS);
  const refPrice = liveBySymbol.get(stock.yahoo);
  if (!refPrice) continue;

  const monthsAgo = Math.floor(randBetween(2, 36));
  const factor = plausibleHistoricFactor(stock.yahoo, monthsAgo);
  const buyPrice = round(refPrice * factor, 4);
  const shares = pickShares(stock.yahoo, refPrice);
  const buyValue = round(shares * buyPrice, 2);
  const buyDate = buyDateInMonthsAgo(monthsAgo);

  rows.push({
    ticker: stock.name,
    shares,
    buyPrice,
    buyValue,
    buyDate,
  });
}

// 24 CLOSED positions
for (let i = 0; i < 24; i++) {
  const stock = pick(STOCKS);
  const refPrice = liveBySymbol.get(stock.yahoo);
  if (!refPrice) continue;

  const monthsAgoBuy = Math.floor(randBetween(12, 36));
  const monthsAgoSell = Math.floor(randBetween(1, monthsAgoBuy - 3));
  const buyFactor = plausibleHistoricFactor(stock.yahoo, monthsAgoBuy);
  const sellFactor = plausibleHistoricFactor(stock.yahoo, monthsAgoSell);

  const buyPrice = round(refPrice * buyFactor, 4);
  const sellPrice = round(refPrice * sellFactor, 4);
  const shares = pickShares(stock.yahoo, refPrice);
  const buyValue = round(shares * buyPrice, 2);
  const sellValue = round(shares * sellPrice, 2);
  const result = round(sellValue - buyValue, 2);
  const buyDate = buyDateInMonthsAgo(monthsAgoBuy);
  const sellDate = buyDateInMonthsAgo(monthsAgoSell);

  rows.push({
    ticker: stock.name,
    shares,
    buyPrice,
    buyValue,
    buyDate,
    sellShares: shares,
    sellPrice,
    sellValue,
    sellDate,
    result,
  });
}

console.log(`Generated ${rows.length} transactions (target: 80)`);

// ---------- 4. Build workbook ----------------------------------------
const wb = XLSX.utils.book_new();

// Sheet 1: "Portfolio 1 (TR)" — uses the working "moviments" layout
const portfolioHeader = [
  ["DEMO PORTFOLIO — generated for portfolio-tracker"],
  [],
  ["Nom", "Nº titols", "Preu compra", "Valor compra", "Data compra", "Nº titols", "Preu venda", "Valor venda", "Data venda", "Resultat"],
];
const portfolioRows = rows.map((r) => [
  r.ticker,
  r.shares,
  r.buyPrice,
  r.buyValue,
  r.buyDate ? isoToSerial(r.buyDate) : null,
  r.sellShares ?? null,
  r.sellPrice ?? null,
  r.sellValue ?? null,
  r.sellDate ? isoToSerial(r.sellDate) : null,
  r.result ?? null,
]);
const portfolioSheet = XLSX.utils.aoa_to_sheet([...portfolioHeader, ...portfolioRows]);

// Format date columns as dd/mm/yyyy
const dateColIdx = [4, 8]; // 0-based: "Data compra" and "Data venda"
for (let r = portfolioHeader.length; r < portfolioHeader.length + portfolioRows.length; r++) {
  for (const c of dateColIdx) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (portfolioSheet[addr] && typeof portfolioSheet[addr].v === "number") {
      portfolioSheet[addr].t = "n";
      portfolioSheet[addr].z = "dd/mm/yyyy";
    }
  }
}
XLSX.utils.book_append_sheet(wb, portfolioSheet, "Portfolio 1 (TR)");

// Sheet 2: "Interessos i dividends"
// Layout: col 0 date | col 1 interest amount | col 4 div ticker | col 5 div amount | col 6 div date
const divsAndInterests = [
  ["INTERESSOS COMPTE", null, null, null, "DIVIDENDS"],
  [],
];

// 12 monthly interest payments through 2024-2025
let interestDate = new Date("2024-01-15T00:00:00Z");
const interestEntries = [];
for (let m = 0; m < 14; m++) {
  const iso = interestDate.toISOString().slice(0, 10);
  interestEntries.push([isoToSerial(iso), round(randBetween(0.4, 3.2), 2)]);
  interestDate.setUTCMonth(interestDate.getUTCMonth() + 1);
}

// 16 dividend payments from tickers known to pay dividends
const dividendPayers = ["AAPL", "MSFT", "KO", "PEPSICO", "JNJ", "PFE", "SAN", "BBVA", "IBE", "TEF", "ITX", "MAP", "ELE", "MCD", "JPM", "V"];
const dividendEntries = [];
let divDate = new Date("2024-02-12T00:00:00Z");
for (let i = 0; i < 16; i++) {
  const t = dividendPayers[i % dividendPayers.length];
  const iso = divDate.toISOString().slice(0, 10);
  dividendEntries.push([t, round(randBetween(0.3, 8.5), 2), isoToSerial(iso)]);
  divDate.setUTCDate(divDate.getUTCDate() + Math.floor(randBetween(15, 50)));
}

// Merge into rows
const divSheetData = [["INTERESSOS COMPTE", null, null, null, "DIVIDENDS"], []];
const maxLen = Math.max(interestEntries.length, dividendEntries.length);
for (let i = 0; i < maxLen; i++) {
  const intRow = interestEntries[i] ?? [null, null];
  const divRow = dividendEntries[i] ?? [null, null, null];
  divSheetData.push([intRow[0], intRow[1], null, null, divRow[0], divRow[1], divRow[2]]);
}
const divSheet = XLSX.utils.aoa_to_sheet(divSheetData);
// Date format
for (let r = 2; r < divSheetData.length; r++) {
  for (const c of [0, 6]) {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (divSheet[addr] && typeof divSheet[addr].v === "number") {
      divSheet[addr].t = "n";
      divSheet[addr].z = "dd/mm/yyyy";
    }
  }
}
XLSX.utils.book_append_sheet(wb, divSheet, "Interessos i dividends");

// Sheet 3: "Patrimoni" (wealth)
// Layout (per parseWealthSheet): col A is category marker, col B is label,
// col C is numeric value. The category persists across rows until another
// marker is seen. Markers containing "accion"/"stock" -> stocks; markers
// containing "efectiu"/"cash"/"compte" -> cash.
const wealthSheet = XLSX.utils.aoa_to_sheet([
  ["Patrimoni"],
  [],
  ["Comptes (cash)", null, null],
  [null, "Compte corrent EUR", 4250.00],
  [null, "Compte estalvi", 12800.00],
  [null, "Renda 4 cash", 850.00],
  ["Accions / stocks", null, null],
  [null, "Broker DEGIRO (mercat)", 28500.00],
  [null, "Broker Trade Republic", 9300.00],
]);
XLSX.utils.book_append_sheet(wb, wealthSheet, "Patrimoni");

// ---------- 5. Write file --------------------------------------------
import path from "node:path";
import fs from "node:fs";

const outDir = "C:\\Users\\barov\\Desktop\\Claude\\projectes-personals";
if (!fs.existsSync(outDir)) {
  console.error("Output directory does not exist:", outDir);
  process.exit(1);
}
const outPath = path.join(outDir, "DEMO_PORTFOLIO.xlsx");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
fs.writeFileSync(outPath, buf);
console.log("Wrote", outPath);
console.log("Transactions:", rows.length);
console.log("Interests:", interestEntries.length);
console.log("Dividends:", dividendEntries.length);
