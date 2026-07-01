import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  searchTickers,
  getLiveCompany,
  type TickerSearchResult,
  type LiveCompany,
} from "@/lib/api";
import { formatMoney, type Currency } from "@/lib/currency";
import { useUser } from "@/hooks/useUser";
import { useDisplayCurrency } from "@/lib/preferences";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ScenarioValuation } from "@/components/ScenarioValuation";

// "Explore" — search any company by ticker and run the same valuation models
// available on the dashboard (Scenarios / DCF / Reverse / Graham / Monte Carlo /
// SoTP), without needing to own it. Live fundamentals come from
// fundamentals-get's `?quote=` mode; the valuation panel is reused verbatim with
// shares/avgCost = 0 (its engine returns null for the "vs cost" ratios then).
function ExploreInner() {
  const { t } = useTranslation();
  const { user } = useUser();
  const { currency } = useDisplayCurrency();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TickerSearchResult | null>(null);
  const [company, setCompany] = useState<LiveCompany | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced ticker autocomplete (only while still choosing).
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
    setError(null);
    setCompany(null);
    setLoading(true);
    getLiveCompany(r.symbol)
      .then((c) => {
        if (c) setCompany(c);
        else setError(t("explore.notFound"));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  const qc = (company?.currency ?? currency) as Currency;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("explore.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("explore.subtitle")}</p>
      </div>

      {/* Ticker search */}
      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-2">
          {selected && <CompanyLogo ticker={selected.symbol} size={28} />}
          <input
            className="w-full max-w-md rounded-md border border-slate-200 px-3 py-2 text-sm"
            placeholder={t("explore.searchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selected) setSelected(null);
            }}
            onFocus={() => results.length > 0 && setOpen(true)}
          />
        </div>
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full max-w-md overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
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

      {loading && <p className="text-sm text-slate-500">{t("explore.loading")}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {!loading && !error && !company && (
        <div className="card border-dashed text-center text-sm text-slate-500">
          {t("explore.empty")}
        </div>
      )}

      {company && user && (
        <section className="card space-y-5">
          {/* Company header */}
          <div className="flex flex-wrap items-center gap-4">
            <CompanyLogo
              ticker={company.ticker}
              website={company.fundamentals.website}
              size={48}
            />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-slate-900">
                {selected?.name ?? company.ticker}
              </p>
              <p className="text-xs text-slate-500">
                {company.ticker}
                {company.fundamentals.sector ? ` · ${company.fundamentals.sector}` : ""}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("explore.price")}
              </p>
              <p className="text-lg font-semibold text-slate-900">
                {company.price != null ? formatMoney(company.price, qc) : "—"}
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <ScenarioValuation
              userId={user.id}
              ticker={company.ticker}
              shares={0}
              avgCostEur={0}
              currentPrice={company.price}
              quoteCurrency={company.currency ?? currency}
              fundamentals={company.fundamentals}
              totalPortfolioValueEur={0}
              displayCurrency={currency}
              fxRates={{}}
            />
          </div>
        </section>
      )}
    </div>
  );
}

export function ExplorePage() {
  return <ExploreInner />;
}
