import { AccountView } from "@neondatabase/neon-js/auth/react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import { AuthGuard } from "@/components/AuthGuard";

function AccountInner() {
  const { t } = useTranslation();
  const { pathname } = useParams<{ pathname: string }>();
  const { currency, setCurrency } = useDisplayCurrency();
  const path = (pathname ?? "settings").trim() || "settings";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        {t("account.title")}
      </h1>

      <section className="card">
        <h2 className="text-lg font-medium text-slate-900 mb-4">
          {t("account.preferences")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">
              {t("account.language")}
            </span>
            <LanguageSwitcher />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">
              {t("account.displayCurrency")}
            </span>
            <select
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={currency}
              onChange={(e) =>
                setCurrency(
                  e.target.value as (typeof SUPPORTED_CURRENCIES)[number],
                )
              }
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <AccountView path={path as any} />
      </section>
    </div>
  );
}

export function AccountPage() {
  return (
    <AuthGuard>
      <AccountInner />
    </AuthGuard>
  );
}
