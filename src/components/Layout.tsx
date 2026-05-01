import { Link, NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function Layout() {
  const { t } = useTranslation();

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
          <Link
            to="/"
            className="font-semibold text-lg text-slate-900 flex items-center gap-2"
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand-500"></span>
            {t("app.name")}
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <NavItem to="/dashboard" label={t("nav.dashboard")} />
            <NavItem to="/upload" label={t("nav.upload")} />
            <NavItem to="/how-to-prepare" label={t("nav.howTo")} />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher />
            <NavLink
              to="/account"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              {t("nav.account")}
            </NavLink>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500 flex justify-between">
          <span>© {new Date().getFullYear()} Portfolio Tracker</span>
          <Link to="/disclaimer" className="hover:text-slate-700">
            Disclaimer
          </Link>
        </div>
      </footer>
    </div>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md ${
          isActive
            ? "bg-brand-50 text-brand-700"
            : "text-slate-600 hover:bg-slate-100"
        }`
      }
    >
      {label}
    </NavLink>
  );
}
