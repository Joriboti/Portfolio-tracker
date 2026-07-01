import { useEffect, useState } from "react";

// Small company logo tile for the dashboard. Primary source is logo.dev — a
// logo API built for stock tickers — keyed by the company's website domain when
// we have it (most accurate) or by ticker otherwise. Requires a publishable
// token in VITE_LOGODEV_TOKEN (safe to expose; that's what publishable keys are
// for). Falls back to a coloured monogram of the ticker when there's no token,
// no match, or the image errors — so it always renders something tidy.

// logo.dev publishable token — safe to ship in the client bundle (that's what
// publishable keys are for). Overridable via VITE_LOGODEV_TOKEN so it can be
// rotated/restricted without a code change.
const LOGODEV_TOKEN =
  (import.meta.env.VITE_LOGODEV_TOKEN as string | undefined) ??
  "pk_VEcmik-7QDe7fQJ5kNcS1Q";

function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// logo.dev's ticker endpoint wants the bare symbol; strip the exchange suffix
// (ITX.MC → ITX, BRK.B kept — only strip known market suffixes).
const MARKET_SUFFIXES = new Set([
  "MC", "PA", "MI", "SW", "TO", "L", "DE", "AS", "BR", "VI", "ST", "HE", "OL",
  "CO", "LS", "MX", "SA", "HK", "T", "TW", "SI", "AX", "NZ", "BK", "F", "BD",
]);

function tickerForLogo(ticker: string): string {
  const parts = ticker.split(".");
  if (parts.length === 2 && MARKET_SUFFIXES.has(parts[1].toUpperCase())) {
    return parts[0];
  }
  return ticker;
}

function logoUrl(ticker: string, website: string | null | undefined): string | null {
  const domain = domainFromWebsite(website);
  if (LOGODEV_TOKEN) {
    const base = domain
      ? `https://img.logo.dev/${encodeURIComponent(domain)}`
      : `https://img.logo.dev/ticker/${encodeURIComponent(tickerForLogo(ticker))}`;
    // fallback=404 makes a miss error out (→ monogram) instead of returning a
    // generic placeholder image.
    return `${base}?token=${LOGODEV_TOKEN}&size=64&format=png&retina=true&fallback=404`;
  }
  // No token configured: best-effort Clearbit by domain, else monogram.
  return domain ? `https://logo.clearbit.com/${domain}` : null;
}

// Deterministic pleasant background from the ticker (stable per company).
function monogramColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

function monogramText(ticker: string): string {
  const base = ticker.split(".")[0].replace(/[^A-Za-z0-9]/g, "");
  return (base.slice(0, 2) || ticker.slice(0, 2)).toUpperCase();
}

export function CompanyLogo({
  ticker,
  website,
  size = 24,
}: {
  ticker: string;
  website?: string | null;
  size?: number;
}) {
  const src = logoUrl(ticker, website);
  const [failed, setFailed] = useState(false);

  // Retry the image when the source changes (e.g. fundamentals loaded in late).
  useEffect(() => setFailed(false), [src]);

  const style = { width: size, height: size } as const;
  const rounded = "rounded-md shrink-0 overflow-hidden";

  if (src && !failed) {
    return (
      <span
        className={`inline-flex items-center justify-center bg-white ring-1 ring-slate-200 ${rounded}`}
        style={style}
      >
        <img
          src={src}
          alt={ticker}
          width={size}
          height={size}
          loading="lazy"
          className="h-full w-full object-contain p-0.5"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center font-semibold text-white ${rounded}`}
      style={{ ...style, backgroundColor: monogramColor(ticker), fontSize: size * 0.4 }}
      title={ticker}
      aria-label={ticker}
    >
      {monogramText(ticker)}
    </span>
  );
}
