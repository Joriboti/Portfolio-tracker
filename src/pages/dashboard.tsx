import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  aggregatePositions,
  computeAutoDividends,
  type Position,
  type ComputedDividend,
} from "@/lib/excel-parser";
import { convert, formatMoney, formatPct, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import {
  getPortfolio,
  getPrices,
  refreshPrices,
  refreshDividends,
  type PriceQuote,
} from "@/lib/api";
import { AuthGuard } from "@/components/AuthGuard";
import { useUser } from "@/hooks/useUser";

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

  const allPositions = useMemo(
    () => (data ? aggregatePositions(data.transactions) : []),
    [data],
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
      data ? computeAutoDividends(data.transactions, data.dividendEvents) : [],
    [data],
  );

  const autoDividendsTotal = useMemo(() => {
    let total = 0;
    for (const d of autoDividends) {
      total += toDisplay(d.total, d.currency, currency, fxRates);
    }
    return total;
  }, [autoDividends, currency, fxRates]);

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
  }, [openPositions]);

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

  if (!data || allPositions.length === 0) {
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

  const manualDividendsTotal = data.dividends.reduce(
    (s, d) => s + d.amount,
    0,
  );
  const totalDividends =
    autoDividends.length > 0 ? autoDividendsTotal : manualDividendsTotal;

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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
      </section>

      {openPositions.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-lg font-medium text-slate-900 mb-3">
            {t("dashboard.positions")}
          </h2>
          <PositionsTable
            positions={openPositions}
            quotes={quotes}
            currency={currency}
            fxRates={fxRates}
          />
        </section>
      )}

      {closedPositions.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-lg font-medium text-slate-900 mb-3">
            {t("dashboard.closedPositions")}
          </h2>
          <ClosedPositionsTable positions={closedPositions} currency={currency} />
        </section>
      )}

      {autoDividends.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="text-lg font-medium text-slate-900 mb-3">
            {t("dashboard.dividendsSection")}
          </h2>
          <DividendsTable
            dividends={autoDividends}
            positions={allPositions}
            currency={currency}
            fxRates={fxRates}
          />
        </section>
      )}
    </div>
  );
}

export function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardInner />
    </AuthGuard>
  );
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
          positive ? "text-brand-700" : negative ? "text-rose-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PositionsTable({
  positions,
  quotes,
  currency,
  fxRates,
}: {
  positions: Position[];
  quotes: Record<string, PriceQuote>;
  currency: Currency;
  fxRates: Record<string, number>;
}) {
  const { t } = useTranslation();
  return (
    <table className="table-base">
      <thead>
        <tr>
          <th>{t("dashboard.headers.ticker")}</th>
          <th className="text-right">{t("dashboard.headers.shares")}</th>
          <th className="text-right">{t("dashboard.headers.avgCost")}</th>
          <th className="text-right">{t("dashboard.headers.currentPrice")}</th>
          <th className="text-right">{t("dashboard.headers.marketValue")}</th>
          <th className="text-right">{t("dashboard.headers.cost")}</th>
          <th className="text-right">{t("dashboard.headers.pl")}</th>
          <th className="text-right">{t("dashboard.headers.plPct")}</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const quote = quotes[p.ticker];
          // Cost basis is already in the user's account currency (EUR);
          // only the live Yahoo price needs FX conversion.
          const currentPriceDisp = quote
            ? toDisplay(
                quote.price,
                quote.currency ?? null,
                currency,
                fxRates,
              )
            : null;
          const marketValue =
            currentPriceDisp != null ? currentPriceDisp * p.shares : null;
          const pl = marketValue != null ? marketValue - p.totalCost : null;
          const plPct =
            pl != null && p.totalCost > 0 ? pl / p.totalCost : null;
          return (
            <tr key={p.ticker}>
              <td className="font-medium">{p.ticker}</td>
              <td className="text-right">{p.shares.toFixed(4)}</td>
              <td className="text-right">{formatMoney(p.avgCost, currency)}</td>
              <td className="text-right">
                {currentPriceDisp != null
                  ? formatMoney(currentPriceDisp, currency)
                  : "—"}
              </td>
              <td className="text-right">{formatMoney(marketValue, currency)}</td>
              <td className="text-right">{formatMoney(p.totalCost, currency)}</td>
              <td
                className={`text-right ${
                  pl == null
                    ? ""
                    : pl > 0
                      ? "text-brand-700"
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
                      ? "text-brand-700"
                      : plPct < 0
                        ? "text-rose-600"
                        : ""
                }`}
              >
                {formatPct(plPct)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ClosedPositionsTable({
  positions,
  currency,
}: {
  positions: Position[];
  currency: Currency;
}) {
  const { t } = useTranslation();
  const sorted = [...positions].sort(
    (a, b) => Math.abs(b.realizedPL) - Math.abs(a.realizedPL),
  );
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
        {sorted.map((p) => {
          const displayAvg = p.historicalAvgCost || p.avgCost;
          return (
            <tr key={p.ticker}>
              <td className="font-medium">{p.ticker}</td>
              <td className="text-right">{formatMoney(displayAvg, currency)}</td>
              <td
                className={`text-right ${
                  p.realizedPL > 0
                    ? "text-brand-700"
                    : p.realizedPL < 0
                      ? "text-rose-600"
                      : ""
                }`}
              >
                {formatMoney(p.realizedPL, currency)}
              </td>
            </tr>
          );
        })}
      </tbody>
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
