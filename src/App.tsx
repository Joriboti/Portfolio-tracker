import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";
import { PREFIXED_LOCALES } from "@/lib/locale";

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
const DisclaimerPage = lazy(() => import("@/pages/disclaimer").then((m) => ({ default: m.DisclaimerPage })));
const ResearchPage = lazy(() => import("@/pages/research").then((m) => ({ default: m.ResearchPage })));
const ResearchArticlePage = lazy(() => import("@/pages/research-article").then((m) => ({ default: m.ResearchArticlePage })));

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

// Public, indexable pages, mirrored under each locale prefix. Catalan lives at
// the bare path (prefix ""), Spanish at "/es", English at "/en" — each URL is
// its own crawlable, prerenderable page with a self-referencing canonical.
// Returned as a flat array of <Route> so it can be spread into <Routes> three
// times (React Router matches Route elements, not wrapper components).
function publicRoutes(prefix: "" | "/es" | "/en") {
  const at = (path: string) => (path === "/" ? prefix || "/" : `${prefix}${path}`);
  return [
    <Route key={`${prefix}:home`} path={at("/")} element={<HomePage />} />,
    <Route key={`${prefix}:research`} path={at("/research")} element={<ResearchPage />} />,
    <Route key={`${prefix}:article`} path={at("/research/:slug")} element={<ResearchArticlePage />} />,
    <Route key={`${prefix}:disclaimer`} path={at("/disclaimer")} element={<DisclaimerPage />} />,
    <Route key={`${prefix}:explore`} path={at("/explore")} element={<ExplorePage />} />,
    // Three segments deep, so it never competes with /explore/:ticker.
    <Route key={`${prefix}:compare`} path={at("/explore/compare/:pair")} element={<ComparePage />} />,
    <Route key={`${prefix}:exploreTicker`} path={at("/explore/:ticker")} element={<ExplorePage />} />,
    <Route key={`${prefix}:forecast`} path={at("/forecast")} element={<ForecastPage />} />,
    <Route key={`${prefix}:fifo`} path={at("/calculadora-fifo")} element={<FifoCalculatorPage />} />,
    <Route key={`${prefix}:xray`} path={at("/radiografia")} element={<RadiografiaPage />} />,
    <Route key={`${prefix}:taxes`} path={at("/taxes")} element={<TaxesPage />} />,
  ];
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

        {/* Public content — indexable, no auth gate — in all three languages. */}
        {publicRoutes("")}
        {publicRoutes("/es")}
        {publicRoutes("/en")}

        {/* English-only SEO tool pages (phase 1). Keyword-targeted, signup-free. */}
        <Route path="/en/dcf-calculator" element={<DcfCalculatorPage />} />
        <Route path="/en/reverse-dcf-calculator" element={<ReverseDcfCalculatorPage />} />
        <Route path="/en/graham-number-calculator" element={<GrahamNumberCalculatorPage />} />
        <Route path="/en/monte-carlo-stock-simulator" element={<MonteCarloStockSimulatorPage />} />
        <Route path="/en/etf-growth-calculator" element={<EtfGrowthCalculatorPage />} />
        <Route path="/en/fifo-capital-gains-calculator" element={<FifoCapitalGainsCalculatorPage />} />
        <Route path="/en/portfolio-tracker" element={<PortfolioTrackerPage />} />

        {/* Unknown paths fall back to the same-language home, else the root. */}
        {PREFIXED_LOCALES.map((l) => (
          <Route key={`${l}:catchall`} path={`/${l}/*`} element={<Navigate to={`/${l}`} replace />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
    </>
  );
}
