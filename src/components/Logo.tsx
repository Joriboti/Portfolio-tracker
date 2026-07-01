import { useId } from "react";

/**
 * TrimmTrack logo mark — a pair of open scissors on a deep petrol tile. "Trimm"
 * (trim = cut) made scissors the natural emblem. The blades curve up to fine
 * points and the handles are tilted loops, keeping the brand's orange accent.
 */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  const id = useId();
  // Two rigid halves, each a blade (up to a tip) continuing through the pivot
  // into a neck toward the opposite handle loop — bowed for a real scissor feel.
  const piece1 = "M24 6.6 C 21.4 10, 18.9 13.4, 15.6 17.4 C 13 19.6, 10.6 20.6, 9 21.7";
  const piece2 = "M8 6.9 C 10.6 10.2, 13.1 13.5, 15.6 17.4 C 18.2 19.6, 20.6 20.6, 22.2 21.8";
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
          id={`${id}-blade`}
          x1="7"
          y1="24"
          x2="24"
          y2="6"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#e8590c" />
          <stop offset="0.5" stopColor="#f5912f" />
          <stop offset="1" stopColor="#ffc488" />
        </linearGradient>
      </defs>

      <rect width="32" height="32" rx="8" fill={`url(#${id}-bg)`} />

      {/* Blades + necks (the two crossing halves). */}
      <g
        stroke={`url(#${id}-blade)`}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d={piece1} />
        <path d={piece2} />
      </g>
      {/* Soft highlight down the blades for depth. */}
      <g
        stroke="#ffe6c9"
        strokeWidth="0.7"
        strokeLinecap="round"
        fill="none"
        opacity="0.75"
      >
        <path d="M24 6.6 C 21.4 10, 18.9 13.4, 15.6 17.4" />
        <path d="M8 6.9 C 10.6 10.2, 13.1 13.5, 15.6 17.4" />
      </g>

      {/* Handle loops — tilted ellipses for a rounded, elegant feel. */}
      <g stroke={`url(#${id}-blade)`} strokeWidth="1.9" fill="none">
        <ellipse cx="7.3" cy="24.1" rx="3.1" ry="2.2" transform="rotate(-34 7.3 24.1)" />
        <ellipse cx="23.9" cy="24.2" rx="3.1" ry="2.2" transform="rotate(34 23.9 24.2)" />
      </g>

      {/* Pivot screw. */}
      <circle cx="15.6" cy="17.4" r="2" fill="#0c2029" />
      <circle cx="15.6" cy="17.4" r="1.25" fill="#ffd9a8" />
      <circle cx="15.1" cy="16.9" r="0.4" fill="#fff" opacity="0.9" />
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
