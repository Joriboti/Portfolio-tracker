import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import ca from "@/locales/ca.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

/**
 * Whether this browser had a language choice cached BEFORE this page load.
 * i18next caches whatever it resolves (including the English fallback), so
 * after init the cache can no longer tell a first visit from a returning one.
 * LocaleSync reads this to offer a first-time visitor their browser language.
 */
export const HAD_LANGUAGE_CHOICE: boolean = (() => {
  try {
    return window.localStorage.getItem("i18nextLng") != null;
  } catch {
    return true; // no storage → never auto-switch
  }
})();

// Custom detector: read the locale from the URL path prefix (/ca/…, /es/…) so a
// direct landing renders in the right language on the very first paint — before
// React mounts and LocaleSync runs. This is what makes the per-language
// prerender deterministic. Falls through to the built-in detectors otherwise.
const pathDetector = new LanguageDetector();
pathDetector.addDetector({
  name: "path",
  lookup() {
    if (typeof window === "undefined") return undefined;
    const seg = window.location.pathname.split("/")[1];
    return seg === "ca" || seg === "es" ? seg : undefined;
  },
});

void i18n
  .use(pathDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ca: { translation: ca },
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "en",
    supportedLngs: ["ca", "en", "es"],
    interpolation: { escapeValue: false },
    detection: {
      // The URL path prefix, then the cached choice. Two detectors are
      // deliberately absent:
      //   • `navigator` — it made the bare root non-deterministic (a crawler
      //     reporting ca would render Catalan under an English canonical). A
      //     first-time visitor's browser language is honoured by LocaleSync
      //     instead, which NAVIGATES to /ca or /es — URL and content agree.
      //   • `querystring` (?lng=) — the legacy language switch. Those URLs 301
      //     to the path-prefixed URL at the edge (see vercel.json), so the
      //     parameter needs no client behaviour at all.
      order: ["path", "localStorage"],
      caches: ["localStorage"],
    },
  });

// The app pages (/dashboard, /upload, …) have no URL locale and no useSeo, so
// <html lang> would stay whatever the shell shipped with (en). Follow the UI
// language instead; on public pages useSeo sets the same value from the URL.
if (typeof document !== "undefined") {
  const syncLang = (lng: string) => {
    document.documentElement.lang = lng.slice(0, 2);
  };
  if (i18n.language) syncLang(i18n.language);
  i18n.on("languageChanged", syncLang);
}

export default i18n;
