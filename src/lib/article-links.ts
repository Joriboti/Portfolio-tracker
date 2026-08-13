import { LOCALES, stripLocale } from "@/lib/locale";

// CMS prose is written by hand, so its links drift from the site's URL rules:
// `http://` instead of https, the apex host instead of www, a path with no
// locale prefix, or a legacy `?lng=`. Each of those costs the reader at least
// one redirect and can land an English reader on a Catalan page.
//
// This turns any link that points at TrimmTrack into a locale-neutral in-app
// path (the caller adds the reader's locale); anything else returns null and is
// left alone as an external link.

const HOSTS = new Set(["trimmtrack.com", "www.trimmtrack.com"]);

/**
 * The in-app, locale-neutral path a CMS link should really point at, or null
 * when the link is external (or points at a non-page asset we must not rewrite).
 */
export function normalizeArticleLink(href: string): string | null {
  const raw = (href ?? "").trim();
  if (!raw) return null;

  let path: string;
  if (raw.startsWith("/")) {
    path = raw;
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!HOSTS.has(url.hostname.toLowerCase())) return null;
    path = url.pathname + url.search + url.hash;
  }

  // Files served from the public/ root are not routes.
  if (/\.(png|jpe?g|svg|webp|gif|xml|txt|ico|pdf|json)(\?|#|$)/i.test(path)) return null;

  // Drop the legacy language query parameter; the locale prefix carries it now.
  const [pathname, query = ""] = path.split("#")[0].split("?");
  const params = new URLSearchParams(query);
  params.delete("lng");
  const rest = params.toString();

  const neutral = stripLocale(pathname).replace(/\/+$/, "") || "/";
  return rest ? `${neutral}?${rest}` : neutral;
}

/** True when `href` points at TrimmTrack in a shape a reader should never see. */
export function isBadInternalLink(href: string): boolean {
  const raw = (href ?? "").trim();
  if (/^http:\/\//i.test(raw) && /trimmtrack\.com/i.test(raw)) return true;
  if (/[?&]lng=/i.test(raw) && /trimmtrack\.com/i.test(raw)) return true;
  if (/^https:\/\/trimmtrack\.com/i.test(raw)) return true; // apex → www redirect
  return false;
}

/** Locale prefixes, exported so the link tests can enumerate them. */
export const LOCALE_PREFIXES = LOCALES.map((l) => (l === "ca" ? "" : `/${l}`));
