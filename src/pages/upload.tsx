import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { parseWorkbook, type ParsedWorkbook } from "@/lib/excel-parser";
import { hasAcceptedDisclaimer } from "./disclaimer";
import { importPortfolio } from "@/lib/api";
import { AuthGuard } from "@/components/AuthGuard";
import { useUser } from "@/hooks/useUser";

function UploadInner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!hasAcceptedDisclaimer()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-amber-900">{t("disclaimer.important")}</p>
          <Link to="/disclaimer" className="btn-primary mt-4 inline-flex">
            {t("disclaimer.title")} →
          </Link>
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
    if (!parsed || !user) return;
    setBusy(true);
    setError(null);
    try {
      await importPortfolio(user.id, {
        transactions: parsed.transactions,
        dividends: parsed.dividends,
        interests: parsed.interests,
        wealth: parsed.wealth,
      });
      navigate("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
                  <th>Ticker</th>
                  <th>Shares</th>
                  <th>Buy price</th>
                  <th>Buy date</th>
                  <th>Sell shares</th>
                  <th>Sell price</th>
                  <th>Sell date</th>
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
              {busy ? t("common.loading") : t("upload.confirm")}
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
    </div>
  );
}

export function UploadPage() {
  return (
    <AuthGuard>
      <UploadInner />
    </AuthGuard>
  );
}
