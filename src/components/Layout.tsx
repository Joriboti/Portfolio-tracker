import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { LocaleLink, LocaleNavLink } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo, Wordmark } from "./Logo";
import { useUser } from "@/hooks/useUser";
import { authClient } from "@/lib/auth";
import i18n from "@/lib/i18n";
import { stripLocale } from "@/lib/locale";

// Keep the active i18next language in sync with the URL's locale prefix so a
// visitor landing directly on /en/… or /es/… (e.g. from Google) sees the right
// language, and the prerenderer renders each locale URL in its own language.
// Bare (Catalan-root) paths don't force a switch — the human's cached choice
// wins there; crawlers get the Catalan snapshot from the prerender step.
function LocaleSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const seg = pathname.split("/")[1];
    if ((seg === "en" || seg === "es") && i18n.language?.slice(0, 2) !== seg) {
      void i18n.changeLanguage(seg);
    }
  }, [pathname]);
  return null;
}

export function Layout() {
  const { t } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  // The landing is a dark editorial page; header/footer follow it there so
  // the charcoal runs edge to edge. Every other route keeps the light chrome.
  // Match the home of every locale (/, /en, /es), not just the Catalan root.
  const dark = stripLocale(location.pathname) === "/";

  // Section navigation now lives in a left off-canvas drawer instead of an inline
  // top nav, so the header stays minimal (and mobile finally gets a real menu).
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the drawer whenever the route changes (a link inside it was followed).
  useEffect(() => setMenuOpen(false), [location.pathname]);
  // Escape closes it; lock body scroll while it's open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

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
      <LocaleSync />
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur ${
          dark
            ? "border-white/10 bg-[#2a1c12]/85 supports-[backdrop-filter]:bg-[#2a1c12]/70"
            : "border-[#ece0cb] bg-[#f7f1e7]/85 supports-[backdrop-filter]:bg-[#f7f1e7]/70"
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("nav.menu")}
            aria-expanded={menuOpen}
            className={`-ml-1 rounded-md p-2 transition-colors ${
              dark ? "text-[#e9dcc4] hover:bg-white/10" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <LocaleLink to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <Logo className="h-8 w-8" />
            <Wordmark className="text-lg" light={dark} />
          </LocaleLink>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <LocaleNavLink
                  to="/account"
                  className={`hidden text-sm sm:inline ${
                    dark ? "text-[#c9bda9] hover:text-[#f3ead9]" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {user.email ?? t("nav.account")}
                </LocaleNavLink>
                <button
                  onClick={() => void signOut()}
                  className={`text-sm ${
                    dark ? "text-[#a99e8c] hover:text-[#f3ead9]" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {t("nav.signOut")}
                </button>
              </>
            ) : (
              <LocaleLink to="/auth/sign-in" className="btn-primary text-xs px-3 py-1.5">
                {t("nav.signIn")}
              </LocaleLink>
            )}
          </div>
        </div>
      </header>

      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} loggedIn={!!user} />

      <main className={`flex-1 ${dark ? "bg-[#1c130c]" : ""}`}>
        <Outlet />
      </main>
      <footer
        className={
          dark ? "border-t border-white/10 bg-[#1a120b]" : "border-t border-[#ece0cb] bg-[#f7f1e7]"
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
            <LocaleLink
              to="/radiografia"
              className={dark ? "hover:text-[#f3ead9]" : "hover:text-slate-700"}
            >
              {t("xray.short")}
            </LocaleLink>
            <LocaleLink
              to="/calculadora-fifo"
              className={dark ? "hover:text-[#f3ead9]" : "hover:text-slate-700"}
            >
              {t("fifoPage.short")}
            </LocaleLink>
            <LocaleLink
              to="/taxes"
              className={dark ? "hover:text-[#f3ead9]" : "hover:text-slate-700"}
            >
              {t("taxes.short")}
            </LocaleLink>
            <LocaleLink to="/disclaimer" className={dark ? "hover:text-[#f3ead9]" : "hover:text-slate-700"}>
              Disclaimer
            </LocaleLink>
          </span>
        </div>
      </footer>
    </div>
  );
}

// Left off-canvas navigation drawer. Its own light surface so it reads over both
// the light chrome and the dark landing. Backdrop click / Escape / route change
// all close it (the last two handled by the parent).
function NavDrawer({ open, onClose, loggedIn }: { open: boolean; onClose: () => void; loggedIn: boolean }) {
  const { t } = useTranslation();

  const sections = [
    { to: "/dashboard", label: t("nav.dashboard") },
    { to: "/upload", label: t("nav.upload") },
    { to: "/explore", label: t("nav.explore") },
    { to: "/forecast", label: t("nav.forecast") },
    { to: "/taxes", label: t("nav.taxes") },
    { to: "/research", label: t("nav.research") },
  ];
  // Tool landings. The four valuation calculators are keyword pages that exist
  // in all three languages, so they belong in the drawer — a page reachable only
  // from a sitemap is a page Google treats as an orphan. LocaleNavLink turns each
  // neutral slug into the current language's URL (/calculadora-dcf → /en/dcf-calculator).
  const tools = [
    { to: "/radiografia", label: t("xray.short") },
    { to: "/calculadora-fifo", label: t("fifoPage.short") },
    { to: "/calculadora-dcf", label: t("tools.dcfShort") },
    { to: "/dcf-invers", label: t("tools.reverseDcfShort") },
    { to: "/numero-de-graham", label: t("tools.grahamShort") },
    { to: "/simulador-monte-carlo", label: t("tools.monteCarloShort") },
  ];

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.menu")}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[#f7f1e7] shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#ece0cb] px-4 py-3">
          <LocaleLink to="/" onClick={onClose} className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <Wordmark className="text-base" />
          </LocaleLink>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.close")}
            className="rounded-md px-2 text-2xl leading-none text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {sections.map((it) => (
            <DrawerItem key={it.to} to={it.to} label={it.label} onClick={onClose} />
          ))}
          <div className="my-2 border-t border-[#ece0cb]" />
          {tools.map((it) => (
            <DrawerItem key={it.to} to={it.to} label={it.label} onClick={onClose} />
          ))}
          {loggedIn && (
            <>
              <div className="my-2 border-t border-[#ece0cb]" />
              <DrawerItem to="/account" label={t("nav.account")} onClick={onClose} />
            </>
          )}
        </nav>
      </aside>
    </>
  );
}

function DrawerItem({ to, label, onClick }: { to: string; label: string; onClick: () => void }) {
  return (
    <LocaleNavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `block rounded-md px-3 py-2 text-sm transition-colors ${
          isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-100"
        }`
      }
    >
      {label}
    </LocaleNavLink>
  );
}
