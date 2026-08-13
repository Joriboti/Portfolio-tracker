import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getInsights, type CompanyInsights as Insights } from "@/lib/research";
import { useLocale } from "@/components/LocaleLink";
import { stripLocale, withLocale, DEFAULT_LOCALE } from "@/lib/locale";

// "Insights" section of the company dashboard: qualitative competitive
// advantages / investment risks, authored in the Notion research CMS and keyed
// by ticker. Self-contained — it fetches its own data and renders nothing when
// no insights are authored for the ticker (most of the ~80 pages), so it never
// shows an empty shell. Doubles as unique, human-written SEO copy per page.

export function CompanyInsights({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { pathname } = useLocation();
  const [data, setData] = useState<Insights | null>(null);
  const [hasCatalan, setHasCatalan] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setHasCatalan(false);
    getInsights(ticker, locale).then((r) => {
      if (cancelled) return;
      setData(r.insights);
      setHasCatalan(r.hasCatalan);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker, locale]);

  if (!data || (data.pros.length === 0 && data.risks.length === 0)) {
    // Nothing authored in THIS language. Never fall back to the Catalan text —
    // point at the Catalan page instead and keep the quantitative sections,
    // which are translated, exactly where they were.
    if (!hasCatalan || locale === DEFAULT_LOCALE) return null;
    return (
      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <p className="text-sm text-slate-600">{t("insights.unavailable")}</p>
        <Link
          to={withLocale(stripLocale(pathname), DEFAULT_LOCALE)}
          hrefLang={DEFAULT_LOCALE}
          className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline"
        >
          {t("insights.viewCatalan")} →
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">
          {t("company.insights.title")}
        </h3>
        <span className="text-[11px] text-slate-400">
          {t("company.insights.source")}
        </span>
      </div>
      {data.thesis && (
        <p className="text-sm leading-relaxed text-slate-600">{data.thesis}</p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.pros.length > 0 && (
          <InsightCard
            title={t("company.insights.pros")}
            items={data.pros}
            tone="pos"
          />
        )}
        {data.risks.length > 0 && (
          <InsightCard
            title={t("company.insights.risks")}
            items={data.risks}
            tone="neg"
          />
        )}
      </div>
    </section>
  );
}

function InsightCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "pos" | "neg";
}) {
  const pos = tone === "pos";
  return (
    <div className="card">
      <h4
        className={`text-sm font-semibold ${
          pos ? "text-emerald-700" : "text-rose-700"
        }`}
      >
        {title}
      </h4>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-slate-700">
            <span
              className={`mt-0.5 select-none ${
                pos ? "text-emerald-500" : "text-rose-500"
              }`}
              aria-hidden="true"
            >
              {pos ? "✓" : "!"}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
