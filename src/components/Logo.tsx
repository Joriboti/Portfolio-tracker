import { useId } from "react";

/**
 * TrimmTrack logo mark — a compass. "Track" (follow / navigate your portfolio)
 * makes the compass the natural emblem: a dark charcoal bezel, a bronze
 * 8-point rose and a bold needle whose north half carries the brand orange.
 * Drawn transparent so it sits on any light surface (header, hero, auth);
 * the dark app-icon tile lives in `public/favicon.svg`.
 */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="TrimmTrack"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={`${id}-needle`}
          x1="16"
          y1="4"
          x2="16"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f2802a" />
          <stop offset="1" stopColor="#d1550f" />
        </linearGradient>
        <linearGradient
          id={`${id}-bronze`}
          x1="6"
          y1="6"
          x2="27"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#c99160" />
          <stop offset="1" stopColor="#a1683c" />
        </linearGradient>
      </defs>

      {/* Bezel + hairline dial ring. */}
      <circle cx="16" cy="16" r="14" fill="none" stroke="#201915" strokeWidth="2.2" />
      <circle
        cx="16"
        cy="16"
        r="11.4"
        fill="none"
        stroke="#201915"
        strokeWidth="0.7"
        opacity="0.32"
      />

      {/* Bronze 8-point compass rose (4 long + 4 short points). */}
      <path
        d="M16 5 L16.61 14.52 L19.89 12.11 L17.48 15.39 L27 16 L17.48 16.61 L19.89 19.89 L16.61 17.48 L16 27 L15.39 17.48 L12.11 19.89 L14.52 16.61 L5 16 L14.52 15.39 L12.11 12.11 L15.39 14.52 Z"
        fill={`url(#${id}-bronze)`}
      />

      {/* North needle (orange) over south needle (ink). */}
      <path d="M16 4.6 L18.4 16 L13.6 16 Z" fill={`url(#${id}-needle)`} />
      <path d="M16 27.4 L18.4 16 L13.6 16 Z" fill="#201915" />

      {/* Pivot. */}
      <circle cx="16" cy="16" r="2" fill="#201915" />
      <circle cx="16" cy="16" r="1.05" fill={`url(#${id}-needle)`} />
      <circle cx="15.6" cy="15.6" r="0.35" fill="#fff" opacity="0.85" />
    </svg>
  );
}

/** TrimmTrack wordmark — serif logotype, two-tone with the brand accent. */
export function Wordmark({
  className = "",
  light = false,
}: {
  className?: string;
  /** Cream "Trimm" for dark surfaces (the orange "Track" reads on both). */
  light?: boolean;
}) {
  return (
    <span
      className={`font-serif font-semibold tracking-tight ${
        light ? "text-[#f3ead9]" : "text-slate-900"
      } ${className}`}
    >
      Trimm<span className="text-brand-600">Track</span>
    </span>
  );
}

/**
 * Research-section lockup: the compass mark + the wordmark with a spaced
 * "RESEARCH" label underneath, matching the brand sheet. Reuses <Logo> and
 * <Wordmark> so it re-themes with the rest of the app.
 */
export function ResearchWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Logo className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
      <div className="leading-none">
        <Wordmark className="text-3xl sm:text-4xl" />
        <div className="mt-1.5 font-serif text-[0.6rem] uppercase tracking-[0.42em] text-slate-500 sm:text-xs">
          Research
        </div>
      </div>
    </div>
  );
}
