import { AuthView } from "@neondatabase/neon-js/auth/react";
import { useTranslation } from "react-i18next";

export function AuthPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="card">
        <h1 className="text-xl font-semibold text-slate-900 mb-4">
          {t("auth.signInTitle")}
        </h1>
        <AuthView />
      </div>
    </div>
  );
}
