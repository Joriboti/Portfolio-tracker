import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LocaleLink } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import {
  aggregatePositions,
  parseWorkbook,
  type ParsedWorkbook,
} from "@/lib/excel-parser";
import { hasAcceptedDisclaimer } from "./disclaimer";
import {
  importPortfolio,
  refreshPrices,
  refreshHistoricalPrices,
  resolveTickers,
} from "@/lib/api";
import { runPriceRefresh } from "@/lib/price-refresh";
import { usePhases, type ImportPhase } from "@/lib/phases";
import { ImportProgress } from "@/components/ImportProgress";
import { AddHoldingForm } from "@/components/AddHoldingForm";
import { HowToPrepareExcel } from "@/components/HowToPrepareExcel";
import { FifoCalculator } from "@/components/FifoCalculator";
import { useUser } from "@/hooks/useUser";
import { setTrialFromExcel } from "@/lib/trial";
import { SPREADSHEET_ACCEPT } from "@/lib/sheet-link";
import { SheetLinkImport } from "@/components/SheetLinkImport";

// The import runs through `seq`, one status machine for the whole thing:
//   file picked   → parsing → (preview, user confirms)
//   confirmed     → uploading → resolving → fetching → computing → done
// Each phase stays on screen at least 400ms; on failure the panel stays with
// what failed and a retry that resumes at the failed phase (the import itself
// is a full replace, so resuming from "uploading" is safe too).
const IMPORT_ORDER: ImportPhase[] = ["uploading", "resolving", "fetching", "computing"];

function UploadInner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [status, seq] = usePhases<ImportPhase>(400);
  const [unresolvedNote, setUnresolvedNote] = useState<string | null>(null);
  // Tickers the resolving phase could not match — kept across a retry that
  // resumes at "fetching", so we don't ask Yahoo to quote them anyway.
  const unresolvedRef = useRef<Set<string>>(new Set());
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
    setParsed(null);
    setUnresolvedNote(null);
    const run = seq.start();
    const stale = () => seq.current.run !== run;
    try {
      await seq.enter("parsing");
      // Let the panel paint before the (synchronous) parse takes the thread.
      await new Promise((r) => setTimeout(r, 0));
      const buffer = await file.arrayBuffer();
      const result = parseWorkbook(buffer);
      if (stale()) return;
      if (result.transactions.length === 0) {
        await seq.fail("parsing", t("upload.errors.noSheets"));
        return;
      }
      await seq.reset();
      setParsed(result);
    } catch {
      if (stale()) return;
      await seq.fail("parsing", t("upload.errors.parseFailed"));
    }
  }

  async function runImport(from: ImportPhase = "uploading") {
    if (!parsed) return;
    const run = seq.start();
    const stale = () => seq.current.run !== run;

    // Anonymous trial: keep the first N rows client-side and go straight to the
    // (public) dashboard — no account, no DB write.
    if (!user) {
      await seq.enter("computing");
      setTrialFromExcel(parsed.transactions);
      await seq.enter("done");
      await seq.settle();
      if (!stale()) navigate("/dashboard");
      return;
    }

    const startAt = Math.max(0, IMPORT_ORDER.indexOf(from));
    let phase: ImportPhase = from;
    try {
      const tickers = Array.from(new Set(parsed.transactions.map((tx) => tx.ticker)));

      if (startAt <= 0) {
        phase = "uploading";
        await seq.enter(phase);
        await importPortfolio(user.id, {
          transactions: parsed.transactions,
          dividends: parsed.dividends,
          interests: parsed.interests,
          wealth: parsed.wealth,
        });
        if (stale()) return;
      }

      if (startAt <= 1) {
        phase = "resolving";
        await seq.enter(phase);
        const { unresolved } = await resolveTickers(user.id, tickers);
        if (stale()) return;
        unresolvedRef.current = new Set(unresolved.map((u) => u.ticker));
        setUnresolvedNote(
          unresolved.length > 0
            ? t("upload.unresolvedNote", {
                count: unresolved.length,
                list: unresolved.map((u) => u.ticker).join(", "),
              })
            : null,
        );
      }

      if (startAt <= 2) {
        phase = "fetching";
        const quotable = tickers.filter((tk) => !unresolvedRef.current.has(tk));
        await seq.enter(phase, { done: 0, total: quotable.length });
        // Weekly history for the charts: in parallel and not waited for. The
        // dashboard renders without it and the weekly cron catches up.
        void refreshHistoricalPrices(user.id).catch(() => {});
        const outcome = await runPriceRefresh({
          tickers: quotable,
          fetchChunk: (symbols, { fx }) => refreshPrices(user.id, { symbols, fx }),
          onProgress: ({ done, total }) => seq.progress(done, total),
        });
        if (stale()) return;
        // Every chunk failed → nothing was priced; that's a real failure. A
        // partial failure is left to the dashboard, which has its own retry.
        if (outcome.total > 0 && outcome.failed.length === outcome.total) {
          throw new Error(outcome.errors[0] ?? t("common.error"));
        }
      }

      phase = "computing";
      await seq.enter(phase);
      aggregatePositions(parsed.transactions);
      await seq.enter("done");
      await seq.settle();
      if (!stale()) navigate("/dashboard");
    } catch (e) {
      if (stale()) return;
      await seq.fail(phase, (e as Error).message);
    }
  }

  function retry() {
    if (status.phase !== "error" || !status.error) return;
    if (status.error.phase === "parsing") {
      // Nothing to resume: back to the drop zone, and open the picker.
      void seq.reset().then(() => inputRef.current?.click());
      return;
    }
    void runImport(status.error.phase);
  }

  function cancel() {
    void seq.reset();
    setParsed(null);
    setUnresolvedNote(null);
  }

  const uniqueTickers = parsed
    ? new Set(parsed.transactions.map((t) => t.ticker)).size
    : 0;
  const idle = status.phase === "idle";
  const parseFailed = status.phase === "error" && status.error?.phase === "parsing";

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

        {/* The file input outlives the drop zone so a parse-error retry can reopen it. */}
        <input
          ref={inputRef}
          type="file"
          accept={SPREADSHEET_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handleFile(f);
          }}
        />

        {!parsed && idle && (
          <>
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
            </div>
            <SheetLinkImport onFile={handleFile} />
          </>
        )}

        {/* One panel for every phase; mounted for the whole run, never swapped. */}
        {!idle && (
          <>
            <ImportProgress
              state={status}
              skeletonRows={uniqueTickers || 6}
              onRetry={retry}
              retryLabel={parseFailed ? t("upload.chooseAnother") : t("upload.retry")}
              note={unresolvedNote}
            />
            {/* A bad sheet can be swapped for another link without going back. */}
            {parseFailed && <SheetLinkImport onFile={handleFile} />}
            {status.phase === "error" && !parseFailed && (
              <button onClick={cancel} className="btn-ghost">
                {t("upload.cancel")}
              </button>
            )}
          </>
        )}

        {parsed && idle && (
          <section className="card">
            <h2 className="font-medium text-slate-900">{t("upload.previewTitle")}</h2>
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
              <button onClick={() => void runImport()} className="btn-primary">
                {t("upload.confirm")}
              </button>
              <button onClick={cancel} className="btn-ghost">
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
