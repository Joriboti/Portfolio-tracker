import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { LocaleLink, useLocale } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import { companyName, pairSlug, pairsFor } from "@/lib/compare";
import { ComparePicker } from "@/components/ComparePicker";
import { SITE_ORIGIN, localeUrl } from "@/lib/locale";
import { shareOnX } from "@/lib/brand";
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
import { CompanyOverview } from "@/components/CompanyOverview";
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
  const locale = useLocale();
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
  // "Resum" (company overview) | "Valoració" (the 6 models). A share link
  // carries valuation assumptions, so it opens on the valuation tab.
  const [view, setView] = useState<"overview" | "valuation">(() =>
    new URLSearchParams(window.location.search).get("s") ? "valuation" : "overview",
  );
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
          // Only curated tickers get a build-time card; a searched-for ticker
          // outside the list falls back to the generic og.png.
          image: staticName
            ? `${SITE_ORIGIN}/og/${routeTicker.toLowerCase()}.png`
            : undefined,
          // /explore/:ticker resolves ANY symbol via the live API, so the route
          // can mint unlimited URLs. Only the curated list (tickers.json — the
          // same source as the sitemap and the prerender) is indexable; anything
          // else stays a working page but not a thin one competing in search.
          noindex: !staticName,
        }
      : {
          title: company
            ? t("seo.exploreTickerTitle", { ticker: company.ticker })
            : t("seo.exploreTitle"),
          description: t("seo.exploreDesc"),
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleShare()}
                className="btn-ghost px-3 py-1.5 text-xs"
                title={t("explore.shareHint")}
              >
                {copied ? `✓ ${t("explore.shareCopied")}` : `🔗 ${t("explore.share")}`}
              </button>
              {/* Plain intent URL on the canonical: no X SDK, no third-party
                  script, nothing that runs before the user chooses to share. */}
              <a
                href={shareOnX(
                  localeUrl(selected ? `/explore/${selected.symbol.toLowerCase()}` : "/explore", locale),
                  selected ? `${selected.symbol} — ${selected.name}` : t("seo.exploreTitle"),
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                𝕏 {t("research.shareX")}
              </a>
            </div>
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
            {/* Resum | Valoració tabs */}
            <div className="mb-4 flex items-center gap-1.5">
              {(["overview", "valuation"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded-full border px-4 py-1.5 text-sm ${
                    view === v
                      ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {t(v === "overview" ? "explore.tabOverview" : "explore.tabValuation")}
                </button>
              ))}
            </div>

            {view === "overview" ? (
              <CompanyOverview company={company} />
            ) : (
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
            )}
          </div>
        </section>
      )}

      {routeTicker && <ComparisonLinks ticker={routeTicker} />}
      {!routeTicker && <ComparePromo />}
      <PopularCompanies exclude={routeTicker} />
    </div>
  );
}

// The head-to-head tool, on the page where someone is already looking up a
// company. Together with the drawer entry this is what makes it reachable
// without typing a /explore/compare/… URL by hand.
function ComparePromo() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-slate-200 pt-6">
      <h2 className="text-sm font-semibold text-slate-700">{t("compare.hubTitle")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("compare.hubLead")}</p>
      <div className="mt-3">
        <ComparePicker />
      </div>
      <LocaleLink
        to="/explore/compare"
        className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
      >
        {t("compare.hubAll")} →
      </LocaleLink>
    </section>
  );
}

// Links from a company to its head-to-head pages. Without these the comparison
// pages would only be reachable from the sitemap and from each other — this is
// the crawl path in, and the natural next click for someone weighing two rivals.
function ComparisonLinks({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  // No locale plumbing needed: LocaleLink localizes the neutral path itself.
  const pairs = pairsFor(ticker);
  if (pairs.length === 0) return null;
  return (
    <section className="border-t border-slate-200 pt-6">
      <h2 className="text-sm font-semibold text-slate-700">
        {t("compare.othersTitle")}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {pairs.map((p) => (
          <LocaleLink
            key={pairSlug(p)}
            to={`/explore/compare/${pairSlug(p)}`}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            {companyName(p.a)} vs {companyName(p.b)}
          </LocaleLink>
        ))}
      </div>
    </section>
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
          <LocaleLink
            key={c.symbol}
            to={`/explore/${c.symbol.toLowerCase()}`}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            {c.name}
          </LocaleLink>
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
