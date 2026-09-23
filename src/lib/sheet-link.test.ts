import { describe, expect, it } from "vitest";
import {
  downloadUrls,
  fetchSheetLink,
  looksLikeSpreadsheet,
  parseSheetLink,
  SheetLinkError,
} from "./sheet-link";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer;
const HTML_BYTES = new TextEncoder().encode("<!doctype html>").buffer;

describe("parseSheetLink", () => {
  it.each([
    [`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, "sheets"],
    [`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing&rtpof=true`, "sheets"],
    [`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit`, "sheets"],
    [`  docs.google.com/spreadsheets/d/${ID}  `, "sheets"],
    [`https://drive.google.com/file/d/${ID}/view?usp=drive_link`, "drive"],
    [`https://drive.google.com/open?id=${ID}`, "drive"],
    [`https://drive.google.com/uc?export=download&id=${ID}`, "drive"],
  ])("%s → %s", (url, kind) => {
    expect(parseSheetLink(url)).toEqual({ kind, id: ID });
  });

  it.each(["", "hello", "https://example.com/a.xlsx", "https://docs.google.com/document/d/abc/edit"])(
    "rejects %s",
    (url) => expect(parseSheetLink(url)).toBeNull(),
  );
});

describe("downloadUrls", () => {
  it("exports a Sheet as xlsx", () => {
    expect(downloadUrls({ kind: "sheets", id: ID })).toEqual([
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`,
    ]);
  });
  it("tries the raw Drive file, then the Sheets export", () => {
    const urls = downloadUrls({ kind: "drive", id: ID });
    expect(urls[0]).toContain("drive.usercontent.google.com/download?id=");
    expect(urls[1]).toContain("/export?format=xlsx");
  });
});

describe("looksLikeSpreadsheet", () => {
  it("accepts zip and OLE2 headers, rejects HTML", () => {
    expect(looksLikeSpreadsheet(XLSX_BYTES)).toBe(true);
    expect(looksLikeSpreadsheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer)).toBe(true);
    expect(looksLikeSpreadsheet(HTML_BYTES)).toBe(false);
    expect(looksLikeSpreadsheet(new ArrayBuffer(0))).toBe(false);
  });
});

describe("fetchSheetLink", () => {
  const respond = (body: ArrayBuffer, status = 200) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      return e instanceof SheetLinkError ? e.code : "other";
    }
  };

  it("returns an xlsx File for a public sheet", async () => {
    const f = await fetchSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`, respond(XLSX_BYTES));
    expect(f.name).toBe("google-sheet.xlsx");
    expect(f.size).toBe(7);
  });

  it("falls through to the Sheets export when the raw Drive download fails", async () => {
    const seen: string[] = [];
    const impl = (async (url: string) => {
      seen.push(url);
      return url.includes("usercontent")
        ? new Response(HTML_BYTES, { status: 500 })
        : new Response(XLSX_BYTES);
    }) as unknown as typeof fetch;
    const f = await fetchSheetLink(`https://drive.google.com/file/d/${ID}/view`, impl);
    expect(f.size).toBe(7);
    expect(seen).toHaveLength(2);
  });

  it("maps failures to codes", async () => {
    const reject = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await code(fetchSheetLink("not a link", reject))).toBe("invalid");
    expect(await code(fetchSheetLink(`docs.google.com/spreadsheets/d/${ID}`, reject))).toBe("private");
    expect(await code(fetchSheetLink(`docs.google.com/spreadsheets/d/${ID}`, respond(HTML_BYTES, 404)))).toBe("notFound");
    expect(await code(fetchSheetLink(`docs.google.com/spreadsheets/d/${ID}`, respond(HTML_BYTES)))).toBe("notSpreadsheet");
  });
});
