import { useMemo, useRef, useState } from "react";
import { LocaleLink } from "@/components/LocaleLink";

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
//
// Visual language: deliberately NOT card-in-card. One open column, hairline
// dividers (#ece0cb, the warm border token), display-font headings, text-link
// actions with arrows, and a receipt-style report with dotted leaders. The only
// boxed moments are the amber warning callout (left rule) and the dark CTA band.

type TaxData = {
  transactions: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
};

type Step = "country" | "year" | "source" | "review" | "questions" | "report";
const STEPS: Step[] = ["country", "year", "source", "review", "questions", "report"];

const FAQ_KEYS = ["casella", "fifo", "foreign", "advice"] as const;
// Warm hairline for both border-* and divide-* contexts (divide children take
// the color from divide-[…], not border-[…]).
const HAIR = "border-[#ece0cb] divide-[#ece0cb]";

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
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
          {t("nav.taxes")}
        </p>
        <h1 className="mt-2 font-display text-4xl text-slate-900">{t("taxes.h1")}</h1>
        <p className="mt-3 leading-relaxed text-slate-600">{t("taxes.lead")}</p>
      </header>

      {/* Progress line: numbered dots joined by a rule that fills as you go. */}
      <ol className="mt-10 flex items-center print:hidden" aria-label="progress">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
            {i > 0 && (
              <span
                aria-hidden
                className={`mx-1.5 h-px flex-1 ${
                  i <= stepIndex ? "bg-brand-500" : "bg-[#e5dbc8]"
                }`}
              />
            )}
            <span className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < stepIndex
                    ? "bg-brand-500 text-white"
                    : i === stepIndex
                      ? "bg-slate-900 text-white"
                      : "border border-[#e5dbc8] text-slate-400"
                }`}
              >
                {i < stepIndex ? "✓" : i + 1}
              </span>
              <span
                className={`hidden text-[11px] sm:block ${
                  i === stepIndex ? "font-medium text-slate-900" : "text-slate-400"
                }`}
              >
                {t(`taxes.steps.${s}`)}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className={`mt-8 border-t ${HAIR} pt-8`}>
        {step === "country" && (
          <section>
            <h2 className="font-display text-2xl text-slate-900">
              {t("taxes.country.title")}
            </h2>
            <div className={`mt-6 divide-y ${HAIR} border-y ${HAIR}`}>
              {TAX_COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  disabled={!c.available}
                  onClick={() => {
                    setCountry(c.code);
                    next();
                  }}
                  className={`group flex w-full items-center gap-4 py-5 text-left ${
                    c.available ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <span className="text-3xl" aria-hidden>
                    {c.flag}
                  </span>
                  <span className="flex-1">
                    <span
                      className={`font-display text-lg group-hover:text-brand-700 ${
                        country === c.code && c.available ? "text-brand-700" : "text-slate-900"
                      }`}
                    >
                      {t(`taxes.country.${c.code}`)}
                    </span>
                    {!c.available && (
                      <span className="ml-3 text-xs uppercase tracking-wide text-slate-400">
                        {t("taxes.country.soon")}
                      </span>
                    )}
                  </span>
                  {c.available && (
                    <span
                      aria-hidden
                      className="text-brand-600 transition-transform group-hover:translate-x-1"
                    >
                      →
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">{t("taxes.country.moreSoon")}</p>
          </section>
        )}

        {step === "year" && (
          <section>
            <h2 className="font-display text-2xl text-slate-900">
              {t("taxes.year.title")}
            </h2>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-10 gap-y-4">
              {ES_AVAILABLE_YEARS.map((y) => (
                <button
                  key={y}
                  onClick={() => {
                    setYear(y);
                    next();
                  }}
                  className={`group font-display text-3xl transition-colors ${
                    year === y
                      ? "text-brand-600"
                      : "text-slate-400 hover:text-slate-900"
                  }`}
                >
                  {y}
                  <span
                    className={`mt-1 block h-0.5 rounded transition-all ${
                      year === y
                        ? "bg-brand-500"
                        : "scale-x-0 bg-slate-300 group-hover:scale-x-100"
                    }`}
                    aria-hidden
                  />
                </button>
              ))}
            </div>
            <p className="mt-5 text-xs text-slate-500">
              {t("taxes.year.hint", { year, next: year + 1 })}
            </p>
          </section>
        )}

        {step === "source" && (
          <section>
            <h2 className="font-display text-2xl text-slate-900">
              {t("taxes.source.title")}
            </h2>
            <div
              className={`mt-6 grid gap-8 sm:grid-cols-3 sm:gap-0 sm:divide-x ${HAIR}`}
            >
              <div className="sm:pr-6">
                <p className="font-display text-lg text-slate-900">
                  {t("taxes.source.portfolio.title")}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  {t("taxes.source.portfolio.desc")}
                </p>
                {user ? (
                  <button
                    onClick={() => void loadPortfolio()}
                    disabled={loadingPortfolio}
                    className="group mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-600"
                  >
                    {loadingPortfolio ? "…" : t("taxes.source.portfolio.use")}
                    <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </button>
                ) : (
                  <LocaleLink
                    to="/auth/sign-in?next=/taxes"
                    className="group mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-600"
                  >
                    {t("taxes.source.portfolio.signIn")}
                    <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </LocaleLink>
                )}
              </div>
              <div className="sm:px-6">
                <p className="font-display text-lg text-slate-900">
                  {t("taxes.source.excel.title")}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
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
                  className="group mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-600"
                >
                  {t("taxes.source.excel.button")}
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
              </div>
              <div className="sm:pl-6">
                <p className="font-display text-lg text-slate-900">
                  {t("taxes.source.trial.title")}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  {t("taxes.source.trial.desc")}
                </p>
                <button
                  onClick={loadTrial}
                  disabled={!hasTrial()}
                  className="group mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-600 disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  {t("taxes.source.trial.use")}
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
              </div>
            </div>
            {sourceError && (
              <p className="mt-5 border-l-2 border-rose-400 pl-3 text-sm text-rose-700">
                {sourceError}
              </p>
            )}
            <p className={`mt-6 border-t ${HAIR} pt-4 text-xs text-slate-500`}>
              {t("taxes.source.formatHint")}{" "}
              <LocaleLink to="/upload" className="text-brand-700 underline">
                {t("taxes.source.formatLink")}
              </LocaleLink>
            </p>
          </section>
        )}

        {step === "review" && data && (
          <section>
            <h2 className="font-display text-2xl text-slate-900">
              {t("taxes.review.title", { year })}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{t("taxes.review.hint")}</p>

            <h3 className="mt-8 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
              {t("taxes.review.salesTitle", { count: yearSales.length })}
            </h3>
            {yearSales.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t("taxes.review.noSales")}</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={`border-b ${HAIR} text-left text-xs text-slate-400`}>
                      <th className="py-2 pr-2 font-normal"></th>
                      <th className="py-2 pr-3 font-normal">{t("taxes.review.hTicker")}</th>
                      <th className="py-2 pr-3 font-normal">{t("taxes.review.hDate")}</th>
                      <th className="py-2 pr-3 text-right font-normal">
                        {t("taxes.review.hProceeds")}
                      </th>
                      <th className="py-2 pr-3 text-right font-normal">
                        {t("taxes.review.hCost")}
                      </th>
                      <th className="py-2 text-right font-normal">{t("taxes.review.hGain")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearSales.map((s, i) => (
                      <tr
                        key={i}
                        className={`border-b ${HAIR} ${excluded.has(i) ? "opacity-40" : ""}`}
                      >
                        <td className="py-2 pr-2">
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
                        <td className="py-2 pr-3 font-medium text-slate-900">{s.ticker}</td>
                        <td className="py-2 pr-3 text-slate-500">{s.sellDate}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{eur(s.proceeds)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{eur(s.cost)}</td>
                        <td
                          className={`py-2 text-right font-medium tabular-nums ${
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

            <dl className="mt-6 space-y-2 text-sm">
              <DottedRow
                label={t("taxes.review.dividends", { count: yearDividends.length })}
                value={eur(yearDividends.reduce((s, d) => s + d.amount, 0))}
              />
              <DottedRow
                label={t("taxes.review.interests", { count: yearInterests.length })}
                value={eur(yearInterests.reduce((s, d) => s + d.amount, 0))}
              />
            </dl>
          </section>
        )}

        {step === "questions" && (
          <section>
            <h2 className="font-display text-2xl text-slate-900">
              {t("taxes.questions.title")}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{t("taxes.questions.hint")}</p>

            <div className={`mt-6 divide-y ${HAIR}`}>
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
            </div>
          </section>
        )}

        {step === "report" && report && (
          <section>
            <h2 className="font-display text-2xl text-slate-900">
              {t("taxes.report.title", { year })}
            </h2>

            {/* Receipt: box → dotted leader → amount. */}
            <dl className={`mt-6 divide-y ${HAIR} border-y ${HAIR}`}>
              {report.lines.map((l) => (
                <div key={l.key} className="py-3.5">
                  <div className="flex items-baseline gap-2">
                    <dt className="shrink-0">
                      <span className="font-display text-sm font-semibold text-brand-700">
                        {t("taxes.report.boxLabel", { box: l.box })}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {t(`taxes.report.lines.${l.key}`)}
                      </span>
                    </dt>
                    <span
                      aria-hidden
                      className="mx-1 flex-1 self-end border-b border-dotted border-slate-300 mb-1"
                    />
                    <dd className="shrink-0 font-display text-xl text-slate-900 tabular-nums">
                      {eur(l.amount)}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs italic text-slate-500">
              {t("taxes.report.orientative")}
            </p>

            <div className="mt-8 grid gap-10 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  {t("taxes.report.gp.title")}
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <DottedRow label={t("taxes.report.gp.gains")} value={eur(report.gainsPositive)} />
                  <DottedRow label={t("taxes.report.gp.losses")} value={eur(report.lossesNegative)} />
                  <DottedRow label={t("taxes.report.gp.net")} value={eur(report.netSales)} strong />
                </dl>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  {t("taxes.report.rcm.title")}
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <DottedRow label={t("taxes.report.rcm.dividends")} value={eur(report.dividendsTotal)} />
                  <DottedRow label={t("taxes.report.rcm.interests")} value={eur(report.interestsTotal)} />
                  <DottedRow label={t("taxes.report.rcm.total")} value={eur(report.rcmTotal)} strong />
                </dl>
              </div>
            </div>

            {(report.carryLossesApplied > 0 ||
              report.crossCompensationUsed > 0 ||
              report.lossesCarriedForward > 0) && (
              <div className="mt-8">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                  {t("taxes.report.comp.title")}
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  {report.carryLossesApplied > 0 && (
                    <DottedRow
                      label={t("taxes.report.comp.carryApplied")}
                      value={eur(report.carryLossesApplied)}
                    />
                  )}
                  {report.crossCompensationUsed > 0 && (
                    <DottedRow
                      label={t("taxes.report.comp.crossUsed", {
                        cap: eur(report.crossCompensationCap),
                      })}
                      value={eur(report.crossCompensationUsed)}
                    />
                  )}
                  {report.lossesCarriedForward > 0 && (
                    <DottedRow
                      label={t("taxes.report.comp.carriedForward")}
                      value={eur(report.lossesCarriedForward)}
                      strong
                    />
                  )}
                </dl>
              </div>
            )}

            <div className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                {t("taxes.report.quota.title")}
              </h3>
              <dl className="mt-3 space-y-2 text-sm">
                <DottedRow label={t("taxes.report.quota.base")} value={eur(report.savingsBase)} strong />
                {report.bracketSteps.map((b, i) => (
                  <DottedRow
                    key={i}
                    label={t("taxes.report.quota.bracket", {
                      rate: (b.rate * 100).toFixed(0),
                      amount: eur(b.amount),
                    })}
                    value={eur(b.tax)}
                    muted
                  />
                ))}
                <DottedRow
                  label={t("taxes.report.quota.estimated")}
                  value={eur(report.estimatedQuota)}
                  strong
                />
                {report.foreignDeduction > 0 && (
                  <DottedRow
                    label={t("taxes.report.quota.deduction")}
                    value={`−${eur(report.foreignDeduction)}`}
                  />
                )}
                {report.spanishWithholding > 0 && (
                  <DottedRow
                    label={t("taxes.report.quota.withheld")}
                    value={`−${eur(report.spanishWithholding)}`}
                  />
                )}
              </dl>
              <div className={`mt-4 border-t-2 border-slate-900 pt-3`}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-display text-lg text-slate-900">
                    {t("taxes.report.quota.balance")}
                  </span>
                  <span className="font-display text-2xl text-slate-900 tabular-nums">
                    {eur(report.estimatedBalance)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {t("taxes.report.quota.balanceNote")}
                </p>
              </div>
            </div>

            {report.warnings.length > 0 && (
              <div className="mt-8 border-l-2 border-amber-400 pl-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-700">
                  {t("taxes.report.warningsTitle")}
                </h3>
                <ul className="mt-3 space-y-3 text-sm text-slate-700">
                  {report.warnings.map((w, i) => (
                    <li key={i}>
                      {t(`taxes.warnings.${w.code}`, { detail: w.detail ?? "" })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-5 print:hidden">
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
                className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
              >
                {t("taxes.report.restart")}
              </button>
            </div>
          </section>
        )}

        {/* Nav (steps with explicit selection advance on click instead) */}
        {(step === "review" || step === "questions") && (
          <div className={`mt-10 flex items-center justify-between border-t ${HAIR} pt-5 print:hidden`}>
            <button
              onClick={back}
              className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              ← {t("taxes.back")}
            </button>
            <button onClick={next} className="btn-primary text-sm px-5 py-2">
              {step === "questions" ? t("taxes.seeReport") : t("taxes.next")} →
            </button>
          </div>
        )}
        {(step === "year" || step === "source") && (
          <div className="mt-10 print:hidden">
            <button
              onClick={back}
              className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              ← {t("taxes.back")}
            </button>
          </div>
        )}
      </div>

      <p className="mt-12 text-xs italic leading-relaxed text-slate-500">
        {t("taxes.disclaimer")}{" "}
        <LocaleLink to="/disclaimer" className="underline">
          Disclaimer
        </LocaleLink>
      </p>

      {/* Indexable copy + FAQ (the prerendered snapshot carries this). */}
      <div className={`mt-12 space-y-12 border-t ${HAIR} pt-12`}>
        <section className="grid gap-8 sm:grid-cols-[1fr_2fr]">
          <h2 className="font-display text-xl text-slate-900">{t("taxes.whatTitle")}</h2>
          <p className="text-sm leading-relaxed text-slate-600">{t("taxes.whatBody")}</p>
        </section>
        <section className="grid gap-8 sm:grid-cols-[1fr_2fr]">
          <h2 className="font-display text-xl text-slate-900">{t("taxes.howTitle")}</h2>
          <p className="text-sm leading-relaxed text-slate-600">{t("taxes.howBody")}</p>
        </section>

        <section>
          <h2 className="font-display text-xl text-slate-900">{t("taxes.faqTitle")}</h2>
          <div className={`mt-4 divide-y ${HAIR} border-y ${HAIR}`}>
            {FAQ_KEYS.map((k) => (
              <details key={k} className="group py-4">
                <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                  {t(`taxes.faq.${k}.q`)}
                  <span
                    aria-hidden
                    className="text-brand-600 transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                  {t(`taxes.faq.${k}.a`)}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Single boxed moment: the dark brand band, mirroring the landing. */}
        <section
          className="rounded-3xl px-8 py-10 text-center"
          style={{ background: "linear-gradient(180deg, #26211d 0%, #100d0b 100%)" }}
        >
          <h2 className="font-display text-2xl text-[#f3ead9]">{t("taxes.cta.title")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#c9bda9]">{t("taxes.cta.body")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <LocaleLink to="/upload" className="btn-primary text-sm px-5 py-2">
              {t("taxes.cta.primary")}
            </LocaleLink>
            <LocaleLink
              to="/calculadora-fifo"
              className="inline-flex items-center px-5 py-2 text-sm text-[#c9bda9] underline-offset-2 hover:text-[#f3ead9] hover:underline"
            >
              {t("taxes.cta.secondary")}
            </LocaleLink>
          </div>
        </section>
      </div>
    </div>
  );
}

/** label ……………… value — the receipt row used across review + report. */
function DottedRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt
        className={
          strong
            ? "shrink-0 font-medium text-slate-900"
            : muted
              ? "shrink-0 text-slate-400"
              : "shrink-0 text-slate-600"
        }
      >
        {label}
      </dt>
      <span
        aria-hidden
        className="mx-1 mb-1 flex-1 self-end border-b border-dotted border-slate-300"
      />
      <dd
        className={`shrink-0 tabular-nums ${
          strong ? "font-semibold text-slate-900" : muted ? "text-slate-400" : "text-slate-700"
        }`}
      >
        {value}
      </dd>
    </div>
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
    <div className="grid gap-1 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
      <div>
        <label className="block text-sm font-medium text-slate-900">{label}</label>
        {help && <p className="mt-0.5 text-xs text-slate-500">{help}</p>}
        {prefill != null && prefill > 0 && prefillLabel && (
          <button
            type="button"
            onClick={() => onChange(Math.round(prefill * 100) / 100)}
            className="mt-1 text-xs font-medium text-brand-700 underline underline-offset-2"
          >
            {prefillLabel}
          </button>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
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
          className="w-36 border-0 border-b border-slate-300 bg-transparent px-0 py-1 text-right text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-0"
        />
        <span className="text-sm text-slate-500">€</span>
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
    <label className="flex items-start gap-3 py-4 text-sm text-slate-700">
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
