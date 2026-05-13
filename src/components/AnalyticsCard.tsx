import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  getAnalytics,
  refreshHistoricalPrices,
  type AnalyticsMetrics,
} from "@/lib/api";
import { formatPct } from "@/lib/currency";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "needs-backfill" }
  | { kind: "no-data"; reason?: string }
  | {
      kind: "ready";
      metrics: AnalyticsMetrics;
      includedTickers: string[];
      excludedTickers: string[];
      includedWeight: number;
      benchmark: string;
      riskFreeRate: number;
    };

const DEFAULT_RF = 0.03;

function num(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      {children}
      <span className="ml-1 text-slate-400 cursor-help text-xs">ⓘ</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-64 bg-slate-900 text-white text-xs rounded-md p-2 z-10 shadow-lg whitespace-normal">
        {text}
      </span>
    </span>
  );
}

function Metric({
  label,
  value,
  tooltip,
  tone,
}: {
  label: string;
  value: string;
  tooltip: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const color =
    tone === "positive"
      ? "text-brand-700"
      : tone === "negative"
        ? "text-rose-600"
        : "text-slate-900";
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-xs text-slate-500 uppercase tracking-wide">
        <Tooltip text={tooltip}>{label}</Tooltip>
      </div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function AnalyticsCard({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [rfInput, setRfInput] = useState<string>((DEFAULT_RF * 100).toFixed(1));
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(
    async (rf: number) => {
      setState({ kind: "loading" });
      try {
        const res = await getAnalytics(userId, rf);
        if (!res.ok) {
          setState({ kind: "error", message: res.reason ?? "unknown" });
          return;
        }
        if (!res.ready) {
          if (res.reason?.includes("historical_prices table")) {
            setState({ kind: "needs-backfill" });
          } else {
            setState({ kind: "no-data", reason: res.reason });
          }
          return;
        }
        if (!res.metrics) {
          setState({ kind: "no-data", reason: res.reason });
          return;
        }
        setState({
          kind: "ready",
          metrics: res.metrics,
          includedTickers: res.includedTickers ?? [],
          excludedTickers: res.excludedTickers ?? [],
          includedWeight: res.includedWeight ?? 0,
          benchmark: res.benchmark ?? "^GSPC",
          riskFreeRate: res.riskFreeRate ?? rf,
        });
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    },
    [userId],
  );

  useEffect(() => {
    void load(DEFAULT_RF);
  }, [load]);

  const handleBackfill = useCallback(async () => {
    if (backfilling) return;
    setBackfilling(true);
    try {
      await refreshHistoricalPrices(userId);
      await load(parseFloat(rfInput) / 100);
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    } finally {
      setBackfilling(false);
    }
  }, [userId, rfInput, backfilling, load]);

  const handleRfApply = useCallback(() => {
    const v = parseFloat(rfInput) / 100;
    if (Number.isFinite(v)) void load(v);
  }, [rfInput, load]);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-medium text-slate-900">
          {t("analytics.title")}
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t("analytics.benchmark")}: <strong>S&amp;P 500</strong></span>
          <span>•</span>
          <span>{t("analytics.window")}</span>
        </div>
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-slate-500 py-4">{t("common.loading")}</p>
      )}

      {state.kind === "error" && (
        <div className="text-sm text-rose-700 bg-rose-50 rounded p-3">
          {t("analytics.error")}: {state.message}
        </div>
      )}

      {state.kind === "needs-backfill" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          <p className="mb-2">{t("analytics.needsBackfill")}</p>
          <button
            onClick={() => void handleBackfill()}
            disabled={backfilling}
            className="btn-primary text-sm px-4 py-2"
          >
            {backfilling
              ? t("analytics.backfilling")
              : t("analytics.runBackfill")}
          </button>
        </div>
      )}

      {state.kind === "no-data" && (
        <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600">
          <p className="mb-2">{t("analytics.noData")}</p>
          <button
            onClick={() => void handleBackfill()}
            disabled={backfilling}
            className="btn-ghost text-sm px-3 py-1.5"
          >
            {backfilling
              ? t("analytics.backfilling")
              : t("analytics.runBackfill")}
          </button>
        </div>
      )}

      {state.kind === "ready" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric
              label={t("analytics.beta")}
              value={num(state.metrics.beta, 2)}
              tooltip={t("analytics.tipBeta")}
              tone={state.metrics.beta > 1 ? "negative" : "neutral"}
            />
            <Metric
              label={t("analytics.alpha")}
              value={formatPct(state.metrics.alpha)}
              tooltip={t("analytics.tipAlpha")}
              tone={
                state.metrics.alpha > 0
                  ? "positive"
                  : state.metrics.alpha < 0
                    ? "negative"
                    : "neutral"
              }
            />
            <Metric
              label={t("analytics.sharpe")}
              value={num(state.metrics.sharpe, 2)}
              tooltip={t("analytics.tipSharpe")}
              tone={
                state.metrics.sharpe > 1
                  ? "positive"
                  : state.metrics.sharpe < 0
                    ? "negative"
                    : "neutral"
              }
            />
            <Metric
              label={t("analytics.volatility")}
              value={formatPct(state.metrics.volatility)}
              tooltip={t("analytics.tipVolatility")}
            />
            <Metric
              label={t("analytics.maxDD")}
              value={formatPct(state.metrics.maxDrawdown)}
              tooltip={t("analytics.tipMaxDD")}
              tone="negative"
            />
            <Metric
              label={t("analytics.rSquared")}
              value={num(state.metrics.rSquared * 100, 1) + "%"}
              tooltip={t("analytics.tipRSquared")}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
            <div>
              {t("analytics.portfolioReturn")}:{" "}
              <strong>{formatPct(state.metrics.portfolioAnnualReturn)}</strong>
            </div>
            <div>
              {t("analytics.marketReturn")}:{" "}
              <strong>{formatPct(state.metrics.marketAnnualReturn)}</strong>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <label className="text-xs text-slate-600">
              <span className="block mb-1">{t("analytics.riskFreeLabel")}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="-5"
                  max="20"
                  value={rfInput}
                  onChange={(e) => setRfInput(e.target.value)}
                  className="w-20 px-2 py-1 border border-slate-200 rounded text-sm"
                />
                <span className="text-slate-500">%</span>
                <button
                  onClick={handleRfApply}
                  className="btn-ghost text-xs px-3 py-1"
                >
                  {t("analytics.applyRf")}
                </button>
              </div>
            </label>
            {state.excludedTickers.length > 0 && (
              <div className="text-xs text-slate-500 flex-1 min-w-0">
                <Tooltip text={t("analytics.tipExcluded")}>
                  <span>
                    {t("analytics.excludedCount", {
                      count: state.excludedTickers.length,
                    })}
                  </span>
                </Tooltip>
                : {state.excludedTickers.join(", ")}
              </div>
            )}
          </div>

          <p className="mt-3 text-[11px] text-slate-400 italic">
            {t("analytics.disclaimer", {
              weeks: state.metrics.weeks,
              pct: ((state.includedWeight ?? 0) * 100).toFixed(0),
            })}
          </p>
        </>
      )}
    </section>
  );
}
