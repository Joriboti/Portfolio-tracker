import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LOCALES, type Locale, isLocalizable, stripLocale, withLocale } from "@/lib/locale";

// Switching language navigates to the EQUIVALENT page, not to the home page.
//
// It used to compare the path against a hand-kept MIRRORED list that had gone
// stale (/taxes and /radiografia were missing), so on those pages — and on every
// English-only tool page — changing language dumped the reader on the home page
// and lost their place. withLocale() knows the full route/slug table, so the only
// question left is whether this path is a localizable public page at all.
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const current = (i18n.language?.slice(0, 2) ?? "ca") as Locale;

  function choose(lng: Locale) {
    void i18n.changeLanguage(lng);
    // App/auth pages are deliberately language-neutral: switch the UI language
    // in place rather than inventing a /es URL for them.
    if (!isLocalizable(stripLocale(pathname))) return;
    navigate(withLocale(pathname, lng) + search + hash);
  }

  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      {LOCALES.map((lng) => (
        <button
          key={lng}
          onClick={() => choose(lng)}
          className={`px-2 py-1 rounded ${
            current === lng
              ? "bg-brand-600 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
