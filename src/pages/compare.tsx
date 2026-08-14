import { Fragment, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { LocaleLink } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import {
  getLiveCompany,
  getSotpQuotes,
  getStatements,
  type LiveCompany,
} from "@/lib/api";
import {
  COMPARE_PAIRS,
  alignSeries,
  canonicalPair,
  companyName,
  convertValues,
  fxSymbol,
  isCuratedPair,
  pairSlug,
  parsePairSlug,
  type Pair,
} from "@/lib/compare";
import { ComparePicker } from "@/components/ComparePicker";
import {
  formatCompact,
  formatSignedPct,
  ttm,
  yoyLatest,
  type CompanyStatements,
  type StatementMetrics,
} from "@/lib/statements";
import { QuarterlyBars } from "@/components/QuarterlyBars";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useSeo } from "@/lib/seo";
import { withLocale, localeFromPath, SITE_ORIGIN } from "@/lib/locale";

// Programmatic head-to-head pages (/explore/compare/aapl-vs-msft). Every figure
// reuses the company dashboard's data path — ?quote= for live fundamentals and
// ?statements= for the quarterly history — so these pages add a large, indexable
// surface without a single new API route or table.

const COLOR_A = "#d1550f"; // brand-600
const COLOR_B = "#0ea5e9";

type Side = { company: LiveCompany | null; statements: CompanyStatements | null };

export function ComparePage() {
  const { pair: slug } = useParams();
  const locale = localeFromPath(useLocation().pathname);
  const parsed = slug ? parsePairSlug(slug) : null;

  // A malformed slug has no page; any other spelling redirects to the one
  // canonical direction so /msft-vs-aapl and /aapl-vs-msft never compete as
  // duplicates. Both stay inside the current language.
  if (!parsed) return <Navigate to={withLocale("/explore/compare", locale)} replace />;
  const canonical = pairSlug(canonicalPair(parsed));
  if (slug !== canonical) {
    return (
      <Navigate to={withLocale(`/explore/compare/${canonical}`, locale)} replace />
    );
  }
  return <CompareInner key={canonical} pair={parsePairSlug(canonical)!} />;
}

// The hub the head-to-head pages hang off: pick any two companies, or take one
// of the pairs that already has a page. Deliberately out of the sitemap and
// noindex — every pair it lists is indexed on its own, so this is navigation.
export function CompareHubPage() {
  const { t } = useTranslation();
  useSeo({
    title: t("seo.compareHubTitle"),
    description: t("seo.compareHubDesc"),
    noindex: true,
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
          {t("compare.hubTitle")}
        </h1>
        <p className="text-sm text-slate-600">{t("compare.hubLead")}</p>
      </header>
      <ComparePicker />
      <section className="border-t border-slate-200 pt-6">
        <h2 className="text-sm font-semibold text-slate-700">
          {t("compare.hubPairsTitle")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {COMPARE_PAIRS.map((p) => (
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
    </div>
  );
}

function CompareInner({ pair }: { pair: Pair }) {
  const { t } = useTranslation();
  const [a, setA] = useState<Side>({ company: null, statements: null });
  const [b, setB] = useState<Side>({ company: null, statements: null });
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"q" | "a">("q");

  const nameA = companyName(pair.a);
  const nameB = companyName(pair.b);

  // Any two symbols get a working page, but only the curated pairs are
  // sitemapped, prerendered and given a build-time card — the rest would be an
  // unbounded set of thin near-duplicates in search. Same deal as a searched-for
  // ticker on /explore/:ticker.
  const curated = isCuratedPair(pair);
  useSeo({
    title: t("seo.compareTitle", { a: nameA, b: nameB }),
    description: t("seo.compareDesc", { a: nameA, b: nameB }),
    image: curated ? `${SITE_ORIGIN}/og/compare-${pairSlug(pair)}.png` : undefined,
    noindex: !curated,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getLiveCompany(pair.a).catch(() => null),
      getLiveCompany(pair.b).catch(() => null),
      getStatements(pair.a).catch(() => null),
      getStatements(pair.b).catch(() => null),
    ])
      .then(([ca, cb, sa, sb]) => {
        if (cancelled) return;
        setA({ company: ca, statements: sa });
        setB({ company: cb, statements: sb });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pair.a, pair.b]);

  // Filing currencies, NOT quote currencies: an ADR like TSM quotes in USD and
  // reports in TWD, so its revenue is ~30x an American peer's in raw units.
  // Absolute figures are only comparable once B is converted into A's currency.
  const ccyA = a.statements?.panel?.financialCurrency ?? a.company?.currency ?? null;
  const ccyB = b.statements?.panel?.financialCurrency ?? b.company?.currency ?? null;
  const fxNeeded = ccyA && ccyB ? fxSymbol(ccyB, ccyA) : null;

  useEffect(() => {
    let cancelled = false;
    if (!fxNeeded) {
      setFxRate(null);
      return;
    }
    getSotpQuotes([fxNeeded])
      .then((q) => {
        if (!cancelled) setFxRate(q[fxNeeded]?.price ?? null);
      })
      .catch(() => {
        if (!cancelled) setFxRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fxNeeded]);

  // Absolute figures are only shown once we can put both sides in one currency.
  const converted = !fxNeeded || fxRate != null;
  const rateB = fxNeeded ? (fxRate ?? 1) : 1;

  const rowsA = period === "q" ? (a.statements?.quarters ?? []) : (a.statements?.annual ?? []);
  const rowsB = period === "q" ? (b.statements?.quarters ?? []) : (b.statements?.annual ?? []);

  const chart = (key: keyof StatementMetrics) => {
    const s = alignSeries(rowsA, rowsB, key, {
      annual: period === "a",
      last: period === "q" ? 16 : 12,
    });
    return { labels: s.labels, a: s.a, b: convertValues(s.b, rateB) };
  };

  const money = (v: number) => formatCompact(v, ccyA);
  const perShare = (v: number) => v.toFixed(2);

  const charts = converted
    ? ([
        ["company.charts.revenue", chart("revenue"), money],
        ["company.charts.netIncome", chart("netIncome"), money],
        ["company.charts.fcf", chart("fcf"), money],
        ["company.charts.eps", chart("eps"), perShare],
        ["company.charts.ebitda", chart("ebitda"), money],
        ["company.charts.shares", chart("shares"), (v: number) => formatCompact(v)],
      ] as const)
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
          {t("compare.heading", { a: nameA, b: nameB })}
        </h1>
        <p className="text-sm text-slate-500">
          {t("compare.subtitle", { a: nameA, b: nameB })}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <CompanyCard side={a} symbol={pair.a} name={nameA} color={COLOR_A} />
        <CompanyCard side={b} symbol={pair.b} name={nameB} color={COLOR_B} />
      </div>

      {loading && <p className="text-sm text-slate-500">{t("company.loading")}</p>}

      {!loading && (
        <>
          <MetricsTable
            pair={pair}
            a={a}
            b={b}
            nameA={nameA}
            nameB={nameB}
            ccyA={ccyA}
            ccyB={ccyB}
          />

          {charts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-700">
                  {t("compare.chartsTitle")}
                </h2>
                <div className="flex items-center gap-1.5">
                  {(["q", "a"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        period === p
                          ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                          : "border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {t(p === "q" ? "company.toggle.quarterly" : "company.toggle.annual")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {charts.map(([titleKey, c, format]) => (
                  <QuarterlyBars
                    key={titleKey}
                    title={t(titleKey)}
                    labels={c.labels}
                    series={[
                      { name: nameA, color: COLOR_A, values: c.a },
                      { name: nameB, color: COLOR_B, values: c.b },
                    ]}
                    format={format}
                  />
                ))}
              </div>
              {fxNeeded && fxRate != null && (
                <p className="text-[11px] text-slate-400">
                  {t("compare.fxNote", {
                    name: nameB,
                    from: ccyB,
                    to: ccyA,
                    rate: fxRate.toPrecision(4),
                  })}
                </p>
              )}
              <p className="text-[11px] text-slate-400">{t("company.depthNote")}</p>
            </section>
          )}

          {!converted && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              {t("compare.fxUnavailable", { from: ccyB, to: ccyA })}
            </p>
          )}
        </>
      )}

      <section className="border-t border-slate-200 pt-6">
        <h2 className="text-sm font-semibold text-slate-700">
          {t("compare.changeTitle")}
        </h2>
        <div className="mt-3">
          <ComparePicker initialA={pair.a} initialB={pair.b} />
        </div>
      </section>

      <OtherComparisons current={pair} />
    </div>
  );
}

/* ───────────────────────── company header card ───────────────────────── */

function CompanyCard({
  side,
  symbol,
  name,
  color,
}: {
  side: Side;
  symbol: string;
  name: string;
  color: string;
}) {
  const { t } = useTranslation();
  const price = side.company?.price;
  const ccy = side.company?.currency;
  return (
    <section className="card" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <div className="flex items-center gap-2">
        <CompanyLogo ticker={symbol} website={side.company?.fundamentals.website} size={28} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{name}</h2>
          <p className="text-[11px] uppercase text-slate-400">{symbol}</p>
        </div>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">
        {price != null && ccy ? formatCompact(price, ccy) : "—"}
      </p>
      <LocaleLink
        to={`/explore/${symbol.toLowerCase()}`}
        className="mt-1 inline-block text-xs text-brand-600 hover:underline"
      >
        {t("compare.viewCompany", { name })}
      </LocaleLink>
    </section>
  );
}

/* ───────────────────────── side-by-side metrics ───────────────────────── */

function MetricsTable({
  pair,
  a,
  b,
  nameA,
  nameB,
  ccyA,
  ccyB,
}: {
  pair: Pair;
  a: Side;
  b: Side;
  nameA: string;
  nameB: string;
  ccyA: string | null;
  ccyB: string | null;
}) {
  const { t } = useTranslation();

  const rows = useMemo(() => {
    const ratio = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
    const pct = (v: number | null | undefined) => (v == null ? "—" : formatSignedPct(v));
    const side = (s: Side, ccy: string | null) => {
      const f = s.company?.fundamentals;
      const p = s.statements?.panel;
      const q = s.statements?.quarters ?? [];
      const price = s.company?.price ?? null;
      const fcf = f?.freeCashflow ?? null;
      const shares = f?.sharesOutstanding ?? null;
      const fcfYield =
        fcf != null && shares && price ? fcf / shares / price : null;
      const netCash =
        f?.totalCash != null && f?.totalDebt != null ? f.totalCash - f.totalDebt : null;
      // Money figures stay in each company's own unit here: the table labels the
      // currency per column, so unlike the shared-axis charts nothing needs
      // converting to be read correctly.
      const money = (v: number | null | undefined) =>
        v == null ? "—" : formatCompact(v, ccy);
      return {
        marketCap: money(f?.marketCap),
        pe: ratio(f?.trailingPe),
        forwardPe: ratio(f?.forwardPe),
        priceToSales: ratio(p?.priceToSales),
        evToEbitda: ratio(p?.evToEbitda),
        priceToBook: ratio(f?.priceToBook),
        profitMargin: pct(f?.profitMargin),
        operatingMargin: pct(p?.operatingMargin),
        revenueYoY: pct(yoyLatest(q, "revenue")),
        earningsYoY: pct(yoyLatest(q, "netIncome")),
        fcfYield: pct(fcfYield),
        divYield: pct(f?.dividendYield),
        payoutRatio: pct(p?.payoutRatio),
        cash: money(f?.totalCash),
        debt: money(f?.totalDebt),
        netCash: money(netCash),
        sbcTtm: money(ttm(q, "sbc")),
      };
    };
    return { A: side(a, ccyA), B: side(b, ccyB) };
  }, [a, b, ccyA, ccyB]);

  const GROUPS: Array<[string, Array<[string, keyof typeof rows.A]>]> = [
    [
      "company.panels.valuation",
      [
        ["company.rows.marketCap", "marketCap"],
        // Not company.rows.pe — that label reads "PE (TTM | NTM | +1y)" for the
        // dashboard's three-in-one row; here each PE gets its own line.
        ["compare.rows.pe", "pe"],
        ["compare.rows.forwardPe", "forwardPe"],
        ["company.rows.priceToSales", "priceToSales"],
        ["company.rows.evToEbitda", "evToEbitda"],
        ["company.rows.priceToBook", "priceToBook"],
      ],
    ],
    [
      "company.panels.marginsGrowth",
      [
        ["company.rows.profitMargin", "profitMargin"],
        ["company.rows.operatingMargin", "operatingMargin"],
        ["company.rows.revenueYoY", "revenueYoY"],
        ["company.rows.earningsYoY", "earningsYoY"],
      ],
    ],
    [
      "company.panels.cashflow",
      [
        ["company.rows.fcfYield", "fcfYield"],
        ["company.charts.sbc", "sbcTtm"],
      ],
    ],
    [
      "company.panels.balance",
      [
        ["company.rows.cash", "cash"],
        ["company.rows.debt", "debt"],
        ["company.rows.netCash", "netCash"],
      ],
    ],
    [
      "company.panels.dividend",
      [
        ["company.rows.divYield", "divYield"],
        ["company.rows.payoutRatio", "payoutRatio"],
      ],
    ],
  ];

  return (
    <section className="card overflow-x-auto">
      <h2 className="text-sm font-semibold text-slate-800">
        {t("compare.tableTitle", { a: nameA, b: nameB })}
      </h2>
      <table className="table-base mt-3 w-full text-sm">
        <thead>
          <tr>
            <th className="text-left font-medium text-slate-500" />
            <th className="text-right font-semibold text-slate-700">
              {nameA}
              {ccyA && <span className="ml-1 text-[10px] font-normal text-slate-400">{ccyA}</span>}
            </th>
            <th className="text-right font-semibold text-slate-700">
              {nameB}
              {ccyB && <span className="ml-1 text-[10px] font-normal text-slate-400">{ccyB}</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(([groupKey, items]) => (
            <Fragment key={groupKey}>
              <tr>
                <td
                  colSpan={3}
                  className="pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                >
                  {t(groupKey)}
                </td>
              </tr>
              {items.map(([labelKey, field]) => (
                <tr key={`${groupKey}:${field}`}>
                  <td className="text-slate-500">{t(labelKey)}</td>
                  <td className="text-right font-medium tabular-nums text-slate-900">
                    {rows.A[field]}
                  </td>
                  <td className="text-right font-medium tabular-nums text-slate-900">
                    {rows.B[field]}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-slate-400">
        {t("compare.tableNote", { ticker: pair.a })}
      </p>
    </section>
  );
}

/* ───────────────────────── internal links ───────────────────────── */

function OtherComparisons({ current }: { current: Pair }) {
  const { t } = useTranslation();
  // Keep the reader in the language they are browsing: these links are the crawl
  // path between the pages, so a ca link on /es would leak the whole grid back
  // to the default locale. LocaleLink now does that from the neutral path.
  const others = COMPARE_PAIRS.filter(
    (p) => !(p.a === current.a && p.b === current.b),
  ).slice(0, 24);
  return (
    <section className="border-t border-slate-200 pt-6">
      <h2 className="text-sm font-semibold text-slate-700">{t("compare.othersTitle")}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {others.map((p) => (
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
