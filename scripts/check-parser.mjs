// Run the full parser and check HIMS transactions for buyDate.
// We can't easily import the .ts directly from node so we'll inline a
// minimal copy of the relevant logic.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const buf = readFileSync("C:/Users/barov/Documents/Moviments Jordi.xlsx");

function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const utcDays = serial - 25569;
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function asNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function asDateISO(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === "number") return excelSerialToISO(v);
  return null;
}

const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellStyles: true });
const sheet = wb.Sheets["Portfolio 1 (TR)"];

// Mimic rowsToMatrix
const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
console.log(`Matrix rows: ${matrix.length}`);

// Debug: what does row 5 (HIMS first buy) look like?
const r5 = matrix[5] ?? [];
console.log(`Row 6 (HIMS first buy) cells:`);
for (let c = 0; c < 10; c++) {
  const v = r5[c];
  console.log(`  col ${c}: type=${typeof v} value=${JSON.stringify(v)}`);
}
console.log("Direct cell E6:", JSON.stringify(sheet["E6"]));
console.log("");

// Look at HIMS rows
let countBuysWithDate = 0;
let countBuysNoDate = 0;
let countSellsWithDate = 0;

for (let i = 0; i < matrix.length; i++) {
  const row = matrix[i] ?? [];
  const ticker = String(row[0] ?? "").trim();
  if (ticker.toUpperCase() !== "HIMS") continue;

  const buyShares = asNumber(row[1]);
  const buyPrice = asNumber(row[2]);
  const buyDateISO = asDateISO(row[4]);
  const sellShares = asNumber(row[5]);
  const sellPrice = asNumber(row[6]);
  const sellDateISO = asDateISO(row[8]);

  const isBuy = buyShares != null && buyPrice != null;
  const isSell = sellShares != null && sellPrice != null;

  if (isBuy) {
    if (buyDateISO) countBuysWithDate++;
    else countBuysNoDate++;
    console.log(`row ${i+1} BUY shares=${buyShares} price=${buyPrice} isoDate=${buyDateISO}`);
  } else if (isSell) {
    if (sellDateISO) countSellsWithDate++;
    console.log(`row ${i+1} SELL shares=${sellShares} price=${sellPrice} isoDate=${sellDateISO}`);
  }
}

console.log(`\nBuys with date: ${countBuysWithDate}`);
console.log(`Buys NO date: ${countBuysNoDate}`);
console.log(`Sells with date: ${countSellsWithDate}`);
