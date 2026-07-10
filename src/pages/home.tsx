import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import { getResearchList, type ResearchCard } from "@/lib/research";
import { useSeo } from "@/lib/seo";
import { TickerBadge, TagPill } from "./research";

export function HomePage() {
  const { t } = useTranslation();
  useSeo({
    title: t("seo.homeTitle"),
    description: t("seo.homeDesc"),
    url: "https://www.trimmtrack.com/",
  });
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background:
          "linear-gradient(163deg, #4a3320 0%, #33220f 42%, #241811 78%, #1c130c 100%)",
      }}
    >
      {/* warm ember glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -top-40 -z-0 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #e76b1c 0%, transparent 70%)" }}
      />

      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-16">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-brand-300 backdrop-blur">
            <Logo className="h-4 w-4" />
            {t("app.tagline")}
          </span>

          <h1 className="mt-7 font-display text-4xl font-semibold leading-[1.08] tracking-tight text-[#f3ead9] sm:text-6xl">
            {t("home.heroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[#c9bda9] sm:text-lg">
            {t("home.heroSubtitle")}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/explore" className="btn-primary px-5 py-2.5 text-sm sm:text-base">
              {t("home.ctaTry")}
            </Link>
            <Link
              to="/disclaimer"
              className="inline-flex items-center rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-[#f3ead9] transition-colors hover:border-white/40 hover:bg-white/5 sm:text-base"
            >
              {t("home.ctaStart")}
            </Link>
          </div>
        </div>

        {/* Preview of the actual output, so a first-time visitor knows what
            they'll get. Decorative mock — illustrative numbers only. The card
            stays light on purpose: it reads as a product screenshot. */}
        <figure className="mt-20">
          <DashboardPreview />
          <figcaption className="mt-3 text-center text-xs text-[#8a7f6d]">
            {t("home.previewCaption")}
          </figcaption>
        </figure>

        {/* How it works, in 3 steps. */}
        <section className="mt-28">
          <h2 className="text-center font-display text-3xl font-semibold tracking-tight text-[#f3ead9]">
            {t("home.steps.title")}
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Step n="1" title={t("home.steps.s1t")} desc={t("home.steps.s1d")} />
            <Step n="2" title={t("home.steps.s2t")} desc={t("home.steps.s2d")} />
            <Step n="3" title={t("home.steps.s3t")} desc={t("home.steps.s3d")} />
          </div>
        </section>

        {/* Tool showcase: cream cards + hex badges over the charcoal page,
            echoing the brand's compass tile (charcoal / orange / cream). */}
        <ToolsShowcase />

        {/* Recent research — hides itself when there's nothing published. */}
        <RecentResearch />

        {/* Trust strip. */}
        <section className="mt-20 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-3">
          <Trust icon={<IconLock />} title={t("home.trust.t1t")} desc={t("home.trust.t1d")} />
          <Trust icon={<IconChart />} title={t("home.trust.t2t")} desc={t("home.trust.t2d")} />
          <Trust icon={<IconSteer />} title={t("home.trust.t3t")} desc={t("home.trust.t3d")} />
        </section>

        <div className="mt-16 text-center">
          <Link to="/disclaimer" className="btn-primary px-7 py-3.5 text-base">
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

// Landing showcase of the 3 newest published analyses. Fetches client-side and
// renders nothing if the CMS is empty or unreachable (graceful degradation).
function RecentResearch() {
  const [articles, setArticles] = useState<ResearchCard[]>([]);
  useEffect(() => {
    let cancelled = false;
    getResearchList().then((a) => {
      if (!cancelled) setArticles(a.slice(0, 3));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (articles.length === 0) return null;

  return (
    <section className="mt-24">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-3xl font-semibold tracking-tight text-[#f3ead9]">
          Anàlisis recents
        </h2>
        <Link
          to="/research"
          className="shrink-0 text-sm font-medium text-brand-400 hover:text-brand-300"
        >
          Veure totes les anàlisis →
        </Link>
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {articles.map((a) => (
          <Link
            key={a.slug}
            to={`/research/${a.slug}`}
            className="group flex flex-col rounded-2xl p-5 shadow-lg transition-transform duration-200 hover:-translate-y-1"
            style={{ background: "linear-gradient(180deg, #f8f2e6 0%, #e8dcc6 100%)" }}
          >
            <TickerBadge ticker={a.ticker} />
            <h3 className="mt-2 font-display font-semibold text-[#26211d] group-hover:text-brand-700">
              {a.title}
            </h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-[#6b6152]">
              {a.summary}
            </p>
            {a.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.tags.slice(0, 3).map((tag) => (
                  <TagPill key={tag} tag={tag} />
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Tools showcase (dark band + cream hex cards) ────────────────────────────

const CHARCOAL = "#26211d";
const CHARCOAL_DEEP = "#100d0b";
const ORANGE = "#f2802a";

const TOOLS = [
  { key: "dashboard", to: "/dashboard", icon: <ToolIconChart /> },
  { key: "build", to: "/upload", icon: <ToolIconUpload /> },
  { key: "explore", to: "/explore", icon: <ToolIconSearch /> },
  { key: "forecast", to: "/forecast", icon: <ToolIconFan /> },
  { key: "research", to: "/research", icon: <ToolIconBook /> },
] as const;

function ToolsShowcase() {
  const { t } = useTranslation();
  return (
    <section
      className="mt-24 rounded-3xl px-5 py-10 ring-1 ring-white/10 sm:px-8"
      style={{ background: `linear-gradient(180deg, ${CHARCOAL} 0%, ${CHARCOAL_DEEP} 100%)` }}
    >
      <h2 className="text-center font-display text-3xl font-semibold text-[#f3ead9]">
        {t("home.tools.title")}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-[#c9bda9]">
        {t("home.tools.intro")}
      </p>

      {/* first/last auto-margins center the row when it fits and keep the
          start reachable when it overflows (justify-center would clip it) */}
      <div className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*:first-child]:ml-auto [&>*:last-child]:mr-auto">
        {TOOLS.map((tool) => (
          <Link
            key={tool.key}
            to={tool.to}
            className="group flex w-48 shrink-0 snap-start flex-col items-center rounded-2xl px-4 pb-6 pt-8 text-center shadow-lg transition-transform duration-200 hover:-translate-y-1.5"
            style={{ background: "linear-gradient(180deg, #f8f2e6 0%, #e8dcc6 100%)" }}
          >
            <HexBadge>{tool.icon}</HexBadge>
            <h3 className="mt-5 font-display text-lg font-semibold" style={{ color: CHARCOAL }}>
              {t(`home.tools.${tool.key}.title`)}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#6b6152]">
              {t(`home.tools.${tool.key}.desc`)}
            </p>
            <span className="mt-auto pt-4 text-xs font-semibold text-brand-700 opacity-60 transition-opacity group-hover:opacity-100">
              {t(`home.tools.${tool.key}.tag`)} →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Dark hexagon tile (thin outline + solid fill) with a centered orange icon. */
function HexBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-24 w-[104px]">
      <svg viewBox="0 0 104 96" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon
          points="27,2 77,2 101,48 77,94 27,94 3,48"
          fill="none"
          stroke={CHARCOAL}
          strokeWidth="2"
        />
        <polygon points="30,8 74,8 95,48 74,88 30,88 9,48" fill={CHARCOAL} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center" style={{ color: ORANGE }}>
        {children}
      </div>
    </div>
  );
}

const toolIconProps = {
  width: 32,
  height: 32,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ToolIconChart() {
  return (
    <svg {...toolIconProps}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="m7 14 4-4 3 3 5-6" />
    </svg>
  );
}

function ToolIconUpload() {
  return (
    <svg {...toolIconProps}>
      <path d="M12 15V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function ToolIconSearch() {
  return (
    <svg {...toolIconProps}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="M8 11.5 10 9l2 2 2.5-3" />
    </svg>
  );
}

function ToolIconFan() {
  return (
    <svg {...toolIconProps}>
      <path d="M4 19c4-1 8-4 10-8" />
      <path d="M4 19c5 .5 10-.5 14-4" />
      <path d="M4 19c3-3 5-8 5-13" />
      <circle cx="4" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ToolIconBook() {
  return (
    <svg {...toolIconProps}>
      <path d="M12 6c-2-1.5-5-1.5-8-.5V19c3-1 6-1 8 .5 2-1.5 5-1.5 8-.5V5.5c-3-1-6-1-8 .5Z" />
      <path d="M12 6v13.5" />
    </svg>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
        {n}
      </div>
      <h3 className="mt-4 font-semibold text-[#f3ead9]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#b3a793]">{desc}</p>
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
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400 ring-1 ring-inset ring-brand-500/25">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-[#f3ead9]">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[#a99e8c]">{desc}</p>
      </div>
    </div>
  );
}

const smallIconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

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
