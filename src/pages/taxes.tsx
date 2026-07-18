import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  parseWorkbook,
  type Dividend,
  type Interest,
  type Transaction,
} from "@/lib/excel-parser";
import { getPortfolio } from "@/lib/api";
import { getTrialTxns, hasTrial } from "@/lib/trial";
import { useUser } from "@/hooks/useUser";
import { useSeo } from "@/lib/seo";
import { formatMoney } from "@/lib/currency";
import {
  TAX_COUNTRIES,
  ES_AVAILABLE_YEARS,
  ES_DEFAULT_YEAR,
  EMPTY_ES_ANSWERS,
  computeEsReport,
  salesFromTransactions,
  inExercise,
  type EsAnswers,
  type EsTaxReport,
  type SaleEvent,
  type TaxCountry,
} from "@/lib/tax";

// Tax wizard (TAXES_PROPOSAL.md phase 1): country → exercise → data source →
// review → guided questions → "box → amount" report for Renta Web. All math is
// client-side (12-function API cap untouched); the page is public so the trial
// path works without an account and the copy below the wizard is indexable.

type TaxData = {
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
};

type Step = "country" | "year" | "source" | "review" | "questions" | "report";
const STEPS: Step[] = ["country", "year", "source", "review", "questions", "report"];

const FAQ_KEYS = ["casella", "fifo", "foreign", "advice"] as const;

function localeOf(lang: string): string {
  return lang.startsWith("es") ? "es-ES" : lang.startsWith("en") ? "en-US" : "ca-ES";
}

export function TaxesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useUser();
  const numLocale = localeOf(i18n.language ?? "ca");
  const eur = (n: number) => formatMoney(n, "EUR", numLocale);

  const [step, setStep] = useState<Step>("country");
  const [country, setCountry] = useState<TaxCountry>("es");
  const [year, setYear] = useState<number>(ES_DEFAULT_YEAR);
  const [data, setData] = useState<TaxData | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<EsAnswers>(EMPTY_ES_ANSWERS);
  const fileRef = useRef<HTMLInputElement>(null);

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          name: t("taxes.h1"),
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: "https://www.trimmtrack.com/taxes",
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
        },
        {
          "@type": "FAQPage",
          mainEntity: FAQ_KEYS.map((k) => ({
            "@type": "Question",
            name: t(`taxes.faq.${k}.q`),
            acceptedAnswer: { "@type": "Answer", text: t(`taxes.faq.${k}.a`) },
          })),
        },
      ],
    }),
    [t],
  );
  useSeo({
    title: t("seo.taxesTitle"),
    description: t("seo.taxesDesc"),
    jsonLd,
  });

  // Sales of the chosen exercise, derived once per data/year change. The review
  // step checkboxes index into this array; computeEsReport uses the same
  // derivation so the indexes line up.
  const yearSales = useMemo<SaleEvent[]>(() => {
    if (!data) return [];
    return inExercise(salesFromTransactions(data.transactions), year).inYear;
  }, [data, year]);

  const yearDividends = useMemo(
    () => (data ? inExercise(data.dividends, year).inYear : []),
    [data, year],
  );
  const yearInterests = useMemo(
    () => (data ? inExercise(data.interests, year).inYear : []),
    [data, year],
  );

  // Editable prefill: dividends from tickers without the Spanish .MC suffix are
  // probably foreign-source. The user confirms/corrects on the questions step.
  const foreignPrefill = useMemo(
    () =>
      yearDividends
        .filter((d) => !d.ticker?.trim().toUpperCase().endsWith(".MC"))
        .reduce((s, d) => s + d.amount, 0),
    [yearDividends],
  );

  const report = useMemo<EsTaxReport | null>(() => {
    if (!data || step !== "report") return null;
    return computeEsReport({
      year,
      transactions: data.transactions,
      dividends: data.dividends,
      interests: data.interests,
      answers,
      excludedSaleIdx: excluded,
    });
  }, [data, step, year, answers, excluded]);

  function goTo(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }
  function next() {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) goTo(STEPS[i + 1]);
  }
  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) goTo(STEPS[i - 1]);
  }

  function applyData(d: TaxData) {
    setData(d);
    setExcluded(new Set());
    setSourceError(null);
    goTo("review");
  }

  async function loadPortfolio() {
    if (!user) return;
    setLoadingPortfolio(true);
    setSourceError(null);
    try {
      const p = await getPortfolio(user.id);
      applyData({
        transactions: p.transactions,
        dividends: p.dividends,
        interests: p.interests,
      });
    } catch {
      setSourceError(t("taxes.source.portfolioError"));
    } finally {
      setLoadingPortfolio(false);
    }
  }

  async function onExcel(file: File) {
    setSourceError(null);
    try {
      const parsed = parseWorkbook(await file.arrayBuffer());
      if (parsed.transactions.length === 0 && parsed.dividends.length === 0) {
        setSourceError(t("taxes.source.excel.empty"));
        return;
      }
      applyData({
        transactions: parsed.transactions,
        dividends: parsed.dividends,
        interests: parsed.interests,
      });
    } catch {
      setSourceError(t("taxes.source.excel.error"));
    }
  }

  function loadTrial() {
    applyData({ transactions: getTrialTxns(), dividends: [], interests: [] });
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">{t("taxes.h1")}</h1>
        <p className="mt-2 text-slate-600">{t("taxes.lead")}</p>
      </header>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`rounded-full px-3 py-1 ring-1 ${
              i === stepIndex
                ? "bg-brand-600 text-white ring-brand-600"
                : i < stepIndex
                  ? "bg-brand-50 text-brand-700 ring-brand-200"
                  : "bg-white text-slate-400 ring-slate-200"
            }`}
          >
            {i + 1}. {t(`taxes.steps.${s}`)}
          </li>
        ))}
      </ol>

      <div className="card p-6 space-y-6">
        {step === "country" && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("taxes.country.title")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {TAX_COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  disabled={!c.available}
                  onClick={() => {
                    setCountry(c.code);
                    next();
                  }}
                  className={`rounded-xl border p-4 text-left transition ${
                    c.available
                      ? country === c.code
                        ? "border-brand-500 bg-brand-50"
                        : "border-slate-200 bg-white hover:border-brand-300"
                      : "border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed"
                  }`}
                >
                  <span className="text-2xl">{c.flag}</span>
                  <p className="mt-1 font-medium text-slate-900">
                    {t(`taxes.country.${c.code}`)}
                  </p>
                  {!c.available && (
                    <p className="text-xs text-slate-500">{t("taxes.country.soon")}</p>
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">{t("taxes.country.moreSoon")}</p>
          </section>
        )}

        {step === "year" && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("taxes.year.title")}
            </h2>
            <div className="flex flex-wrap gap-3">
              {ES_AVAILABLE_YEARS.map((y) => (
                <button
                  key={y}
                  onClick={() => {
                    setYear(y);
                    next();
                  }}
                  className={`rounded-xl border px-5 py-3 font-medium ${
                    year === y
                      ? "border-brand-500 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                  }`}
                >
                  {t("taxes.year.label", { year: y })}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {t("taxes.year.hint", { year, next: year + 1 })}
            </p>
          </section>
        )}

        {step === "source" && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("taxes.source.title")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col">
                <p className="font-medium text-slate-900">
                  {t("taxes.source.portfolio.title")}
                </p>
                <p className="mt-1 flex-1 text-xs text-slate-500">
                  {t("taxes.source.portfolio.desc")}
                </p>
                {user ? (
                  <button
                    onClick={() => void loadPortfolio()}
                    disabled={loadingPortfolio}
                    className="btn-primary mt-3 text-sm px-3 py-1.5"
                  >
                    {loadingPortfolio ? "…" : t("taxes.source.portfolio.use")}
                  </button>
                ) : (
                  <Link
                    to="/auth/sign-in?next=/taxes"
                    className="btn-ghost mt-3 text-center text-sm px-3 py-1.5"
                  >
                    {t("taxes.source.portfolio.signIn")}
                  </Link>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col">
                <p className="font-medium text-slate-900">
                  {t("taxes.source.excel.title")}
                </p>
                <p className="mt-1 flex-1 text-xs text-slate-500">
                  {t("taxes.source.excel.desc")}
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onExcel(f);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn-primary mt-3 text-sm px-3 py-1.5"
                >
                  {t("taxes.source.excel.button")}
                </button>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col">
                <p className="font-medium text-slate-900">
                  {t("taxes.source.trial.title")}
                </p>
                <p className="mt-1 flex-1 text-xs text-slate-500">
                  {t("taxes.source.trial.desc")}
                </p>
                <button
                  onClick={loadTrial}
                  disabled={!hasTrial()}
                  className="btn-ghost mt-3 text-sm px-3 py-1.5 disabled:opacity-50"
                >
                  {t("taxes.source.trial.use")}
                </button>
              </div>
            </div>
            {sourceError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {sourceError}
              </p>
            )}
            <p className="text-xs text-slate-500">
              {t("taxes.source.formatHint")}{" "}
              <Link to="/upload" className="text-brand-700 underline">
                {t("taxes.source.formatLink")}
              </Link>
            </p>
          </section>
        )}

        {step === "review" && data && (
          <section className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("taxes.review.title", { year })}
            </h2>
            <p className="text-sm text-slate-600">{t("taxes.review.hint")}</p>

            <div>
              <h3 className="font-medium text-slate-900">
                {t("taxes.review.salesTitle", { count: yearSales.length })}
              </h3>
              {yearSales.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">{t("taxes.review.noSales")}</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="table-base w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        <th className="py-1.5 pr-2"></th>
                        <th className="py-1.5 pr-3">{t("taxes.review.hTicker")}</th>
                        <th className="py-1.5 pr-3">{t("taxes.review.hDate")}</th>
                        <th className="py-1.5 pr-3 text-right">{t("taxes.review.hProceeds")}</th>
                        <th className="py-1.5 pr-3 text-right">{t("taxes.review.hCost")}</th>
                        <th className="py-1.5 text-right">{t("taxes.review.hGain")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearSales.map((s, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="py-1.5 pr-2">
                            <input
                              type="checkbox"
                              checked={!excluded.has(i)}
                              onChange={(e) => {
                                setExcluded((prev) => {
                                  const nxt = new Set(prev);
                                  if (e.target.checked) nxt.delete(i);
                                  else nxt.add(i);
                                  return nxt;
                                });
                              }}
                            />
                          </td>
                          <td className="py-1.5 pr-3 font-medium text-slate-900">{s.ticker}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{s.sellDate}</td>
                          <td className="py-1.5 pr-3 text-right">{eur(s.proceeds)}</td>
                          <td className="py-1.5 pr-3 text-right">{eur(s.cost)}</td>
                          <td
                            className={`py-1.5 text-right font-medium ${
                              s.gain >= 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {eur(s.gain)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">
                  {t("taxes.review.dividends", { count: yearDividends.length })}
                </p>
                <p className="font-medium text-slate-900">
                  {eur(yearDividends.reduce((s, d) => s + d.amount, 0))}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">
                  {t("taxes.review.interests", { count: yearInterests.length })}
                </p>
                <p className="font-medium text-slate-900">
                  {eur(yearInterests.reduce((s, d) => s + d.amount, 0))}
                </p>
              </div>
            </div>
          </section>
        )}

        {step === "questions" && (
          <section className="space-y-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("taxes.questions.title")}
            </h2>
            <p className="text-sm text-slate-600">{t("taxes.questions.hint")}</p>

            <NumberField
              label={t("taxes.questions.carryGains.label")}
              help={t("taxes.questions.carryGains.help")}
              value={answers.carryLossesGains}
              onChange={(v) => setAnswers((a) => ({ ...a, carryLossesGains: v }))}
            />
            <NumberField
              label={t("taxes.questions.carryRcm.label")}
              help={t("taxes.questions.carryRcm.help")}
              value={answers.carryLossesRcm}
              onChange={(v) => setAnswers((a) => ({ ...a, carryLossesRcm: v }))}
            />
            <NumberField
              label={t("taxes.questions.foreignGross.label")}
              help={t("taxes.questions.foreignGross.help", {
                prefill: eur(foreignPrefill),
              })}
              value={answers.foreignDividendGross}
              onChange={(v) => setAnswers((a) => ({ ...a, foreignDividendGross: v }))}
              prefill={foreignPrefill}
              prefillLabel={t("taxes.questions.usePrefill")}
            />
            <NumberField
              label={t("taxes.questions.foreignWithholding.label")}
              help={t("taxes.questions.foreignWithholding.help")}
              value={answers.foreignWithholding}
              onChange={(v) => setAnswers((a) => ({ ...a, foreignWithholding: v }))}
            />
            <NumberField
              label={t("taxes.questions.spanishWithholding.label")}
              help={t("taxes.questions.spanishWithholding.help")}
              value={answers.spanishWithholding}
              onChange={(v) => setAnswers((a) => ({ ...a, spanishWithholding: v }))}
            />
            <CheckField
              label={t("taxes.questions.abroad.label")}
              checked={answers.assetsAbroadOver50k}
              onChange={(v) => setAnswers((a) => ({ ...a, assetsAbroadOver50k: v }))}
            />
            <CheckField
              label={t("taxes.questions.cryptoAbroad.label")}
              checked={answers.cryptoAbroadOver50k}
              onChange={(v) => setAnswers((a) => ({ ...a, cryptoAbroadOver50k: v }))}
            />
          </section>
        )}

        {step === "report" && report && (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-900">
              {t("taxes.report.title", { year })}
            </h2>

            {/* Box → amount cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              {report.lines.map((l) => (
                <div
                  key={l.key}
                  className="rounded-xl border border-brand-200 bg-brand-50/60 p-4"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                    {t("taxes.report.boxLabel", { box: l.box })}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {t(`taxes.report.lines.${l.key}`)}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {eur(l.amount)}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">{t("taxes.report.orientative")}</p>

            {/* Detail blocks */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-1">
                <p className="font-medium text-slate-900">{t("taxes.report.gp.title")}</p>
                <Row k={t("taxes.report.gp.gains")} v={eur(report.gainsPositive)} />
                <Row k={t("taxes.report.gp.losses")} v={eur(report.lossesNegative)} />
                <Row k={t("taxes.report.gp.net")} v={eur(report.netSales)} strong />
              </div>
              <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-1">
                <p className="font-medium text-slate-900">{t("taxes.report.rcm.title")}</p>
                <Row k={t("taxes.report.rcm.dividends")} v={eur(report.dividendsTotal)} />
                <Row k={t("taxes.report.rcm.interests")} v={eur(report.interestsTotal)} />
                <Row k={t("taxes.report.rcm.total")} v={eur(report.rcmTotal)} strong />
              </div>
            </div>

            {(report.carryLossesApplied > 0 ||
              report.crossCompensationUsed > 0 ||
              report.lossesCarriedForward > 0) && (
              <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-1">
                <p className="font-medium text-slate-900">{t("taxes.report.comp.title")}</p>
                {report.carryLossesApplied > 0 && (
                  <Row
                    k={t("taxes.report.comp.carryApplied")}
                    v={eur(report.carryLossesApplied)}
                  />
                )}
                {report.crossCompensationUsed > 0 && (
                  <Row
                    k={t("taxes.report.comp.crossUsed", {
                      cap: eur(report.crossCompensationCap),
                    })}
                    v={eur(report.crossCompensationUsed)}
                  />
                )}
                {report.lossesCarriedForward > 0 && (
                  <Row
                    k={t("taxes.report.comp.carriedForward")}
                    v={eur(report.lossesCarriedForward)}
                    strong
                  />
                )}
              </div>
            )}

            <div className="rounded-lg bg-slate-50 p-4 text-sm space-y-1">
              <p className="font-medium text-slate-900">{t("taxes.report.quota.title")}</p>
              <Row k={t("taxes.report.quota.base")} v={eur(report.savingsBase)} strong />
              {report.bracketSteps.map((b, i) => (
                <Row
                  key={i}
                  k={t("taxes.report.quota.bracket", {
                    rate: (b.rate * 100).toFixed(0),
                    amount: eur(b.amount),
                  })}
                  v={eur(b.tax)}
                />
              ))}
              <Row k={t("taxes.report.quota.estimated")} v={eur(report.estimatedQuota)} strong />
              {report.foreignDeduction > 0 && (
                <Row
                  k={t("taxes.report.quota.deduction")}
                  v={`−${eur(report.foreignDeduction)}`}
                />
              )}
              {report.spanishWithholding > 0 && (
                <Row
                  k={t("taxes.report.quota.withheld")}
                  v={`−${eur(report.spanishWithholding)}`}
                />
              )}
              <Row
                k={t("taxes.report.quota.balance")}
                v={eur(report.estimatedBalance)}
                strong
              />
              <p className="pt-1 text-xs text-slate-500">{t("taxes.report.quota.balanceNote")}</p>
            </div>

            {report.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                <p className="font-medium text-amber-900">{t("taxes.report.warningsTitle")}</p>
                <ul className="mt-2 space-y-2 text-amber-800">
                  {report.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden>⚠</span>
                      <span>{t(`taxes.warnings.${w.code}`, { detail: w.detail ?? "" })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-3 print:hidden">
              <button onClick={() => window.print()} className="btn-primary text-sm px-4 py-2">
                {t("taxes.report.print")}
              </button>
              <button
                onClick={() => {
                  setData(null);
                  setAnswers(EMPTY_ES_ANSWERS);
                  setExcluded(new Set());
                  goTo("country");
                }}
                className="btn-ghost text-sm px-4 py-2"
              >
                {t("taxes.report.restart")}
              </button>
            </div>
          </section>
        )}

        {/* Nav buttons (steps with explicit selection advance on click instead) */}
        {(step === "review" || step === "questions") && (
          <div className="flex justify-between border-t border-slate-100 pt-4 print:hidden">
            <button onClick={back} className="btn-ghost text-sm px-4 py-2">
              {t("taxes.back")}
            </button>
            <button onClick={next} className="btn-primary text-sm px-4 py-2">
              {step === "questions" ? t("taxes.seeReport") : t("taxes.next")}
            </button>
          </div>
        )}
        {(step === "year" || step === "source") && (
          <div className="border-t border-slate-100 pt-4 print:hidden">
            <button onClick={back} className="btn-ghost text-sm px-4 py-2">
              {t("taxes.back")}
            </button>
          </div>
        )}
      </div>

      <p className="rounded-lg bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600">
        {t("taxes.disclaimer")}{" "}
        <Link to="/disclaimer" className="underline">
          Disclaimer
        </Link>
      </p>

      {/* Indexable copy + FAQ (the prerendered snapshot carries this). */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">{t("taxes.whatTitle")}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{t("taxes.whatBody")}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">{t("taxes.howTitle")}</h2>
        <p className="text-sm leading-relaxed text-slate-600">{t("taxes.howBody")}</p>
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">{t("taxes.faqTitle")}</h2>
        <dl className="space-y-4">
          {FAQ_KEYS.map((k) => (
            <div key={k}>
              <dt className="font-medium text-slate-900">{t(`taxes.faq.${k}.q`)}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                {t(`taxes.faq.${k}.a`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/60 p-6 ring-1 ring-brand-200">
        <h2 className="text-lg font-semibold text-slate-900">{t("taxes.cta.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("taxes.cta.body")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/upload" className="btn-primary text-sm px-4 py-2">
            {t("taxes.cta.primary")}
          </Link>
          <Link to="/calculadora-fifo" className="btn-ghost text-sm px-4 py-2">
            {t("taxes.cta.secondary")}
          </Link>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <p className="flex justify-between gap-4">
      <span className={strong ? "font-medium text-slate-900" : "text-slate-600"}>{k}</span>
      <span className={strong ? "font-semibold text-slate-900" : "text-slate-700"}>{v}</span>
    </p>
  );
}

function NumberField({
  label,
  help,
  value,
  onChange,
  prefill,
  prefillLabel,
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
  prefill?: number;
  prefillLabel?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-900">{label}</label>
      {help && <p className="mt-0.5 text-xs text-slate-500">{help}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value === 0 ? "" : value}
          placeholder="0"
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            onChange(Number.isFinite(n) && n >= 0 ? n : 0);
          }}
          className="w-44 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
        />
        <span className="text-sm text-slate-500">€</span>
        {prefill != null && prefill > 0 && prefillLabel && (
          <button
            type="button"
            onClick={() => onChange(Math.round(prefill * 100) / 100)}
            className="text-xs text-brand-700 underline"
          >
            {prefillLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      {label}
    </label>
  );
}
