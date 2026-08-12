// Minimal vector PDF writer — enough to lay out a one-page portfolio report,
// with no dependency.
//
// Why hand-rolled: the only thing we need to draw is text, rectangles, lines
// and pie slices, all of which are a few operators in a PDF content stream.
// Pulling in a PDF library for that would add hundreds of kilobytes to a Vite
// bundle for one page, and it would still be limited to the base-14 fonts we
// use here anyway.
//
// Conventions:
//   - Coordinates are TOP-LEFT origin, y growing downwards (PDF's own origin is
//     bottom-left; the flip happens once, in `pt()`), because every layout
//     calculation in the report reads better that way.
//   - Text is written in WinAnsiEncoding with every non-ASCII byte escaped in
//     octal, so the emitted file stays pure ASCII and cannot be corrupted by a
//     stray UTF-8 conversion somewhere in the download path.
//   - Only Helvetica and Helvetica-Bold are used. They are base-14, so nothing
//     has to be embedded, and the file stays a few kilobytes.

export type Rgb = [number, number, number];
export type PdfFont = "sans" | "sansBold";
export type TextAlign = "left" | "center" | "right";

export type TextOptions = {
  size?: number;
  font?: PdfFont;
  color?: Rgb;
  align?: TextAlign;
  /** Extra space between characters, in points. */
  letterSpacing?: number;
};

// A4 in PostScript points.
export const A4_WIDTH = 595.276;
export const A4_HEIGHT = 841.89;

// --- WinAnsi encoding -------------------------------------------------------

// CP1252 differs from Latin-1 only in 0x80–0x9F. These are the ones that can
// realistically show up in the report (currency, typographic punctuation).
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85, // …
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92, // ’
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Map a code point to its WinAnsi byte, or null when unrepresentable. */
function winAnsiByte(cp: number): number | null {
  if (cp >= 0x20 && cp <= 0x7e) return cp;
  const mapped = CP1252_HIGH[cp];
  if (mapped != null) return mapped;
  if (cp >= 0xa0 && cp <= 0xff) return cp; // Latin-1 range, incl. àéíòúçñ·
  return null;
}

/** PDF literal string: parentheses and backslashes escaped, high bytes octal. */
function pdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const byte = winAnsiByte(cp);
    if (byte == null) {
      out += "?";
      continue;
    }
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += "\\" + String.fromCharCode(byte); // ( ) \
    } else if (byte < 0x20 || byte > 0x7e) {
      out += "\\" + byte.toString(8).padStart(3, "0");
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

// --- Glyph widths -----------------------------------------------------------

// Adobe AFM widths (per 1000 units) for ASCII 32–126. Accented characters are
// measured as their unaccented base letter, which is exact for Helvetica's
// composed glyphs.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Base letter used to measure an accented character. */
function foldAccent(cp: number): number {
  if (cp >= 0xc0 && cp <= 0xc5) return 0x41; // À-Å → A
  if (cp === 0xc7) return 0x43; // Ç → C
  if (cp >= 0xc8 && cp <= 0xcb) return 0x45; // È-Ë → E
  if (cp >= 0xcc && cp <= 0xcf) return 0x49; // Ì-Ï → I
  if (cp === 0xd1) return 0x4e; // Ñ → N
  if (cp >= 0xd2 && cp <= 0xd6) return 0x4f; // Ò-Ö → O
  if (cp >= 0xd9 && cp <= 0xdc) return 0x55; // Ù-Ü → U
  if (cp >= 0xe0 && cp <= 0xe5) return 0x61; // à-å → a
  if (cp === 0xe7) return 0x63; // ç → c
  if (cp >= 0xe8 && cp <= 0xeb) return 0x65; // è-ë → e
  if (cp >= 0xec && cp <= 0xef) return 0x69; // ì-ï → i
  if (cp === 0xf1) return 0x6e; // ñ → n
  if (cp >= 0xf2 && cp <= 0xf6) return 0x6f; // ò-ö → o
  if (cp >= 0xf9 && cp <= 0xfc) return 0x75; // ù-ü → u
  if (cp === 0xb7) return 0x2e; // · ≈ .
  if (cp === 0x20ac) return 0x45; // € ≈ E
  return cp;
}

/** Width of `text` at `size` points. */
export function measureText(text: string, size: number, font: PdfFont = "sans"): number {
  const table = font === "sansBold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let units = 0;
  for (const ch of text) {
    const cp = foldAccent(ch.codePointAt(0)!);
    units += cp >= 32 && cp <= 126 ? table[cp - 32] : table[0];
  }
  return (units / 1000) * size;
}

// --- Document ---------------------------------------------------------------

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const col = ([r, g, b]: Rgb): string => `${f(r / 255)} ${f(g / 255)} ${f(b / 255)}`;

export class PdfDoc {
  private ops: string[] = [];
  readonly width: number;
  readonly height: number;

  constructor(width = A4_WIDTH, height = A4_HEIGHT) {
    this.width = width;
    this.height = height;
  }

  /** Flip a top-left y into PDF's bottom-left space. */
  private pt(y: number): number {
    return this.height - y;
  }

  rect(x: number, y: number, w: number, h: number, fill: Rgb): this {
    this.ops.push(`${col(fill)} rg`, `${f(x)} ${f(this.pt(y + h))} ${f(w)} ${f(h)} re f`);
    return this;
  }

  /** Rounded rectangle, corner radius clamped to half the shorter side. */
  roundedRect(x: number, y: number, w: number, h: number, r: number, fill: Rgb): this {
    const rad = Math.min(r, w / 2, h / 2);
    const k = rad * 0.5523;
    const y0 = this.pt(y + h);
    const y1 = this.pt(y);
    this.ops.push(
      `${col(fill)} rg`,
      `${f(x + rad)} ${f(y0)} m`,
      `${f(x + w - rad)} ${f(y0)} l`,
      `${f(x + w - rad + k)} ${f(y0)} ${f(x + w)} ${f(y0 + rad - k)} ${f(x + w)} ${f(y0 + rad)} c`,
      `${f(x + w)} ${f(y1 - rad)} l`,
      `${f(x + w)} ${f(y1 - rad + k)} ${f(x + w - rad + k)} ${f(y1)} ${f(x + w - rad)} ${f(y1)} c`,
      `${f(x + rad)} ${f(y1)} l`,
      `${f(x + rad - k)} ${f(y1)} ${f(x)} ${f(y1 - rad + k)} ${f(x)} ${f(y1 - rad)} c`,
      `${f(x)} ${f(y0 + rad)} l`,
      `${f(x)} ${f(y0 + rad - k)} ${f(x + rad - k)} ${f(y0)} ${f(x + rad)} ${f(y0)} c`,
      "f",
    );
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, width = 0.5): this {
    this.ops.push(
      `${col(color)} RG`,
      `${f(width)} w`,
      `${f(x1)} ${f(this.pt(y1))} m ${f(x2)} ${f(this.pt(y2))} l S`,
    );
    return this;
  }

  circle(cx: number, cy: number, r: number, fill: Rgb): this {
    const k = r * 0.5523;
    const y = this.pt(cy);
    this.ops.push(
      `${col(fill)} rg`,
      `${f(cx + r)} ${f(y)} m`,
      `${f(cx + r)} ${f(y + k)} ${f(cx + k)} ${f(y + r)} ${f(cx)} ${f(y + r)} c`,
      `${f(cx - k)} ${f(y + r)} ${f(cx - r)} ${f(y + k)} ${f(cx - r)} ${f(y)} c`,
      `${f(cx - r)} ${f(y - k)} ${f(cx - k)} ${f(y - r)} ${f(cx)} ${f(y - r)} c`,
      `${f(cx + k)} ${f(y - r)} ${f(cx + r)} ${f(y - k)} ${f(cx + r)} ${f(y)} c`,
      "f",
    );
    return this;
  }

  /** Closed polygon through `points` ([x, y] pairs, top-left space). */
  polygon(points: Array<[number, number]>, fill: Rgb): this {
    if (points.length < 3) return this;
    this.ops.push(`${col(fill)} rg`);
    points.forEach(([x, y], i) => {
      this.ops.push(`${f(x)} ${f(this.pt(y))} ${i === 0 ? "m" : "l"}`);
    });
    this.ops.push("h f");
    return this;
  }

  /**
   * One slice of a donut, from `a0` to `a1` radians measured clockwise from
   * twelve o'clock — the direction a reader expects a pie to fill.
   *
   * Arcs are emitted as cubic Béziers of at most 90°, which is where the
   * circular-arc approximation stays visually exact.
   */
  donutSlice(
    cx: number,
    cy: number,
    rOuter: number,
    rInner: number,
    a0: number,
    a1: number,
    fill: Rgb,
  ): this {
    if (a1 - a0 <= 1e-6) return this;
    // Clockwise from 12 o'clock, in PDF's y-up space.
    const px = (r: number, a: number): [number, number] => [
      cx + r * Math.sin(a),
      this.pt(cy) + r * Math.cos(a),
    ];
    const segs = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2)));
    const step = (a1 - a0) / segs;
    // Tangent length for a Bézier approximating an arc of `step` radians.
    const kFor = (r: number): number => (r * 4 * Math.tan(step / 4)) / 3;

    const out: string[] = [`${col(fill)} rg`];
    const [sx, sy] = px(rOuter, a0);
    out.push(`${f(sx)} ${f(sy)} m`);
    for (let i = 0; i < segs; i++) {
      const b0 = a0 + i * step;
      const b1 = b0 + step;
      const [x0, y0] = px(rOuter, b0);
      const [x1, y1] = px(rOuter, b1);
      const k = kFor(rOuter);
      // Tangent at angle a (clockwise from 12) is (cos a, -sin a) in y-up space.
      out.push(
        `${f(x0 + k * Math.cos(b0))} ${f(y0 - k * Math.sin(b0))} ` +
          `${f(x1 - k * Math.cos(b1))} ${f(y1 + k * Math.sin(b1))} ` +
          `${f(x1)} ${f(y1)} c`,
      );
    }
    if (rInner > 0) {
      const [ix, iy] = px(rInner, a1);
      out.push(`${f(ix)} ${f(iy)} l`);
      for (let i = segs; i > 0; i--) {
        const b0 = a0 + i * step;
        const b1 = b0 - step;
        const [x0, y0] = px(rInner, b0);
        const [x1, y1] = px(rInner, b1);
        const k = kFor(rInner);
        out.push(
          `${f(x0 - k * Math.cos(b0))} ${f(y0 + k * Math.sin(b0))} ` +
            `${f(x1 + k * Math.cos(b1))} ${f(y1 - k * Math.sin(b1))} ` +
            `${f(x1)} ${f(y1)} c`,
        );
      }
    } else {
      out.push(`${f(cx)} ${f(this.pt(cy))} l`);
    }
    out.push("h f");
    this.ops.push(...out);
    return this;
  }

  /** `y` is the text baseline. */
  text(str: string, x: number, y: number, opts: TextOptions = {}): this {
    const size = opts.size ?? 10;
    const font = opts.font ?? "sans";
    const color = opts.color ?? [0, 0, 0];
    const spacing = opts.letterSpacing ?? 0;
    const width = measureText(str, size, font) + spacing * Math.max(0, str.length - 1);
    const x0 =
      opts.align === "center" ? x - width / 2 : opts.align === "right" ? x - width : x;
    this.ops.push(
      "BT",
      `/${font === "sansBold" ? "F2" : "F1"} ${f(size)} Tf`,
      `${col(color)} rg`,
      ...(spacing ? [`${f(spacing)} Tc`] : []),
      `${f(x0)} ${f(this.pt(y))} Td`,
      `(${pdfString(str)}) Tj`,
      ...(spacing ? ["0 Tc"] : []),
      "ET",
    );
    return this;
  }

  /**
   * Draw `str` clipped to `maxWidth`, appending an ellipsis when it does not
   * fit. Long instrument names would otherwise run into the next column.
   */
  textEllipsized(
    str: string,
    x: number,
    y: number,
    maxWidth: number,
    opts: TextOptions = {},
  ): this {
    const size = opts.size ?? 10;
    const font = opts.font ?? "sans";
    if (measureText(str, size, font) <= maxWidth) return this.text(str, x, y, opts);
    let cut = str;
    while (cut.length > 1 && measureText(cut + "…", size, font) > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return this.text(cut + "…", x, y, opts);
  }

  /** Serialise to a PDF file. */
  toBytes(): Uint8Array {
    const content = this.ops.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] ` +
        `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((obj, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xrefStart = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;

    // Every byte in `out` is ASCII by construction (see pdfString), so the
    // char-code-per-byte conversion below is lossless and the offsets recorded
    // above stay valid.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  toBlob(): Blob {
    const bytes = this.toBytes();
    // Copy into a plain ArrayBuffer: a Uint8Array's buffer is typed as possibly
    // shared, which Blob won't accept.
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    return new Blob([buf], { type: "application/pdf" });
  }
}
