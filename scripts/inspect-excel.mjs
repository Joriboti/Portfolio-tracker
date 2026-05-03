// Walk the user's source Excel and print raw rows for the tickers we
// have discrepancies on. Helps spot duplicate buys, format quirks, and
// rows that have both buy + sell info.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const PATH = "C:/Users/barov/Documents/Moviments Jordi.xlsx";
const FOCUS = new Set(["HIMS", "HOOD", "MU", "IAG", "SMCI"]);

const buf = readFileSync(PATH);
const wb = XLSX.read(buf, { type: "buffer", cellDates: false });

function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const utcDays = serial - 25569;
  const utcMs = utcDays * 86400 * 1000;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

console.log("Sheets in workbook:");
for (const name of wb.SheetNames) console.log("  -", name);
console.log("");

for (const sheetName of wb.SheetNames) {
  if (!sheetName.trim().toLowerCase().startsWith("portfolio")) continue;
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  console.log(`=== ${sheetName} ===`);

  // Find header row
  let headerRow = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i] ?? [];
    const cells = row.map((c) => String(c ?? "").toLowerCase());
    if (cells.some((c) => c === "nom") && cells.some((c) => c.includes("titol"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    console.log("  (no header found)\n");
    continue;
  }
  console.log(`  Header row index: ${headerRow}`);
  console.log(`  Headers:`, matrix[headerRow]?.map((c) => String(c ?? "")));

  // Print rows for focused tickers
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const ticker = String(row[0] ?? "").trim();
    if (!ticker) continue;
    if (!FOCUS.has(ticker.toUpperCase())) continue;

    const buyShares = row[1];
    const buyPrice = row[2];
    const buyValue = row[3];
    const buyDate = typeof row[4] === "number" ? excelSerialToISO(row[4]) : row[4];
    const sellShares = row[5];
    const sellPrice = row[6];
    const sellValue = row[7];
    const sellDate = typeof row[8] === "number" ? excelSerialToISO(row[8]) : row[8];
    const result = row[9];

    console.log(
      `  Row ${i}: ${ticker.padEnd(6)} ` +
        `buy=${String(buyShares).padEnd(10)}@${String(buyPrice).padEnd(8)} val=${String(buyValue).padEnd(8)} d=${buyDate ?? ""} | ` +
        `sell=${String(sellShares ?? "-").padEnd(8)}@${String(sellPrice ?? "-").padEnd(8)} val=${String(sellValue ?? "-").padEnd(8)} d=${sellDate ?? ""} | result=${result ?? "-"}`,
    );
  }
  console.log("");
}
