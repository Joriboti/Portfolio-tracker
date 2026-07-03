import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";

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
const ForecastPage = lazy(() => import("@/pages/forecast").then((m) => ({ default: m.ForecastPage })));
const DisclaimerPage = lazy(() => import("@/pages/disclaimer").then((m) => ({ default: m.DisclaimerPage })));
const ResearchPage = lazy(() => import("@/pages/research").then((m) => ({ default: m.ResearchPage })));
const ResearchArticlePage = lazy(() => import("@/pages/research-article").then((m) => ({ default: m.ResearchArticlePage })));

// Wrap any page that should require an authenticated session. The auth
// routes themselves stay public so the user can actually sign in.
function Private({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}

export default function App() {
  return (
    <>
    <Analytics />
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 text-slate-400" />}>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/:pathname" element={<AuthPage />} />

        {/* Public content — indexable, no auth gate. The landing (and the
            catch-all that renders it) MUST stay public: the canonical URL and
            the sitemap point at "/", so Googlebot needs to read it. The page
            uses no session data; its CTAs route through auth-gated pages. */}
        <Route path="/" element={<HomePage />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/research/:slug" element={<ResearchArticlePage />} />
        <Route path="/disclaimer" element={<DisclaimerPage />} />
        {/* Public taster: anyone can run the 6 valuation models on any ticker
            (no account). The panel runs ephemerally without a userId. */}
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/forecast" element={<ForecastPage />} />

        {/* Public with a trial: no account → capped in-memory taste, sign-in →
            the real thing. Each page branches internally on the session. */}
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/debug" element={<Private><DebugPage /></Private>} />
        {/* Folded into /upload (Build portfolio → Excel subsection). */}
        <Route path="/how-to-prepare" element={<Navigate to="/upload" replace />} />
        <Route path="/account" element={<Private><AccountPage /></Private>} />
        <Route path="/account/:pathname" element={<Private><AccountPage /></Private>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
    </>
  );
}
