import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PortfolioXray } from "@/components/PortfolioXray";
import { useSeo } from "@/lib/seo";

// Public, indexable landing for the Portfolio X-Ray ("Radiografia") tool: drop a
// broker Excel (parsed in the browser, never uploaded) or type a few holdings
// and get an instant diversification grade + a shareable card. Targets queries
// like "analizar mi cartera de inversión / radiografia cartera d'accions" and
// funnels into the anonymous trial dashboard. Mirrors calculadora-fifo.tsx.

const FAQ_KEYS = ["what", "privacy", "grade", "free"] as const;
const STEP_KEYS = ["one", "two", "three"] as const;

export function RadiografiaPage() {
  const { t } = useTranslation();

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          name: t("xray.h1"),
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: "https://www.trimmtrack.com/radiografia",
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
        },
        {
          "@type": "FAQPage",
          mainEntity: FAQ_KEYS.map((k) => ({
            "@type": "Question",
            name: t(`xray.faq.${k}.q`),
            acceptedAnswer: { "@type": "Answer", text: t(`xray.faq.${k}.a`) },
          })),
        },
      ],
    }),
    [t],
  );

  useSeo({
    title: t("xray.seoTitle"),
    description: t("xray.seoDesc"),
    jsonLd,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{t("xray.eyebrow")}</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900 sm:text-4xl">{t("xray.h1")}</h1>
        <p className="mt-3 text-slate-600">{t("xray.lead")}</p>
      </header>

      <PortfolioXray />

      <section className="grid gap-4 sm:grid-cols-3">
        {STEP_KEYS.map((k, i) => (
          <div key={k} className="rounded-xl border border-slate-200 p-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {i + 1}
            </div>
            <p className="mt-2 font-medium text-slate-800">{t(`xray.steps.${k}.title`)}</p>
            <p className="mt-1 text-sm text-slate-500">{t(`xray.steps.${k}.body`)}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">{t("xray.whatTitle")}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{t("xray.whatBody")}</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">{t("xray.faqTitle")}</h2>
        <dl className="space-y-4">
          {FAQ_KEYS.map((k) => (
            <div key={k}>
              <dt className="font-medium text-slate-900">{t(`xray.faq.${k}.q`)}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-600">{t(`xray.faq.${k}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/60 p-6 ring-1 ring-brand-200">
        <h2 className="text-lg font-semibold text-slate-900">{t("xray.ctaTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("xray.ctaBody")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/explore" className="btn-primary text-sm px-4 py-2">
            {t("xray.exploreCta")}
          </Link>
          <Link to="/forecast" className="btn-ghost text-sm px-4 py-2">
            {t("xray.forecastCta")}
          </Link>
        </div>
      </section>

      <p className="text-xs text-slate-400">{t("xray.disclaimer")}</p>
    </div>
  );
}
