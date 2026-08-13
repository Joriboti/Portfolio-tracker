import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  searchTickers,
  getLiveCompany,
  type TickerSearchResult,
  type LiveCompany,
} from "@/lib/api";
import { CompanyLogo } from "@/components/CompanyLogo";

// Same shape Yahoo uses (BRK-B, SAN.MC, BTC-EUR, ^GSPC) — mirrors the guard in
// api/portfolio-import.ts so a bad symbol is caught before the round trip.
const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; company: LiveCompany }
  | { status: "none" };

// "Change ticker" dialog for a dashboard holding: a broker Excel often names a
// less-known company with a code Yahoo doesn't know, which leaves the row with
// no price, no fundamentals and no history. Search the right symbol (or type it
// straight in), see it priced live before committing, and every row of that
// holding is re-pointed at it.
export function TickerRenameDialog({
  ticker,
  existing = [],
  onClose,
  onConfirm,
}: {
  ticker: string;
  /** Other tickers already in the portfolio — renaming onto one merges them. */
  existing?: string[];
  onClose: () => void;
  onConfirm: (to: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TickerSearchResult | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const target = (selected?.symbol ?? query).trim().toUpperCase();
  const valid = TICKER_RE.test(target) && target !== ticker.toUpperCase();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced name/symbol autocomplete, only while the user is still choosing.
  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      searchTickers(query)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setOpen(true);
        })
        .catch(() => !cancelled && setResults([]));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, selected]);

  // Price the candidate symbol before the user commits: a symbol that returns
  // no quote is exactly the problem they came here to fix.
  useEffect(() => {
    if (!valid) {
      setPreview({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPreview({ status: "loading" });
    const id = setTimeout(() => {
      getLiveCompany(target)
        .then((c) => {
          if (cancelled) return;
          setPreview(c && c.price != null ? { status: "ok", company: c } : { status: "none" });
        })
        .catch(() => !cancelled && setPreview({ status: "none" }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [target, valid]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(target);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("dashboard.rename.title")}
        className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          disabled={busy}
          className="absolute right-4 top-3 text-2xl leading-none text-slate-400 hover:text-slate-700 disabled:opacity-40"
          aria-label={t("dashboard.rename.close")}
        >
          &times;
        </button>

        <h2 className="pr-8 text-lg font-medium text-slate-900">
          {t("dashboard.rename.title")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("dashboard.rename.lead")}</p>

        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("dashboard.rename.current")}
          </span>
          <CompanyLogo ticker={ticker} size={20} />
          <span className="font-medium text-slate-800">{ticker}</span>
        </div>

        <div ref={boxRef} className="relative mt-4">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
            {t("dashboard.rename.newTicker")}
          </label>
          <input
            autoFocus
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            placeholder={t("dashboard.rename.searchPlaceholder")}
            value={query}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selected) setSelected(null);
            }}
            onFocus={() => results.length > 0 && setOpen(true)}
          />
          {open && results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => (
                <li key={`${r.symbol}-${r.exchange}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setSelected(r);
                      setQuery(r.symbol);
                      setOpen(false);
                    }}
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
          <p className="mt-1.5 text-xs text-slate-400">{t("dashboard.rename.searchHint")}</p>
        </div>

        {/* Live check of the candidate symbol */}
        <div className="mt-3 min-h-[2.5rem] text-sm">
          {target.length > 0 && !valid && (
            <p className="text-amber-600">
              {target === ticker.toUpperCase()
                ? t("dashboard.rename.same")
                : t("dashboard.rename.invalid")}
            </p>
          )}
          {valid && preview.status === "loading" && (
            <p className="text-slate-500">{t("dashboard.rename.checking")}</p>
          )}
          {valid && preview.status === "ok" && (
            <p className="text-emerald-700">
              ✓{" "}
              {t("dashboard.rename.found", {
                ticker: target,
                price: preview.company.price?.toLocaleString("ca-ES", {
                  maximumFractionDigits: 2,
                }),
                currency: preview.company.currency ?? "",
              })}
              {selected?.name && (
                <span className="text-slate-500"> · {selected.name}</span>
              )}
            </p>
          )}
          {valid && preview.status === "none" && (
            <p className="text-amber-600">{t("dashboard.rename.notFound")}</p>
          )}
        </div>

        {valid && existing.some((e) => e.toUpperCase() === target) && (
          <p className="text-sm text-amber-600">
            {t("dashboard.rename.merge", { ticker: target })}
          </p>
        )}

        <p className="mt-1 text-xs text-slate-500">{t("dashboard.rename.scope")}</p>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="btn-ghost text-sm px-4 py-2">
            {t("dashboard.rename.cancel")}
          </button>
          <button
            onClick={() => void confirm()}
            disabled={!valid || busy}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            {busy ? t("dashboard.rename.applying") : t("dashboard.rename.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
