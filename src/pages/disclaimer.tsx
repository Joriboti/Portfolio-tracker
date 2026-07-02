import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const STORAGE_KEY = "pt:disclaimerAccepted";

export function hasAcceptedDisclaimer(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function DisclaimerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function accept() {
    window.localStorage.setItem(STORAGE_KEY, "1");
    navigate("/upload");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="card border-amber-200 bg-amber-50">
        <h1 className="text-xl font-semibold text-amber-900">
          {t("disclaimer.title")}
        </h1>
        <p className="mt-3 font-medium text-amber-900">
          {t("disclaimer.important")}
        </p>
        <div className="mt-4 space-y-3 text-sm text-amber-900/90">
          <p>{t("disclaimer.p1")}</p>
          <p>
            {t("disclaimer.p2")}{" "}
            <Link
              to="/upload"
              className="underline font-medium hover:text-amber-700"
            >
              {t("nav.howTo")} →
            </Link>
          </p>
          <p>{t("disclaimer.p3")}</p>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={accept} className="btn-primary">
            {t("disclaimer.ack")}
          </button>
          <Link to="/" className="btn-ghost">
            {t("nav.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
