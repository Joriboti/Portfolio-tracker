import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatMoney, formatPct, type Currency } from "@/lib/currency";
import { useDisplayCurrency } from "@/lib/preferences";
import { useSeo } from "@/lib/seo";
import {
  projectDeterministic,
  projectMonteCarlo,
  type ContributionFrequency,
} from "@/lib/forecast";

// Public "Projecció" tool: project a passive/ETF portfolio forward with
// recurring contributions, fees and an uncertainty band (Monte Carlo). Pure
// client-side — reuses src/lib/forecast.ts, no backend. Usable without an
// account (another free taster for the funnel).

const PRESETS: Record<string, { return: number; volatility: number }> = {
  conservative: { return: 4, volatility: 6 },
  balanced: { return: 6.5, volatility: 11 },
  aggressive: { return: 8.5, volatility: 16 },
};

export function ForecastPage() {
  const { t } = useTranslation();
  const { currency } = useDisplayCurrency();

  const [startValue, setStartValue] = useState(10_000);
  const [years, setYears] = useState(20);
  const [amount, setAmount] = useState(200);
  const [frequency, setFrequency] = useState<ContributionFrequency>("monthly");
  const [annualReturn, setAnnualReturn] = useState(6.5); // %
  const [volatility, setVolatility] = useState(11); // %
  const [ter, setTer] = useState(0.2); // %
  const [taxDrag, setTaxDrag] = useState(0); // %

  useSeo({
    title: t("forecast.seoTitle"),
    description: t("forecast.subtitle"),
    url: "https://www.trimmtrack.com/forecast",
  });

  const contribution = { amount, frequency };

  const det = useMemo(
    () =>
      projectDeterministic({
        startValue,
        years,
        annualReturn: annualReturn / 100,
        ter: ter / 100,
        contribution,
        taxDrag: taxDrag / 100,
      }),
    [startValue, years, annualReturn, ter, amount, frequency, taxDrag],
  );

  const mc = useMemo(
    () =>
      projectMonteCarlo({
        startValue,
        years,
        assets: [
          {
            id: "portfolio",
            weight: 1,
            expectedReturn: annualReturn / 100,
            volatility: volatility / 100,
            ter: ter / 100,
          },
        ],
        correlation: [[1]],
        contribution,
        rebalance: "none",
        taxDrag: taxDrag / 100,
        runs: 1500,
        seed: 12345,
      }),
    [startValue, years, annualReturn, volatility, ter, amount, frequency, taxDrag],
  );

  const invested = mc.invested[mc.invested.length - 1] ?? startValue;
  const fmt = (v: number) => formatMoney(v, currency);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("forecast.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("forecast.subtitle")}</p>
      </div>

      {/* Inputs */}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t("forecast.startValue", { currency })} value={startValue} step={1000} min={0} onChange={setStartValue} />
          <Field label={t("forecast.years")} value={years} step={1} min={1} max={60} onChange={setYears} />
          <Field label={t("forecast.contribution", { currency })} value={amount} step={50} min={0} onChange={setAmount} />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-400">{t("forecast.frequency")}</span>
            <select
              className="w-32 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ContributionFrequency)}
            >
              <option value="none">{t("forecast.freq.none")}</option>
              <option value="monthly">{t("forecast.freq.monthly")}</option>
              <option value="quarterly">{t("forecast.freq.quarterly")}</option>
              <option value="annual">{t("forecast.freq.annual")}</option>
              <option value="one_off">{t("forecast.freq.oneOff")}</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <Field label={t("forecast.expectedReturn")} value={annualReturn} step={0.5} suffix="%" onChange={setAnnualReturn} />
          <Field label={t("forecast.volatility")} value={volatility} step={1} min={0} suffix="%" onChange={setVolatility} />
          <Field label={t("forecast.ter")} value={ter} step={0.05} min={0} suffix="%" onChange={setTer} />
          <Field label={t("forecast.taxDrag")} value={taxDrag} step={1} min={0} max={100} suffix="%" onChange={setTaxDrag} />

          <div className="flex items-center gap-1.5">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50"
                onClick={() => {
                  setAnnualReturn(p.return);
                  setVolatility(p.volatility);
                }}
              >
                {t(`forecast.preset.${key}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Fan chart */}
      <section className="card">
        <FanChart mc={mc} det={det} currency={currency} />
      </section>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("forecast.median")} value={fmt(mc.terminal.p50)} accent />
        <Stat label={t("forecast.range")} value={`${fmt(mc.terminal.p10)} – ${fmt(mc.terminal.p90)}`} />
        <Stat label={t("forecast.invested")} value={fmt(invested)} />
        <Stat
          label={t("forecast.gain")}
          value={`${fmt(mc.terminal.p50 - invested)} (${formatPct(invested > 0 ? mc.terminal.p50 / invested - 1 : null)})`}
          tone={mc.terminal.p50 >= invested ? "pos" : "neg"}
        />
      </section>

      <p className="text-xs text-slate-400">{t("forecast.disclaimer")}</p>
    </div>
  );
}

/* ────────────────────────── inputs / stats ────────────────────────── */

function Field({
  label,
  value,
  step,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm"
          value={value}
          onChange={(e) => {
            let v = Number(e.target.value);
            if (!Number.isFinite(v)) v = 0;
            if (min != null) v = Math.max(min, v);
            if (max != null) v = Math.min(max, v);
            onChange(v);
          }}
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

function Stat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "pos" | "neg";
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${accent ? "border-brand-300" : "border-slate-200"}`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`text-base font-semibold tabular-nums ${
          tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : accent ? "text-brand-700" : "text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/* ─────────────────────────── SVG fan chart ────────────────────────── */

function FanChart({
  mc,
  det,
  currency,
}: {
  mc: ReturnType<typeof projectMonteCarlo>;
  det: ReturnType<typeof projectDeterministic>;
  currency: Currency;
}) {
  const { t } = useTranslation();
  const W = 720;
  const H = 300;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const n = mc.years.length;
  if (n < 2) return null;

  const maxY = Math.max(...mc.p90, ...det.points.map((p) => p.value));
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / (maxY || 1)) * (H - padT - padB);

  const line = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const bandTop = mc.p90.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const bandBottom = Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k;
    return `L${x(i)},${y(mc.p10[i])}`;
  }).join(" ");
  const band = `${bandTop} ${bandBottom} Z`;
  const detVals = det.points.map((p) => p.value);

  // Y gridlines (0, 25, 50, 75, 100%).
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label={t("forecast.title")}>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tk)} x2={W - padR} y2={y(tk)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={y(tk) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              {formatMoney(tk, currency)}
            </text>
          </g>
        ))}
        {/* p10–p90 band */}
        <path d={band} fill="#e76b1c" fillOpacity={0.13} stroke="none" />
        {/* median */}
        <path d={line(mc.p50)} fill="none" stroke="#d1550f" strokeWidth={2} />
        {/* deterministic (dashed) */}
        <path d={line(detVals)} fill="none" stroke="#0f172a" strokeWidth={1.3} strokeDasharray="4 3" opacity={0.7} />
        {/* invested */}
        <path d={line(mc.invested)} fill="none" stroke="#94a3b8" strokeWidth={1.2} strokeDasharray="2 3" />
        {/* x labels: 0, mid, end */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {mc.years[i]}y
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-500">
        <Legend color="#d1550f">{t("forecast.legendMedian")}</Legend>
        <Legend color="#e76b1c" faded>{t("forecast.legendBand")}</Legend>
        <Legend color="#0f172a" dashed>{t("forecast.legendDeterministic")}</Legend>
        <Legend color="#94a3b8" dashed>{t("forecast.legendInvested")}</Legend>
      </div>
    </div>
  );
}

function Legend({ color, faded, dashed, children }: { color: string; faded?: boolean; dashed?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-5 rounded"
        style={{ backgroundColor: color, opacity: faded ? 0.25 : 1, borderTop: dashed ? `2px dashed ${color}` : undefined }}
      />
      {children}
    </span>
  );
}
