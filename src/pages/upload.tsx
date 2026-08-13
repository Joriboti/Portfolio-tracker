import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LocaleLink } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/excel-parser";
import { hasAcceptedDisclaimer } from "./disclaimer";
import {
  importPortfolio,
  refreshPrices,
  refreshHistoricalPrices,
} from "@/lib/api";
import { AddHoldingForm } from "@/components/AddHoldingForm";
import { HowToPrepareExcel } from "@/components/HowToPrepareExcel";
import { FifoCalculator } from "@/components/FifoCalculator";
import { useUser } from "@/hooks/useUser";
import { setTrialFromExcel } from "@/lib/trial";

function UploadInner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!hasAcceptedDisclaimer()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-amber-900">{t("disclaimer.important")}</p>
          <LocaleLink to="/disclaimer" className="btn-primary mt-4 inline-flex">
            {t("disclaimer.title")} →
          </LocaleLink>
        </div>
      </div>
    );
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseWorkbook(buffer);
      if (result.transactions.length === 0) {
        setError(t("upload.errors.noSheets"));
        return;
      }
      setParsed(result);
    } catch {
      setError(t("upload.errors.parseFailed"));
    }
  }

  async function confirmImport() {
    if (!parsed) return;
    // Anonymous trial: keep the first N rows client-side and go straight to the
    // (public) dashboard — no account, no DB write.
    if (!user) {
      setTrialFromExcel(parsed.transactions);
      navigate("/dashboard");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStatus(t("upload.importing"));
      await importPortfolio(user.id, {
        transactions: parsed.transactions,
        dividends: parsed.dividends,
        interests: parsed.interests,
        wealth: parsed.wealth,
      });
      // Refresh current prices and weekly history for the freshly imported
      // tickers, so the dashboard's value chart, analytics and annual returns
      // are correct immediately. Without this the value-based views show
      // phantom losses (capital counted, but newly added tickers have no
      // price history) until the weekly cron runs. Tolerant of failure — the
      // crons will catch up and the import itself already succeeded.
      setStatus(t("upload.fetchingPrices"));
      try {
        await refreshPrices(user.id);
      } catch {
        /* cron will catch up */
      }
      setStatus(t("upload.fetchingHistory"));
      try {
        await refreshHistoricalPrices(user.id);
      } catch {
        /* cron will catch up */
      }
      navigate("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const uniqueTickers = parsed
    ? new Set(parsed.transactions.map((t) => t.ticker)).size
    : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        {t("upload.title")}
      </h1>

      {/* Subsection 1 — search a ticker and add positions one by one. */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {t("upload.sectionManual")}
        </h2>
        <AddHoldingForm
          userId={user?.id ?? ""}
          onAdded={() => navigate("/dashboard")}
        />
        {!user && (
          <p className="text-xs text-slate-500">
            {t("trial.uploadHint", { rows: 30, positions: 10 })}
          </p>
        )}
      </section>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        {t("upload.orExcel")}
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Subsection 2 — build/import from an Excel: upload + how-to + FIFO. */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("upload.sectionExcel")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t("upload.sectionExcelHint")}
          </p>
        </div>

      {!parsed && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className="card border-dashed border-2 border-slate-300 cursor-pointer hover:border-brand-500 hover:bg-brand-50/40 transition-colors"
        >
          <p className="text-center text-slate-700">{t("upload.drop")}</p>
          <p className="text-center text-xs text-slate-500 mt-2">
            {t("upload.supports")}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>
      )}

      {error && (
        <div className="card border-rose-200 bg-rose-50 text-rose-900 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}

      {parsed && (
        <section className="card">
          <h2 className="font-medium text-slate-900">{t("upload.preview")}</h2>
          <p className="text-sm text-slate-600 mt-1">
            {t("upload.summary", {
              count: parsed.transactions.length,
              tickers: uniqueTickers,
            })}
          </p>
          {parsed.warnings.length > 0 && (
            <ul className="mt-3 text-xs text-amber-800 list-disc list-inside">
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {parsed.excluded.length > 0 && (
            <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
              <p className="font-medium text-sky-900">
                {t("upload.excludedTitle", { count: parsed.excluded.length })}
              </p>
              <p className="mt-1 text-xs text-sky-800">
                {t("upload.excludedHint")}
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-sky-900 sm:grid-cols-3">
                {parsed.excluded.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-sky-300"
                      style={{ backgroundColor: `#${e.color}` }}
                    />
                    <span className="font-medium">{e.ticker}</span>
                    <span className="text-sky-700/70">
                      ({e.portfolio} · row {e.row})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 max-h-72 overflow-auto rounded-md border border-slate-200">
            <table className="table-base">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th>{t("upload.preview.ticker")}</th>
                  <th>{t("upload.preview.shares")}</th>
                  <th>{t("upload.preview.buyPrice")}</th>
                  <th>{t("upload.preview.buyDate")}</th>
                  <th>{t("upload.preview.sellShares")}</th>
                  <th>{t("upload.preview.sellPrice")}</th>
                  <th>{t("upload.preview.sellDate")}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.transactions.slice(0, 50).map((t, i) => (
                  <tr key={i}>
                    <td className="font-medium">{t.ticker}</td>
                    <td>{t.shares || "—"}</td>
                    <td>{t.buyPrice?.toFixed(2) ?? "—"}</td>
                    <td>{t.buyDate ?? "—"}</td>
                    <td>{t.sellShares ?? "—"}</td>
                    <td>{t.sellPrice?.toFixed(2) ?? "—"}</td>
                    <td>{t.sellDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={confirmImport}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? (status ?? t("common.loading")) : t("upload.confirm")}
            </button>
            <button
              onClick={() => {
                setParsed(null);
                setError(null);
              }}
              className="btn-ghost"
            >
              {t("upload.cancel")}
            </button>
          </div>
        </section>
      )}

        {/* How to prepare the Excel — folded here from its old standalone page. */}
        <details className="card group">
          <summary className="flex cursor-pointer items-center justify-between font-medium text-slate-900 marker:content-none">
            {t("upload.howToToggle")}
            <span className="text-slate-400 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mt-4">
            <HowToPrepareExcel />
          </div>
        </details>

        {/* FIFO realized-result calculator to help fill the "Resultat" column. */}
        <div>
          <h3 className="mb-2 font-medium text-slate-900">{t("fifo.title")}</h3>
          <FifoCalculator />
        </div>
      </section>
    </div>
  );
}

export function UploadPage() {
  return <UploadInner />;
}
