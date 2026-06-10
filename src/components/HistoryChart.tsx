import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPortfolioHistory,
  refreshHistoricalPrices,
  type HistoryPoint,
} from "@/lib/api";
import { convert, formatMoney, type Currency } from "@/lib/currency";

// Weekly portfolio-value vs. net-contributed-capital line chart. Hand-rolled
// SVG (the project deliberately has no chart library — the distribution pie
// is a hand-drawn canvas too). Values arrive in EUR from the API and are
// converted to the display currency with the current FX rates, consistent
// with how the dashboard converts its totals.

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "needs-backfill" }
  | { kind: "empty"; reason?: string }
  | { kind: "ready"; series: HistoryPoint[]; warnings: string[] };

const W = 920;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

function dateToMs(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
}

function formatDateShort(d: string, locale: string): string {
  return new Date(dateToMs(d)).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function HistoryChart({
  userId,
  currency,
  fxRates,
}: {
  userId: string;
  currency: Currency;
  fxRates: Record<string, number>;
}) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [backfilling, setBackfilling] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await getPortfolioHistory(userId);
      if (!res.ok) {
        setState({ kind: "empty", reason: res.reason });
        return;
      }
      if (!res.ready || !res.series || res.series.length < 2) {
        if (res.reason?.includes("historical_prices table")) {
          setState({ kind: "needs-backfill" });
        } else {
          setState({ kind: "empty", reason: res.reason });
        }
        return;
      }
      setState({ kind: "ready", series: res.series, warnings: res.warnings ?? [] });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBackfill = useCallback(async () => {
    if (backfilling) return;
    setBackfilling(true);
    try {
      await refreshHistoricalPrices(userId);
      await load();
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    } finally {
      setBackfilling(false);
    }
  }, [userId, backfilling, load]);

  // EUR → display currency, using the same live FX map the dashboard uses.
  const toDisp = useCallback(
    (v: number) => (currency === "EUR" ? v : convert(v, "EUR", currency, fxRates)),
    [currency, fxRates],
  );

  const chart = useMemo(() => {
    if (state.kind !== "ready") return null;
    const series = state.series;
    const xs = series.map((p) => dateToMs(p.date));
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const xSpan = Math.max(x1 - x0, 1);
    let yMax = 0;
    for (const p of series) {
      yMax = Math.max(yMax, toDisp(p.value), toDisp(p.netCapital));
    }
    if (yMax <= 0) return null;
    yMax *= 1.05;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const px = (ms: number) => PAD.left + ((ms - x0) / xSpan) * plotW;
    const py = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

    const valuePath = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${px(xs[i]).toFixed(1)},${py(toDisp(p.value)).toFixed(1)}`)
      .join("");
    const capitalPath = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${px(xs[i]).toFixed(1)},${py(toDisp(p.netCapital)).toFixed(1)}`)
      .join("");
    // Area under the value line, for a subtle fill.
    const areaPath =
      valuePath +
      `L${px(x1).toFixed(1)},${(PAD.top + plotH).toFixed(1)}` +
      `L${px(x0).toFixed(1)},${(PAD.top + plotH).toFixed(1)}Z`;

    // ~5 y gridlines at round values.
    const yTicks: number[] = [];
    const step = niceStep(yMax / 4);
    for (let v = step; v < yMax; v += step) yTicks.push(v);

    // ~6 x labels.
    const xTicks: Array<{ ms: number; label: string }> = [];
    const n = Math.min(6, series.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.round((i * (series.length - 1)) / Math.max(n - 1, 1));
      xTicks.push({
        ms: xs[idx],
        label: new Date(xs[idx]).toLocaleDateString(i18n.language, {
          month: "short",
          year: "2-digit",
        }),
      });
    }

    return { series, xs, px, py, valuePath, capitalPath, areaPath, yTicks, xTicks, x0, xSpan, plotW };
  }, [state, toDisp, i18n.language]);

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!chart || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const xView = ((e.clientX - rect.left) / rect.width) * W;
      const ms = chart.x0 + ((xView - PAD.left) / chart.plotW) * chart.xSpan;
      // nearest point by date
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < chart.xs.length; i++) {
        const d = Math.abs(chart.xs[i] - ms);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      setHover(best);
    },
    [chart],
  );

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-lg font-medium text-slate-900">{t("history.title")}</h2>
        {state.kind === "ready" && (
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-brand-600" />
              {t("history.valueSeries")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 border-t-2 border-dashed border-slate-400" />
              {t("history.capitalSeries")}
            </span>
          </div>
        )}
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-slate-500 py-8 text-center">{t("common.loading")}</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-rose-600 py-4">
          {t("history.error")}: {state.message}
        </p>
      )}

      {state.kind === "needs-backfill" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-2">{t("history.needsBackfill")}</p>
          <button
            onClick={() => void handleBackfill()}
            disabled={backfilling}
            className="btn-primary text-sm px-4 py-2"
          >
            {backfilling ? t("analytics.backfilling") : t("analytics.runBackfill")}
          </button>
        </div>
      )}

      {state.kind === "empty" && (
        <p className="text-sm text-slate-500 py-8 text-center">{t("history.empty")}</p>
      )}

      {state.kind === "ready" && chart && (
        <>
          {state.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {state.warnings.includes("fx-history-missing")
                ? t("history.fxMissing")
                : t("history.partialHistory")}
            </div>
          )}
          <div className="relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="w-full select-none"
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
            >
              {/* gridlines */}
              {chart.yTicks.map((v) => (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={chart.py(v)}
                    y2={chart.py(v)}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 8}
                    y={chart.py(v) + 3.5}
                    textAnchor="end"
                    fontSize="10"
                    fill="#94a3b8"
                  >
                    {compactMoney(v, currency, i18n.language)}
                  </text>
                </g>
              ))}
              {/* x labels */}
              {chart.xTicks.map((tk, i) => (
                <text
                  key={i}
                  x={chart.px(tk.ms)}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#94a3b8"
                >
                  {tk.label}
                </text>
              ))}
              {/* value area + lines */}
              <path d={chart.areaPath} fill="#0d9488" opacity="0.07" />
              <path d={chart.capitalPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" />
              <path d={chart.valuePath} fill="none" stroke="#0d9488" strokeWidth="2" />
              {/* hover marker */}
              {hover != null && (
                <g>
                  <line
                    x1={chart.px(chart.xs[hover])}
                    x2={chart.px(chart.xs[hover])}
                    y1={PAD.top}
                    y2={H - PAD.bottom}
                    stroke="#cbd5e1"
                    strokeWidth="1"
                  />
                  <circle
                    cx={chart.px(chart.xs[hover])}
                    cy={chart.py(toDisp(chart.series[hover].value))}
                    r="3.5"
                    fill="#0d9488"
                  />
                  <circle
                    cx={chart.px(chart.xs[hover])}
                    cy={chart.py(toDisp(chart.series[hover].netCapital))}
                    r="3"
                    fill="#94a3b8"
                  />
                </g>
              )}
            </svg>
            {hover != null && (
              <ChartTooltip
                point={chart.series[hover]}
                xFrac={(chart.px(chart.xs[hover]) - PAD.left) / chart.plotW}
                currency={currency}
                toDisp={toDisp}
                locale={i18n.language}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ChartTooltip({
  point,
  xFrac,
  currency,
  toDisp,
  locale,
}: {
  point: HistoryPoint;
  xFrac: number;
  currency: Currency;
  toDisp: (v: number) => number;
  locale: string;
}) {
  const { t } = useTranslation();
  const pnl = toDisp(point.pnl);
  // Flip the tooltip side past the midpoint so it never overflows the card.
  const onLeft = xFrac > 0.55;
  const xPct = (PAD.left + xFrac * (W - PAD.left - PAD.right)) / W;
  return (
    <div
      className="absolute top-2 pointer-events-none rounded-lg border border-slate-200 bg-white/95 shadow-md px-3 py-2 text-xs space-y-0.5"
      style={
        onLeft
          ? { right: `${(1 - xPct) * 100 + 1.5}%` }
          : { left: `${xPct * 100 + 1.5}%` }
      }
    >
      <p className="font-medium text-slate-700">{formatDateShort(point.date, locale)}</p>
      <p className="text-slate-600">
        {t("history.valueSeries")}:{" "}
        <span className="font-semibold text-slate-900">
          {formatMoney(toDisp(point.value), currency)}
        </span>
      </p>
      <p className="text-slate-600">
        {t("history.capitalSeries")}:{" "}
        <span className="font-semibold text-slate-900">
          {formatMoney(toDisp(point.netCapital), currency)}
        </span>
      </p>
      <p className="text-slate-600">
        P&L:{" "}
        <span
          className={`font-semibold ${
            pnl > 0 ? "text-brand-700" : pnl < 0 ? "text-rose-600" : "text-slate-900"
          }`}
        >
          {formatMoney(pnl, currency)}
        </span>
      </p>
    </div>
  );
}

// Round a raw step up to 1/2/5 × 10^k so gridline values look natural.
function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const unit = raw / pow;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * pow;
}

// "12 k€"-style compact axis labels.
function compactMoney(v: number, currency: Currency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}
