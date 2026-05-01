import { useState } from "react";
import { useTranslation } from "react-i18next";

const PROMPT_CA = `Tinc un Excel/Google Sheet amb el meu històric d'inversions però en un format desordenat. Necessito que el reorganitzis a un Excel amb 4 fulls EXACTAMENT amb aquests noms i estructura:

FULL 1: "Portfolio 1 (TR)"
- Fila 3 = capçaleres exactes: Nom | Nº titols | Preu compra | Valor compra | Data compra | Nº titols | Preu venda | Valor venda | Data venda | Resultat
- A partir de la fila 4: una fila per transacció.
- Compra → ompliu columnes 1-5 i deixeu 6-10 buides.
- Venda → deixeu 1-5 buides i ompliu 6-10. Resultat = (preu venda - preu mig compra) * nº títols venuts.
- Dates en format Excel serial (número) o "yyyy-mm-dd".
- "Nom" és el ticker tal com el coneix l'API (p.ex. AAPL, NVDA, AMSL).

FULL 2: "Portfolio 2 (operacions)"
- Mateixa estructura que el Full 1, però per a transaccions d'altres brokers.

FULL 3: "Interessos i dividends"
- Columna A: data interès, Columna B: import interès.
- Columna E: ticker dividend, Columna F: import, Columna G: data.

FULL 4: "Patrimoni"
- Columna A: categoria ("Accions" o "Efectiu"), Columna B: nom del compte/cartera, Columna C: valor.

Si trobes dades que no encaixen, posa-les a una pestanya nova "Notes" i comenta-m'ho. No inventis valors. Si una columna no la tens (ex: resultat), deixa-la buida.

Retorna'm el fitxer .xlsx llest per pujar.`;

const PROMPT_EN = `I have an Excel/Google Sheet with my investment history but in a messy format. I need you to reorganize it into an Excel with 4 sheets named EXACTLY as follows:

SHEET 1: "Portfolio 1 (TR)"
- Row 3 = exact headers: Nom | Nº titols | Preu compra | Valor compra | Data compra | Nº titols | Preu venda | Valor venda | Data venda | Resultat
- From row 4: one row per transaction.
- Buy → fill columns 1-5, leave 6-10 empty.
- Sell → leave 1-5 empty, fill 6-10. Result = (sell price - avg buy price) * sold shares.
- Dates in Excel serial format (number) or "yyyy-mm-dd".
- "Nom" is the ticker as the API recognizes it (e.g. AAPL, NVDA, AMSL).

SHEET 2: "Portfolio 2 (operacions)"
- Same structure as Sheet 1, but for transactions from other brokers.

SHEET 3: "Interessos i dividends"
- Column A: interest date, Column B: interest amount.
- Column E: dividend ticker, Column F: amount, Column G: date.

SHEET 4: "Patrimoni"
- Column A: category ("Accions" or "Efectiu"), Column B: account/portfolio name, Column C: value.

If you find data that doesn't fit, put it in a new "Notes" tab and tell me. Do not invent values. If a column is missing (e.g. result), leave it empty.

Return me the .xlsx file ready to upload.`;

export function HowToPreparePage() {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const prompt = i18n.language?.startsWith("en") ? PROMPT_EN : PROMPT_CA;

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("howTo.title")}
        </h1>
        <p className="mt-2 text-slate-600">{t("howTo.intro")}</p>
      </header>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-slate-900">{t("howTo.promptTitle")}</h2>
          <button onClick={copy} className="btn-primary text-xs px-3 py-1.5">
            {copied ? t("howTo.copied") : t("howTo.copy")}
          </button>
        </div>
        <pre className="whitespace-pre-wrap text-xs bg-slate-900 text-slate-100 rounded-md p-4 max-h-[420px] overflow-auto">
{prompt}
        </pre>
      </section>

      <section className="card">
        <h2 className="font-medium text-slate-900">{t("howTo.schemaTitle")}</h2>
        <p className="mt-2 text-sm text-slate-600">{t("howTo.schemaDesc")}</p>
        <ul className="mt-3 list-disc list-inside text-sm text-slate-700 space-y-1">
          <li>{t("howTo.sheet1")}</li>
          <li>{t("howTo.sheet2")}</li>
          <li>{t("howTo.sheet3")}</li>
          <li>{t("howTo.sheet4")}</li>
        </ul>
      </section>
    </div>
  );
}
