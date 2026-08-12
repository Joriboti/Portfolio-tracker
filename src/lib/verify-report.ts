// The two artefacts a verified snapshot produces: a one-page A4 PDF report and
// a landscape card for sharing as a PNG.
//
// Both are built from the *signed body only*. Nothing is passed in on the side
// and nothing is recomputed here, so every figure that appears on either
// artefact is one that went into the digest — which is the whole point: a
// reader can recompute the hash from what the verify page shows and get the
// number printed on the card.
//
// Colours come from one categorical palette, validated for colourblind
// separation and contrast against a light ground, and assigned in fixed order
// (never cycled) — the ninth bucket is a deliberate neutral, not a ninth hue.

import { PdfDoc, A4_WIDTH, measureText, type Rgb } from "./pdf";
import {
  REMAINDER_KEY,
  shortDigest,
  type IssuedSnapshot,
  type SnapshotBody,
  type SnapshotHolding,
} from "./verify";

/** Fixed categorical order. Slot i always means "the i-th largest holding". */
export const DISTRIBUTION_COLORS = [
  "#d1550f",
  "#3b6ea5",
  "#2fa37a",
  "#a13a8f",
  "#a8871a",
  "#0f8ea3",
  "#b03a5b",
  "#6b5bd0",
] as const;

/** Everything past the top N. A neutral, so it never reads as another holding. */
export const REMAINDER_COLOR = "#a99e8b";

const INK = "#221d15";
const INK_MUTED = "#847a6a";
const HAIRLINE = "#e5ddce";
const CREAM = "#faf6ef";
const BRAND = "#d1550f";
const POSITIVE = "#2fa37a";
const NEGATIVE = "#b03a5b";

/**
 * Slot `index` of the fixed order. Hues are never cycled: anything past the
 * palette — like the remainder bucket — gets the neutral, so a reader can never
 * mistake two different entities for the same one.
 */
export function sliceColor(index: number, ticker?: string): string {
  if (ticker === REMAINDER_KEY) return REMAINDER_COLOR;
  return DISTRIBUTION_COLORS[index] ?? REMAINDER_COLOR;
}

const hexToRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Labels the caller pulls out of i18n — this module never touches translations. */
export type ReportLabels = {
  brand: string;
  url: string;
  title: string;
  /** e.g. "Self-reported · signed by TrimmTrack" */
  tierLabel: string;
  /** The honest one-liner about what the badge does and does not attest. */
  attestation: string;
  issuedOn: string;
  distribution: string;
  regions: string;
  sectors: string;
  keyFigures: string;
  holdings: string;
  topPosition: string;
  effectiveN: string;
  totalReturn: string;
  irr: string;
  totalValue: string;
  totalCost: string;
  realized: string;
  dividends: string;
  other: string;
  grade: string;
  verifyTitle: string;
  /** Full explanation — the PDF has room for it. */
  verifyHint: string;
  /** One short line for the card's footer, which has a single line of space. */
  verifyShort: string;
  code: string;
  digest: string;
  revoked: string;
  disclaimer: string;
  regionNames: Record<string, string>;
};

export type ReportFormat = {
  /** Locale-aware percentage, e.g. "34,1 %". Signed when `signed` is set. */
  pct: (v: number | null, signed?: boolean) => string;
  money: (v: number | null) => string;
  number: (v: number, dp?: number) => string;
  date: (iso: string) => string;
};

// --- shared geometry --------------------------------------------------------

type Slice = { key: string; label: string; weight: number; color: string; value?: number };

function holdingSlices(body: SnapshotBody, otherLabel: string): Slice[] {
  return body.holdings.map((h: SnapshotHolding, i) => ({
    key: h.t,
    label: h.t === REMAINDER_KEY ? otherLabel : h.t,
    weight: h.w,
    color: sliceColor(i, h.t),
    value: h.v,
  }));
}

/**
 * Angles for a donut, clockwise from twelve o'clock, with a gap between
 * neighbouring slices so two adjacent fills never touch.
 *
 * The gap is given in the drawing unit and converted to radians against the
 * outer radius, so it reads as the same 2 units of visible ground whether the
 * donut is 74 points wide on the PDF or 150 pixels wide on the card.
 */
function donutAngles(
  slices: Slice[],
  radius: number,
  gap = 2,
): Array<{ a0: number; a1: number; slice: Slice }> {
  const gapRad = gap / radius;
  let cursor = 0;
  return slices.map((slice) => {
    const span = slice.weight * Math.PI * 2;
    const a0 = cursor + gapRad / 2;
    const a1 = cursor + span - gapRad / 2;
    cursor += span;
    return { a0, a1: Math.max(a0, a1), slice };
  });
}

// ---------------------------------------------------------------------------
// A4 report
// ---------------------------------------------------------------------------

export function buildReportPdf(
  snapshot: IssuedSnapshot,
  L: ReportLabels,
  fmt: ReportFormat,
): PdfDoc {
  const doc = new PdfDoc();
  const body = snapshot.body;
  const M = 48; // page margin
  const W = A4_WIDTH;
  const contentW = W - M * 2;

  const ink = hexToRgb(INK);
  const muted = hexToRgb(INK_MUTED);
  const hair = hexToRgb(HAIRLINE);
  const brand = hexToRgb(BRAND);

  // --- header ---
  doc.rect(0, 0, W, 4, brand);
  drawCompass(doc, M, 38, 22);
  doc.text(L.brand, M + 30, 46, { size: 15, font: "sansBold", color: ink });
  doc.text(L.url, M + 30, 58, { size: 8, color: muted });
  doc.text(`${L.issuedOn} ${fmt.date(snapshot.issuedAt)}`, W - M, 46, {
    size: 9,
    color: muted,
    align: "right",
  });
  doc.text(`${L.code} ${snapshot.code}`, W - M, 58, {
    size: 9,
    font: "sansBold",
    color: ink,
    align: "right",
  });

  let y = 96;
  doc.text(L.title, M, y, { size: 20, font: "sansBold", color: ink });
  y += 18;

  // Tier pill — states plainly which rung of the ladder this card earned.
  const pillText = L.tierLabel;
  const pillW = measureText(pillText, 8.5, "sansBold") + 16;
  doc.roundedRect(M, y - 9, pillW, 15, 7.5, hexToRgb(CREAM));
  doc.text(pillText, M + 8, y + 1.5, { size: 8.5, font: "sansBold", color: brand });
  if (snapshot.revokedAt) {
    doc.text(L.revoked.toUpperCase(), M + pillW + 10, y + 1.5, {
      size: 8.5,
      font: "sansBold",
      color: hexToRgb(NEGATIVE),
    });
  }
  y += 20;
  y = paragraph(doc, L.attestation, M, y, contentW, { size: 8.5, color: muted, leading: 11 });
  y += 14;

  doc.line(M, y, W - M, y, hair, 0.8);
  y += 22;

  // --- distribution: donut left, legend right ---
  doc.text(L.distribution.toUpperCase(), M, y, {
    size: 8,
    font: "sansBold",
    color: muted,
    letterSpacing: 1.1,
  });
  y += 16;

  const slices = holdingSlices(body, L.other);
  const cx = M + 74;
  const cy = y + 74;
  for (const { a0, a1, slice } of donutAngles(slices, 74)) {
    doc.donutSlice(cx, cy, 74, 44, a0, a1, hexToRgb(slice.color));
  }
  // Centre of the donut carries the headline the chart is about.
  doc.text(String(body.holdingsCount), cx, cy + 2, {
    size: 22,
    font: "sansBold",
    color: ink,
    align: "center",
  });
  doc.text(L.holdings.toUpperCase(), cx, cy + 14, {
    size: 6.5,
    color: muted,
    align: "center",
    letterSpacing: 0.6,
  });

  // Legend — a chip carries identity, the text stays ink.
  const legendX = M + 168;
  const legendW = W - M - legendX;
  let ly = y + 8;
  for (const slice of slices) {
    doc.roundedRect(legendX, ly - 5.5, 7, 7, 1.5, hexToRgb(slice.color));
    doc.textEllipsized(slice.label, legendX + 13, ly, legendW - 130, {
      size: 9,
      color: ink,
    });
    if (body.amounts && slice.value != null) {
      doc.text(fmt.money(slice.value), legendX + legendW - 52, ly, {
        size: 9,
        color: muted,
        align: "right",
      });
    }
    doc.text(fmt.pct(slice.weight), legendX + legendW, ly, {
      size: 9,
      font: "sansBold",
      color: ink,
      align: "right",
    });
    ly += 15.5;
  }

  y = Math.max(cy + 84, ly + 6);
  doc.line(M, y, W - M, y, hair, 0.8);
  y += 22;

  // --- key figures ---
  doc.text(L.keyFigures.toUpperCase(), M, y, {
    size: 8,
    font: "sansBold",
    color: muted,
    letterSpacing: 1.1,
  });
  y += 18;

  const figures: Array<{ label: string; value: string; tone?: Rgb }> = [
    { label: L.holdings, value: fmt.number(body.holdingsCount) },
    { label: L.topPosition, value: fmt.pct(body.conc.top1) },
    { label: L.effectiveN, value: fmt.number(body.conc.effN, 1) },
    { label: L.grade, value: `${body.grade} · ${fmt.number(body.score)}/100` },
    {
      label: L.totalReturn,
      value: fmt.pct(body.ret.total, true),
      tone: toneFor(body.ret.total),
    },
    { label: L.irr, value: fmt.pct(body.ret.irr, true), tone: toneFor(body.ret.irr) },
  ];
  if (body.amounts && body.totals) {
    const { value, cost, realized, dividends } = body.totals;
    figures.push({ label: L.totalValue, value: fmt.money(value) });
    if (cost > 0) figures.push({ label: L.totalCost, value: fmt.money(cost) });
    // Omitted entirely when the source could not tell us — a "0 €" here would
    // read as "you have realised nothing", which is a different statement.
    if (realized != null) {
      figures.push({ label: L.realized, value: fmt.money(realized), tone: toneFor(realized) });
    }
    if (dividends != null) {
      figures.push({ label: L.dividends, value: fmt.money(dividends) });
    }
  }

  const cols = 3;
  const colW = contentW / cols;
  figures.forEach((fig, i) => {
    const fx = M + (i % cols) * colW;
    const fy = y + Math.floor(i / cols) * 40;
    doc.text(fig.label.toUpperCase(), fx, fy, { size: 6.5, color: muted, letterSpacing: 0.5 });
    doc.text(fig.value, fx, fy + 15, { size: 13, font: "sansBold", color: fig.tone ?? ink });
  });
  y += Math.ceil(figures.length / cols) * 40 + 6;

  doc.line(M, y, W - M, y, hair, 0.8);
  y += 22;

  // --- regions, and sectors when we have coverage ---
  y = stackedBarSection(
    doc,
    L.regions,
    body.regions.slice(0, DISTRIBUTION_COLORS.length).map((r, i) => ({
      key: r.k,
      label: L.regionNames[r.k] ?? r.k,
      weight: r.w,
      color: sliceColor(i),
    })),
    M,
    y,
    contentW,
    fmt,
  );

  if (body.sectors && body.sectors.length > 0) {
    y += 18;
    y = stackedBarSection(
      doc,
      L.sectors,
      body.sectors.slice(0, DISTRIBUTION_COLORS.length).map((s, i) => ({
        key: s.k,
        label: s.k,
        weight: s.w,
        color: sliceColor(i),
      })),
      M,
      y,
      contentW,
      fmt,
    );
  }

  // --- verification block, pinned to the bottom ---
  const boxH = 84;
  const boxY = doc.height - M - boxH - 22;
  doc.roundedRect(M, boxY, contentW, boxH, 6, hexToRgb(CREAM));
  doc.text(L.verifyTitle.toUpperCase(), M + 16, boxY + 20, {
    size: 8,
    font: "sansBold",
    color: brand,
    letterSpacing: 1.1,
  });
  doc.text(`${L.code}: ${snapshot.code}`, M + 16, boxY + 38, {
    size: 11,
    font: "sansBold",
    color: ink,
  });
  doc.text(`${L.digest}: ${shortDigest(snapshot.digest)}`, M + 16, boxY + 53, {
    size: 9,
    color: muted,
  });
  paragraph(doc, L.verifyHint, M + 210, boxY + 22, contentW - 226, {
    size: 8,
    color: muted,
    leading: 10.5,
  });

  paragraph(doc, L.disclaimer, M, doc.height - M - 14, contentW, {
    size: 6.5,
    color: muted,
    leading: 8,
  });

  return doc;
}

function toneFor(v: number | null): Rgb | undefined {
  if (v == null) return undefined;
  return v >= 0 ? hexToRgb(POSITIVE) : hexToRgb(NEGATIVE);
}

/** Word-wrap `text` into `width`, returning the y below the last line. */
function paragraph(
  doc: PdfDoc,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: { size: number; color: Rgb; leading: number },
): number {
  const words = text.split(/\s+/);
  let line = "";
  let cursor = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measureText(next, opts.size) > width && line) {
      doc.text(line, x, cursor, { size: opts.size, color: opts.color });
      cursor += opts.leading;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    doc.text(line, x, cursor, { size: opts.size, color: opts.color });
    cursor += opts.leading;
  }
  return cursor;
}

/** A labelled 100% stacked bar with its legend underneath. */
function stackedBarSection(
  doc: PdfDoc,
  title: string,
  slices: Slice[],
  x: number,
  y: number,
  width: number,
  fmt: ReportFormat,
): number {
  const muted = hexToRgb(INK_MUTED);
  const ink = hexToRgb(INK);
  doc.text(title.toUpperCase(), x, y, {
    size: 8,
    font: "sansBold",
    color: muted,
    letterSpacing: 1.1,
  });
  y += 12;

  // 2pt of page showing between segments, so neighbouring fills never touch.
  let cursor = x;
  for (const s of slices) {
    const w = s.weight * width;
    if (w > 0) doc.roundedRect(cursor, y, Math.max(0, w - 2), 9, 2, hexToRgb(s.color));
    cursor += w;
  }
  y += 22;

  let lx = x;
  for (const s of slices) {
    const label = `${s.label} ${fmt.pct(s.weight)}`;
    const w = measureText(label, 8) + 16;
    if (lx + w > x + width) break; // one row of legend; the bar carries the rest
    doc.roundedRect(lx, y - 5, 6, 6, 1.5, hexToRgb(s.color));
    doc.text(label, lx + 10, y, { size: 8, color: ink });
    lx += w + 8;
  }
  return y + 6;
}

/** The compass mark from Logo.tsx, as vectors. */
function drawCompass(doc: PdfDoc, x: number, y: number, size: number): void {
  const s = size / 32;
  const at = (px: number, py: number): [number, number] => [x + px * s, y + py * s];
  const [cx, cy] = at(16, 16);
  doc.circle(cx, cy, 14 * s, hexToRgb("#e9dcc4"));
  doc.circle(cx, cy, 11.8 * s, hexToRgb("#ffffff"));
  doc.polygon([at(16, 4.6), at(18.4, 16), at(13.6, 16)], hexToRgb("#e76b1c"));
  doc.polygon([at(16, 27.4), at(18.4, 16), at(13.6, 16)], hexToRgb("#c99160"));
  doc.circle(cx, cy, 2 * s, hexToRgb("#e9dcc4"));
  doc.circle(cx, cy, 1.05 * s, hexToRgb("#e76b1c"));
}

// ---------------------------------------------------------------------------
// Shareable card (self-contained SVG string → PNG)
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildVerifiedCardSvg(
  snapshot: IssuedSnapshot,
  L: ReportLabels,
  fmt: ReportFormat,
): string {
  const W = 1200;
  const H = 630;
  const body = snapshot.body;
  const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const slices = holdingSlices(body, L.other);

  // Donut, clockwise from twelve o'clock, drawn as arc paths.
  const cx = 300;
  const cy = 330;
  const rOuter = 150;
  const rInner = 92;
  const arcs = donutAngles(slices, rOuter)
    .map(({ a0, a1, slice }) => {
      const p = (r: number, a: number): string =>
        `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      return (
        `<path d="M ${p(rOuter, a0)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, a1)} ` +
        `L ${p(rInner, a1)} A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, a0)} Z" fill="${slice.color}"/>`
      );
    })
    .join("");

  // Euro amounts appear only when the owner opted into disclosing them — the
  // same flag that put them in the signed body.
  const legend = slices
    .map((s, i) => {
      const ly = 152 + i * 44;
      const money =
        s.value == null
          ? ""
          : `<text x="430" y="0" text-anchor="end" font-family="${sans}" font-size="20" fill="${INK_MUTED}">${esc(fmt.money(s.value))}</text>`;
      return `<g transform="translate(560,${ly})">
        <rect x="0" y="-11" width="13" height="13" rx="3" fill="${s.color}"/>
        <text x="26" y="0" font-family="${sans}" font-size="22" fill="${INK}">${esc(s.label)}</text>
        ${money}
        <text x="580" y="0" text-anchor="end" font-family="${sans}" font-size="22" font-weight="600" fill="${INK}">${esc(fmt.pct(s.weight))}</text>
      </g>`;
    })
    .join("");

  const ret = fmt.pct(body.ret.total, true);
  const retColor = (body.ret.total ?? 0) >= 0 ? POSITIVE : NEGATIVE;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${BRAND}"/>

  <text x="64" y="76" font-family="${sans}" font-size="30" font-weight="700" fill="${INK}">${esc(L.brand)}</text>
  <text x="64" y="102" font-family="${sans}" font-size="15" fill="${INK_MUTED}">${esc(L.url)}</text>

  <g transform="translate(${W - 64},0)">
    <text x="0" y="70" text-anchor="end" font-family="${sans}" font-size="17" font-weight="600" fill="${BRAND}" letter-spacing="1.5">${esc(L.tierLabel.toUpperCase())}</text>
    <text x="0" y="96" text-anchor="end" font-family="${sans}" font-size="15" fill="${INK_MUTED}">${esc(L.code)} ${esc(snapshot.code)} · ${esc(fmt.date(snapshot.issuedAt))}</text>
  </g>

  <line x1="64" y1="126" x2="${W - 64}" y2="126" stroke="${HAIRLINE}" stroke-width="2"/>

  ${arcs}
  <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="${sans}" font-size="58" font-weight="700" fill="${INK}">${esc(String(body.holdingsCount))}</text>
  <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-family="${sans}" font-size="18" fill="${INK_MUTED}" letter-spacing="1.2">${esc(L.holdings.toUpperCase())}</text>

  ${legend}

  <g transform="translate(64,540)">
    <text x="0" y="0" font-family="${sans}" font-size="15" fill="${INK_MUTED}" letter-spacing="1.2">${esc(L.totalReturn.toUpperCase())}</text>
    <text x="0" y="34" font-family="${sans}" font-size="34" font-weight="700" fill="${retColor}">${esc(ret)}</text>
  </g>
  <g transform="translate(300,540)">
    <text x="0" y="0" font-family="${sans}" font-size="15" fill="${INK_MUTED}" letter-spacing="1.2">${esc(L.topPosition.toUpperCase())}</text>
    <text x="0" y="34" font-family="${sans}" font-size="34" font-weight="700" fill="${INK}">${esc(fmt.pct(body.conc.top1))}</text>
  </g>
  <g transform="translate(500,540)">
    <text x="0" y="0" font-family="${sans}" font-size="15" fill="${INK_MUTED}" letter-spacing="1.2">${esc(L.grade.toUpperCase())}</text>
    <text x="0" y="34" font-family="${sans}" font-size="34" font-weight="700" fill="${INK}">${esc(body.grade)}</text>
  </g>
  <g transform="translate(${W - 64},540)">
    <text x="0" y="0" text-anchor="end" font-family="${sans}" font-size="15" fill="${INK_MUTED}" letter-spacing="1.2">${esc(L.digest.toUpperCase())}</text>
    <text x="0" y="30" text-anchor="end" font-family="${sans}" font-size="22" font-weight="600" fill="${INK}">${esc(shortDigest(snapshot.digest))}</text>
  </g>

  <text x="64" y="${H - 26}" font-family="${sans}" font-size="16" fill="${INK_MUTED}">${esc(L.verifyShort)}</text>
</svg>`;
}
