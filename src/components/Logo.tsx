import { useId } from "react";

/**
 * TrimmTrack logo mark — a painterly orange flourish on a deep petrol tile,
 * an abstract nod to the gestural cover art of Blur's "13".
 */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  const id = useId();
  const swirl = "M8 23 C5 15 12 8 19 11 C25 13.5 22 21 16 19.5";
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
          id={`${id}-bg`}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#173a49" />
          <stop offset="1" stopColor="#0c2029" />
        </linearGradient>
        <linearGradient
          id={`${id}-st`}
          x1="6"
          y1="24"
          x2="24"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#e8590c" />
          <stop offset="0.55" stopColor="#f5912f" />
          <stop offset="1" stopColor="#ffc488" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id}-bg)`} />
      <path
        d={swirl}
        fill="none"
        stroke={`url(#${id}-st)`}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={swirl}
        fill="none"
        stroke="#ffe6c9"
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <circle cx="8" cy="23" r="1.7" fill="#ffd9a8" />
      <circle cx="23.4" cy="9.2" r="1.05" fill="#f5912f" />
      <circle cx="12.4" cy="6.6" r="0.8" fill="#ffc488" />
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
