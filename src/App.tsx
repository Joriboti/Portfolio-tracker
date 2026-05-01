import { Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { HomePage } from "@/pages/home";
import { AuthPage } from "@/pages/auth";
import { AccountPage } from "@/pages/account";
import { DashboardPage } from "@/pages/dashboard";
import { UploadPage } from "@/pages/upload";
import { HowToPreparePage } from "@/pages/how-to-prepare";
import { DisclaimerPage } from "@/pages/disclaimer";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/how-to-prepare" element={<HowToPreparePage />} />
        <Route path="/disclaimer" element={<DisclaimerPage />} />
        <Route path="/account/*" element={<AccountPage />} />
        <Route path="/auth/*" element={<AuthPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
