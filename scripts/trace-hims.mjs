// Walk the entire HIMS event log (after dedup + exclusion) using the same
// FIFO logic as aggregatePositions, so we can see step-by-step what the
// dashboard is computing.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const PATH = "C:/Users/barov/Documents/Moviments Jordi.xlsx";
const TICKER = process.argv[2]?.toUpperCase() ?? "HIMS";

const buf = readFileSync(PATH);
const wb = XLSX.read(buf, {
  type: "buffer",
  cellDates: false,
  cellStyles: true,
});

function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function asNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function isExcluded(sheet, r) {
  const cell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
  return cell?.s?.patternType === "solid" && (cell?.s?.fgColor?.rgb || cell?.s?.bgColor?.rgb);
}

function findHeaderRow(sheet) {
  const ref = sheet["!ref"];
  if (!ref) return -1;
  const range = XLSX.utils.decode_range(ref);
  for (let r = 0; r <= Math.min(range.e.r, 10); r++) {
    const a = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const cells = [];
    for (let c = 0; c < 10; c++) {
      const v = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
      cells.push(String(v ?? "").toLowerCase());
    }
    if (cells.some((c) => c === "nom") && cells.some((c) => c.includes("titol"))) {
      return r;
    }
  }
  return -1;
}

const events = [];

for (const name of wb.SheetNames) {
  if (!name.trim().toLowerCase().startsWith("portfolio")) continue;
  const sheet = wb.Sheets[name];
  const ref = sheet["!ref"];
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);
  const headerRow = findHeaderRow(sheet);
  if (headerRow === -1) continue;

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const tickerCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const ticker = tickerCell?.v ? String(tickerCell.v).trim() : null;
    if (!ticker) continue;
    if (ticker.toUpperCase() !== TICKER) continue;

    const excluded = isExcluded(sheet, r);
    const cells = [];
    for (let c = 0; c < 10; c++) {
      cells.push(sheet[XLSX.utils.encode_cell({ r, c })]?.v ?? null);
    }
    const buyShares = asNumber(cells[1]);
    const buyPrice = asNumber(cells[2]);
    const buyValue = asNumber(cells[3]);
    const buyDate = asNumber(cells[4]);
    const sellShares = asNumber(cells[5]);
    const sellPrice = asNumber(cells[6]);
    const sellValue = asNumber(cells[7]);
    const sellDate = asNumber(cells[8]);
    const result = asNumber(cells[9]);

    const isBuy = buyShares != null && buyPrice != null;
    const isSell = sellShares != null && sellPrice != null;

    if (!isBuy && !isSell) continue;

    if (excluded) {
      console.log(
        `EXCLUDED row ${r + 1} (${name.trim()}): ${ticker} ` +
          (isBuy ? `buy ${buyShares}@${buyPrice}` : `sell ${sellShares}@${sellPrice}`),
      );
      continue;
    }

    if (isBuy) {
      events.push({
        kind: "buy",
        date: buyDate ? excelSerialToISO(buyDate) : "9999-12-31",
        shares: buyShares,
        cost: buyValue ?? buyShares * buyPrice,
        row: r + 1,
        sheet: name.trim(),
      });
    }
    if (isSell) {
      events.push({
        kind: "sell",
        date: sellDate ? excelSerialToISO(sellDate) : "9999-12-31",
        shares: sellShares,
        result: result ?? 0,
        row: r + 1,
        sheet: name.trim(),
      });
    }
  }
}

events.sort((a, b) => {
  const c = a.date.localeCompare(b.date);
  if (c !== 0) return c;
  return a.kind === "buy" ? -1 : 1;
});

console.log(`\n--- ${TICKER}: FIFO walk over ${events.length} events ---\n`);

const lots = [];
let realized = 0;
for (const ev of events) {
  if (ev.kind === "buy") {
    lots.push({ shares: ev.shares, cost: ev.cost });
    const totalShares = lots.reduce((s, l) => s + l.shares, 0);
    const totalCost = lots.reduce((s, l) => s + l.cost, 0);
    console.log(
      `BUY  row ${ev.row} ${ev.date} ${ev.shares.toFixed(4)}@${(ev.cost / ev.shares).toFixed(2)} -> ` +
        `lots=${lots.length} totalShares=${totalShares.toFixed(4)} totalCost=${totalCost.toFixed(2)} avg=${(totalCost / totalShares).toFixed(2)}`,
    );
  } else {
    let remaining = ev.shares;
    while (remaining > 1e-9 && lots.length > 0) {
      const lot = lots[0];
      if (lot.shares <= remaining + 1e-9) {
        remaining -= lot.shares;
        lots.shift();
      } else {
        const pct = remaining / lot.shares;
        lot.cost -= lot.cost * pct;
        lot.shares -= remaining;
        remaining = 0;
      }
    }
    realized += ev.result;
    const totalShares = lots.reduce((s, l) => s + l.shares, 0);
    const totalCost = lots.reduce((s, l) => s + l.cost, 0);
    console.log(
      `SELL row ${ev.row} ${ev.date} ${ev.shares.toFixed(4)} (result ${ev.result?.toFixed(2)}) -> ` +
        `lots=${lots.length} totalShares=${totalShares.toFixed(4)} totalCost=${totalCost.toFixed(2)} ` +
        (totalShares > 0 ? `avg=${(totalCost / totalShares).toFixed(2)}` : "closed"),
    );
  }
}

const totalShares = lots.reduce((s, l) => s + l.shares, 0);
const totalCost = lots.reduce((s, l) => s + l.cost, 0);
console.log(`\n=== FINAL ${TICKER} ===`);
console.log(`Open lots: ${lots.length}, total shares: ${totalShares.toFixed(4)}`);
console.log(`Total cost: ${totalCost.toFixed(2)} EUR`);
console.log(`Avg cost: ${(totalCost / totalShares).toFixed(4)} EUR/share`);
console.log(`Realized P&L: ${realized.toFixed(2)} EUR`);
