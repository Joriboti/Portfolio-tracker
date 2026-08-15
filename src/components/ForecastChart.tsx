import { useTranslation } from "react-i18next";
import { nextEstimate, type ForecastBar } from "@/lib/estimates";
import { axisLabel, niceTicks, unitFrom } from "@/lib/axis";
import { formatSignedPct } from "@/lib/statements";

// Hand-rolled SVG forecast chart (house style — no chart lib, like
// QuarterlyBars / TimeSeriesChart). Reported periods and expected ones on one
// axis, drawn so a reader can never mistake which is which:
//
//   • a reported period is a solid bar,
//   • an expected one is an outlined bar at the consensus average, with a
//     whisker running from the lowest analyst to the highest,
//   • a dashed line between them marks where the record stops and the opinion
//     starts,
//   • and where a reported period had a consensus, a coloured tick sits at the
//     figure that had been expected — above the bar for a miss, below it for a
//     beat.
//
// The whisker is the point of the whole thing. An average drawn alone is a
// forecast wearing the clothes of a measurement; the spread is what says how
// much of one it is.

const W = 340;
const H = 158;
const PAD_TOP = 16;
const PAD_BOTTOM = 20;
const PAD_X = 7;
/** Left gutter for the value axis — see QuarterlyBars for why it earns it. */
const AXIS_W = 36;

export function ForecastChart({
  title,
  bars,
  color,
  format,
  note,
  onExpand,
}: {
  title: string;
  bars: ForecastBar[];
  /** Any CSS color; tailwind palette hexes look best on the cream cards. */
  color: string;
  format: (v: number) => string;
  /** Currency/basis caption under the chart. */
  note?: string;
  /** When set, a ⤢ button appears and clicking the card enlarges it. */
  onExpand?: () => void;
}) {
  const { t } = useTranslation();
  const n = bars.length;
  const hasEstimate = bars.some((b) => b.estimate != null);
  if (n === 0 || !hasEstimate) return null;

  // Extent over every drawn value, the whiskers included — a high estimate
  // above the tallest reported bar must not run off the top of the plot.
  let min = 0;
  let max = 0;
  for (const b of bars) {
    for (const v of [
      b.actual,
      b.consensus,
      b.estimate?.avg ?? null,
      b.estimate?.low ?? null,
      b.estimate?.high ?? null,
    ]) {
      if (v == null) continue;
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
  }
  if (max === min) max = min + 1;

  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * plotH;
  const zeroY = y(0);
  const ticks = niceTicks(min, max);
  const plotW = W - AXIS_W - PAD_X;
  const slot = plotW / n;
  const gap = Math.min(6, slot * 0.28);
  const barW = slot - gap;
  const center = (i: number) => AXIS_W + i * slot + slot / 2;

  const firstEstimate = bars.findIndex((b) => b.estimate != null);
  const step = Math.max(1, Math.ceil(n / 8));
  const showLabel = (i: number) => n <= 8 || i % step === 0 || i === n - 1;

  const next = nextEstimate(bars)!;
  const analysts = next.estimate?.analysts ?? null;
  const growth = next.estimate?.growth ?? null;

  return (
    <div
      className={`card ${onExpand ? "cursor-zoom-in transition-shadow hover:shadow-card-hover" : ""}`}
      onClick={onExpand}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">{title}</h3>
        <div className="flex items-center gap-2.5 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: color }}
            />
            {t("company.forecast.reported")}
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-[2px] border border-dashed"
              style={{ borderColor: color }}
            />
            {t("company.forecast.estimate")}
          </span>
          {bars.some((b) => b.projected) && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-[2px] border border-dotted opacity-50"
                style={{ borderColor: color }}
              />
              {t("company.forecast.projection")}
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
        {/* value axis: a gridline per round number, labelled in the gutter */}
        {ticks.map((v) => (
          <g key={`tick-${v}`}>
            <line
              x1={AXIS_W}
              x2={W - PAD_X}
              y1={y(v)}
              y2={y(v)}
              stroke="#eef2f7"
              strokeWidth={0.8}
            />
            <text
              x={AXIS_W - 4}
              y={y(v) + 2.6}
              textAnchor="end"
              fontSize={7.5}
              fill="#b6c2d1"
            >
              {axisLabel(v)}
            </text>
          </g>
        ))}
        <line
          x1={AXIS_W}
          x2={W - PAD_X}
          y1={zeroY}
          y2={zeroY}
          stroke="#e2e8f0"
          strokeWidth={1}
        />

        {/* where the record stops and the opinion starts */}
        {firstEstimate > 0 && (
          <line
            x1={AXIS_W + firstEstimate * slot}
            x2={AXIS_W + firstEstimate * slot}
            y1={PAD_TOP - 6}
            y2={H - PAD_BOTTOM + 4}
            stroke="#cbd5e1"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {bars.map((b, i) => {
          const x0 = center(i) - barW / 2;
          const value = b.actual ?? b.estimate?.avg ?? null;
          if (value == null) return null;
          const by = value >= 0 ? y(value) : zeroY;
          const bh = Math.max(0.5, Math.abs(y(value) - zeroY));
          const forecast = b.actual == null;
          const projected = !!b.projected;
          const beat = b.surprise != null && b.surprise >= 0;
          return (
            <g key={`${b.periodEnd}-${i}`}>
              <rect
                x={x0}
                y={by}
                width={Math.max(1, barW)}
                height={bh}
                rx={1.5}
                fill={color}
                fillOpacity={projected ? 0.06 : forecast ? 0.14 : 0.9}
                stroke={forecast ? color : "none"}
                strokeWidth={forecast ? 1 : 0}
                strokeOpacity={projected ? 0.45 : 1}
                strokeDasharray={projected ? "1 2" : forecast ? "2 1.5" : undefined}
              >
                <title>
                  {forecast
                    ? `${b.label} · ${t(
                        projected
                          ? "company.forecast.projection"
                          : "company.forecast.estimate",
                      )}: ${format(value)}${
                        b.estimate?.low != null && b.estimate?.high != null
                          ? ` (${format(b.estimate.low)} – ${format(b.estimate.high)})`
                          : ""
                      }`
                    : `${b.label}: ${format(value)}${
                        b.consensus != null
                          ? ` · ${t("company.forecast.expected")} ${format(b.consensus)}${
                              b.surprise != null
                                ? ` (${formatSignedPct(b.surprise)})`
                                : ""
                            }`
                          : ""
                      }`}
                </title>
              </rect>

              {/* the spread between the lowest and the highest analyst */}
              {forecast && b.estimate?.low != null && b.estimate?.high != null && (
                <g stroke={color} strokeOpacity={0.75} strokeWidth={1}>
                  <line
                    x1={center(i)}
                    x2={center(i)}
                    y1={y(b.estimate.high)}
                    y2={y(b.estimate.low)}
                  />
                  <line
                    x1={center(i) - 3}
                    x2={center(i) + 3}
                    y1={y(b.estimate.high)}
                    y2={y(b.estimate.high)}
                  />
                  <line
                    x1={center(i) - 3}
                    x2={center(i) + 3}
                    y1={y(b.estimate.low)}
                    y2={y(b.estimate.low)}
                  />
                </g>
              )}

              {/* what had been expected of a period that has since reported */}
              {!forecast && b.consensus != null && (
                <line
                  x1={x0 - 1}
                  x2={x0 + barW + 1}
                  y1={y(b.consensus)}
                  y2={y(b.consensus)}
                  stroke={beat ? "#059669" : "#e11d48"}
                  strokeWidth={1.4}
                />
              )}

              {showLabel(i) && (
                <text
                  x={center(i)}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={8.5}
                  fill={projected ? "#e2e8f0" : forecast ? "#cbd5e1" : "#94a3b8"}
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* The unit the axis numbers are in, stated once. */}
        {unitFrom(format) && (
          <text x={2} y={8} fontSize={7.5} fill="#b6c2d1">
            {unitFrom(format)}
          </text>
        )}
      </svg>

      <p className="mt-0.5 text-[11px] text-slate-400">
        {analysts != null
          ? t("company.forecast.analysts", { count: analysts, period: next.label })
          : t("company.forecast.consensusOn", { period: next.label })}
        {growth != null && (
          <span className={growth >= 0 ? "text-emerald-600" : "text-rose-600"}>
            {" · "}
            {formatSignedPct(growth)} {t("company.forecast.yoy")}
          </span>
        )}
        {note && ` · ${note}`}
      </p>
    </div>
  );
}
