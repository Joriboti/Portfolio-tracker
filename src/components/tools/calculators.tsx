import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { calculateSimpleDCF, impliedGrowth } from "@/lib/dcf";
import { grahamValue, grahamGrowthClamped, GRAHAM_GROWTH_CAP } from "@/lib/graham";
import { monteCarloSimpleDCF } from "@/lib/montecarlo";

// Self-contained, signup-free calculator widgets for the tool landing pages
// (see App.tsx). Each is a thin, controlled UI over the pure, tested math in
// src/lib (dcf.ts, graham.ts, montecarlo.ts) — no backend, no session, no live
// quotes: the visitor types the inputs.
//
// Presentation only: every label, result caption and explanatory note comes
// from the locale files under `calc.*`. The widgets are mounted on the ca and
// es landings too (/calculadora-dcf, /simulador-monte-carlo…), where English
// labels used to leak through; the maths below is untouched and unduplicated.

const num = (s: string): number => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const money = (n: number, ccy = "$") =>
  Number.isFinite(n) ? `${ccy}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");

function Field({
  label,
  value,
  onChange,
  suffix,
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-brand-400">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg bg-transparent px-3 py-2 outline-none"
        />
        {suffix ? <span className="px-3 text-slate-400">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl p-4 ${
        accent ? "bg-brand-600 text-white" : "bg-slate-50 ring-1 ring-slate-200"
      }`}
    >
      <div className={`text-xs ${accent ? "text-brand-50" : "text-slate-500"}`}>{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>
  );
}

export function DcfCalculator() {
  const { t } = useTranslation();
  const [eps, setEps] = useState("6");
  const [growth, setGrowth] = useState("10");
  const [years, setYears] = useState("10");
  const [mult, setMult] = useState("18");
  const [ret, setRet] = useState("10");
  const [price, setPrice] = useState("150");

  const r = useMemo(
    () =>
      calculateSimpleDCF({
        baseMetric: num(eps),
        growthRate: num(growth) / 100,
        years: num(years),
        exitMultiple: num(mult),
        desiredReturn: num(ret) / 100,
        currentPrice: num(price),
      }),
    [eps, growth, years, mult, ret, price],
  );

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("calc.fields.epsFcf")} value={eps} onChange={setEps} suffix="$" />
        <Field label={t("calc.fields.growth")} value={growth} onChange={setGrowth} suffix="%" />
        <Field label={t("calc.fields.years")} value={years} onChange={setYears} />
        <Field label={t("calc.fields.exitMultiple")} value={mult} onChange={setMult} suffix="×" />
        <Field label={t("calc.fields.requiredReturn")} value={ret} onChange={setRet} suffix="%" />
        <Field label={t("calc.fields.currentPrice")} value={price} onChange={setPrice} suffix="$" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label={t("calc.stats.fairValue")} value={money(r.fairValue)} accent />
        <Stat label={t("calc.stats.upside")} value={r.upsideVsPrice == null ? "—" : pct(r.upsideVsPrice)} />
        <Stat label={t("calc.stats.impliedReturn")} value={r.impliedReturn == null ? "—" : pct(r.impliedReturn)} />
      </div>
      <p className="mt-3 text-xs text-slate-400">{t("calc.notes.dcf")}</p>
    </Shell>
  );
}

export function ReverseDcfCalculator() {
  const { t } = useTranslation();
  const [price, setPrice] = useState("150");
  const [eps, setEps] = useState("6");
  const [years, setYears] = useState("10");
  const [mult, setMult] = useState("18");
  const [ret, setRet] = useState("10");

  const g = useMemo(
    () =>
      impliedGrowth({
        currentPrice: num(price),
        baseMetric: num(eps),
        years: num(years),
        exitMultiple: num(mult),
        desiredReturn: num(ret) / 100,
      }),
    [price, eps, years, mult, ret],
  );

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("calc.fields.currentPrice")} value={price} onChange={setPrice} suffix="$" />
        <Field label={t("calc.fields.epsFcf")} value={eps} onChange={setEps} suffix="$" />
        <Field label={t("calc.fields.years")} value={years} onChange={setYears} />
        <Field label={t("calc.fields.exitMultiple")} value={mult} onChange={setMult} suffix="×" />
        <Field label={t("calc.fields.requiredReturn")} value={ret} onChange={setRet} suffix="%" />
      </div>
      <div className="mt-5">
        <Stat label={t("calc.stats.impliedGrowth")} value={g == null ? "—" : pct(g)} accent />
      </div>
      <p className="mt-3 text-xs text-slate-400">{t("calc.notes.reverse")}</p>
    </Shell>
  );
}

export function GrahamCalculator() {
  const { t } = useTranslation();
  const [eps, setEps] = useState("6");
  const [growth, setGrowth] = useState("8");
  const [aaa, setAaa] = useState("4.5");

  const v = useMemo(() => grahamValue(num(eps), num(growth), num(aaa)), [eps, growth, aaa]);
  const clamped = grahamGrowthClamped(num(growth));

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("calc.fields.trailingEps")} value={eps} onChange={setEps} suffix="$" />
        <Field label={t("calc.fields.expectedGrowth")} value={growth} onChange={setGrowth} suffix="%" />
        <Field label={t("calc.fields.aaaYield")} value={aaa} onChange={setAaa} suffix="%" />
      </div>
      <div className="mt-5">
        <Stat label={t("calc.stats.graham")} value={money(v ?? NaN)} accent />
      </div>
      <p className="mt-3 text-xs text-slate-400">
        {t("calc.notes.graham")}{" "}
        {clamped ? t("calc.notes.grahamCapped", { cap: GRAHAM_GROWTH_CAP }) : ""}
      </p>
    </Shell>
  );
}

export function CompoundGrowthCalculator() {
  const { t } = useTranslation();
  const [initial, setInitial] = useState("10000");
  const [monthly, setMonthly] = useState("500");
  const [ret, setRet] = useState("7");
  const [years, setYears] = useState("20");

  const out = useMemo(() => {
    const P = num(initial);
    const c = num(monthly);
    const yrs = num(years);
    const rMonthly = num(ret) / 100 / 12;
    const months = Math.round(yrs * 12);
    if (![P, c, yrs].every(Number.isFinite) || months <= 0) {
      return { future: NaN, contributed: NaN, growth: NaN };
    }
    let bal = P;
    for (let m = 0; m < months; m++) bal = bal * (1 + rMonthly) + c;
    const contributed = P + c * months;
    return { future: bal, contributed, growth: bal - contributed };
  }, [initial, monthly, ret, years]);

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("calc.fields.initial")} value={initial} onChange={setInitial} suffix="$" />
        <Field label={t("calc.fields.monthly")} value={monthly} onChange={setMonthly} suffix="$" />
        <Field label={t("calc.fields.expectedReturn")} value={ret} onChange={setRet} suffix="%" />
        <Field label={t("calc.fields.years")} value={years} onChange={setYears} />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label={t("calc.stats.futureValue")} value={money(out.future)} accent />
        <Stat label={t("calc.stats.contributed")} value={money(out.contributed)} />
        <Stat label={t("calc.stats.investmentGrowth")} value={money(out.growth)} />
      </div>
      <p className="mt-3 text-xs text-slate-400">{t("calc.notes.compound")}</p>
    </Shell>
  );
}

export function MonteCarloCalculator() {
  const { t } = useTranslation();
  const [eps, setEps] = useState("6");
  const [growth, setGrowth] = useState("10");
  const [growthSd, setGrowthSd] = useState("3");
  const [years, setYears] = useState("10");
  const [mult, setMult] = useState("18");
  const [multSd, setMultSd] = useState("4");
  const [ret, setRet] = useState("10");
  const [price, setPrice] = useState("150");
  const [seed, setSeed] = useState(0); // re-run trigger

  const res = useMemo(() => {
    void seed;
    return monteCarloSimpleDCF(
      {
        baseMetric: num(eps),
        growthRate: num(growth) / 100,
        years: num(years),
        exitMultiple: num(mult),
        desiredReturn: num(ret) / 100,
        currentPrice: num(price),
      },
      { growthSd: num(growthSd) / 100, multipleSd: num(multSd) },
      5000,
    );
  }, [eps, growth, growthSd, years, mult, multSd, ret, price, seed]);

  const maxCount = Math.max(1, ...res.bins.map((b) => b.count));

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("calc.fields.forwardEps")} value={eps} onChange={setEps} suffix="$" />
        <Field label={t("calc.fields.growthMean")} value={growth} onChange={setGrowth} suffix="%" />
        <Field label={t("calc.fields.growthSd")} value={growthSd} onChange={setGrowthSd} suffix="pp" />
        <Field label={t("calc.fields.years")} value={years} onChange={setYears} />
        <Field label={t("calc.fields.multipleMean")} value={mult} onChange={setMult} suffix="×" />
        <Field label={t("calc.fields.multipleSd")} value={multSd} onChange={setMultSd} suffix="×" />
        <Field label={t("calc.fields.requiredReturn")} value={ret} onChange={setRet} suffix="%" />
        <Field label={t("calc.fields.currentPrice")} value={price} onChange={setPrice} suffix="$" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label={t("calc.stats.p10")} value={money(res.p10)} />
        <Stat label={t("calc.stats.p50")} value={money(res.p50)} accent />
        <Stat label={t("calc.stats.p90")} value={money(res.p90)} />
      </div>
      <div className="mt-4 flex h-24 items-end gap-0.5" aria-hidden>
        {res.bins.map((b, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-brand-300"
            style={{ height: `${(b.count / maxCount) * 100}%` }}
            title={`${money(b.x0)}–${money(b.x1)}: ${b.count}`}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{t("calc.notes.mcRuns", { runs: res.runs.toLocaleString(i18n.language) })}</span>
        <button
          onClick={() => setSeed((s) => s + 1)}
          className="rounded-md border border-slate-300 px-3 py-1 font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("calc.rerun")}
        </button>
      </div>
    </Shell>
  );
}
