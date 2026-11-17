import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";

// English ships inside the entry bundle: it is the default language, the one
// the bare URLs render in and the fallback for any missing key, so it must be
// there before the first paint with no extra request. Catalan and Spanish are
// separate chunks, fetched only by the visitor who reads them. All three used
// to be imported here, which put 180 kB of JSON (65 kB gzipped) in front of
// every page for two languages the reader was not using.
const LAZY_LOCALES: Record<string, () => Promise<{ default: unknown }>> = {
  ca: () => import("@/locales/ca.json"),
  es: () => import("@/locales/es.json"),
};

// A minimal i18next backend over those dynamic imports. With
// `partialBundledLanguages`, i18next asks it for whatever is not in
// `resources` — at init for the detected language, and again inside
// changeLanguage(), which resolves only once the bundle is in. So nothing that
// switches language (LanguageSwitcher, LocaleSync) has to know loading exists.
const lazyBackend = {
  type: "backend" as const,
  init() {},
  read(
    lng: string,
    _ns: string,
    done: (err: unknown, data?: unknown) => void,
  ) {
    const load = LAZY_LOCALES[lng];
    // Not a lazy language (en is bundled; anything else is unsupported).
    if (!load) return done(null, {});
    load().then(
      (mod) => done(null, mod.default),
      (err) => done(err),
    );
  },
};

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

const initialised = i18n
  .use(lazyBackend)
  .use(pathDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    // Only "ca", never "ca-ES": one chunk per language, and no request for a
    // regional variant that does not exist.
    load: "languageOnly",
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
    // If the first render ever goes ahead without the language (see i18nReady),
    // re-render when its bundle lands instead of staying in English.
    react: { bindI18nStore: "added" },
  });

/** How long the first render waits for a ca/es bundle before going ahead. */
const LOCALE_WAIT_MS = 8000;

/**
 * Resolves when the language of this page is loaded. main.tsx waits for it
 * before mounting, so a Catalan or Spanish page never paints in English first
 * — and, just as important, so the prerenderer never snapshots one in English.
 * While it waits the prerendered HTML is already on screen.
 *
 * Never rejects and never hangs: a failed or stalled chunk must not leave the
 * page unmounted. It renders in English and switches when the bundle arrives.
 */
export const i18nReady: Promise<void> = Promise.race([
  initialised.then(
    () => undefined,
    () => undefined,
  ),
  new Promise<void>((resolve) => setTimeout(resolve, LOCALE_WAIT_MS)),
]);

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
