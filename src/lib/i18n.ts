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
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
