import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LocaleLink } from "@/components/LocaleLink";
import { useSeo } from "@/lib/seo";
import { localeUrl, type Locale } from "@/lib/locale";

// Shared scaffold for the search-intent tool landing pages. Renders a keyword
// H1, the interactive calculator, 400–600 words of educational prose + a worked
// example, an FAQ, and a CTA into the product. Emits SoftwareApplication +
// FAQPage JSON-LD and a self-referencing canonical.
//
// Pages are addressed by ROUTE_SLUGS route id rather than a literal path, so the
// canonical and the hreflang cluster are built from the same slug table the
// router and the sitemap read. A page that exists in three languages gets three
// reciprocal URLs for free; one that exists only in English passes
// alternates={["en"]} and advertises no ca/es URL that would 404.

export type Faq = { q: string; a: ReactNode };

export type ToolPageProps = {
  /**
   * This page's slug WITHOUT the locale prefix, worded for `locale`
   * ("/calculadora-dcf" in ca/es, "/dcf-calculator" in en). Usually
   * ROUTE_SLUGS[id][locale]; English-only pages pass their literal slug.
   */
  path: string;
  /** Locale this instance renders in; drives canonical, JSON-LD url and copy. */
  locale: Locale;
  /** Locales this page actually exists in (reciprocal hreflang set). */
  alternates: Locale[];
  seoTitle: string;
  seoDescription: string;
  appName: string;
  h1: string;
  lead: ReactNode;
  tool: ReactNode;
  sections: { title: string; body: ReactNode }[];
  example: { title: string; body: ReactNode };
  faqs: Faq[];
  cta?: {
    title: string;
    body: string;
    primaryTo: string;
    primaryLabel: string;
    secondaryTo?: string;
    secondaryLabel?: string;
  };
};

/** Plain-text version of an FAQ answer for the schema (strips any JSX). */
function faqText(a: ReactNode): string {
  if (typeof a === "string") return a;
  if (Array.isArray(a)) return a.map(faqText).join(" ");
  return "";
}

export function ToolPage(props: ToolPageProps) {
  const { path, locale, alternates, appName, faqs } = props;
  const { t } = useTranslation();
  const canonical = localeUrl(path, locale);

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          name: appName,
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: canonical,
          inLanguage: locale,
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
          isAccessibleForFree: true,
        },
        {
          "@type": "FAQPage",
          inLanguage: locale,
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: faqText(f.a) },
          })),
        },
      ],
    }),
    [appName, canonical, faqs, locale],
  );

  useSeo({
    title: props.seoTitle,
    description: props.seoDescription,
    path,
    alternates,
    jsonLd,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{props.h1}</h1>
        <p className="mt-2 text-slate-600">{props.lead}</p>
      </header>

      {props.tool}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">{props.example.title}</h2>
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-700">
          {props.example.body}
        </div>
      </section>

      {props.sections.map((s) => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">{s.title}</h2>
          <div className="space-y-3 text-sm leading-relaxed text-slate-600">{s.body}</div>
        </section>
      ))}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">{t("tools.faqHeading")}</h2>
        <dl className="space-y-4">
          {faqs.map((f) => (
            <div key={f.q}>
              <dt className="font-medium text-slate-900">{f.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-600">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {props.cta ? (
        <section className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/60 p-6 ring-1 ring-brand-200">
          <h2 className="text-lg font-semibold text-slate-900">{props.cta.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{props.cta.body}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <LocaleLink to={props.cta.primaryTo} className="btn-primary text-sm px-4 py-2">
              {props.cta.primaryLabel}
            </LocaleLink>
            {props.cta.secondaryTo ? (
              <LocaleLink to={props.cta.secondaryTo} className="btn-ghost text-sm px-4 py-2">
                {props.cta.secondaryLabel}
              </LocaleLink>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
