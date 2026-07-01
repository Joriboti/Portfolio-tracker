import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  searchTickers,
  addHolding,
  refreshPrices,
  refreshHistoricalPrices,
  type TickerSearchResult,
} from "@/lib/api";
import type { Transaction } from "@/lib/excel-parser";
import { CompanyLogo } from "@/components/CompanyLogo";

// Manual "Add holding" form: search a ticker (Yahoo autocomplete), enter shares,
// average price paid and the buy date, and append it to the portfolio without
// touching the rest (portfolio-import append mode). Complements the Excel
// upload for anyone who'd rather add positions one by one.
export function AddHoldingForm({
  userId,
  onAdded,
}: {
  userId: string;
  onAdded?: (ticker: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TickerSearchResult | null>(null);
  const [shares, setShares] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [buyDate, setBuyDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced ticker search — only while the user is still choosing (no
  // selection yet, query long enough).
  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      searchTickers(query)
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setOpen(true);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, selected]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function pick(r: TickerSearchResult) {
    setSelected(r);
    setQuery(r.symbol);
    setOpen(false);
  }

  function reset() {
    setSelected(null);
    setQuery("");
    setShares("");
    setAvgPrice("");
    setBuyDate("");
  }

  async function submit() {
    setError(null);
    setDone(null);
    const sh = Number(shares);
    const px = Number(avgPrice);
    if (!selected) {
      setError(t("addHolding.errorTicker"));
      return;
    }
    if (!Number.isFinite(sh) || sh <= 0) {
      setError(t("addHolding.errorShares"));
      return;
    }
    if (!Number.isFinite(px) || px <= 0) {
      setError(t("addHolding.errorPrice"));
      return;
    }
    const txn: Transaction = {
      ticker: selected.symbol.toUpperCase(),
      shares: sh,
      buyPrice: px,
      buyValue: sh * px,
      buyDate: buyDate || null,
      sellShares: null,
      sellPrice: null,
      sellValue: null,
      sellDate: null,
      result: null,
      portfolio: "manual",
    };
    setBusy(true);
    try {
      await addHolding(userId, txn);
      // Pull price + weekly history for the new ticker so the dashboard value
      // views are correct immediately. Tolerant of failure — the crons catch up.
      try {
        await refreshPrices(userId);
      } catch {
        /* cron will catch up */
      }
      try {
        await refreshHistoricalPrices(userId);
      } catch {
        /* cron will catch up */
      }
      setDone(t("addHolding.added", { ticker: txn.ticker }));
      reset();
      onAdded?.(txn.ticker);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="font-medium text-slate-900">{t("addHolding.title")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("addHolding.subtitle")}</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {/* Ticker search */}
        <div ref={boxRef} className="relative">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
            {t("addHolding.ticker")}
          </label>
          <div className="flex items-center gap-2">
            {selected && <CompanyLogo ticker={selected.symbol} size={28} />}
            <input
              className="w-64 rounded-md border border-slate-200 px-3 py-2 text-sm"
              placeholder={t("addHolding.searchPlaceholder")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selected) setSelected(null);
              }}
              onFocus={() => results.length > 0 && setOpen(true)}
            />
          </div>
          {open && results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-64 w-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => (
                <li key={`${r.symbol}-${r.exchange}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => pick(r)}
                  >
                    <CompanyLogo ticker={r.symbol} size={22} />
                    <span className="font-medium text-slate-800">{r.symbol}</span>
                    <span className="truncate text-xs text-slate-500">{r.name}</span>
                    {r.exchange && (
                      <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                        {r.exchange}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Shares */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("addHolding.shares")}
          </span>
          <input
            type="number"
            step="any"
            min="0"
            className="w-28 rounded-md border border-slate-200 px-3 py-2 text-sm text-right"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
          />
        </label>

        {/* Avg price (EUR, matching the EUR book) */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("addHolding.avgPrice")}
          </span>
          <input
            type="number"
            step="any"
            min="0"
            className="w-32 rounded-md border border-slate-200 px-3 py-2 text-sm text-right"
            value={avgPrice}
            onChange={(e) => setAvgPrice(e.target.value)}
          />
        </label>

        {/* Buy date */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("addHolding.buyDate")}
          </span>
          <input
            type="date"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={buyDate}
            onChange={(e) => setBuyDate(e.target.value)}
          />
        </label>

        <button onClick={submit} disabled={busy} className="btn-primary">
          {busy ? t("common.loading") : t("addHolding.add")}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {done && <p className="mt-3 text-sm text-emerald-600">{done}</p>}
    </section>
  );
}
