import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { LocaleLink } from "@/components/LocaleLink";

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
  refreshHistoricalPrices,
  appendHoldings,
  renameTicker,
  type PriceQuote,
  type PriceUnavailableReason,
  type Fundamentals,
  type LiveCompany,
} from "@/lib/api";
import { runPriceRefresh } from "@/lib/price-refresh";
import { holdFor } from "@/lib/phases";
import { buildPositionRow, formatLargeMoney, numberLocale } from "@/lib/money";
import { NativeAwarePrice } from "@/components/NativePrice";
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
import { CompanyOverview } from "@/components/CompanyOverview";
import { CompanyLogo } from "@/components/CompanyLogo";
import { Logo, PageLoading } from "@/components/Logo";
import { PortfolioVerifier } from "@/components/PortfolioVerifier";
import { TickerRenameDialog } from "@/components/TickerRenameDialog";

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
  // The price refresh, as the header shows it: how far along, whether the
  // last one failed (in which case the timestamp is stale). The quotes on
  // screen are never cleared by a refresh — they're dimmed and overwritten
  // row by row as chunks land.
  const [refresh, setRefresh] = useState<{
    active: boolean;
    done: number;
    total: number;
    error: string | null;
    stale: boolean;
  }>({ active: false, done: 0, total: 0, error: null, stale: false });
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Tickers with no market symbol → why, so their rows can say so.
  const [unavailable, setUnavailable] = useState<Record<string, PriceUnavailableReason>>({});
  // One refresh at a time; a ref so a double click can't start a second run
  // before the first render lands.
  const refreshRunning = useRef(false);
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
  // Ticker of the holding whose "change ticker" dialog is open, if any.
  const [renaming, setRenaming] = useState<string | null>(null);

  // Refresh prices in parallel chunks and paint each row as its chunk lands.
  // What's on screen is never cleared: a chunk that fails leaves its rows as
  // they were, the timestamp is marked stale and a retry is offered. Runs at
  // least 400ms so a fast refresh reads as one, not as a flash.
  async function runRefresh(tickers: string[]) {
    if (!user || refreshRunning.current) return;
    refreshRunning.current = true;
    const startedAt = Date.now();
    const total = tickers.length;
    setRefresh({ active: true, done: 0, total, error: null, stale: false });
    // Dividend events ride along; the portfolio re-read that picks them up is
    // detached so it never holds the price indicator open.
    void refreshDividends(user.id)
      .catch(() => null)
      .then(() => getPortfolio(user.id))
      .then((d) => setData(d))
      .catch(() => {});
    try {
      const outcome = await runPriceRefresh({
        tickers,
        fetchChunk: (symbols, { fx }) => refreshPrices(user.id, { symbols, fx }),
        onProgress: ({ done, quotes: arrived, fxRates: fx }) => {
          if (Object.keys(arrived).length > 0) setQuotes((prev) => ({ ...prev, ...arrived }));
          if (Object.keys(fx).length > 0) setFxRates((prev) => ({ ...prev, ...fx }));
          setRefresh((r) => ({ ...r, done }));
        },
      });
      setUnavailable((prev) => {
        const next = { ...prev };
        for (const tk of Object.keys(outcome.quotes)) delete next[tk];
        for (const [tk, why] of Object.entries(outcome.unavailable)) {
          next[tk] = why === "skipped" ? "skipped" : "unresolved";
        }
        return next;
      });
      await holdFor(startedAt);
      if (outcome.failed.length > 0) {
        setRefresh({
          active: false,
          done: total,
          total,
          error: t("dashboard.refreshPartial", { count: outcome.failed.length }),
          stale: true,
        });
      } else {
        setLastUpdated(new Date().toISOString());
        setRefresh({ active: false, done: total, total, error: null, stale: false });
      }
    } catch (e) {
      await holdFor(startedAt);
      setRefresh({ active: false, done: 0, total, error: (e as Error).message, stale: true });
    } finally {
      refreshRunning.current = false;
    }
  }

  function handleRefresh() {
    // Biggest positions first, so the numbers that move the total land first.
    const ordered = openPositions
      .map((p) => {
        const q = quotes[p.ticker];
        const value = q ? toDisplay(q.price, q.currency ?? null, currency, fxRates) * p.shares : 0;
        return { ticker: p.ticker, value };
      })
      .sort((a, b) => b.value - a.value)
      .map((x) => x.ticker);
    void runRefresh(ordered);
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

  // Keyed on the set of open tickers, not the positions array: a portfolio
  // re-read after a refresh yields a new array of the same tickers and must
  // not trigger another price fetch.
  const openTickerKey = useMemo(() => [...openTickers].sort().join(","), [openTickers]);
  useEffect(() => {
    if (openTickerKey === "") return;
    const tickers = openTickerKey.split(",");
    getPrices(tickers)
      .then(({ quotes, fxRates, unavailable }) => {
        const map: Record<string, PriceQuote> = {};
        for (const q of quotes) map[q.ticker] = q;
        // Merge, never replace: a refresh may be painting rows at the same time.
        setQuotes((prev) => ({ ...prev, ...map }));
        setFxRates((prev) => ({ ...prev, ...fxRates }));
        setUnavailable(unavailable);
      })
      .catch(() => {
        /* keep whatever is on screen; the banner offers a refresh */
      });
    // Cached fundamentals (PER, P/B, …). Missing table / no rows → empty map,
    // the PER card shows its "no data" state.
    getFundamentals(tickers)
      .then(setFundamentals)
      .catch(() => setFundamentals({}));
  }, [openTickerKey]);

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

  // "Change ticker": re-point a holding at the market symbol Yahoo actually
  // knows (a broker Excel often names a less-covered company something else),
  // then pull its price and weekly history so the row stops showing "—".
  async function handleRename(from: string, to: string) {
    if (!user) return;
    await renameTicker(user.id, from, to);

    // Re-point the loaded rows locally so the table shows the new symbol at
    // once; the price/history refresh below can take the better part of a
    // minute and shouldn't hold the dialog open.
    setData((prev) =>
      prev
        ? {
            ...prev,
            transactions: prev.transactions.map((tx) =>
              tx.ticker === from ? { ...tx, ticker: to } : tx,
            ),
            dividends: prev.dividends.map((d) =>
              d.ticker === from ? { ...d, ticker: to } : d,
            ),
            dividendEvents: prev.dividendEvents.filter((e) => e.ticker !== from),
          }
        : prev,
    );
    // A deconstructor removal referred to the old symbol — carry it across so
    // the view doesn't silently bring the holding back.
    setRemoved((prev) => prev.map((tk) => (tk === from ? to : tk)));
    setRenaming(null);

    // The new symbol may be one nothing has ever priced. Everything here is
    // best-effort: the rename itself is already committed, and the daily crons
    // catch up on whatever fails. The old symbol's "unavailable" mark goes
    // with it; the new one is priced first so its row fills in first.
    setUnavailable((prev) => {
      const next = { ...prev };
      delete next[from];
      return next;
    });
    void refreshHistoricalPrices(user.id).catch(() => {});
    const others = openPositions
      .map((p) => p.ticker)
      .filter((tk) => tk !== from && tk !== to);
    await runRefresh([to, ...others]);
  }

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

  if (loading) return <PageLoading />;

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
          <LocaleLink to="/upload" className="btn-primary mt-4 inline-flex">
            {t("nav.upload")}
          </LocaleLink>
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

  // Rows with no price, split by why: no market symbol (fix: change the
  // ticker) vs. simply not fetched yet (fix: refresh).
  const missingQuotes = openPositions.filter((p) => !quotes[p.ticker]).map((p) => p.ticker);
  const unresolvedQuotes = missingQuotes.filter((tk) => unavailable[tk]);
  const pendingQuotes = missingQuotes.filter((tk) => !unavailable[tk]);
  const pricesUpdatedAt = lastUpdated ?? data.lastPriceUpdate;

  // Both totals in the display currency — the cost is recorded in EUR and used
  // to be summed as-is even when the dashboard showed USD.
  let totalValue = 0;
  let totalCost = 0;
  for (const p of openPositions) {
    const row = buildPositionRow({
      ticker: p.ticker,
      shares: p.shares,
      avgCost: p.avgCost,
      totalCost: p.totalCost,
      quote: quotes[p.ticker] ?? null,
      displayCurrency: currency,
      fxRates,
    });
    if (row.marketValue != null) totalValue += row.marketValue;
    totalCost += row.cost ?? p.totalCost;
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
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-slate-500">
            {pricesUpdatedAt
              ? t("dashboard.lastUpdated", {
                  when: new Date(pricesUpdatedAt).toLocaleString(),
                })
              : t("dashboard.neverUpdated")}
            {refresh.stale && (
              <span className="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                {t("dashboard.stale")}
              </span>
            )}
          </p>
          {refresh.error && !refresh.active && (
            <p className="text-xs text-rose-700">
              {refresh.error}{" "}
              <button
                onClick={handleRefresh}
                className="font-medium underline hover:text-rose-900"
              >
                {t("dashboard.retry")}
              </button>
            </p>
          )}
          <button
            onClick={handleRefresh}
            disabled={refresh.active}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            {refresh.active ? (
              <>
                <Logo className="h-3.5 w-3.5" spinning label={t("common.loading")} />
                <span aria-live="polite">
                  {refresh.total > 1
                    ? t("dashboard.updating", { done: refresh.done, total: refresh.total })
                    : t("dashboard.updatingOne")}
                </span>
              </>
            ) : (
              t("dashboard.refresh")
            )}
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

      {missingQuotes.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span>⚠</span>
          <span>
            {pendingQuotes.length > 0 && (
              <>
                {t("dashboard.missingPrices")}{" "}
                <button
                  onClick={handleRefresh}
                  disabled={refresh.active}
                  className="underline font-medium hover:text-amber-900"
                >
                  {t("dashboard.refresh")}
                </button>
                {". "}
              </>
            )}
            {unresolvedQuotes.length > 0 && (
              <>
                {t("dashboard.unresolvedBanner", {
                  count: unresolvedQuotes.length,
                  list: unresolvedQuotes.join(", "),
                })}
                {user && <span className="ml-1">{t("dashboard.rename.missingHint")}</span>}
              </>
            )}
          </span>
        </div>
      )}

      <section
        className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 transition-opacity duration-300 ${
          refresh.active ? "opacity-60" : ""
        }`}
      >
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
            unavailable={unavailable}
            dimmed={refresh.active}
            currency={currency}
            fxRates={fxRates}
            fundamentals={fundamentals}
            userId={user?.id ?? null}
            totalPortfolioValue={totalValue}
            onRemove={removePosition}
            onRename={user ? setRenaming : undefined}
          />
        </section>
      )}

      {renaming && (
        <TickerRenameDialog
          ticker={renaming}
          existing={allPositions.map((p) => p.ticker).filter((tk) => tk !== renaming)}
          onClose={() => setRenaming(null)}
          onConfirm={(to) => handleRename(renaming, to)}
        />
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

      {openPositions.length > 0 && user && (
        <PortfolioVerifier
          userId={user.id}
          positions={openPositions}
          quotes={quotes}
          fxRates={fxRates}
          fundamentals={fundamentals}
          txns={visibleData?.transactions ?? []}
          dividends={visibleData?.dividends ?? []}
          interests={visibleData?.interests ?? []}
        />
      )}

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

  // The wait a refresh actually lands on: the session has to be fetched again
  // before we know whether this is the real dashboard or the trial one. It
  // showed a bare line of text while a route change one click away showed the
  // compass, so the same wait looked like two different things.
  if (isPending || carrying) return <PageLoading />;
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

// "Price unavailable", said on the row itself — never a blank, never a 0. The
// tooltip says which kind: no market symbol for this ticker (fix: change the
// ticker) or simply not fetched yet (fix: refresh).
function PriceUnavailable({ reason }: { reason: PriceUnavailableReason | null }) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
      title={
        reason
          ? t("dashboard.priceUnavailableUnresolved")
          : t("dashboard.priceUnavailablePending")
      }
    >
      {t("dashboard.priceUnavailable")}
    </span>
  );
}

function PositionsTable({
  positions,
  quotes,
  unavailable,
  dimmed,
  currency,
  fxRates,
  fundamentals,
  userId,
  totalPortfolioValue,
  onRemove,
  onRename,
}: {
  positions: Position[];
  quotes: Record<string, PriceQuote>;
  unavailable: Record<string, PriceUnavailableReason>;
  /** A refresh is in flight: keep every figure, just lower it a notch. */
  dimmed: boolean;
  currency: Currency;
  fxRates: Record<string, number>;
  fundamentals: Record<string, Fundamentals>;
  userId: string | null;
  totalPortfolioValue: number;
  onRemove: (ticker: string) => void;
  /** Only offered to signed-in users — the rename is a DB write. */
  onRename?: (ticker: string) => void;
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
      // One conversion, here, into the display currency — for the quote AND
      // the EUR cost basis — so every figure on the row is in the same
      // currency (the row asserts it). The native quote stays on the row for
      // the price cell to show.
      const money = buildPositionRow({
        ticker: p.ticker,
        shares: p.shares,
        avgCost: p.avgCost,
        totalCost: p.totalCost,
        quote: quote ?? null,
        displayCurrency: currency,
        fxRates,
      });
      const weight =
        money.marketValue != null && totalPortfolioValue > 0
          ? money.marketValue / totalPortfolioValue
          : null;
      return {
        p,
        quote,
        fund: fundamentals[p.ticker],
        money,
        currentPriceDisp: money.price,
        marketValue: money.marketValue,
        pl: money.pl,
        plPct: money.plPct,
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
          return r.money.avgCost ?? -Infinity;
        case "price":
          return r.currentPriceDisp ?? -Infinity;
        case "value":
          return r.marketValue ?? -Infinity;
        case "weight":
          return r.weight ?? -Infinity;
        case "cost":
          return r.money.cost ?? -Infinity;
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
          <th className={onRename ? "w-16" : "w-8"} />
        </tr>
      </thead>
      <tbody className={`transition-opacity duration-300 ${dimmed ? "opacity-60" : ""}`}>
        {rows.map((row) => {
          const { p, quote, fund, money, marketValue, pl, plPct, weight } = row;
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
                <td className="text-right">{formatMoney(money.avgCost, currency)}</td>
                <td className="text-right">
                  <NativeAwarePrice
                    row={money}
                    display={currency}
                    fallback={<PriceUnavailable reason={unavailable[p.ticker] ?? null} />}
                  />
                </td>
                <td className="text-right">{formatMoney(marketValue, currency)}</td>
                <td className="text-right text-slate-500">{formatPct(weight)}</td>
                <td className="text-right">{formatMoney(money.cost, currency)}</td>
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
                <td className="text-right whitespace-nowrap">
                  {onRename && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRename(p.ticker);
                      }}
                      // A position with no quote is precisely the one whose
                      // ticker needs fixing, so flag the action there.
                      className={`px-1 text-sm leading-none ${
                        quote
                          ? "text-slate-300 hover:text-brand-600"
                          : "text-amber-500 hover:text-amber-600"
                      }`}
                      title={t("dashboard.rename.action", { ticker: p.ticker })}
                      aria-label={t("dashboard.rename.action", { ticker: p.ticker })}
                    >
                      ✎
                    </button>
                  )}
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
                    <ExpandedPositionDetail
                      p={p}
                      quote={quote}
                      fund={fund}
                      currentPriceDisp={money.price}
                      userId={userId}
                      currency={currency}
                      totalPortfolioValue={totalPortfolioValue}
                      fxRates={fxRates}
                    />
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

// Expanded holding row: tabs Resum | Valoració, mirroring /explore/:ticker.
// "Resum" reuses the CompanyOverview company dashboard (statements, charts,
// insights); "Valoració" keeps the existing fundamentals + valuation models.
// The Resum tab only appears when we have a cached fundamentals row to seed the
// LiveCompany the overview expects; without it we fall back to Valoració only.
function ExpandedPositionDetail({
  p,
  quote,
  fund,
  currentPriceDisp,
  userId,
  currency,
  totalPortfolioValue,
  fxRates,
}: {
  p: Position;
  quote: PriceQuote | undefined;
  fund: Fundamentals | undefined;
  currentPriceDisp: number | null;
  userId: string | null;
  currency: Currency;
  totalPortfolioValue: number;
  fxRates: Record<string, number>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"resum" | "valoracio">("resum");

  // The overview needs statements in the company's own quote currency, so pass
  // the native quote price/currency (not the display-converted figure).
  const liveCompany: LiveCompany | null = fund
    ? {
        ticker: p.ticker,
        price: quote?.price ?? null,
        currency: quote?.currency ?? currency,
        // The stored quote IS the market's own (pence already in pounds).
        quoteCurrency: quote?.currency ?? currency,
        fundamentals: fund,
      }
    : null;

  // Yield on cost: estimated annual dividends (yield × current price × shares)
  // over the FIFO cost basis of the open position.
  const yieldOnCost =
    fund?.dividendYield != null && currentPriceDisp != null && p.totalCost > 0
      ? (fund.dividendYield * currentPriceDisp * p.shares) / p.totalCost
      : null;

  const showOverview = liveCompany != null && tab === "resum";

  return (
    <div className="space-y-4">
      {liveCompany && (
        <div className="flex items-center gap-1.5">
          {(["resum", "valoracio"] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={`rounded-full border px-3 py-1 text-xs ${
                tab === tb
                  ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {t(tb === "resum" ? "explore.tabOverview" : "explore.tabValuation")}
            </button>
          ))}
        </div>
      )}

      {showOverview ? (
        <CompanyOverview company={liveCompany!} />
      ) : (
        <div className="space-y-5">
          <FundamentalsDetail fund={fund} yieldOnCost={yieldOnCost} />
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
      )}
    </div>
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
      // Short scale on purpose: Intl's compact notation writes "B" for 10^12
      // under a Catalan locale (bilió), which turned trillions into billions.
      value: formatLargeMoney(fund.marketCap, fund.currency, numberLocale(i18n.language)),
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
          <td>{t("dashboard.grandTotal")}</td>
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
