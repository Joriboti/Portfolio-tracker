import { useId } from "react";

/** TrimmTrack logo mark — a burnt-amber tile with an ascending "track" line. */
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
          id={`${id}-tt`}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f5912f" />
          <stop offset="1" stopColor="#d1550f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}-tt)`} />
      <path
        d="M6 21 L13 13 L18 17 L26 8"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="8" r="2.6" fill="#fff" />
    </svg>
  );
}

/** TrimmTrack wordmark — two-tone, brand-accented. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-semibold tracking-tight text-slate-900 ${className}`}
    >
      Trimm<span className="text-brand-600">Track</span>
    </span>
  );
}
