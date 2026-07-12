import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LOCALES, type Locale, stripLocale, withLocale } from "@/lib/locale";

// Public pages that exist under every locale prefix. Switching language on one
// of these navigates to the sibling URL (/calculadora-fifo → /en/calculadora-fifo)
// so the choice is reflected in a crawlable path. On any other page (app pages,
// or the English-only tool pages) we just change the language in place, falling
// back to that language's home when the current path has no localized sibling.
const MIRRORED = ["/research", "/explore", "/forecast", "/disclaimer", "/calculadora-fifo"];

function isMirrored(neutralPath: string): boolean {
  return neutralPath === "/" || MIRRORED.some((p) => neutralPath.startsWith(p));
}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = (i18n.language?.slice(0, 2) ?? "ca") as Locale;

  function choose(lng: Locale) {
    void i18n.changeLanguage(lng);
    const neutral = stripLocale(pathname);
    if (isMirrored(neutral)) {
      navigate(withLocale(neutral, lng));
    } else if (pathname.startsWith("/en/") || pathname.startsWith("/es/")) {
      // English-only tool page (no sibling): send to the chosen language home.
      navigate(withLocale("/", lng));
    }
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
