import { useTranslation } from "react-i18next";
import { LocaleLink } from "@/components/LocaleLink";
import { useLocale } from "@/components/LocaleLink";
import { useSeo } from "@/lib/seo";

// Real "not found" page, in the language of the URL that was asked for.
//
// It replaced a `<Navigate to="/">`: redirecting every unknown path to the home
// page told Google that /whatever-typo and / were the same page, and it meant a
// broken link looked like a working one. Vercel now answers genuinely unknown
// paths with a 404 status and a prerendered copy of this page (see vercel.json
// and scripts/prerender.mjs); this component is the client-side counterpart for
// a path the router cannot match after the app has booted.
export function NotFoundPage() {
  const { t } = useTranslation();
  const locale = useLocale();

  useSeo({
    title: t("notFound.title"),
    description: t("notFound.description"),
    // Never indexable, and never advertising alternates: this page has no
    // canonical identity of its own.
    noindex: true,
    alternates: [locale],
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <p className="font-display text-6xl text-brand-600">404</p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
        {t("notFound.heading")}
      </h1>
      <p className="mx-auto mt-3 max-w-prose text-slate-600">{t("notFound.body")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <LocaleLink to="/" className="btn-primary text-sm px-5 py-2">
          {t("notFound.home")}
        </LocaleLink>
        <LocaleLink to="/explore" className="btn-ghost text-sm px-5 py-2">
          {t("nav.explore")}
        </LocaleLink>
        <LocaleLink to="/research" className="btn-ghost text-sm px-5 py-2">
          {t("nav.research")}
        </LocaleLink>
      </div>
    </div>
  );
}
