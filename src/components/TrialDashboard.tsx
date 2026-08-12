import { Fragment, useEffect, useMemo, useState } from "react";
import { LocaleLink } from "@/components/LocaleLink";

import { useTranslation } from "react-i18next";
import { aggregatePositions } from "@/lib/excel-parser";
import { convert, formatMoney, formatPct, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import { getSotpQuotes, getLiveCompany, type SotpLiveQuote, type LiveCompany } from "@/lib/api";
import { ScenarioValuation } from "@/components/ScenarioValuation";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  getTrialTxns,
  clearTrial,
  TRIAL_EVENT,
  TRIAL_MAX_POSITIONS,
  TRIAL_MAX_ROWS,
} from "@/lib/trial";

// Yahoo FX symbols fetched alongside the tickers so we can express every row in
// one display currency (cost basis is EUR; live prices are in each ticker's
// quote currency). Reuses the same `?live=` batch endpoint as SoTP.
const FX_TICKERS = ["EURUSD=X", "GBPUSD=X", "CHFUSD=X"];

// The public, no-account "taste" of the dashboard: positions with live prices,
// P&L and weights, plus the 6 valuation models per holding. Analytics /
// performance / evolution stay behind sign-up (they need server-side history).
export function TrialDashboard() {
  const { t } = useTranslation();
  const { currency } = useDisplayCurrency();
  const [txns, setTxns] = useState(getTrialTxns);
  const [quotes, setQuotes] = useState<Record<string, SotpLiveQuote>>({});
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  // React to trial edits made elsewhere in this tab (Add form, clear).
  useEffect(() => {
    const h = () => setTxns(getTrialTxns());
    window.addEventListener(TRIAL_EVENT, h);
    return () => window.removeEventListener(TRIAL_EVENT, h);
  }, []);

  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.isOpen),
    [txns],
  );

  const tickerKey = useMemo(
    () => positions.map((p) => p.ticker.toUpperCase()).sort().join(","),
    [positions],
  );

  useEffect(() => {
    if (!tickerKey) {
      setQuotes({});
      return;
    }
    let cancelled = false;
    getSotpQuotes([...tickerKey.split(","), ...FX_TICKERS])
      .then((map) => {
        if (cancelled) return;
        const fx: Record<string, number> = {};
        for (const s of FX_TICKERS) {
          const q = map[s];
          if (q?.price != null) fx[s.slice(0, 3)] = q.price; // e.g. EUR → USD price
        }
        setFxRates(fx);
        setQuotes(map);
      })
      .catch(() => {
        if (!cancelled) setQuotes({});
      });
    return () => {
      cancelled = true;
    };
  }, [tickerKey]);

  const rows = useMemo(() => {
    return positions.map((p) => {
      const q = quotes[p.ticker.toUpperCase()];
      const priceQc = q?.price ?? null;
      const qc = (q?.currency ?? "EUR") as Currency;
      // Cost basis is EUR (manual entry + the EUR book); live value is in the
      // ticker's quote currency. Bring both into the display currency.
      const costDisp = convert(p.totalCost, "EUR", currency, fxRates);
      const mvDisp =
        priceQc != null ? convert(priceQc * p.shares, qc, currency, fxRates) : null;
      const pl = mvDisp != null ? mvDisp - costDisp : null;
      const plPct = pl != null && costDisp !== 0 ? pl / costDisp : null;
      return { p, priceQc, qc, costDisp, mvDisp, pl, plPct };
    });
  }, [positions, quotes, fxRates, currency]);

  const totalCost = rows.reduce((s, r) => s + r.costDisp, 0);
  const totalMv = rows.reduce((s, r) => s + (r.mvDisp ?? r.costDisp), 0);
  const totalPl = totalMv - totalCost;
  const fmt = (v: number | null) => formatMoney(v, currency);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      {/* Trial banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3">
        <span className="text-sm text-slate-700">{t("trial.banner")}</span>
        <LocaleLink
          to="/auth/sign-in?next=/dashboard"
          className="btn-primary ml-auto shrink-0 px-3 py-1.5 text-xs"
        >
          {t("trial.signUp")}
        </LocaleLink>
      </div>

      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t("trial.title")}</h1>
        {positions.length > 0 && (
          <button
            onClick={() => clearTrial()}
            className="text-xs text-slate-400 hover:text-rose-500"
          >
            {t("trial.reset")}
          </button>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="card border-dashed text-center">
          <p className="text-slate-600">
            {t("trial.empty", { rows: TRIAL_MAX_ROWS, positions: TRIAL_MAX_POSITIONS })}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <LocaleLink to="/upload" className="btn-primary">
              {t("trial.emptyCta")}
            </LocaleLink>
            <LocaleLink to="/explore" className="btn-ghost">
              {t("home.ctaTry")}
            </LocaleLink>
          </div>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t("dashboard.totalValue")} value={fmt(totalMv)} />
            <Stat label={t("dashboard.totalCost")} value={fmt(totalCost)} />
            <Stat
              label={t("dashboard.totalPL")}
              value={fmt(totalPl)}
              tone={totalPl >= 0 ? "pos" : "neg"}
            />
          </div>

          {/* Positions */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="table-base min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th>{t("dashboard.headers.ticker")}</th>
                  <th className="text-right">{t("dashboard.headers.shares")}</th>
                  <th className="text-right">{t("dashboard.headers.currentPrice")}</th>
                  <th className="text-right">{t("dashboard.headers.marketValue")}</th>
                  <th className="text-right">{t("dashboard.headers.weight")}</th>
                  <th className="text-right">{t("dashboard.headers.pl")}</th>
                  <th className="text-right">{t("dashboard.headers.plPct")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = expanded === r.p.ticker;
                  return (
                    <Fragment key={r.p.ticker}>
                      <tr className="border-t border-slate-100">
                        <td>
                          <span className="flex items-center gap-2">
                            <CompanyLogo ticker={r.p.ticker} size={22} />
                            <span className="font-medium text-slate-800">{r.p.ticker}</span>
                          </span>
                        </td>
                        <td className="text-right tabular-nums">
                          {Number(r.p.shares.toFixed(4)).toLocaleString()}
                        </td>
                        <td className="text-right tabular-nums">
                          {r.priceQc != null ? formatMoney(r.priceQc, r.qc) : "—"}
                        </td>
                        <td className="text-right tabular-nums">{fmt(r.mvDisp)}</td>
                        <td className="text-right tabular-nums text-slate-500">
                          {totalMv > 0 ? formatPct((r.mvDisp ?? r.costDisp) / totalMv) : "—"}
                        </td>
                        <td
                          className={`text-right tabular-nums ${
                            r.pl == null ? "" : r.pl >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {fmt(r.pl)}
                        </td>
                        <td
                          className={`text-right tabular-nums ${
                            r.plPct == null ? "" : r.plPct >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {formatPct(r.plPct)}
                        </td>
                        <td className="text-right">
                          <button
                            className="text-xs font-medium text-brand-700 hover:underline"
                            onClick={() => setExpanded(isOpen ? null : r.p.ticker)}
                          >
                            {isOpen ? t("valuation.title") + " ▲" : t("valuation.title") + " ▾"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50/50 px-3 py-4">
                            <TrialValuation
                              ticker={r.p.ticker}
                              shares={r.p.shares}
                              avgCostEur={r.p.avgCost}
                              currency={currency}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`text-lg font-semibold ${
          tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : "text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// Fetches live fundamentals for the ticker (same path as Explore) so the
// valuation models auto-fill, then renders the ephemeral valuation panel.
function TrialValuation({
  ticker,
  shares,
  avgCostEur,
  currency,
}: {
  ticker: string;
  shares: number;
  avgCostEur: number;
  currency: Currency;
}) {
  const { t } = useTranslation();
  const [company, setCompany] = useState<LiveCompany | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLiveCompany(ticker)
      .then((c) => {
        if (!cancelled) setCompany(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (loading) return <p className="text-xs text-slate-400">{t("explore.loading")}</p>;
  if (!company) return <p className="text-xs text-slate-400">{t("explore.notFound")}</p>;

  return (
    <ScenarioValuation
      userId=""
      ticker={ticker}
      shares={shares}
      avgCostEur={avgCostEur}
      currentPrice={company.price}
      quoteCurrency={company.currency ?? currency}
      fundamentals={company.fundamentals}
      totalPortfolioValueEur={0}
      displayCurrency={currency}
      fxRates={{}}
    />
  );
}
