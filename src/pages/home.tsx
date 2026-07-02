import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="relative overflow-hidden">
      {/* warm ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[28rem] bg-gradient-to-b from-brand-100/70 via-brand-50/40 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-300/20 blur-3xl"
      />

      <div className="mx-auto max-w-6xl px-4 pt-20 pb-16">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200/70 bg-white/70 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
            <Logo className="h-4 w-4" />
            {t("app.tagline")}
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
            {t("home.heroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
            {t("home.heroSubtitle")}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/disclaimer" className="btn-primary px-5 py-2.5 text-base">
              {t("home.ctaStart")}
            </Link>
            <Link
              to="/upload"
              className="btn-ghost px-5 py-2.5 text-base"
            >
              {t("home.ctaHowTo")}
            </Link>
          </div>
        </div>

        <div className="mt-24 grid gap-6 md:grid-cols-3">
          <Feature
            icon={<IconUpload />}
            title={t("home.feat1Title")}
            desc={t("home.feat1Desc")}
          />
          <Feature
            icon={<IconPulse />}
            title={t("home.feat2Title")}
            desc={t("home.feat2Desc")}
          />
          <Feature
            icon={<IconShield />}
            title={t("home.feat3Title")}
            desc={t("home.feat3Desc")}
          />
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="card group transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 transition-colors group-hover:bg-brand-100">
        {icon}
      </div>
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{desc}</p>
    </div>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconUpload() {
  return (
    <svg {...iconProps}>
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function IconPulse() {
  return (
    <svg {...iconProps}>
      <path d="M3 12h4l2 6 4-13 2 7h6" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg {...iconProps}>
      <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
