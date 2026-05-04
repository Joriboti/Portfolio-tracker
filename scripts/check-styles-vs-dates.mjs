import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const buf = readFileSync("C:/Users/barov/Documents/Moviments Jordi.xlsx");

const tests = [
  { type: "buffer", cellDates: false },
  { type: "buffer", cellDates: false, cellStyles: true },
];

for (const opts of tests) {
  console.log(`\n=== read opts: ${JSON.stringify(opts)} ===`);
  const wb = XLSX.read(buf, opts);
  const sheet = wb.Sheets["Portfolio 1 (TR)"];

  for (const sjOpts of [
    { header: 1, raw: true, defval: null },
    { header: 1, raw: false, defval: null },
    { header: 1, raw: true },
  ]) {
    const matrix = XLSX.utils.sheet_to_json(sheet, sjOpts);
    const v = matrix[5]?.[4];
    console.log(
      `  sheet_to_json(${JSON.stringify(sjOpts)}) -> col4=${typeof v} ${JSON.stringify(v)}`,
    );
  }
}
