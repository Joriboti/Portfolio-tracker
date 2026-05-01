import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useUser } from "@/hooks/useUser";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, isPending } = useUser();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-slate-500">
        {t("common.loading")}
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to={`/auth/sign-in?next=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}
