import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import ca from "@/locales/ca.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

// Custom detector: read the locale from the URL path prefix (/en/…, /es/…) so a
// direct landing renders in the right language on the very first paint — before
// React mounts and LocaleSync runs. This is what makes the per-language
// prerender deterministic. Falls through to the built-in detectors otherwise.
const pathDetector = new LanguageDetector();
pathDetector.addDetector({
  name: "path",
  lookup() {
    if (typeof window === "undefined") return undefined;
    const seg = window.location.pathname.split("/")[1];
    return seg === "en" || seg === "es" ? seg : undefined;
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
    fallbackLng: "ca",
    supportedLngs: ["ca", "en", "es"],
    interpolation: { escapeValue: false },
    detection: {
      // The URL path prefix, then the cached choice. Two detectors are
      // deliberately absent:
      //   • `navigator` — it made the bare root non-deterministic (a crawler
      //     reporting en would render English under a ca canonical). English is
      //     discovered via the /en URLs + hreflang instead, so the unprefixed
      //     root is always the ca default; a returning visitor's cached choice
      //     still wins via localStorage.
      //   • `querystring` (?lng=) — the legacy language switch. Honouring it
      //     meant /research?lng=es rendered Spanish at a URL whose canonical
      //     says Catalan: a JS-only language switch Google cannot follow and a
      //     contradiction where it can. Those URLs now 301 to /es/research at
      //     the edge (see vercel.json), so the parameter needs no client
      //     behaviour at all — and if one slips through, the page renders the
      //     language its path declares.
      order: ["path", "localStorage"],
      caches: ["localStorage"],
    },
  });

export default i18n;
