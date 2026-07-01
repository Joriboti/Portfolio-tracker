import { Route, Routes } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "@/components/Layout";
import { AuthGuard } from "@/components/AuthGuard";
import { HomePage } from "@/pages/home";
import { AuthPage } from "@/pages/auth";
import { AccountPage } from "@/pages/account";
import { DashboardPage } from "@/pages/dashboard";
import { DebugPage } from "@/pages/debug";
import { UploadPage } from "@/pages/upload";
import { ExplorePage } from "@/pages/explore";
import { HowToPreparePage } from "@/pages/how-to-prepare";
import { DisclaimerPage } from "@/pages/disclaimer";

// Wrap any page that should require an authenticated session. The auth
// routes themselves stay public so the user can actually sign in.
function Private({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}

export default function App() {
  return (
    <>
    <Analytics />
    <Routes>
      <Route element={<Layout />}>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/:pathname" element={<AuthPage />} />

        <Route path="/" element={<Private><HomePage /></Private>} />
        <Route path="/dashboard" element={<Private><DashboardPage /></Private>} />
        <Route path="/debug" element={<Private><DebugPage /></Private>} />
        <Route path="/upload" element={<Private><UploadPage /></Private>} />
        <Route path="/explore" element={<Private><ExplorePage /></Private>} />
        <Route path="/how-to-prepare" element={<Private><HowToPreparePage /></Private>} />
        <Route path="/disclaimer" element={<Private><DisclaimerPage /></Private>} />
        <Route path="/account" element={<Private><AccountPage /></Private>} />
        <Route path="/account/:pathname" element={<Private><AccountPage /></Private>} />
        <Route path="*" element={<Private><HomePage /></Private>} />
      </Route>
    </Routes>
    </>
  );
}
