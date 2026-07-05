import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FifoCalculator } from "@/components/FifoCalculator";
import { useSeo } from "@/lib/seo";

// Public, indexable landing page for the FIFO realized-gain calculator. The
// calculator itself already lives inside /upload; this standalone page targets
// the search query ("calculadora FIFO acciones/criptos plusvalía") with real
// educational copy + FAQ schema, and funnels into the product via the CTA.

const FAQ_KEYS = ["what", "crypto", "partial", "tax"] as const;

export function FifoCalculatorPage() {
  const { t } = useTranslation();

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          name: t("fifoPage.h1"),
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: "https://www.trimmtrack.com/calculadora-fifo",
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
        },
        {
          "@type": "FAQPage",
          mainEntity: FAQ_KEYS.map((k) => ({
            "@type": "Question",
            name: t(`fifoPage.faq.${k}.q`),
            acceptedAnswer: { "@type": "Answer", text: t(`fifoPage.faq.${k}.a`) },
          })),
        },
      ],
    }),
    [t],
  );

  useSeo({
    title: t("fifoPage.seoTitle"),
    description: t("fifoPage.seoDesc"),
    url: "https://www.trimmtrack.com/calculadora-fifo",
    jsonLd,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">{t("fifoPage.h1")}</h1>
        <p className="mt-2 text-slate-600">{t("fifoPage.lead")}</p>
      </header>

      <FifoCalculator />

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">{t("fifoPage.whatTitle")}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{t("fifoPage.whatBody")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">{t("fifoPage.howTitle")}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{t("fifoPage.howBody")}</p>
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900">{t("fifoPage.exampleTitle")}</p>
          <p className="mt-1 leading-relaxed">{t("fifoPage.exampleBody")}</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">{t("fifoPage.faqTitle")}</h2>
        <dl className="space-y-4">
          {FAQ_KEYS.map((k) => (
            <div key={k}>
              <dt className="font-medium text-slate-900">{t(`fifoPage.faq.${k}.q`)}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                {t(`fifoPage.faq.${k}.a`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/60 p-6 ring-1 ring-brand-200">
        <h2 className="text-lg font-semibold text-slate-900">{t("fifoPage.ctaTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("fifoPage.ctaBody")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/upload" className="btn-primary text-sm px-4 py-2">
            {t("fifoPage.ctaPrimary")}
          </Link>
          <Link to="/explore" className="btn-ghost text-sm px-4 py-2">
            {t("fifoPage.ctaSecondary")}
          </Link>
        </div>
      </section>

      <p className="text-xs text-slate-400">{t("fifoPage.taxNote")}</p>
    </div>
  );
}
