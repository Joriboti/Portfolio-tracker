// Check if cellStyles:true breaks date parsing.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const buf = readFileSync("C:/Users/barov/Documents/Moviments Jordi.xlsx");

for (const opts of [
  { type: "buffer", cellDates: false },
  { type: "buffer", cellDates: false, cellStyles: true },
  { type: "buffer", cellStyles: true },
]) {
  console.log(`\n=== Options: ${JSON.stringify(opts)} ===`);
  const wb = XLSX.read(buf, opts);
  const sheet = wb.Sheets["Portfolio 1 (TR)"];
  // Look at row 6 (HIMS first buy) — should have buy date 2024-09-04 = serial 45539
  const date = sheet["E6"];
  console.log(`E6 raw: type=${typeof date?.v} value=${JSON.stringify(date?.v)} formatted='${date?.w}'`);
  const date2 = sheet["E7"];
  console.log(`E7 raw: type=${typeof date2?.v} value=${JSON.stringify(date2?.v)} formatted='${date2?.w}'`);
}
