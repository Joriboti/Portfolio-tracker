import { useEffect, useMemo, useState } from "react";
import { aggregatePositions, type Transaction } from "@/lib/excel-parser";
import { getPortfolio } from "@/lib/api";
import { AuthGuard } from "@/components/AuthGuard";
import { useUser } from "@/hooks/useUser";

type DashboardData = Awaited<ReturnType<typeof getPortfolio>>;

function DebugInner() {
  const { user } = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getPortfolio(user.id)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [user]);

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    if (!data) return map;
    for (const t of data.transactions) {
      const list = map.get(t.ticker) ?? [];
      list.push(t);
      map.set(t.ticker, list);
    }
    return map;
  }, [data]);

  const positions = useMemo(
    () => (data ? aggregatePositions(data.transactions) : []),
    [data],
  );

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-10">Loading…</div>;
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
  if (!data) return <div className="mx-auto max-w-6xl px-4 py-10">No data</div>;

  const filterLower = filter.trim().toUpperCase();
  const tickers = Array.from(grouped.keys()).sort();
  const visibleTickers = filterLower
    ? tickers.filter((t) => t.includes(filterLower))
    : tickers;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Debug</h1>
        <p className="mt-1 text-sm text-slate-600">
          Raw transactions in the database (ungrouped, FIFO-aggregated below).
          Use this to compare against the source Excel.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Total: {data.transactions.length} transactions, {tickers.length} tickers.
        </p>
        <input
          type="text"
          placeholder="Filter by ticker (e.g. HIMS)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mt-3 w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </header>

      {visibleTickers.map((ticker) => {
        const txns: Transaction[] = grouped.get(ticker) ?? [];
        const buys = txns.filter((t: Transaction) => t.buyPrice != null);
        const sells = txns.filter(
          (t: Transaction) =>
            t.sellShares != null && Number(t.sellShares) > 0,
        );
        const buyShares = buys.reduce(
          (s: number, t: Transaction) => s + Number(t.shares ?? 0),
          0,
        );
        const buyValue = buys.reduce(
          (s: number, t: Transaction) => s + Number(t.buyValue ?? 0),
          0,
        );
        const sellShares = sells.reduce(
          (s: number, t: Transaction) => s + Number(t.sellShares ?? 0),
          0,
        );
        const realized = sells.reduce(
          (s: number, t: Transaction) => s + Number(t.result ?? 0),
          0,
        );
        const pos = positions.find((p) => p.ticker === ticker);
        return (
          <section key={ticker} className="card overflow-x-auto">
            <h2 className="text-lg font-medium">
              {ticker}{" "}
              <span className="text-xs font-normal text-slate-500">
                ({txns.length} rows · {buys.length} buys · {sells.length} sells)
              </span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Sum of buys: {buyShares.toFixed(4)} sh · {buyValue.toFixed(2)} EUR
              {" — "}
              Sum of sells: {sellShares.toFixed(4)} sh · realized{" "}
              {realized.toFixed(2)} EUR
            </p>
            {pos && (
              <p className="text-xs text-brand-700 mt-1">
                FIFO output → {pos.shares.toFixed(4)} sh remaining · avg cost{" "}
                {pos.avgCost.toFixed(2)} EUR · total cost{" "}
                {pos.totalCost.toFixed(2)} EUR · isOpen={String(pos.isOpen)}
              </p>
            )}
            <table className="table-base mt-3">
              <thead>
                <tr>
                  <th>Portfolio</th>
                  <th className="text-right">Buy sh</th>
                  <th className="text-right">Buy €</th>
                  <th className="text-right">Buy val</th>
                  <th>Buy date</th>
                  <th className="text-right">Sell sh</th>
                  <th className="text-right">Sell €</th>
                  <th className="text-right">Sell val</th>
                  <th>Sell date</th>
                  <th className="text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t: Transaction, i: number) => (
                  <tr key={i}>
                    <td className="text-xs text-slate-500">{t.portfolio}</td>
                    <td className="text-right">
                      {t.buyPrice != null ? Number(t.shares).toFixed(4) : "—"}
                    </td>
                    <td className="text-right">
                      {t.buyPrice != null ? Number(t.buyPrice).toFixed(2) : "—"}
                    </td>
                    <td className="text-right">
                      {t.buyValue != null ? Number(t.buyValue).toFixed(2) : "—"}
                    </td>
                    <td className="text-xs">{t.buyDate ?? ""}</td>
                    <td className="text-right">
                      {t.sellShares != null
                        ? Number(t.sellShares).toFixed(4)
                        : "—"}
                    </td>
                    <td className="text-right">
                      {t.sellPrice != null
                        ? Number(t.sellPrice).toFixed(2)
                        : "—"}
                    </td>
                    <td className="text-right">
                      {t.sellValue != null
                        ? Number(t.sellValue).toFixed(2)
                        : "—"}
                    </td>
                    <td className="text-xs">{t.sellDate ?? ""}</td>
                    <td className="text-right">
                      {t.result != null ? Number(t.result).toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

export function DebugPage() {
  return (
    <AuthGuard>
      <DebugInner />
    </AuthGuard>
  );
}
