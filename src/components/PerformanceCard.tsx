import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getPerformance,
  refreshHistoricalPrices,
  type YearReturn,
} from "@/lib/api";
import { formatMoney, formatPct, type Currency } from "@/lib/currency";
import type { SinceInception, YearlyBreakdown } from "@/lib/performance";

type ValueState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "needs-backfill" }
  | { kind: "empty"; reason?: string }
  | { kind: "ready"; years: YearReturn[]; firstYear: number | null };

function toneClass(n: number): string {
  return n > 0 ? "text-emerald-600" : n < 0 ? "text-rose-600" : "text-slate-900";
}

export function PerformanceCard({
  userId,
  since,
  yearly,
  currency,
}: {
  userId: string;
  since: SinceInception;
  yearly: YearlyBreakdown[];
  currency: Currency;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<ValueState>({ kind: "loading" });
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(async () => {
    setValue({ kind: "loading" });
    try {
      const res = await getPerformance(userId);
      if (!res.ok) {
        setValue({ kind: "empty", reason: res.reason });
        return;
      }
      if (!res.ready) {
        if (res.reason?.includes("historical_prices table")) {
          setValue({ kind: "needs-backfill" });
        } else {
          setValue({ kind: "empty", reason: res.reason });
        }
        return;
      }
      setValue({
        kind: "ready",
        years: res.years ?? [],
        firstYear: res.firstYear ?? null,
      });
    } catch (e) {
      setValue({ kind: "error", message: (e as Error).message });
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
      setValue({ kind: "error", message: (e as Error).message });
    } finally {
      setBackfilling(false);
    }
  }, [userId, backfilling, load]);

  const valueByYear = useMemo(() => {
    const m = new Map<number, YearReturn>();
    if (value.kind === "ready") for (const y of value.years) m.set(y.year, y);
    return m;
  }, [value]);

  // Union of years from the exact (frontend) and value-based (backend) sources.
  const allYears = useMemo(() => {
    const set = new Set<number>();
    for (const y of yearly) set.add(y.year);
    for (const y of valueByYear.keys()) set.add(y);
    return [...set].sort((a, b) => b - a);
  }, [yearly, valueByYear]);

  const exactByYear = useMemo(() => {
    const m = new Map<number, YearlyBreakdown>();
    for (const y of yearly) m.set(y.year, y);
    return m;
  }, [yearly]);

  return (
    <section className="card overflow-hidden">
      <h2 className="text-lg font-medium text-slate-900 mb-3">
        {t("performance.title")}
      </h2>

      {/* ---- Since inception ---- */}
      <div className="rounded-lg bg-slate-50 p-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {t("performance.totalGain")}
            </p>
            <p className={`mt-1 text-3xl font-semibold ${toneClass(since.totalGain)}`}>
              {formatMoney(since.totalGain, currency)}
            </p>
          </div>
          {since.returnPct != null && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {t("performance.totalReturn")}
              </p>
              <p className={`mt-1 text-2xl font-semibold ${toneClass(since.returnPct)}`}>
                {formatPct(since.returnPct)}
              </p>
            </div>
          )}
          {since.irr != null && (
            <div title={t("performance.irrHint")}>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {t("performance.irr")}
                <span className="ml-1 text-slate-400 cursor-help">ⓘ</span>
              </p>
              <p className={`mt-1 text-2xl font-semibold ${toneClass(since.irr)}`}>
                {formatPct(since.irr)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-sm">
          <Mini label={t("performance.netInvested")} value={formatMoney(since.netInvested, currency)} />
          <Mini label={t("performance.currentValue")} value={formatMoney(since.currentValue, currency)} />
          <Mini label={t("performance.unrealized")} value={formatMoney(since.unrealized, currency)} tone={since.unrealized} />
          <Mini label={t("performance.realized")} value={formatMoney(since.realized, currency)} tone={since.realized} />
          <Mini label={t("performance.dividends")} value={formatMoney(since.dividends, currency)} />
          <Mini label={t("performance.interests")} value={formatMoney(since.interests, currency)} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400 italic">
          {t("performance.sinceHint")}
        </p>
      </div>

      {/* ---- Per year ---- */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h3 className="text-sm font-medium text-slate-700">
            {t("performance.byYear")}
          </h3>
          {value.kind === "ready" && value.firstYear != null && (
            <span className="text-xs text-slate-400">
              {t("performance.valueWindow", { year: value.firstYear })}
            </span>
          )}
        </div>

        {value.kind === "needs-backfill" && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-2">{t("performance.needsBackfill")}</p>
            <button
              onClick={() => void handleBackfill()}
              disabled={backfilling}
              className="btn-primary text-sm px-4 py-2"
            >
              {backfilling ? t("analytics.backfilling") : t("analytics.runBackfill")}
            </button>
          </div>
        )}
        {value.kind === "error" && (
          <p className="mb-3 text-xs text-rose-600">
            {t("performance.valueError")}: {value.message}
          </p>
        )}

        {allYears.length === 0 ? (
          <p className="text-sm text-slate-500">{t("performance.noYears")}</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>{t("performance.yearCol")}</th>
                <th className="text-right">
                  {t("performance.returnCol")}
                </th>
                <th className="text-right">{t("performance.valueGainCol")}</th>
                <th className="text-right">{t("performance.realizedCol")}</th>
              </tr>
            </thead>
            <tbody>
              {allYears.map((year) => {
                const v = valueByYear.get(year);
                const ex = exactByYear.get(year);
                return (
                  <tr key={year}>
                    <td className="font-medium">
                      {year}
                      {v?.partial && (
                        <span className="ml-1 text-[10px] text-slate-400 uppercase">
                          {t("performance.ytd")}
                        </span>
                      )}
                    </td>
                    <td className={`text-right ${v?.returnPct != null ? toneClass(v.returnPct) : ""}`}>
                      {v?.returnPct != null ? formatPct(v.returnPct) : "—"}
                    </td>
                    <td className={`text-right ${v ? toneClass(v.gain) : ""}`}>
                      {v ? formatMoney(v.gain, currency) : "—"}
                    </td>
                    <td className={`text-right ${ex ? toneClass(ex.total) : ""}`}>
                      {ex ? formatMoney(ex.total, currency) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-400 italic">
          {t("performance.byYearHint")}
        </p>
      </div>
    </section>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 font-semibold ${tone != null ? toneClass(tone) : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}
