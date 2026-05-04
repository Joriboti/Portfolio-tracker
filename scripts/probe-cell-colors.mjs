// Probe whether xlsx (community edition) gives us cell-fill colors when
// `cellStyles: true` is set. We need this to support "mark a row blue =
// exclude it from the portfolio."
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const PATH = "C:/Users/barov/Documents/Moviments Jordi.xlsx";
const buf = readFileSync(PATH);
const wb = XLSX.read(buf, {
  type: "buffer",
  cellDates: false,
  cellStyles: true,
});

// Walk every row of every Portfolio sheet and list the ones whose column A
// has a coloured fill — these are the ones our parser will exclude.
console.log("Rows that would be excluded (highlighted column-A fill):\n");
let total = 0;
for (const name of wb.SheetNames) {
  if (!name.trim().toLowerCase().startsWith("portfolio")) continue;
  const sheet = wb.Sheets[name];
  const ref = sheet["!ref"];
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);
  console.log(`--- ${name.trim()} (${range.e.r + 1} rows) ---`);
  for (let r = 0; r <= range.e.r; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const style = cell?.s;
    if (!style || style.patternType !== "solid") continue;
    const rgb = style.fgColor?.rgb ?? style.bgColor?.rgb;
    if (!rgb) continue;
    const ticker = cell.v ?? "(empty)";
    console.log(`  row ${r + 1}: ${String(ticker).padEnd(10)} fill=${rgb}`);
    total++;
  }
}
console.log(`\nTotal excluded: ${total}`);
