// Dev preview for the verified-portfolio artefacts. Renders the A4 PDF and the
// shareable card from a sample snapshot so the layout can be eyeballed without
// clicking through the app.
//
//   npx vite-node scripts/preview-verify-report.ts -- <outDir>
//
// Writes report.pdf, card.svg and (via puppeteer) card.png + report.png.

import { writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { buildSnapshotBody, canonicalizeBody, recomputeDigest } from "../src/lib/verify";
import {
  buildReportPdf,
  buildVerifiedCardSvg,
  type ReportFormat,
  type ReportLabels,
} from "../src/lib/verify-report";
import type { XrayReport } from "../src/lib/xray";

const outDir = process.argv[2] ?? ".";

const tickers = [
  ["NVDA", 0.211, 9840],
  ["ASML", 0.164, 7650],
  ["MSFT", 0.138, 6430],
  ["AAPL", 0.121, 5640],
  ["ITX.MC", 0.094, 4380],
  ["BTC-EUR", 0.081, 3770],
  ["LVMH.PA", 0.062, 2890],
  ["SAN.MC", 0.048, 2240],
  ["AIR.PA", 0.031, 1450],
  ["ENG.MC", 0.028, 1300],
  ["REP.MC", 0.022, 1020],
] as const;

const report: XrayReport = {
  holdingsCount: tickers.length,
  totalValueEur: 46610,
  totalCostEur: 33180,
  unrealizedEur: 13430,
  sinceInception: {
    grossInvested: 33180,
    sellProceeds: 4100,
    netInvested: 29080,
    openCost: 33180,
    currentValue: 46610,
    unrealized: 13430,
    realized: 1820,
    dividends: 940,
    interests: 0,
    totalGain: 16190,
    returnPct: 0.5567,
    irr: 0.1842,
  },
  weights: tickers.map(([ticker, weight, valueEur]) => ({ ticker, weight, valueEur })),
  concentration: { hhi: 0.121, effectiveN: 8.26, top1: 0.211, top3: 0.513 },
  regions: [
    { key: "US", weight: 0.47 },
    { key: "Europe", weight: 0.405 },
    { key: "Crypto", weight: 0.081 },
    { key: "Asia", weight: 0.044 },
  ],
  sectors: [
    { key: "Technology", weight: 0.514 },
    { key: "Consumer Cyclical", weight: 0.156 },
    { key: "Financial Services", weight: 0.048 },
    { key: "Energy", weight: 0.05 },
    { key: "Industrials", weight: 0.031 },
  ],
  sectorCoverage: 0.92,
  weightedPe: 31.2,
  peCoverage: 0.88,
  score: 68,
  grade: "B",
  scoreParts: { concentration: 24, count: 18, region: 14, sector: 12 },
  flags: [],
};

const nf = (dp: number) =>
  new Intl.NumberFormat("ca-ES", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const fmt: ReportFormat = {
  pct: (v, signed) =>
    v == null ? "—" : `${signed && v >= 0 ? "+" : ""}${nf(1).format(v * 100)} %`,
  money: (v) => (v == null ? "—" : `${nf(0).format(v)} €`),
  number: (v, dp = 0) => nf(dp).format(v),
  date: (iso) => new Date(iso).toLocaleDateString("ca-ES", { dateStyle: "long" }),
};

const labels: ReportLabels = {
  brand: "TrimmTrack",
  url: "trimmtrack.com",
  title: "Cartera verificada",
  tierLabel: "Autodeclarat · signat per TrimmTrack",
  attestation:
    "Aquest document acredita que TrimmTrack va emetre aquestes xifres exactes en la data indicada i que no s'han modificat des de llavors. Les dades provenen de l'Excel que el titular va importar: no s'ha verificat amb el bròker.",
  issuedOn: "Emès el",
  distribution: "Distribució de la cartera",
  regions: "Exposició per regió",
  sectors: "Exposició per sector",
  keyFigures: "Xifres clau",
  holdings: "Posicions",
  topPosition: "Posició principal",
  effectiveN: "Posicions efectives",
  totalReturn: "Rendiment total",
  irr: "Rendiment anual (TIR)",
  totalValue: "Valor total",
  totalCost: "Cost total",
  realized: "Resultat realitzat",
  dividends: "Dividends",
  other: "Altres",
  grade: "Nota",
  verifyTitle: "Com verificar-ho",
  verifyHint:
    "Obre trimmtrack.com/verify i introdueix el codi. La pàgina recalcula l'empremta a partir de les xifres desades: si coincideix amb la impresa aquí, el document no s'ha alterat.",
  verifyShort: "Verifica-ho a trimmtrack.com/verify amb el codi H7K2M9QX4B",
  code: "Codi",
  digest: "Empremta",
  revoked: "Revocat",
  disclaimer:
    "TrimmTrack no és un assessor financer registrat. Aquest document és informatiu i no constitueix una recomanació d'inversió.",
  regionNames: {
    US: "EUA",
    Europe: "Europa",
    UK: "Regne Unit",
    Asia: "Àsia-Pacífic",
    Crypto: "Cripto",
    Other: "Altres",
  },
};

const body = buildSnapshotBody({ report, amounts: true });
const canonical = canonicalizeBody(body);
const code = "H7K2M9QX4B";
const issuedAt = "2026-08-12T09:30:00.000Z";
const digest = await recomputeDigest({ code, issuedAt, canonical });
const snapshot = { code, issuedAt, body, canonical, digest, signatureValid: true };

const pdfPath = path.join(outDir, "report.pdf");
writeFileSync(pdfPath, buildReportPdf(snapshot, labels, fmt).toBytes());

const svg = buildVerifiedCardSvg(snapshot, labels, fmt);
const svgPath = path.join(outDir, "card.svg");
writeFileSync(svgPath, svg);

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(
  `<body style="margin:0">${svg}</body>`,
  { waitUntil: "networkidle0" },
);
await page.screenshot({ path: path.join(outDir, "card.png") });

// Chrome renders PDFs in its built-in viewer, which is enough for a look at the
// page layout.
const pdfPage = await browser.newPage();
await pdfPage.setViewport({ width: 900, height: 1240 });
await pdfPage.goto(`file:///${pdfPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
await pdfPage.screenshot({ path: path.join(outDir, "report.png") });

await browser.close();
console.log("wrote report.pdf, card.svg, card.png, report.png to", outDir);
