// Shareable valuation links for the public /explore page.
//
// The whole state of a valuation (ticker + active tab + the ValuationModel
// with every model's assumptions) is serialised into a single compact
// base64url query param (?s=…). Opening such a link replays the exact same
// valuation, interactive, with no backend involved: encode/decode are pure
// and tolerate garbage input (a tampered link degrades to null → normal
// explore page).

import type { ValuationModel } from "./scenarioValuation";

export type ShareState = {
  /** Ticker symbol (Yahoo format, e.g. "NVDA", "IAG.MC"). */
  t: string;
  /** Active valuation tab id (scenarios | dcf | reverse | graham | montecarlo | sotp). */
  tab?: string;
  /** The full valuation model (scenarios, DCF/Graham/MC/SoTP configs, …). */
  m?: Partial<ValuationModel>;
};

/** UTF-8 safe base64url (no padding, URL-safe alphabet). */
function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(v: string): string {
  const b64 = v.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare(state: ShareState): string {
  return toBase64Url(JSON.stringify(state));
}

/** Decode a ?s= param. Returns null for anything malformed. */
export function decodeShare(param: string): ShareState | null {
  try {
    const obj = JSON.parse(fromBase64Url(param)) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const s = obj as Record<string, unknown>;
    if (typeof s.t !== "string" || s.t.trim() === "") return null;
    return {
      t: s.t.trim().toUpperCase(),
      tab: typeof s.tab === "string" ? s.tab : undefined,
      m: s.m && typeof s.m === "object" ? (s.m as Partial<ValuationModel>) : undefined,
    };
  } catch {
    return null;
  }
}

/** Absolute share URL for the current origin. */
export function buildShareUrl(state: ShareState): string {
  return `${window.location.origin}/explore?s=${encodeShare(state)}`;
}
