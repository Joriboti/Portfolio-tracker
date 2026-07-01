import { useEffect, useState } from "react";

// Small company logo tile for the dashboard. Tries a real logo (Clearbit, keyed
// by the company's website domain from the fundamentals table) and gracefully
// degrades to a coloured monogram of the ticker when there's no domain or the
// image fails to load — so it always renders something tidy, no hard
// dependency on any logo provider.

function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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
  const domain = domainFromWebsite(website);
  const src = domain ? `https://logo.clearbit.com/${domain}` : null;
  const [failed, setFailed] = useState(false);

  // Retry the image when the domain changes (e.g. fundamentals loaded in late).
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
