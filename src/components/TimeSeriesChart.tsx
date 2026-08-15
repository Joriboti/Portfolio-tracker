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
/** Vertical room one reference label needs before the next can be written. */
const LABEL_GAP = 9;

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

  // Reference labels sit at the right end of their own line, so two benchmarks
  // that happen to land at a similar multiple print on top of each other —
  // which is exactly when both matter, a company trading at its own median and
  // the market's at once. Nudge each down until it clears the one above. The
  // line itself never moves; only where its label is written.
  const labelYs: number[] = [];
  const ordered = refLines
    .map((r, i) => ({ r, i, y: y(r.value) - 3 }))
    .sort((a, b) => a.y - b.y);
  let floor = -Infinity;
  for (const item of ordered) {
    const at = Math.max(item.y, floor + LABEL_GAP);
    labelYs[item.i] = at;
    floor = at;
  }

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
        {/* Benchmarks under the data — they are the backdrop it is read
            against, not part of it. */}
        {refLines.map((r) => (
          <line
            key={r.label}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={y(r.value)}
            y2={y(r.value)}
            stroke={r.color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.75}
          />
        ))}
        {withData.map((s) => (
          <path key={s.name} d={path(s)} fill="none" stroke={s.color} strokeWidth={1.6} />
        ))}
        {/* Their labels over it, outlined in the card's own colour. A
            company's own median runs through the middle of its data by
            construction, so its label lands on the series every time; drawn
            underneath, it was unreadable. */}
        {refLines.map((r, i) => (
          <text
            key={r.label}
            x={W - PAD_X}
            y={labelYs[i]}
            textAnchor="end"
            fontSize={7.5}
            fill={r.color}
            stroke="#fffdf8"
            strokeWidth={2.4}
            strokeLinejoin="round"
            style={{ paintOrder: "stroke" }}
          >
            {r.label} {format(r.value)}
          </text>
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
