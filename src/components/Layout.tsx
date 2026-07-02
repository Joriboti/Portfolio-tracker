import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo, Wordmark } from "./Logo";
import { useUser } from "@/hooks/useUser";
import { authClient } from "@/lib/auth";

export function Layout() {
  const { t } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();

  async function signOut() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = authClient as any;
      if (typeof client.signOut === "function") {
        await client.signOut();
      }
    } finally {
      navigate("/");
    }
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <Logo className="h-8 w-8" />
            <Wordmark className="text-lg" />
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <NavItem to="/dashboard" label={t("nav.dashboard")} />
            <NavItem to="/upload" label={t("nav.upload")} />
            <NavItem to="/explore" label={t("nav.explore")} />
            <NavItem to="/research" label={t("nav.research")} />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <NavLink
                  to="/account"
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  {user.email ?? t("nav.account")}
                </NavLink>
                <button
                  onClick={() => void signOut()}
                  className="text-sm text-slate-500 hover:text-slate-900"
                >
                  {t("nav.signOut")}
                </button>
              </>
            ) : (
              <Link
                to="/auth/sign-in"
                className="btn-primary text-xs px-3 py-1.5"
              >
                {t("nav.signIn")}
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500 flex justify-between">
          <span className="flex items-center gap-1.5">
            <Logo className="h-4 w-4" />© {new Date().getFullYear()} TrimmTrack
          </span>
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
