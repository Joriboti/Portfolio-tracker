import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  aggregatePositions,
  computeAutoDividends,
  computeRealizedPLByYear,
  type Position,
  type ComputedDividend,
  type YearlyPL,
} from "@/lib/excel-parser";
import { convert, formatMoney, formatPct, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import {
  getPortfolio,
  getPrices,
  refreshPrices,
  refreshDividends,
  getFundamentals,
  refreshFundamentals,
  appendHoldings,
  type PriceQuote,
  type Fundamentals,
} from "@/lib/api";
import {
  computeSinceInception,
  computeYearlyBreakdown,
} from "@/lib/performance";
import { useUser } from "@/hooks/useUser";
import { TrialDashboard } from "@/components/TrialDashboard";
import { hasTrial, getTrialTxns, clearTrial } from "@/lib/trial";
import { PieChartModal } from "@/components/PieChartModal";
import { AnalyticsCard } from "@/components/AnalyticsCard";
import { PerformanceCard } from "@/components/PerformanceCard";
import { DividendsCard } from "@/components/DividendsCard";
import { HistoryChart } from "@/components/HistoryChart";
import { ScenarioValuation } from "@/components/ScenarioValuation";
import { CompanyLogo } from "@/components/CompanyLogo";

type DashboardData = Awaited<ReturnType<typeof getPortfolio>>;

// Convert an amount from a position's source currency to the user's
// display currency. The transactions in the source Excel are recorded in
// the listing currency of each ticker (USD for HIMS, EUR for IAG.MC, …),
// so we lean on the latest Yahoo quote's currency as the source for both
// cost basis and current price. Without this every USD-listed position
// gets summed in EUR as if no FX existed.
function toDisplay(
  amount: number,
  fromCurrency: string | null | undefined,
  display: Currency,
  fxRates: Record<string, number>,
): number {
  if (!fromCurrency || fromCurrency === display) return amount;
  return convert(amount, fromCurrency as Currency, display, fxRates);
}

function DashboardInner() {
  const { t } = useTranslation();
  const { currency } = useDisplayCurrency();
  const { user } = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [quotes, setQuotes] = useState<Record<string, PriceQuote>>({});
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showPie, setShowPie] = useState(false);
  const [fundamentals, setFundamentals] = useState<Record<string, Fundamentals>>({});
  const [fundRefreshing, setFundRefreshing] = useState(false);
  // Client-side "portfolio deconstructor": experimentally remove holdings from
  // the view (a ✕ on each row) with an undo stack — like Word — to bring them
  // back. Purely local, never touches the DB, so the user can play with
  // allocations mixing the Excel import and manually-added holdings. The stack
  // is ordered oldest→newest so undo pops the most recent removal.
  const [removed, setRemoved] = useState<string[]>([]);

  async function handleRefresh() {
    if (!user || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshPrices(user.id),
        refreshDividends(user.id),
      ]);
      const [priceRes, portfolioRes] = await Promise.all([
        getPrices(openPositions.map((p) => p.ticker)),
        getPortfolio(user.id),
      ]);
      const map: Record<string, PriceQuote> = {};
      for (const q of priceRes.quotes) map[q.ticker] = q;
      setQuotes(map);
      setFxRates(priceRes.fxRates);
      setData(portfolioRes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    getPortfolio(user.id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setData({
          transactions: [],
          dividends: [],
          interests: [],
          wealth: [],
          dividendEvents: [],
          lastPriceUpdate: null,
        });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Everything downstream is derived from `visibleData` — `data` with the
  // deconstructor's removed tickers filtered out of every ticker-scoped table
  // (transactions, dividends, dividend events). Interests/wealth aren't
  // ticker-scoped so they pass through untouched. When nothing is removed this
  // is the identity, so there's zero overhead in the common case.
  const removedSet = useMemo(() => new Set(removed), [removed]);
  const visibleData = useMemo(() => {
    if (!data) return null;
    if (removedSet.size === 0) return data;
    return {
      ...data,
      transactions: data.transactions.filter((tx) => !removedSet.has(tx.ticker)),
      dividends: data.dividends.filter((d) => !removedSet.has(d.ticker)),
      dividendEvents: data.dividendEvents.filter(
        (e) => !removedSet.has(e.ticker),
      ),
    };
  }, [data, removedSet]);

  const allPositions = useMemo(
    () => (visibleData ? aggregatePositions(visibleData.transactions) : []),
    [visibleData],
  );
  const openPositions = useMemo(
    () => allPositions.filter((p) => p.isOpen),
    [allPositions],
  );
  const closedPositions = useMemo(
    () => allPositions.filter((p) => !p.isOpen),
    [allPositions],
  );

  const autoDividends = useMemo(
    () =>
      visibleData
        ? computeAutoDividends(
            visibleData.transactions,
            visibleData.dividendEvents,
          )
        : [],
    [visibleData],
  );

  const openTickers = useMemo(
    () => new Set(openPositions.map((p) => p.ticker)),
    [openPositions],
  );

  const openAutoDividends = useMemo(
    () => autoDividends.filter((d) => openTickers.has(d.ticker)),
    [autoDividends, openTickers],
  );

  const autoDividendsTotal = useMemo(() => {
    let total = 0;
    for (const d of openAutoDividends) {
      total += toDisplay(d.total, d.currency, currency, fxRates);
    }
    return total;
  }, [openAutoDividends, currency, fxRates]);

  const yearlyPL = useMemo(
    () => (visibleData ? computeRealizedPLByYear(visibleData.transactions) : []),
    [visibleData],
  );

  const yearlyBreakdown = useMemo(
    () =>
      visibleData
        ? computeYearlyBreakdown(
            visibleData.transactions,
            visibleData.dividends,
            visibleData.interests,
          )
        : [],
    [visibleData],
  );

  useEffect(() => {
    if (openPositions.length === 0) return;
    const tickers = openPositions.map((p) => p.ticker);
    getPrices(tickers)
      .then(({ quotes, fxRates }) => {
        const map: Record<string, PriceQuote> = {};
        for (const q of quotes) map[q.ticker] = q;
        setQuotes(map);
        setFxRates(fxRates);
      })
      .catch(() => {
        setQuotes({});
        setFxRates({});
      });
    // Cached fundamentals (PER, P/B, …). Missing table / no rows → empty map,
    // the PER card shows its "no data" state.
    getFundamentals(tickers)
      .then(setFundamentals)
      .catch(() => setFundamentals({}));
  }, [openPositions]);

  async function handleFundamentalsRefresh() {
    if (!user || fundRefreshing) return;
    setFundRefreshing(true);
    try {
      // The server refreshes stale-first within a time budget; `exhausted`
      // means more tickers are pending, so keep going (bounded) until done.
      for (let i = 0; i < 3; i++) {
        const r = await refreshFundamentals(user.id);
        if (!r.exhausted) break;
      }
      setFundamentals(
        await getFundamentals(openPositions.map((p) => p.ticker)),
      );
    } catch {
      /* per-ticker errors are already tolerated server-side; keep the UI calm */
    } finally {
      setFundRefreshing(false);
    }
  }

  // Weighted harmonic mean PER over open positions with a valid trailing PE:
  // PER = Σ(value_i) / Σ(value_i / PE_i). The only aggregation that is
  // mathematically consistent for P/E ratios (an arithmetic mean of PERs
  // overweights expensive stocks). Coverage = share of portfolio value the
  // calculation actually represents (crypto / no-earnings tickers excluded).
  const perStats = useMemo(() => {
    let totalValue = 0;
    let coveredValue = 0;
    let invSum = 0;
    const uncovered: string[] = [];
    for (const p of openPositions) {
      const quote = quotes[p.ticker];
      if (!quote) continue;
      const v =
        toDisplay(quote.price, quote.currency ?? null, currency, fxRates) *
        p.shares;
      if (v <= 0) continue;
      totalValue += v;
      const pe = fundamentals[p.ticker]?.trailingPe;
      if (pe != null && pe > 0) {
        coveredValue += v;
        invSum += v / pe;
      } else {
        uncovered.push(p.ticker);
      }
    }
    if (invSum <= 0 || totalValue <= 0) return null;
    return {
      per: coveredValue / invSum,
      coverage: coveredValue / totalValue,
      uncovered,
    };
  }, [openPositions, quotes, fundamentals, currency, fxRates]);

  const fundamentalsUpdatedAt = useMemo(() => {
    let latest: string | null = null;
    for (const f of Object.values(fundamentals)) {
      if (f.updatedAt && (!latest || f.updatedAt > latest)) latest = f.updatedAt;
    }
    return latest;
  }, [fundamentals]);

  // Deconstructor controls.
  function removePosition(ticker: string) {
    setRemoved((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]));
  }
  function restorePosition(ticker: string) {
    setRemoved((prev) => prev.filter((tk) => tk !== ticker));
  }
  function undoRemove() {
    setRemoved((prev) => prev.slice(0, -1));
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">{t("common.loading")}</div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card border-rose-200 bg-rose-50 text-rose-900 text-sm whitespace-pre-wrap">
          {error}
        </div>
      </div>
    );
  }

  // Empty state keys off the *raw* portfolio: if the user has genuinely no
  // transactions, prompt them to build one. If they've merely deconstructed
  // every holding away (removed.length > 0), stay on the dashboard so the undo
  // banner remains reachable.
  if (!data || (data.transactions.length === 0 && removed.length === 0)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="card text-center">
          <p className="text-slate-700">{t("dashboard.noPositions")}</p>
          <Link to="/upload" className="btn-primary mt-4 inline-flex">
            {t("nav.upload")}
          </Link>
        </div>
      </div>
    );
  }

  const manualDividendsTotal = (visibleData?.dividends ?? []).reduce(
    (s, d) => s + d.amount,
    0,
  );
  const totalDividends =
    openAutoDividends.length > 0 ? autoDividendsTotal : manualDividendsTotal;

  const realizedPL = allPositions.reduce((s, p) => s + p.realizedPL, 0);

  let totalValue = 0;
  let totalCost = 0;
  for (const p of openPositions) {
    const quote = quotes[p.ticker];
    if (quote) {
      const priceInDisplay = toDisplay(
        quote.price,
        quote.currency ?? null,
        currency,
        fxRates,
      );
      totalValue += priceInDisplay * p.shares;
    }
    totalCost += p.totalCost;
  }
  const unrealized = totalValue > 0 ? totalValue - totalCost : 0;

  const since = computeSinceInception({
    txns: visibleData?.transactions ?? [],
    dividends: visibleData?.dividends ?? [],
    interests: visibleData?.interests ?? [],
    currentValue: totalValue,
    openCost: totalCost,
    realized: realizedPL,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("dashboard.title")}
        </h1>
        <div className="flex items-center gap-3">
          {data.lastPriceUpdate && (
            <p className="text-xs text-slate-500">
              {t("dashboard.lastUpdated", {
                when: new Date(data.lastPriceUpdate).toLocaleString(),
              })}
            </p>
          )}
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            {refreshing ? t("common.loading") : t("dashboard.refresh")}
          </button>
        </div>
      </header>

      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/70 px-4 py-2.5 text-sm text-slate-700">
          <button
            onClick={undoRemove}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-50"
            title={t("dashboard.deconstruct.undo")}
          >
            <span aria-hidden>↩</span> {t("dashboard.deconstruct.undo")}
          </button>
          <span className="text-slate-500">
            {t("dashboard.deconstruct.removedLabel")}
          </span>
          {removed.map((tk) => (
            <button
              key={tk}
              onClick={() => restorePosition(tk)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700"
              title={t("dashboard.deconstruct.restore", { ticker: tk })}
            >
              {tk} <span aria-hidden>＋</span>
            </button>
          ))}
        </div>
      )}

      {openPositions.length > 0 &&
        openPositions.some((p) => !quotes[p.ticker]) && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            <span>⚠</span>
            <span>
              {t("dashboard.missingPrices")}{" "}
              <button
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="underline font-medium hover:text-amber-900"
              >
                {t("dashboard.refresh")}
              </button>
            </span>
          </div>
        )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label={t("dashboard.totalValue")} value={formatMoney(totalValue, currency)} />
        <Stat label={t("dashboard.totalCost")} value={formatMoney(totalCost, currency)} />
        <Stat
          label={t("dashboard.totalPL")}
          value={formatMoney(unrealized, currency)}
          positive={unrealized > 0}
          negative={unrealized < 0}
        />
        <Stat
          label={t("dashboard.realizedPL")}
          value={formatMoney(realizedPL, currency)}
          positive={realizedPL > 0}
          negative={realizedPL < 0}
        />
        <Stat label={t("dashboard.dividends")} value={formatMoney(totalDividends, currency)} />
        <PerStat
          perStats={perStats}
          refreshing={fundRefreshing}
          onRefresh={() => void handleFundamentalsRefresh()}
        />
      </section>

      {user && (
        <HistoryChart userId={user.id} currency={currency} fxRates={fxRates} />
      )}

      {user && (
        <PerformanceCard
          userId={user.id}
          since={since}
          yearly={yearlyBreakdown}
          currency={currency}
        />
      )}

      <DividendsCard
        autoDividends={autoDividends}
        manualDividends={visibleData?.dividends ?? []}
        totalValue={totalValue}
        currency={currency}
        fxRates={fxRates}
      />

      {openPositions.length > 0 && (
        <section className="card overflow-x-auto">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="text-lg font-medium text-slate-900">
              {t("dashboard.positions")}
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              {fundamentalsUpdatedAt && (
                <span className="text-xs text-slate-400">
                  {t("fundamentals.updated", {
                    when: new Date(fundamentalsUpdatedAt).toLocaleDateString(),
                  })}
                </span>
              )}
              <button
                onClick={() => void handleFundamentalsRefresh()}
                disabled={fundRefreshing}
                className="btn-ghost text-xs px-3 py-1.5"
              >
                {fundRefreshing
                  ? t("fundamentals.refreshing")
                  : t("fundamentals.refresh")}
              </button>
              <button
                onClick={() => setShowPie(true)}
                className="btn-ghost text-xs px-3 py-1.5"
              >
                {t("dashboard.pieButton")}
              </button>
            </div>
          </div>
          <PositionsTable
            positions={openPositions}
            quotes={quotes}
            currency={currency}
            fxRates={fxRates}
            fundamentals={fundamentals}
            userId={user?.id ?? null}
            totalPortfolioValue={totalValue}
            onRemove={removePosition}
          />
        </section>
      )}

      {showPie && (
        <PieChartModal
          positions={openPositions}
          quotes={quotes}
          currency={currency}
          fxRates={fxRates}
          fundamentals={fundamentals}
          onClose={() => setShowPie(false)}
        />
      )}

      {closedPositions.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-lg font-medium text-slate-900 mb-3">
            {t("dashboard.closedPositions")}
          </h2>
          {yearlyPL.length > 0 && (
            <YearSelector
              yearlyPL={yearlyPL}
              selectedYear={selectedYear}
              onSelect={setSelectedYear}
              currency={currency}
            />
          )}
          <ClosedPositionsTable
            positions={closedPositions}
            allPositions={allPositions}
            currency={currency}
            yearlyPL={yearlyPL}
            selectedYear={selectedYear}
          />
        </section>
      )}

      {openPositions.length > 0 && user && <AnalyticsCard userId={user.id} />}

      {openAutoDividends.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-lg font-medium text-slate-900 mb-3">
            {t("dashboard.dividendsSection")}
          </h2>
          <DividendsTable
            dividends={openAutoDividends}
            positions={openPositions}
            currency={currency}
            fxRates={fxRates}
          />
        </section>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user, isPending } = useUser();
  const [carrying, setCarrying] = useState(false);

  // Carry an anonymous trial portfolio into the account on first sign-in, then
  // refresh prices so the real dashboard is populated immediately.
  useEffect(() => {
    if (!user || !hasTrial()) return;
    setCarrying(true);
    const txns = getTrialTxns();
    appendHoldings(user.id, txns)
      .then(() => refreshPrices(user.id).catch(() => {}))
      .catch(() => {})
      .finally(() => {
        clearTrial();
        setCarrying(false);
      });
  }, [user]);

  if (isPending || carrying) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-slate-500">
        {t("common.loading")}
      </div>
    );
  }
  // No account → the public trial dashboard. Signed in → the real thing.
  return user ? <DashboardInner /> : <TrialDashboard />;
}

function Stat({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold ${
          positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// Summary card for the portfolio's weighted harmonic mean PER, with the
// share of portfolio value the figure covers. Empty state doubles as the
// call-to-action to fill the fundamentals cache.
function PerStat({
  perStats,
  refreshing,
  onRefresh,
}: {
  perStats: { per: number; coverage: number; uncovered: string[] } | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="card">
      <p
        className="text-xs uppercase tracking-wide text-slate-500"
        title={t("fundamentals.perCardHint")}
      >
        {t("fundamentals.perCard")} ⓘ
      </p>
      {perStats ? (
        <>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {new Intl.NumberFormat(i18n.language, {
              maximumFractionDigits: 1,
            }).format(perStats.per)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {t("fundamentals.coverage", {
              pct: Math.round(perStats.coverage * 100),
            })}
          </p>
          {perStats.uncovered.length > 0 && (
            <p
              className="mt-0.5 text-[11px] text-slate-400"
              title={perStats.uncovered.join(", ")}
            >
              {t("fundamentals.uncovered", {
                count: perStats.uncovered.length,
                tickers: perStats.uncovered.slice(0, 4).join(", "),
                more:
                  perStats.uncovered.length > 4
                    ? ` +${perStats.uncovered.length - 4}`
                    : "",
              })}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-400">
            {t("fundamentals.noData")}
          </p>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="mt-1 text-xs text-brand-700 underline disabled:text-slate-400"
          >
            {refreshing
              ? t("fundamentals.refreshing")
              : t("fundamentals.refresh")}
          </button>
        </>
      )}
    </div>
  );
}

type SortKey =
  | "ticker"
  | "shares"
  | "avgCost"
  | "price"
  | "value"
  | "weight"
  | "cost"
  | "pl"
  | "plPct";

// Clickable, sort-aware table header. Shows a neutral ↕ until active, then the
// current direction. Keeps the open-positions table sortable by any column.
function SortTh({
  label,
  k,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      className={`cursor-pointer select-none whitespace-nowrap hover:text-slate-900 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {label}
      <span className="ml-0.5 text-[10px] text-slate-400">
        {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}

function PositionsTable({
  positions,
  quotes,
  currency,
  fxRates,
  fundamentals,
  userId,
  totalPortfolioValue,
  onRemove,
}: {
  positions: Position[];
  quotes: Record<string, PriceQuote>;
  currency: Currency;
  fxRates: Record<string, number>;
  fundamentals: Record<string, Fundamentals>;
  userId: string | null;
  totalPortfolioValue: number;
  onRemove: (ticker: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Default to biggest-position-first; click any header to re-sort.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "value",
    dir: "desc",
  });

  const rows = useMemo(() => {
    const mapped = positions.map((p) => {
      const quote = quotes[p.ticker];
      // Cost basis is already in the user's account currency (EUR);
      // only the live Yahoo price needs FX conversion.
      const currentPriceDisp = quote
        ? toDisplay(quote.price, quote.currency ?? null, currency, fxRates)
        : null;
      const marketValue =
        currentPriceDisp != null ? currentPriceDisp * p.shares : null;
      const pl = marketValue != null ? marketValue - p.totalCost : null;
      const plPct = pl != null && p.totalCost > 0 ? pl / p.totalCost : null;
      const weight =
        marketValue != null && totalPortfolioValue > 0
          ? marketValue / totalPortfolioValue
          : null;
      return {
        p,
        quote,
        fund: fundamentals[p.ticker],
        currentPriceDisp,
        marketValue,
        pl,
        plPct,
        weight,
      };
    });
    const key = (r: (typeof mapped)[number]): number | string => {
      switch (sort.key) {
        case "ticker":
          return r.p.ticker;
        case "shares":
          return r.p.shares;
        case "avgCost":
          return r.p.avgCost;
        case "price":
          return r.currentPriceDisp ?? -Infinity;
        case "value":
          return r.marketValue ?? -Infinity;
        case "weight":
          return r.weight ?? -Infinity;
        case "cost":
          return r.p.totalCost;
        case "pl":
          return r.pl ?? -Infinity;
        case "plPct":
          return r.plPct ?? -Infinity;
      }
    };
    mapped.sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : (av as number) - (bv as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return mapped;
  }, [positions, quotes, fundamentals, currency, fxRates, totalPortfolioValue, sort]);

  function toggleSort(k: SortKey) {
    setSort((s) =>
      s.key === k
        ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: k, dir: k === "ticker" ? "asc" : "desc" },
    );
  }

  return (
    <table className="table-base">
      <thead>
        <tr>
          <SortTh label={t("dashboard.headers.ticker")} k="ticker" align="left" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.shares")} k="shares" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.avgCost")} k="avgCost" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.currentPrice")} k="price" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.marketValue")} k="value" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.weight")} k="weight" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.cost")} k="cost" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.pl")} k="pl" sort={sort} onSort={toggleSort} />
          <SortTh label={t("dashboard.headers.plPct")} k="plPct" sort={sort} onSort={toggleSort} />
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { p, quote, fund, currentPriceDisp, marketValue, pl, plPct, weight } =
            row;
          const isExpanded = expanded === p.ticker;
          return (
            <Fragment key={p.ticker}>
              <tr
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => setExpanded(isExpanded ? null : p.ticker)}
              >
                <td className="font-medium">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 text-slate-400">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                    <CompanyLogo ticker={p.ticker} website={fund?.website} size={24} />
                    <span>{p.ticker}</span>
                  </div>
                </td>
                <td className="text-right">{p.shares.toFixed(4)}</td>
                <td className="text-right">{formatMoney(p.avgCost, currency)}</td>
                <td className="text-right">
                  {currentPriceDisp != null
                    ? formatMoney(currentPriceDisp, currency)
                    : "—"}
                </td>
                <td className="text-right">{formatMoney(marketValue, currency)}</td>
                <td className="text-right text-slate-500">{formatPct(weight)}</td>
                <td className="text-right">{formatMoney(p.totalCost, currency)}</td>
                <td
                  className={`text-right ${
                    pl == null
                      ? ""
                      : pl > 0
                        ? "text-emerald-600"
                        : pl < 0
                          ? "text-rose-600"
                          : ""
                  }`}
                >
                  {formatMoney(pl, currency)}
                </td>
                <td
                  className={`text-right ${
                    plPct == null
                      ? ""
                      : plPct > 0
                        ? "text-emerald-600"
                        : plPct < 0
                          ? "text-rose-600"
                          : ""
                  }`}
                >
                  {formatPct(plPct)}
                </td>
                <td className="text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(p.ticker);
                    }}
                    className="text-slate-300 hover:text-rose-600 px-1 text-base leading-none"
                    title={t("dashboard.deconstruct.remove", { ticker: p.ticker })}
                    aria-label={t("dashboard.deconstruct.remove", {
                      ticker: p.ticker,
                    })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
              {isExpanded && (
                <tr className="bg-slate-50/70">
                  <td colSpan={10} className="px-4 py-3">
                    <div className="space-y-5">
                      <FundamentalsDetail
                        fund={fund}
                        // Yield on cost: estimated annual dividends (yield ×
                        // current price × shares) over the FIFO cost basis of
                        // the open position.
                        yieldOnCost={
                          fund?.dividendYield != null &&
                          currentPriceDisp != null &&
                          p.totalCost > 0
                            ? (fund.dividendYield * currentPriceDisp * p.shares) /
                              p.totalCost
                            : null
                        }
                      />
                      {userId && (
                        <div className="border-t border-slate-200 pt-4">
                          <ScenarioValuation
                            userId={userId}
                            ticker={p.ticker}
                            shares={p.shares}
                            avgCostEur={p.avgCost}
                            currentPrice={quote ? quote.price : null}
                            quoteCurrency={quote?.currency ?? currency}
                            fundamentals={fund}
                            totalPortfolioValueEur={totalPortfolioValue}
                            displayCurrency={currency}
                            fxRates={fxRates}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function FundamentalsDetail({
  fund,
  yieldOnCost,
}: {
  fund: Fundamentals | undefined;
  yieldOnCost: number | null;
}) {
  const { t, i18n } = useTranslation();
  if (!fund) {
    return <p className="text-xs text-slate-400">{t("fundamentals.noneForTicker")}</p>;
  }
  const nf = (v: number | null, digits = 1): string =>
    v == null
      ? "—"
      : new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: digits,
        }).format(v);
  const metrics: Array<{ label: string; value: string }> = [
    { label: t("fundamentals.per"), value: nf(fund.trailingPe) },
    { label: t("fundamentals.forwardPe"), value: nf(fund.forwardPe) },
    { label: t("fundamentals.priceToBook"), value: nf(fund.priceToBook, 2) },
    { label: t("fundamentals.roe"), value: formatPct(fund.roe) },
    { label: t("fundamentals.margin"), value: formatPct(fund.profitMargin) },
    {
      label: t("fundamentals.debtToEquity"),
      // Yahoo reports D/E as a percentage-style number (e.g. 41.2); shown
      // here as the conventional ratio (0.41).
      value: fund.debtToEquity == null ? "—" : nf(fund.debtToEquity / 100, 2),
    },
    { label: t("fundamentals.yield"), value: formatPct(fund.dividendYield) },
    { label: t("fundamentals.yieldOnCost"), value: formatPct(yieldOnCost) },
    {
      label: t("fundamentals.marketCap"),
      value:
        fund.marketCap == null
          ? "—"
          : new Intl.NumberFormat(i18n.language, {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(fund.marketCap) + (fund.currency ? ` ${fund.currency}` : ""),
    },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label}>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {m.label}
            </p>
            <p className="text-sm font-medium text-slate-800">{m.value}</p>
          </div>
        ))}
      </div>
      {(fund.sector || fund.industry) && (
        <p className="mt-2 text-xs text-slate-400">
          {[fund.sector, fund.industry].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

function YearSelector({
  yearlyPL,
  selectedYear,
  onSelect,
  currency,
}: {
  yearlyPL: YearlyPL[];
  selectedYear: number | null;
  onSelect: (year: number | null) => void;
  currency: Currency;
}) {
  const { t } = useTranslation();
  const activeData = selectedYear
    ? yearlyPL.find((y) => y.year === selectedYear)
    : null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button
          onClick={() => onSelect(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedYear === null
              ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {t("dashboard.yearAll")}
        </button>
        {yearlyPL.map((y) => (
          <button
            key={y.year}
            onClick={() => onSelect(y.year === selectedYear ? null : y.year)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedYear === y.year
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {y.year}
          </button>
        ))}
      </div>
      {activeData && (
        <p className={`text-sm font-semibold ${
          activeData.total > 0 ? "text-emerald-600" : activeData.total < 0 ? "text-rose-600" : "text-slate-900"
        }`}>
          {t("dashboard.yearPL", { year: activeData.year })}:{" "}
          {formatMoney(activeData.total, currency)}
        </p>
      )}
    </div>
  );
}

function ClosedPositionsTable({
  positions,
  allPositions,
  currency,
  yearlyPL,
  selectedYear,
}: {
  positions: Position[];
  allPositions: Position[];
  currency: Currency;
  yearlyPL?: YearlyPL[];
  selectedYear?: number | null;
}) {
  const { t } = useTranslation();

  const activeYearData = selectedYear
    ? yearlyPL?.find((y) => y.year === selectedYear)
    : null;

  const rows = useMemo(() => {
    if (!activeYearData) {
      return [...positions]
        .sort((a, b) => Math.abs(b.realizedPL) - Math.abs(a.realizedPL))
        .map((p) => ({
          ticker: p.ticker,
          avgCost: p.historicalAvgCost || p.avgCost,
          pl: p.realizedPL,
        }));
    }
    return activeYearData.byTicker
      .map((t) => {
        const pos = allPositions.find((p) => p.ticker === t.ticker);
        return {
          ticker: t.ticker,
          avgCost: pos ? pos.historicalAvgCost || pos.avgCost : 0,
          pl: t.pl,
        };
      })
      .sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl));
  }, [positions, allPositions, activeYearData]);

  const total = rows.reduce((s, r) => s + r.pl, 0);

  return (
    <table className="table-base">
      <thead>
        <tr>
          <th>{t("dashboard.headers.ticker")}</th>
          <th className="text-right">{t("dashboard.headers.avgCost")}</th>
          <th className="text-right">{t("dashboard.realizedPL")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ticker}>
            <td className="font-medium">{r.ticker}</td>
            <td className="text-right">{formatMoney(r.avgCost, currency)}</td>
            <td
              className={`text-right ${
                r.pl > 0
                  ? "text-emerald-600"
                  : r.pl < 0
                    ? "text-rose-600"
                    : ""
              }`}
            >
              {formatMoney(r.pl, currency)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold border-t border-slate-200">
          <td colSpan={2}>
            {activeYearData
              ? t("dashboard.yearPL", { year: activeYearData.year })
              : t("dashboard.closedTotal")}
          </td>
          <td
            className={`text-right ${
              total > 0 ? "text-emerald-600" : total < 0 ? "text-rose-600" : ""
            }`}
          >
            {formatMoney(total, currency)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

type TickerDividendSummary = {
  ticker: string;
  payments: number;
  total: number;
  currency: string;
};

function DividendsTable({
  dividends,
  positions,
  currency,
  fxRates,
}: {
  dividends: ComputedDividend[];
  positions: Position[];
  currency: Currency;
  fxRates: Record<string, number>;
}) {
  const { t } = useTranslation();

  const byTicker = useMemo(() => {
    const map = new Map<string, TickerDividendSummary>();
    for (const d of dividends) {
      const entry = map.get(d.ticker) ?? {
        ticker: d.ticker,
        payments: 0,
        total: 0,
        currency: d.currency,
      };
      entry.payments++;
      entry.total += toDisplay(d.total, d.currency, currency, fxRates);
      map.set(d.ticker, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [dividends, currency, fxRates]);

  const costByTicker = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) {
      const existing = map.get(p.ticker) ?? 0;
      map.set(p.ticker, existing + (p.totalCost > 0 ? p.totalCost : 0));
    }
    return map;
  }, [positions]);

  const grandTotal = byTicker.reduce((s, d) => s + d.total, 0);

  return (
    <table className="table-base">
      <thead>
        <tr>
          <th>{t("dashboard.headers.ticker")}</th>
          <th className="text-right">{t("dashboard.divHeaders.payments")}</th>
          <th className="text-right">{t("dashboard.divHeaders.total")}</th>
          <th className="text-right">{t("dashboard.divHeaders.yield")}</th>
        </tr>
      </thead>
      <tbody>
        {byTicker.map((d) => {
          const cost = costByTicker.get(d.ticker) ?? 0;
          const yieldOnCost = cost > 0 ? d.total / cost : null;
          return (
            <tr key={d.ticker}>
              <td className="font-medium">{d.ticker}</td>
              <td className="text-right">{d.payments}</td>
              <td className="text-right text-brand-700">
                {formatMoney(d.total, currency)}
              </td>
              <td className="text-right">{formatPct(yieldOnCost)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="font-semibold border-t border-slate-200">
          <td>Total</td>
          <td />
          <td className="text-right text-brand-700">
            {formatMoney(grandTotal, currency)}
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}
