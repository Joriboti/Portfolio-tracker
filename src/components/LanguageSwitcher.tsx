import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language?.slice(0, 2) ?? "ca";

  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      {(["ca", "es", "en"] as const).map((lng) => (
        <button
          key={lng}
          onClick={() => void i18n.changeLanguage(lng)}
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
