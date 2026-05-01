import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-sm font-medium text-brand-600 uppercase tracking-wide">
          {t("app.tagline")}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          {t("home.heroTitle")}
        </h1>
        <p className="mt-4 text-lg text-slate-600">{t("home.heroSubtitle")}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/disclaimer" className="btn-primary">
            {t("home.ctaStart")}
          </Link>
          <Link to="/how-to-prepare" className="btn-ghost">
            {t("home.ctaHowTo")}
          </Link>
        </div>
      </div>

      <div className="mt-20 grid gap-6 md:grid-cols-3">
        <Feature
          title={t("home.feat1Title")}
          desc={t("home.feat1Desc")}
        />
        <Feature
          title={t("home.feat2Title")}
          desc={t("home.feat2Desc")}
        />
        <Feature
          title={t("home.feat3Title")}
          desc={t("home.feat3Desc")}
        />
      </div>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{desc}</p>
    </div>
  );
}
