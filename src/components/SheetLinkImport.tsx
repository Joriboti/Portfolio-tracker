import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchSheetLink, parseSheetLink, SheetLinkError } from "@/lib/sheet-link";

// "Paste a Google Sheets / Drive link" — the second way in next to the file
// picker. Downloads the sheet as .xlsx in the browser and hands it to the
// same handler a picked file goes through.
export function SheetLinkImport({
  onFile,
  className = "",
}: {
  onFile: (file: File) => void | Promise<void>;
  className?: string;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value = url) {
    if (busy || !value.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const file = await fetchSheetLink(value);
      setUrl("");
      await onFile(file);
    } catch (e) {
      const code = e instanceof SheetLinkError ? e.code : "private";
      setError(t(`sheetLink.errors.${code}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="sheet-link" className="text-sm font-medium text-slate-700">
        {t("sheetLink.label")}
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="sheet-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          disabled={busy}
          placeholder={t("sheetLink.placeholder")}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            // A pasted link is the whole intent — import it straight away.
            const text = e.clipboardData.getData("text");
            if (parseSheetLink(text)) {
              e.preventDefault();
              setUrl(text.trim());
              void submit(text);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
        />
        <button type="submit" disabled={busy || !url.trim()} className="btn-primary shrink-0">
          {busy ? t("sheetLink.loading") : t("sheetLink.import")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{t("sheetLink.hint")}</p>
      )}
    </form>
  );
}
