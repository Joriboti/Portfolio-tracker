import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  searchTickers,
  getLiveCompany,
  type TickerSearchResult,
  type LiveCompany,
} from "@/lib/api";
import tickers from "@/data/tickers.json";
import { formatMoney, type Currency } from "@/lib/currency";
import { useUser } from "@/hooks/useUser";
import { useDisplayCurrency } from "@/lib/preferences";
import { useSeo } from "@/lib/seo";
import { decodeShare, buildShareUrl, type ShareState } from "@/lib/share";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  ScenarioValuation,
  type ValuationTab,
} from "@/components/ScenarioValuation";
import type { ValuationModel } from "@/lib/scenarioValuation";

const CURATED = tickers as { symbol: string; name: string }[];
const TICKER_NAMES: Record<string, string> = Object.fromEntries(
  CURATED.map((c) => [c.symbol.toUpperCase(), c.name]),
);

// "Explore" — search any company by ticker and run the same valuation models
// available on the dashboard (Scenarios / DCF / Reverse / Graham / Monte Carlo /
// SoTP), without needing to own it. Live fundamentals come from
// fundamentals-get's `?quote=` mode; the valuation panel is reused verbatim with
// shares/avgCost = 0 (its engine returns null for the "vs cost" ratios then).
function ExploreInner({ routeTicker }: { routeTicker: string | null }) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { currency } = useDisplayCurrency();

  // On a /explore/:ticker route we know the name up front (from the curated
  // list), so the heading + SEO tags render immediately — the live numbers fill
  // in async. Falls back to the raw symbol for tickers outside the list.
  const staticName = routeTicker ? TICKER_NAMES[routeTicker] ?? null : null;
  const displayName = staticName ?? routeTicker ?? "";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TickerSearchResult | null>(null);
  const [company, setCompany] = useState<LiveCompany | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Share-link support: a ?s= param carries {ticker, tab, model}. Decoded
  // exactly once on mount (state initializer → stable object) so the panel's
  // load effect doesn't re-run. A bad/tampered param degrades to null.
  const [shared] = useState<ShareState | null>(() => {
    const p = new URLSearchParams(window.location.search).get("s");
    return p ? decodeShare(p) : null;
  });
  const [copied, setCopied] = useState(false);
  // Latest model+tab from the valuation panel, for building the share URL.
  const shareStateRef = useRef<{ model: ValuationModel; tab: ValuationTab } | null>(null);
  const onValuationState = useCallback(
    (model: ValuationModel, tab: ValuationTab) => {
      shareStateRef.current = { model, tab };
    },
    [],
  );

  useSeo(
    routeTicker
      ? {
          title: t("seo.exploreTickerNameTitle", {
            name: displayName,
            ticker: routeTicker,
          }),
          description: t("seo.exploreTickerDesc", {
            name: displayName,
            ticker: routeTicker,
          }),
          url: `https://www.trimmtrack.com/explore/${routeTicker.toLowerCase()}`,
        }
      : {
          title: company
            ? t("seo.exploreTickerTitle", { ticker: company.ticker })
            : t("seo.exploreTitle"),
          description: t("seo.exploreDesc"),
          url: "https://www.trimmtrack.com/explore",
        },
  );

  // /explore/:ticker → auto-load that company on mount. A synthetic `selected`
  // suppresses the autocomplete dropdown and feeds the header its name + logo.
  useEffect(() => {
    if (!routeTicker) return;
    setSelected({ symbol: routeTicker, name: displayName, exchange: null, type: null });
    setQuery(routeTicker);
    setCompany(null);
    setError(null);
    setLoading(true);
    let cancelled = false;
    getLiveCompany(routeTicker)
      .then((c) => {
        if (cancelled) return;
        if (c) setCompany(c);
        else setError(t("explore.notFound"));
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTicker]);

  // Opening a share link auto-loads its ticker, same path as picking a result.
  useEffect(() => {
    if (!shared) return;
    setQuery(shared.t);
    setLoading(true);
    getLiveCompany(shared.t)
      .then((c) => {
        if (c) setCompany(c);
        else setError(t("explore.notFound"));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  async function handleShare() {
    const cur = shareStateRef.current;
    if (!company) return;
    const url = buildShareUrl({
      t: company.ticker,
      tab: cur?.tab,
      m: cur?.model,
    });
    // Reflect the link in the address bar too, so it can be copied manually.
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied → the address bar already holds the link */
    }
  }

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
        <h1 className="text-2xl font-semibold text-slate-900">
          {routeTicker
            ? t("explore.tickerHeading", { name: displayName, ticker: routeTicker })
            : t("explore.title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          {routeTicker
            ? t("explore.tickerSubtitle", { name: displayName })
            : t("explore.subtitle")}
        </p>
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

      {company && (
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
                {selected?.name ?? staticName ?? company.ticker}
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
            <button
              type="button"
              onClick={() => void handleShare()}
              className="btn-ghost px-3 py-1.5 text-xs"
              title={t("explore.shareHint")}
            >
              {copied ? `✓ ${t("explore.shareCopied")}` : `🔗 ${t("explore.share")}`}
            </button>
          </div>

          {!user && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-slate-600">
              {t("explore.tryFree")}{" "}
              <a href="/auth/sign-in" className="font-medium text-brand-700 underline">
                {t("explore.signInToSave")}
              </a>
            </div>
          )}

          <div className="border-t border-slate-200 pt-4">
            <ScenarioValuation
              userId={user?.id ?? ""}
              ticker={company.ticker}
              shares={0}
              avgCostEur={0}
              currentPrice={company.price}
              quoteCurrency={company.currency ?? currency}
              fundamentals={company.fundamentals}
              totalPortfolioValueEur={0}
              displayCurrency={currency}
              fxRates={{}}
              initialModel={
                shared && company.ticker === shared.t ? shared.m ?? null : null
              }
              initialTab={
                shared && company.ticker === shared.t && isValuationTab(shared.tab)
                  ? shared.tab
                  : null
              }
              onStateChange={onValuationState}
            />
          </div>
        </section>
      )}

      <PopularCompanies exclude={routeTicker} />
    </div>
  );
}

// Internal-link grid to the per-ticker pages: gives Google a crawl path to
// every /explore/:ticker (alongside the sitemap) and lets visitors jump between
// companies. Also renders as indexable, keyword-rich anchor text.
function PopularCompanies({ exclude }: { exclude: string | null }) {
  const { t } = useTranslation();
  const list = CURATED.filter((c) => c.symbol.toUpperCase() !== exclude).slice(0, 30);
  return (
    <section className="border-t border-slate-200 pt-6">
      <h2 className="text-sm font-semibold text-slate-700">{t("explore.popularTitle")}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {list.map((c) => (
          <Link
            key={c.symbol}
            to={`/explore/${c.symbol.toLowerCase()}`}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            {c.name}
          </Link>
        ))}
      </div>
    </section>
  );
}

const VALUATION_TABS = [
  "scenarios",
  "dcf",
  "reverse",
  "graham",
  "montecarlo",
  "sotp",
] as const;

function isValuationTab(v: string | undefined): v is ValuationTab {
  return v != null && (VALUATION_TABS as readonly string[]).includes(v);
}

export function ExplorePage() {
  const { ticker } = useParams();
  const routeTicker = ticker ? ticker.toUpperCase() : null;
  // Remount on ticker change so per-route state (loaded company, share) resets
  // cleanly instead of leaking between /explore/aapl and /explore/msft.
  return <ExploreInner key={routeTicker ?? "hub"} routeTicker={routeTicker} />;
}
