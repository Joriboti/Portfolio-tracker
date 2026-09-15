import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import { IMPORT_PHASES, type ImportPhase, type PhaseState } from "@/lib/phases";

/**
 * The one status panel for the whole import: which phase we're in, an
 * indeterminate bar that never stops, and a skeleton of the table that is
 * about to appear underneath.
 *
 * It is mounted once per run and stays mounted through every phase — the
 * parent switches its *props*, never the component — so the bar's animation
 * never restarts and nothing blinks between "resolving" and "fetching". On an
 * error the panel stays too, with what failed and a retry, because a panel
 * that vanishes on failure looks exactly like a page that gave up.
 */
export function ImportProgress({
  state,
  skeletonRows,
  onRetry,
  retryLabel,
  note,
}: {
  state: PhaseState<ImportPhase>;
  /** How many table rows to sketch — the number of tickers when known. */
  skeletonRows: number;
  onRetry?: () => void;
  retryLabel?: string;
  /** An extra line under the phase, e.g. the tickers with no market symbol. */
  note?: string | null;
}) {
  const { t } = useTranslation();
  const failed = state.phase === "error";
  const phase: ImportPhase | null = failed
    ? (state.error?.phase ?? null)
    : state.phase === "idle" || state.phase === "error"
      ? null
      : state.phase;
  const done = phase === "done" && !failed;

  const label = (p: ImportPhase, withProgress: boolean): string => {
    if (p === "fetching" && withProgress && state.progress && state.progress.total > 0) {
      return t("upload.phases.fetchingProgress", state.progress);
    }
    return t(`upload.phases.${p}`);
  };

  const headline = failed
    ? t("upload.phases.error", { phase: phase ? t(`upload.phases.${phase}`).toLowerCase() : "" })
    : phase
      ? label(phase, true)
      : "";

  const rows = Math.min(Math.max(skeletonRows, 3), 12);

  return (
    <section
      className="card space-y-4"
      role="status"
      aria-live="polite"
      aria-busy={!failed && !done}
    >
      <div className="flex items-center gap-3">
        {!failed && !done && (
          <Logo className="h-6 w-6 shrink-0" spinning label={t("common.loading")} />
        )}
        {done && <span className="text-emerald-600" aria-hidden>✓</span>}
        {failed && <span className="text-rose-600" aria-hidden>✕</span>}
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${
              failed ? "text-rose-800" : done ? "text-emerald-700" : "text-slate-900"
            }`}
          >
            {headline}
          </p>
          {failed && state.error && (
            <p className="mt-0.5 text-xs text-rose-700 whitespace-pre-wrap">{state.error.message}</p>
          )}
          {note && <p className="mt-0.5 text-xs text-amber-800">{note}</p>}
        </div>
        {failed && onRetry && (
          <button onClick={onRetry} className="btn-primary text-xs px-3 py-1.5">
            {retryLabel ?? t("upload.retry")}
          </button>
        )}
      </div>

      {/* The bar: indeterminate while working, full on done, static on error. */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        aria-hidden
      >
        <div
          className={`h-full w-full rounded-full ${
            failed
              ? "bg-rose-400"
              : done
                ? "bg-emerald-500"
                : "progress-indeterminate bg-brand-500"
          }`}
        />
      </div>

      {/* Step list: what's behind us, what we're on, what's still to come. */}
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {IMPORT_PHASES.filter((p) => p !== "done" && p !== "parsing").map((p) => {
          const idx = IMPORT_PHASES.indexOf(p);
          const cur = phase ? IMPORT_PHASES.indexOf(phase) : -1;
          const status =
            failed && p === phase
              ? "failed"
              : idx < cur || done
                ? "done"
                : idx === cur
                  ? "current"
                  : "pending";
          return (
            <li
              key={p}
              className={`flex items-center gap-1 ${
                status === "current"
                  ? "font-medium text-brand-700"
                  : status === "done"
                    ? "text-slate-500"
                    : status === "failed"
                      ? "text-rose-700"
                      : "text-slate-400"
              }`}
            >
              <span aria-hidden>
                {status === "done" ? "✓" : status === "failed" ? "✕" : status === "current" ? "●" : "○"}
              </span>
              {label(p, false)}
            </li>
          );
        })}
      </ol>

      {/* Skeleton of the positions table that is on its way. */}
      {!failed && (
        <div className="overflow-hidden rounded-md border border-slate-200" aria-hidden>
          <div className="grid grid-cols-6 gap-3 bg-slate-50 px-3 py-2">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-3 rounded bg-slate-200/80 animate-pulse" />
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="grid grid-cols-6 gap-3 border-t border-slate-100 px-3 py-2.5">
              {Array.from({ length: 6 }, (_, c) => (
                <span
                  key={c}
                  className={`h-3 rounded bg-slate-100 animate-pulse ${c === 0 ? "w-2/3" : ""}`}
                  style={{ animationDelay: `${(r * 6 + c) * 40}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
