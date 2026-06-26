import { AuthView } from "@neondatabase/neon-js/auth/react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Logo, Wordmark } from "@/components/Logo";

export function AuthPage() {
  const { pathname } = useParams<{ pathname: string }>();
  const { t } = useTranslation();
  // Default to "sign-in" when no sub-path is provided.
  const path = (pathname ?? "sign-in").trim() || "sign-in";

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-96 bg-gradient-to-b from-brand-100/60 via-brand-50/30 to-transparent"
      />
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-12 w-12 drop-shadow-sm" />
          <div className="mt-3 text-xl">
            <Wordmark />
          </div>
          <p className="mt-1 text-sm text-slate-500">{t("app.tagline")}</p>
        </div>
        <div className="card shadow-card">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <AuthView path={path as any} />
        </div>
      </div>
    </div>
  );
}
