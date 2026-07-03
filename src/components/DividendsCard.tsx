import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { convert, formatMoney, formatPct, type Currency } from "@/lib/currency";
import type { ComputedDividend, Dividend } from "@/lib/excel-parser";
import { CompanyLogo } from "@/components/CompanyLogo";

// Dividend income card: what the portfolio actually pays. Everything is
// derived client-side from data the dashboard already holds — the computed
// per-ex-date dividends (preferred) or the manual Excel dividend rows as a
// fallback, mirroring how the dashboard's "Dividends" stat picks its source.
// Shows trailing-12-month income + portfolio yield, an income-per-year bar
// chart and a per-ticker breakdown. Hand-rolled SVG, no chart library.

type IncomeEvent = {
  ticker: string;
  /** ISO date, or null for undated manual rows (counted in totals only). */
  date: string | null;
  /** Amount in the display currency. */
  amount: number;
};

function toDisplay(
  amount: number,
  fromCurrency: string | null | undefined,
  display: Currency,
  fxRates: Record<string, number>,
): number {
  if (!fromCurrency || fromCurrency === display) return amount;
  return convert(amount, fromCurrency as Currency, display, fxRates);
}

export function DividendsCard({
  autoDividends,
  manualDividends,
  totalValue,
  currency,
  fxRates,
}: {
  /** Computed dividends (per ex-date), full history including closed names. */
  autoDividends: ComputedDividend[];
  /** Manual dividend rows from the Excel (EUR book values). */
  manualDividends: Dividend[];
  /** Current portfolio market value in the display currency (for the yield). */
  totalValue: number;
  currency: Currency;
  fxRates: Record<string, number>;
}) {
  const { t, i18n } = useTranslation();

  const events = useMemo<IncomeEvent[]>(() => {
    if (autoDividends.length > 0) {
      return autoDividends.map((d) => ({
        ticker: d.ticker,
        date: d.exDate,
        amount: toDisplay(d.total, d.currency, currency, fxRates),
      }));
    }
    // Manual rows are recorded in EUR (the account/book currency).
    return manualDividends.map((d) => ({
      ticker: d.ticker,
      date: d.date,
      amount: toDisplay(d.amount, "EUR", currency, fxRates),
    }));
  }, [autoDividends, manualDividends, currency, fxRates]);

  const stats = useMemo(() => {
    const now = Date.now();
    const yearAgo = now - 365 * 24 * 3600 * 1000;
    let allTime = 0;
    let ttm = 0;
    const byYear = new Map<number, number>();
    const ttmByTicker = new Map<string, number>();
    const allByTicker = new Map<string, number>();
    for (const e of events) {
      if (!Number.isFinite(e.amount) || e.amount <= 0) continue;
      allTime += e.amount;
      allByTicker.set(e.ticker, (allByTicker.get(e.ticker) ?? 0) + e.amount);
      if (!e.date) continue;
      const ts = Date.parse(e.date);
      if (!Number.isFinite(ts)) continue;
      const y = new Date(ts).getFullYear();
      byYear.set(y, (byYear.get(y) ?? 0) + e.amount);
      if (ts >= yearAgo && ts <= now) {
        ttm += e.amount;
        ttmByTicker.set(e.ticker, (ttmByTicker.get(e.ticker) ?? 0) + e.amount);
      }
    }
    // Per-ticker breakdown: trailing 12 months when there is recent income,
    // otherwise the all-time totals (so old imports still show something).
    const usingTtm = ttm > 0;
    const perTicker = [...(usingTtm ? ttmByTicker : allByTicker).entries()]
      .map(([ticker, amount]) => ({ ticker, amount }))
      .sort((a, b) => b.amount - a.amount);
    const perTickerTotal = perTicker.reduce((s, r) => s + r.amount, 0);
    const years = [...byYear.entries()]
      .map(([year, amount]) => ({ year, amount }))
      .sort((a, b) => a.year - b.year);
    return { allTime, ttm, years, perTicker, perTickerTotal, usingTtm };
  }, [events]);

  if (events.length === 0 || stats.allTime <= 0) return null;

  const fmt = (v: number) => formatMoney(v, currency);
  const yieldOnValue = totalValue > 0 && stats.ttm > 0 ? stats.ttm / totalValue : null;
  const nfYear = new Intl.NumberFormat(i18n.language, { useGrouping: false });

  return (
    <section className="card space-y-4">
      <h2 className="text-lg font-medium text-slate-900">{t("dividends.title")}</h2>

      {/* Headline stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("dividends.ttm")}
          </p>
          <p className="text-xl font-semibold text-slate-900">{fmt(stats.ttm)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("dividends.yield")}
          </p>
          <p className="text-xl font-semibold text-slate-900">
            {yieldOnValue != null ? formatPct(yieldOnValue) : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("dividends.allTime")}
          </p>
          <p className="text-xl font-semibold text-slate-900">{fmt(stats.allTime)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Income per year */}
        {stats.years.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("dividends.byYear")}
            </p>
            <YearBars years={stats.years} currency={currency} nfYear={nfYear} />
          </div>
        )}

        {/* Per-ticker breakdown */}
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {stats.usingTtm ? t("dividends.byTicker") : t("dividends.byTickerAll")}
          </p>
          <ul className="divide-y divide-slate-100">
            {stats.perTicker.slice(0, 8).map((r) => {
              const weight = stats.perTickerTotal > 0 ? r.amount / stats.perTickerTotal : 0;
              return (
                <li key={r.ticker} className="flex items-center gap-2 py-1.5 text-sm">
                  <CompanyLogo ticker={r.ticker} size={20} />
                  <span className="font-medium text-slate-800">{r.ticker}</span>
                  <span className="ml-auto tabular-nums text-slate-700">{fmt(r.amount)}</span>
                  <span className="w-14 text-right text-xs tabular-nums text-slate-400">
                    {formatPct(weight)}
                  </span>
                </li>
              );
            })}
          </ul>
          {stats.perTicker.length > 8 && (
            <p className="mt-1 text-xs text-slate-400">
              {t("dividends.more", { count: stats.perTicker.length - 8 })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function YearBars({
  years,
  currency,
  nfYear,
}: {
  years: { year: number; amount: number }[];
  currency: Currency;
  nfYear: Intl.NumberFormat;
}) {
  const W = 360;
  const H = 160;
  const padB = 18;
  const padT = 16;
  const n = years.length;
  const maxV = Math.max(...years.map((y) => y.amount), 1);
  const gap = 8;
  const barW = Math.min(48, (W - gap * (n + 1)) / n);
  const usedW = n * barW + (n + 1) * gap;
  const offX = Math.max(0, (W - usedW) / 2);
  const barH = (v: number) => ((H - padT - padB) * v) / maxV;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" role="img">
      {years.map((y, i) => {
        const h = barH(y.amount);
        const x = offX + gap + i * (barW + gap);
        const top = H - padB - h;
        return (
          <g key={y.year}>
            <rect x={x} y={top} width={barW} height={h} rx={3} fill="#e76b1c" fillOpacity={0.85} />
            <text x={x + barW / 2} y={top - 4} textAnchor="middle" fontSize={9} fill="#475569">
              {formatMoney(y.amount, currency)}
            </text>
            <text x={x + barW / 2} y={H - 5} textAnchor="middle" fontSize={9} fill="#94a3b8">
              {nfYear.format(y.year)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
