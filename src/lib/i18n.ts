import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import ca from "@/locales/ca.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

void i18n
  .use(LanguageDetector)
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
      // querystring first: ?lng=es / ?lng=en are the indexable per-language
      // URLs (hreflang alternates in useSeo point at them; Googlebot renders
      // the translated page).
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lng",
      caches: ["localStorage"],
    },
  });

export default i18n;
