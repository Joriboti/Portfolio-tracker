import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { aggregatePositions, type Position } from "@/lib/excel-parser";
import { formatMoney, formatPct, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import { getPortfolio, getPrices, refreshPrices, type PriceQuote } from "@/lib/api";
import { AuthGuard } from "@/components/AuthGuard";
import { useUser } from "@/hooks/useUser";

type DashboardData = Awaited<ReturnType<typeof getPortfolio>>;

function DashboardInner() {
  const { t } = useTranslation();
  const { currency } = useDisplayCurrency();
  const { user } = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [quotes, setQuotes] = useState<Record<string, PriceQuote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefreshPrices() {
    if (!user) return;
    setRefreshing(true);
    try {
      await refreshPrices(user.id);
      const tickers = positions.map((p) => p.ticker);
      const { quotes } = await getPrices(tickers);
      const map: Record<string, PriceQuote> = {};
      for (const q of quotes) map[q.ticker] = q;
      setQuotes(map);
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
          lastPriceUpdate: null,
        });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const positions = useMemo(
    () => (data ? aggregatePositions(data.transactions) : []),
    [data],
  );

  useEffect(() => {
    if (positions.length === 0) return;
    const tickers = positions.map((p) => p.ticker);
    getPrices(tickers)
      .then(({ quotes }) => {
        const map: Record<string, PriceQuote> = {};
        for (const q of quotes) map[q.ticker] = q;
        setQuotes(map);
      })
      .catch(() => setQuotes({}));
  }, [positions]);

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

  if (!data || positions.length === 0) {
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

  const totalDividends = data.dividends.reduce((s, d) => s + d.amount, 0);
  const realizedPL = positions.reduce((s, p) => s + p.realizedPL, 0);

  let totalValue = 0;
  let totalCost = 0;
  for (const p of positions) {
    const quote = quotes[p.ticker];
    if (quote) totalValue += quote.price * p.shares;
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
            onClick={() => void handleRefreshPrices()}
            disabled={refreshing}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            {refreshing ? t("common.loading") : "↻ Refresh prices"}
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

      <section className="card overflow-x-auto">
        <h2 className="text-lg font-medium text-slate-900 mb-3">
          {t("dashboard.positions")}
        </h2>
        <PositionsTable positions={positions} quotes={quotes} currency={currency} />
      </section>
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
}: {
  positions: Position[];
  quotes: Record<string, PriceQuote>;
  currency: Currency;
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
          const marketValue = quote ? quote.price * p.shares : null;
          const pl = marketValue != null ? marketValue - p.totalCost : null;
          const plPct = pl != null && p.totalCost > 0 ? pl / p.totalCost : null;
          return (
            <tr key={p.ticker}>
              <td className="font-medium">{p.ticker}</td>
              <td className="text-right">{p.shares.toFixed(4)}</td>
              <td className="text-right">{formatMoney(p.avgCost, currency)}</td>
              <td className="text-right">
                {quote ? formatMoney(quote.price, currency) : "—"}
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
