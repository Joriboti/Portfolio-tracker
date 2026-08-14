// Hand-rolled SVG line chart (house style — no chart lib, like QuarterlyBars /
// HistoryChart). Takes 1–2 dated series on a shared axis plus optional
// horizontal reference lines, which is what the P/E charts need: a company's
// own rating history read against the market's median and its forward multiple.
//
// Series carry dates, not slots, so two companies whose weeks don't line up
// exactly still land in the right place along x.

export type LineSeries = {
  name: string;
  /** Any CSS color; tailwind palette hexes look best on the cream cards. */
  color: string;
  points: Array<{ date: string; value: number }>;
};

/** A flat line across the plot — a benchmark, not part of the data. */
export type RefLine = {
  label: string;
  value: number;
  color: string;
};

const W = 320;
const H = 150;
const PAD_TOP = 16;
const PAD_BOTTOM = 18;
const PAD_X = 6;

export function TimeSeriesChart({
  title,
  series,
  refLines = [],
  format,
  legend = true,
}: {
  title: string;
  series: LineSeries[];
  refLines?: RefLine[];
  format: (v: number) => string;
  legend?: boolean;
}) {
  const withData = series.filter((s) => s.points.length > 1);
  if (withData.length === 0) return null;

  // One x scale for everything, in time — not in index — so a series with
  // fewer points sits under the right dates instead of being stretched.
  const times = withData.flatMap((s) => s.points.map((p) => Date.parse(p.date)));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const tSpan = t1 - t0 || 1;

  const values = withData.flatMap((s) => s.points.map((p) => p.value));
  // Reference lines take part in the extent, otherwise a median well outside
  // the company's own range would be drawn off the top of the card.
  for (const r of refLines) values.push(r.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
  min -= pad;
  max += pad;

  const x = (ms: number) => PAD_X + ((ms - t0) / tSpan) * (W - PAD_X * 2);
  const y = (v: number) =>
    PAD_TOP + ((max - v) / (max - min || 1)) * (H - PAD_TOP - PAD_BOTTOM);

  const path = (s: LineSeries) =>
    s.points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(Date.parse(p.date)).toFixed(1)},${y(p.value).toFixed(1)}`,
      )
      .join(" ");

  const firstYear = new Date(t0).getFullYear();
  const lastYear = new Date(t1).getFullYear();

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-slate-700">{title}</h3>
        {legend && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {withData.map((s) => (
              <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.name}
                <span className="tabular-nums text-slate-400">
                  {format(s.points[s.points.length - 1].value)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={title}>
        {refLines.map((r) => (
          <g key={r.label}>
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y(r.value)}
              y2={y(r.value)}
              stroke={r.color}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.75}
            />
            <text x={W - PAD_X} y={y(r.value) - 3} textAnchor="end" fontSize={7.5} fill={r.color}>
              {r.label} {format(r.value)}
            </text>
          </g>
        ))}
        {withData.map((s) => (
          <path key={s.name} d={path(s)} fill="none" stroke={s.color} strokeWidth={1.6} />
        ))}
        <text x={PAD_X} y={9} fontSize={8.5} fill="#94a3b8">
          {format(max)}
        </text>
        <text x={PAD_X} y={H - 6} fontSize={8.5} fill="#94a3b8">
          {firstYear}
        </text>
        <text x={W - PAD_X} y={H - 6} textAnchor="end" fontSize={8.5} fill="#94a3b8">
          {lastYear}
        </text>
      </svg>
    </div>
  );
}
