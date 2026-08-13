import { useTranslation } from "react-i18next";

// Hand-rolled SVG bar chart for the company dashboard (house style — no chart
// lib, like HistoryChart / DividendsCard). Supports 1–2 series, grouped or
// stacked, negative values (bars hang below the zero line) and per-bar
// <title> tooltips. Labels/series arrive pre-aligned from the caller.

export type BarSeries = {
  name: string;
  /** Any CSS color; tailwind palette hexes look best on the cream cards. */
  color: string;
  values: Array<number | null>;
};

const W = 320;
const H = 130;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;
const PAD_X = 6;

export function QuarterlyBars({
  title,
  labels,
  series,
  stacked = false,
  format,
  negativeColor = "#e11d48",
  onExpand,
  estimate,
  estimateLabel,
}: {
  title: string;
  labels: string[];
  series: BarSeries[];
  stacked?: boolean;
  format: (v: number) => string;
  /** Single-series charts paint below-zero bars this color. */
  negativeColor?: string;
  /** When set, a ⤢ button appears and clicking the card enlarges it. */
  onExpand?: () => void;
  /**
   * Optional analyst consensus for the period after the last bar, drawn as an
   * outlined "ghost" bar so it never reads as reported data. Single-series
   * charts only.
   */
  estimate?: { label: string; value: number } | null;
  /** Word marking the ghost bar as a forecast, e.g. "est." */
  estimateLabel?: string;
}) {
  const { t } = useTranslation();
  const est = series.length === 1 ? (estimate ?? null) : null;
  // The ghost bar occupies a real slot on the x axis, so it widens the grid and
  // participates in the extent — otherwise a consensus above the current high
  // would overflow the plot.
  const n = labels.length + (est ? 1 : 0);
  const hasData = labels.length > 0 && series.some((s) => s.values.some((v) => v != null));
  if (!hasData) return null;

  // Extent across bars (stacked sums positives/negatives separately).
  let min = 0;
  let max = 0;
  if (est) {
    max = Math.max(max, est.value);
    min = Math.min(min, est.value);
  }
  for (let i = 0; i < labels.length; i++) {
    if (stacked) {
      let up = 0;
      let down = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v == null) continue;
        if (v >= 0) up += v;
        else down += v;
      }
      max = Math.max(max, up);
      min = Math.min(min, down);
    } else {
      for (const s of series) {
        const v = s.values[i];
        if (v == null) continue;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
  }
  if (max === min) max = min + 1;

  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * plotH;
  const zeroY = y(0);

  const slot = (W - PAD_X * 2) / n;
  const groupGap = Math.min(6, slot * 0.25);
  const groupW = slot - groupGap;
  const perBarW = stacked || series.length === 1 ? groupW : groupW / series.length;

  // Sparse x labels: aim for ~6, always include first and last. The ghost bar
  // owns the last slot and always labels itself, so real bars only compete for
  // the slots before it.
  const lastReal = labels.length - 1;
  const step = Math.max(1, Math.ceil(n / 6));
  const showLabel = (i: number) =>
    i === lastReal || (i % step === 0 && i < lastReal - step / 2);

  const singleSeries = series.length === 1;

  return (
    <div
      className={`card ${onExpand ? "cursor-zoom-in transition-shadow hover:shadow-card-hover" : ""}`}
      onClick={onExpand}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">{title}</h3>
        <div className="flex items-center gap-2.5 text-[10px] text-slate-500">
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.name} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ background: s.color }}
                />
                {s.name}
              </span>
            ))}
          {est && estimateLabel && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-[2px] border border-dashed"
                style={{ borderColor: series[0].color }}
              />
              {estimateLabel}
            </span>
          )}
          {onExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              className="text-slate-300 hover:text-brand-600"
              aria-label={t("company.expandChart")}
            >
              ⤢
            </button>
          )}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full"
        role="img"
        aria-label={title}
      >
        {/* zero line */}
        <line x1={PAD_X} x2={W - PAD_X} y1={zeroY} y2={zeroY} stroke="#e2e8f0" strokeWidth={1} />
        {labels.map((label, i) => {
          const x0 = PAD_X + i * slot + groupGap / 2;
          let stackUp = 0;
          let stackDown = 0;
          return (
            <g key={`${label}-${i}`}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v == null) return null;
                let bx = x0;
                let bw = perBarW;
                let by: number;
                let bh: number;
                if (stacked && series.length > 1) {
                  if (v >= 0) {
                    by = y(stackUp + v);
                    bh = y(stackUp) - by;
                    stackUp += v;
                  } else {
                    by = y(stackDown);
                    bh = y(stackDown + v) - by;
                    stackDown += v;
                  }
                } else {
                  bx = x0 + (singleSeries ? 0 : si * perBarW);
                  by = v >= 0 ? y(v) : zeroY;
                  bh = Math.abs(y(v) - zeroY);
                }
                const fill = singleSeries && v < 0 ? negativeColor : s.color;
                return (
                  <rect
                    key={s.name}
                    x={bx}
                    y={by}
                    width={Math.max(1, bw - 1)}
                    height={Math.max(0.5, bh)}
                    rx={1.5}
                    fill={fill}
                    opacity={0.9}
                  >
                    <title>{`${label}${series.length > 1 ? ` · ${s.name}` : ""}: ${format(v)}`}</title>
                  </rect>
                );
              })}
              {showLabel(i) && (
                <text
                  x={x0 + groupW / 2}
                  y={H - 5}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill="#94a3b8"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {/* consensus ghost bar: outlined, never filled — reads as "not reported" */}
        {est &&
          (() => {
            const x0 = PAD_X + labels.length * slot + groupGap / 2;
            const by = est.value >= 0 ? y(est.value) : zeroY;
            const bh = Math.abs(y(est.value) - zeroY);
            const color = series[0].color;
            return (
              <g>
                <rect
                  x={x0}
                  y={by}
                  width={Math.max(1, groupW - 1)}
                  height={Math.max(0.5, bh)}
                  rx={1.5}
                  fill={color}
                  fillOpacity={0.12}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="2 1.5"
                >
                  <title>{`${est.label} · ${estimateLabel ?? "est."}: ${format(est.value)}`}</title>
                </rect>
                <text
                  x={x0 + groupW / 2}
                  y={H - 5}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill="#94a3b8"
                >
                  {est.label}
                </text>
              </g>
            );
          })()}
        {/* max marker */}
        <text x={PAD_X} y={9} fontSize={8.5} fill="#94a3b8">
          {format(max)}
        </text>
      </svg>
    </div>
  );
}
