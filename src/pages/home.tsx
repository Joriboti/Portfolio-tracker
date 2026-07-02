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
            <Link to="/upload" className="btn-ghost px-5 py-2.5 text-base">
              {t("home.ctaHowTo")}
            </Link>
          </div>
        </div>

        {/* Preview of the actual output, so a first-time visitor knows what
            they'll get. Decorative mock — illustrative numbers only. */}
        <figure className="mt-16">
          <DashboardPreview />
          <figcaption className="mt-3 text-center text-xs text-slate-400">
            {t("home.previewCaption")}
          </figcaption>
        </figure>

        {/* How it works, in 3 steps. */}
        <section className="mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900">
            {t("home.steps.title")}
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Step n="1" title={t("home.steps.s1t")} desc={t("home.steps.s1d")} />
            <Step n="2" title={t("home.steps.s2t")} desc={t("home.steps.s2d")} />
            <Step n="3" title={t("home.steps.s3t")} desc={t("home.steps.s3d")} />
          </div>
        </section>

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

        {/* Trust strip. */}
        <section className="mt-16 grid gap-4 rounded-2xl border border-slate-200 bg-white/60 p-6 sm:grid-cols-3">
          <Trust icon={<IconLock />} title={t("home.trust.t1t")} desc={t("home.trust.t1d")} />
          <Trust icon={<IconChart />} title={t("home.trust.t2t")} desc={t("home.trust.t2d")} />
          <Trust icon={<IconSteer />} title={t("home.trust.t3t")} desc={t("home.trust.t3d")} />
        </section>

        <div className="mt-14 text-center">
          <Link to="/disclaimer" className="btn-primary px-6 py-3 text-base">
            {t("home.ctaStart")}
          </Link>
        </div>
      </div>
    </div>
  );
}

// Illustrative, non-interactive mock of the dashboard so visitors can picture
// the output. Numbers are fake and hard-coded; not localized on purpose.
function DashboardPreview() {
  return (
    <div
      aria-hidden
      className="pointer-events-none mx-auto max-w-4xl select-none rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">
          La meva cartera
        </span>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">
          demo
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PreviewStat label="Valor total" value="24.860 €" />
        <PreviewStat label="Cost" value="18.400 €" />
        <PreviewStat label="P&L no realitzat" value="+6.460 €" tone="pos" />
        <PreviewStat label="TIR anual" value="+14,2 %" tone="pos" />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-100">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr] bg-slate-50 px-3 py-2 text-[10px] uppercase tracking-wide text-slate-400">
          <span>Ticker</span>
          <span className="text-right">Valor</span>
          <span className="text-right">Pes</span>
          <span className="text-right">P&L</span>
        </div>
        <PreviewRow hue="#e76b1c" ticker="NVDA" value="6.120 €" weight="24,6 %" pl="+38 %" tone="pos" />
        <PreviewRow hue="#2563eb" ticker="MSFT" value="4.980 €" weight="20,0 %" pl="+21 %" tone="pos" />
        <PreviewRow hue="#059669" ticker="ASML" value="3.740 €" weight="15,0 %" pl="-4 %" tone="neg" />
        <PreviewRow hue="#7c3aed" ticker="AAPL" value="3.010 €" weight="12,1 %" pl="+9 %" tone="pos" />
      </div>
    </div>
  );
}

function PreviewStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 text-sm font-semibold ${
          tone === "pos"
            ? "text-emerald-600"
            : tone === "neg"
              ? "text-rose-600"
              : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PreviewRow({
  hue,
  ticker,
  value,
  weight,
  pl,
  tone,
}: {
  hue: string;
  ticker: string;
  value: string;
  weight: string;
  pl: string;
  tone: "pos" | "neg";
}) {
  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr] items-center border-t border-slate-100 px-3 py-2 text-xs text-slate-700">
      <span className="flex items-center gap-2 font-medium">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
          style={{ backgroundColor: hue }}
        >
          {ticker.slice(0, 1)}
        </span>
        {ticker}
      </span>
      <span className="text-right">{value}</span>
      <span className="text-right text-slate-400">{weight}</span>
      <span
        className={`text-right font-medium ${
          tone === "pos" ? "text-emerald-600" : "text-rose-600"
        }`}
      >
        {pl}
      </span>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white/70 p-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
        {n}
      </div>
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{desc}</p>
    </div>
  );
}

function Trust({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
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

const smallIconProps = { ...iconProps, width: 18, height: 18 };

function IconLock() {
  return (
    <svg {...smallIconProps}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg {...smallIconProps}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-4" />
      <path d="M13 16V8" />
      <path d="M18 16v-6" />
    </svg>
  );
}

function IconSteer() {
  return (
    <svg {...smallIconProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3.5v6M4.2 16l5.3-3M19.8 16l-5.3-3" />
    </svg>
  );
}
