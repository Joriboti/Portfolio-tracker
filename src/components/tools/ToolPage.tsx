import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSeo } from "@/lib/seo";
import { SITE_ORIGIN, type Locale } from "@/lib/locale";

// Shared scaffold for the English SEO tool pages (/en/*). Renders a keyword H1,
// the interactive calculator, 400–600 words of educational prose + a worked
// example, an FAQ, and a CTA into the product. Emits SoftwareApplication +
// FAQPage JSON-LD and a self-referencing, English-only canonical/hreflang.

export type Faq = { q: string; a: ReactNode };

export type ToolPageProps = {
  /** Language-neutral path; the canonical becomes /en + this ("/dcf-calculator"). */
  slug: string;
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

// English-only pages: don't advertise ca/es hreflang alternates that don't exist.
const EN_ONLY: Locale[] = ["en"];

/** Plain-text version of an FAQ answer for the schema (strips any JSX). */
function faqText(a: ReactNode): string {
  if (typeof a === "string") return a;
  if (Array.isArray(a)) return a.map(faqText).join(" ");
  return "";
}

export function ToolPage(props: ToolPageProps) {
  const { slug, appName, faqs } = props;
  const canonical = `${SITE_ORIGIN}/en${slug}`;

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
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          isAccessibleForFree: true,
        },
        {
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: faqText(f.a) },
          })),
        },
      ],
    }),
    [appName, canonical, faqs],
  );

  useSeo({
    title: props.seoTitle,
    description: props.seoDescription,
    path: `/en${slug}`,
    alternates: EN_ONLY,
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
        <h2 className="text-xl font-semibold text-slate-900">Frequently asked questions</h2>
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
            <Link to={props.cta.primaryTo} className="btn-primary text-sm px-4 py-2">
              {props.cta.primaryLabel}
            </Link>
            {props.cta.secondaryTo ? (
              <Link to={props.cta.secondaryTo} className="btn-ghost text-sm px-4 py-2">
                {props.cta.secondaryLabel}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
