import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { aggregatePositions, type Position } from "@/lib/excel-parser";
import { formatMoney, formatPct, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import { getPortfolio, getPrices, type PriceQuote } from "@/lib/api";

type DashboardData = Awaited<ReturnType<typeof getPortfolio>>;

export function DashboardPage() {
  const { t } = useTranslation();
  const { currency } = useDisplayCurrency();
  const [data, setData] = useState<DashboardData | null>(null);
  const [quotes, setQuotes] = useState<Record<string, PriceQuote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPortfolio()
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {
        if (cancelled) return;
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
  }, []);

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
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("dashboard.title")}
        </h1>
        {data.lastPriceUpdate && (
          <p className="text-xs text-slate-500">
            {t("dashboard.lastUpdated", {
              when: new Date(data.lastPriceUpdate).toLocaleString(),
            })}
          </p>
        )}
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
