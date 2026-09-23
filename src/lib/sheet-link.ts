// Import a spreadsheet from a Google Sheets / Google Drive link, entirely in
// the browser. Both Google endpoints below answer with CORS headers, so no
// API route is needed (we are at the Vercel Hobby route cap):
//   - docs.google.com/spreadsheets/d/<id>/export?format=xlsx — a native Sheet
//     (or an .xlsx opened in Sheets' Office mode) exported as .xlsx, fills
//     included, so coloured-row exclusion still works.
//   - drive.usercontent.google.com/download?id=<id> — an .xlsx/.xls stored
//     as-is in Drive.
// A private file redirects to the Google sign-in page, which has no CORS
// headers, so fetch() rejects — that is the "not shared publicly" case.

/** For <input type="file" accept>: extensions AND MIME types. Android's
 *  picker filters by MIME, and with extensions alone some pickers (Drive
 *  among them) grey the spreadsheet out. */
export const SPREADSHEET_ACCEPT = [
  ".xlsx",
  ".xls",
  ".ods",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
].join(",");

export type SheetLink = { kind: "sheets" | "drive"; id: string };

export type SheetLinkErrorCode = "invalid" | "private" | "notFound" | "notSpreadsheet";

export class SheetLinkError extends Error {
  constructor(public code: SheetLinkErrorCode) {
    super(code);
    this.name = "SheetLinkError";
  }
}

const ID = "[A-Za-z0-9_-]{20,}";

export function parseSheetLink(raw: string): SheetLink | null {
  const input = raw.trim();
  if (!input) return null;
  let m = input.match(new RegExp(`docs\\.google\\.com/spreadsheets/(?:u/\\d+/)?d/(${ID})`));
  if (m) return { kind: "sheets", id: m[1] };
  m = input.match(new RegExp(`drive\\.google\\.com/(?:drive/)?(?:u/\\d+/)?file/d/(${ID})`));
  if (m) return { kind: "drive", id: m[1] };
  m = input.match(new RegExp(`(?:drive|docs)\\.google\\.com/.*[?&]id=(${ID})`));
  if (m) return { kind: "drive", id: m[1] };
  return null;
}

/** Candidate download URLs, tried in order. A Drive file link can point at
 *  an uploaded .xlsx (usercontent) or at a Sheet (export), so it gets both. */
export function downloadUrls(link: SheetLink): string[] {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${link.id}/export?format=xlsx`;
  const rawUrl = `https://drive.usercontent.google.com/download?id=${link.id}&export=download&confirm=t`;
  return link.kind === "sheets" ? [exportUrl] : [rawUrl, exportUrl];
}

/** xlsx/ods are zip ("PK\x03\x04"); legacy xls is OLE2 ("\xD0\xCF\x11\xE0"). */
export function looksLikeSpreadsheet(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (b.length < 4) return false;
  const zip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  return zip || ole;
}

/** Download the linked spreadsheet as a File, ready for the same handler a
 *  file-input pick goes through. Throws SheetLinkError. */
export async function fetchSheetLink(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<File> {
  const link = parseSheetLink(raw);
  if (!link) throw new SheetLinkError("invalid");

  // The most telling failure wins: a reachable-but-wrong response beats a
  // 404, which beats a CORS rejection (= private).
  let worst: SheetLinkErrorCode = "private";
  const rank: Record<SheetLinkErrorCode, number> = {
    invalid: 3,
    notSpreadsheet: 2,
    notFound: 1,
    private: 0,
  };
  const note = (c: SheetLinkErrorCode) => {
    if (rank[c] > rank[worst]) worst = c;
  };

  for (const url of downloadUrls(link)) {
    let res: Response;
    try {
      res = await fetchImpl(url, { credentials: "omit", redirect: "follow" });
    } catch {
      continue; // sign-in redirect without CORS → private (the default)
    }
    if (res.status === 404) {
      note("notFound");
      continue;
    }
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) {
      note("notSpreadsheet");
      continue;
    }
    const buf = await res.arrayBuffer();
    if (!looksLikeSpreadsheet(buf)) {
      note("notSpreadsheet");
      continue;
    }
    return new File([buf], "google-sheet.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  throw new SheetLinkError(worst);
}
