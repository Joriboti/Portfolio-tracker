import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo, Wordmark } from "./Logo";
import { useUser } from "@/hooks/useUser";
import { authClient } from "@/lib/auth";

export function Layout() {
  const { t } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();
  // The landing is a dark editorial page; header/footer follow it there so
  // the charcoal runs edge to edge. Every other route keeps the light chrome.
  const dark = useLocation().pathname === "/";

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
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur ${
          dark
            ? "border-white/10 bg-[#14100d]/85 supports-[backdrop-filter]:bg-[#14100d]/70"
            : "border-slate-200/80 bg-white/85 supports-[backdrop-filter]:bg-white/70"
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <Logo className="h-8 w-8" />
            <Wordmark className="text-lg" light={dark} />
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <NavItem to="/dashboard" label={t("nav.dashboard")} dark={dark} />
            <NavItem to="/upload" label={t("nav.upload")} dark={dark} />
            <NavItem to="/explore" label={t("nav.explore")} dark={dark} />
            <NavItem to="/forecast" label={t("nav.forecast")} dark={dark} />
            <NavItem to="/research" label={t("nav.research")} dark={dark} />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <NavLink
                  to="/account"
                  className={`text-sm ${
                    dark
                      ? "text-[#c9bda9] hover:text-[#f3ead9]"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {user.email ?? t("nav.account")}
                </NavLink>
                <button
                  onClick={() => void signOut()}
                  className={`text-sm ${
                    dark
                      ? "text-[#a99e8c] hover:text-[#f3ead9]"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
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
      <main className={`flex-1 ${dark ? "bg-[#14100d]" : ""}`}>
        <Outlet />
      </main>
      <footer
        className={
          dark ? "border-t border-white/10 bg-[#100d0b]" : "border-t border-slate-200 bg-white"
        }
      >
        <div
          className={`mx-auto max-w-6xl px-4 py-4 text-xs flex justify-between ${
            dark ? "text-[#a99e8c]" : "text-slate-500"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Logo className="h-4 w-4" />© {new Date().getFullYear()} TrimmTrack
          </span>
          <span className="flex items-center gap-3">
            <Link
              to="/calculadora-fifo"
              className={dark ? "hover:text-[#f3ead9]" : "hover:text-slate-700"}
            >
              {t("fifoPage.short")}
            </Link>
            <Link to="/disclaimer" className={dark ? "hover:text-[#f3ead9]" : "hover:text-slate-700"}>
              Disclaimer
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function NavItem({ to, label, dark }: { to: string; label: string; dark?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md ${
          isActive
            ? dark
              ? "bg-white/10 text-brand-400"
              : "bg-brand-50 text-brand-700"
            : dark
              ? "text-[#c9bda9] hover:bg-white/5 hover:text-[#f3ead9]"
              : "text-slate-600 hover:bg-slate-100"
        }`
      }
    >
      {label}
    </NavLink>
  );
}
