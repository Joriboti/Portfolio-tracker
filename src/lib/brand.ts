// The brand's official identities, in one place so the footer link, the
// Organization `sameAs`, the article schema and the share intents can never
// drift apart. Anything claiming to be TrimmTrack elsewhere is not us.

export const X_HANDLE = "@trimmtrack";
export const X_URL = "https://x.com/trimmtrack";

/** Profiles Google may treat as the same entity (schema.org `sameAs`). */
export const SAME_AS: string[] = [X_URL];

/** The one OG/Schema image every page and article uses. */
export const OG_IMAGE = "https://www.trimmtrack.com/og.png";

/** X share intent for a page, with no SDK and no third-party script. */
export function shareOnX(url: string, text: string): string {
  const p = new URLSearchParams({ url, text, via: X_HANDLE.replace("@", "") });
  return `https://x.com/intent/post?${p.toString()}`;
}
