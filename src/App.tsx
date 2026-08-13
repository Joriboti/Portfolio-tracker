import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";
import { LOCALES, ROUTE_SLUGS, withLocale, type Locale } from "@/lib/locale";

// Route-level code splitting: each page ships as its own chunk so the initial
// load only pulls what the current route needs (heavy deps like the Excel
// parser on /upload no longer bloat first paint). Named exports → default-map.
const HomePage = lazy(() => import("@/pages/home").then((m) => ({ default: m.HomePage })));
const AuthPage = lazy(() => import("@/pages/auth").then((m) => ({ default: m.AuthPage })));
const AccountPage = lazy(() => import("@/pages/account").then((m) => ({ default: m.AccountPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const DebugPage = lazy(() => import("@/pages/debug").then((m) => ({ default: m.DebugPage })));
const UploadPage = lazy(() => import("@/pages/upload").then((m) => ({ default: m.UploadPage })));
const ExplorePage = lazy(() => import("@/pages/explore").then((m) => ({ default: m.ExplorePage })));
const ComparePage = lazy(() => import("@/pages/compare").then((m) => ({ default: m.ComparePage })));
const ForecastPage = lazy(() => import("@/pages/forecast").then((m) => ({ default: m.ForecastPage })));
const FifoCalculatorPage = lazy(() => import("@/pages/calculadora-fifo").then((m) => ({ default: m.FifoCalculatorPage })));
const RadiografiaPage = lazy(() => import("@/pages/radiografia").then((m) => ({ default: m.RadiografiaPage })));
const TaxesPage = lazy(() => import("@/pages/taxes").then((m) => ({ default: m.TaxesPage })));
const VerifyPage = lazy(() => import("@/pages/verify").then((m) => ({ default: m.VerifyPage })));
const DisclaimerPage = lazy(() => import("@/pages/disclaimer").then((m) => ({ default: m.DisclaimerPage })));
const ResearchPage = lazy(() => import("@/pages/research").then((m) => ({ default: m.ResearchPage })));
const ResearchArticlePage = lazy(() => import("@/pages/research-article").then((m) => ({ default: m.ResearchArticlePage })));
const NotFoundPage = lazy(() => import("@/pages/not-found").then((m) => ({ default: m.NotFoundPage })));

// About / privacy / terms — static prose, one component, three ids × three
// languages (slugs come from ROUTE_SLUGS like every other translated page).
const TrustPage = lazy(() => import("@/pages/trust").then((m) => ({ default: m.TrustPage })));

// Catalan/Spanish versions of the four valuation tool landings.
const CaDcfPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.CaDcfPage })));
const CaReverseDcfPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.CaReverseDcfPage })));
const CaGrahamPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.CaGrahamPage })));
const CaMonteCarloPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.CaMonteCarloPage })));
const EsDcfPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.EsDcfPage })));
const EsReverseDcfPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.EsReverseDcfPage })));
const EsGrahamPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.EsGrahamPage })));
const EsMonteCarloPage = lazy(() => import("@/pages/tools-localized").then((m) => ({ default: m.EsMonteCarloPage })));

// English-only SEO tool pages (phase 1). Each targets one keyword under /en/*.
const DcfCalculatorPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.DcfCalculatorPage })));
const ReverseDcfCalculatorPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.ReverseDcfCalculatorPage })));
const GrahamNumberCalculatorPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.GrahamNumberCalculatorPage })));
const MonteCarloStockSimulatorPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.MonteCarloStockSimulatorPage })));
const EtfGrowthCalculatorPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.EtfGrowthCalculatorPage })));
const FifoCapitalGainsCalculatorPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.FifoCapitalGainsCalculatorPage })));
const PortfolioTrackerPage = lazy(() => import("@/pages/en-tools").then((m) => ({ default: m.PortfolioTrackerPage })));

// Wrap any page that should require an authenticated session. The auth
// routes themselves stay public so the user can actually sign in.
function Private({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}

// Public, indexable pages, mirrored under each locale. Catalan lives at the bare
// path, Spanish at "/es", English at "/en" — each URL is its own crawlable,
// prerenderable page with a self-referencing canonical. Returned as a flat array
// of <Route> so it can be spread into <Routes> once per locale (React Router
// matches Route elements, not wrapper components).
//
// Paths come from withLocale(), the same helper the links, the canonical and the
// sitemap use, so a page whose slug is translated (/calculadora-fifo in ca/es,
// /fifo-capital-gains-calculator in en) is routed from that one slug table
// instead of being spelled out again here.
function publicRoutes(locale: Locale) {
  const at = (neutral: string) => withLocale(neutral, locale);
  const k = (name: string) => `${locale}:${name}`;
  return [
    <Route key={k("home")} path={at("/")} element={<HomePage />} />,
    <Route key={k("research")} path={at("/research")} element={<ResearchPage />} />,
    <Route key={k("article")} path={at("/research/:slug")} element={<ResearchArticlePage />} />,
    <Route key={k("disclaimer")} path={at("/disclaimer")} element={<DisclaimerPage />} />,
    <Route key={k("explore")} path={at("/explore")} element={<ExplorePage />} />,
    // Three segments deep, so it never competes with /explore/:ticker.
    <Route key={k("compare")} path={at("/explore/compare/:pair")} element={<ComparePage />} />,
    <Route key={k("exploreTicker")} path={at("/explore/:ticker")} element={<ExplorePage />} />,
    <Route key={k("forecast")} path={at("/forecast")} element={<ForecastPage />} />,
    <Route key={k("fifo")} path={at(ROUTE_SLUGS.fifo[locale])} element={<FifoPageFor locale={locale} />} />,
    <Route key={k("xray")} path={at("/radiografia")} element={<RadiografiaPage />} />,
    <Route key={k("taxes")} path={at("/taxes")} element={<TaxesPage />} />,
    <Route key={k("about")} path={at(ROUTE_SLUGS.about[locale])} element={<TrustPage id="about" locale={locale} />} />,
    <Route key={k("privacy")} path={at(ROUTE_SLUGS.privacy[locale])} element={<TrustPage id="privacy" locale={locale} />} />,
    <Route key={k("terms")} path={at(ROUTE_SLUGS.terms[locale])} element={<TrustPage id="terms" locale={locale} />} />,
  ];
}

// The FIFO page: ca/es use the general calculator landing, English uses the
// keyword-targeted page that already existed at /en/fifo-capital-gains-calculator.
// Routing them through one route id is what lets the two hreflang-pair instead of
// competing for the same query.
function FifoPageFor({ locale }: { locale: Locale }) {
  return locale === "en" ? <FifoCapitalGainsCalculatorPage /> : <FifoCalculatorPage />;
}

// The four valuation tools that now exist in all three languages. English copy
// lives in en-tools.tsx, Catalan and Spanish in tools-localized.tsx; the slug of
// each comes from ROUTE_SLUGS so /calculadora-dcf, /es/calculadora-dcf and
// /en/dcf-calculator are one page in three languages.
const LOCALIZED_TOOLS = [
  { id: "dcf", ca: CaDcfPage, es: EsDcfPage, en: DcfCalculatorPage },
  { id: "reverseDcf", ca: CaReverseDcfPage, es: EsReverseDcfPage, en: ReverseDcfCalculatorPage },
  { id: "graham", ca: CaGrahamPage, es: EsGrahamPage, en: GrahamNumberCalculatorPage },
  { id: "monteCarlo", ca: CaMonteCarloPage, es: EsMonteCarloPage, en: MonteCarloStockSimulatorPage },
] as const;

function toolRoutes() {
  return LOCALIZED_TOOLS.flatMap(({ id, ...byLocale }) =>
    LOCALES.map((l) => {
      const Page = byLocale[l];
      return (
        <Route
          key={`${l}:tool:${id}`}
          path={withLocale(ROUTE_SLUGS[id][l], l)}
          element={<Page />}
        />
      );
    }),
  );
}

export default function App() {
  return (
    <>
    <Analytics />
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 text-slate-400" />}>
    <Routes>
      <Route element={<Layout />}>
        {/* App / auth routes stay unprefixed: they're behind auth or a trial and
            are Disallow-ed in robots.txt, so they need no per-language URL. The
            UI language on them still follows the i18next localStorage choice. */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/:pathname" element={<AuthPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/debug" element={<Private><DebugPage /></Private>} />
        {/* Folded into /upload (Build portfolio → Excel subsection). */}
        <Route path="/how-to-prepare" element={<Navigate to="/upload" replace />} />
        <Route path="/account" element={<Private><AccountPage /></Private>} />
        <Route path="/account/:pathname" element={<Private><AccountPage /></Private>} />

        {/* Public but unprefixed and out of the sitemap: anyone can check a
            card, yet /verify/:code renders one person's portfolio, so it is
            noindex'd per route rather than crawled in three languages. */}
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/verify/:code" element={<VerifyPage />} />

        {/* Public content — indexable, no auth gate — in all three languages. */}
        {LOCALES.map((l) => publicRoutes(l))}

        {/* Search-intent tool landings, one route per (tool, language). */}
        {toolRoutes()}

        {/* Still English-only, deliberately: a ca/es "ETF growth" page would
            compete with /forecast and a ca/es "portfolio tracker" page with the
            home page, which already own those intents in those languages. */}
        <Route path="/en/etf-growth-calculator" element={<EtfGrowthCalculatorPage />} />
        <Route path="/en/portfolio-tracker" element={<PortfolioTrackerPage />} />

        {/* Unknown paths render a real 404 in the language of the URL. They used
            to redirect to the home page, which told Google a typo and the home
            page were the same document. Vercel serves the prerendered copy of
            this page with a 404 status; this route is the in-app equivalent. */}
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
    </>
  );
}
