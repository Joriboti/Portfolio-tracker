import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { convert, formatMoney, formatPct, type Currency } from "@/lib/currency";
import {
  computeValuation,
  defaultModel,
  MAX_SCENARIOS,
  type ScenarioInput,
  type ValuationModel,
} from "@/lib/scenarioValuation";
import {
  calculateSimpleDCF,
  impliedGrowth,
  defaultDcfConfig,
  type DcfConfig,
  type DcfMetric,
} from "@/lib/dcf";
import {
  getScenarioModel,
  saveScenarioModel,
  type Fundamentals,
} from "@/lib/api";

type ValuationTab = "scenarios" | "dcf" | "reverse";

const GOLD = "#d4af37";
const PRICE_COLOR = "#64748b"; // slate-500
const COST_COLOR = "#94a3b8"; // slate-400
const NEW_SCENARIO_COLORS = ["#7c3aed", "#ea580c"];

type SaveState = "idle" | "saving" | "saved";

export function ScenarioValuation({
  userId,
  ticker,
  shares,
  avgCostEur,
  currentPrice,
  quoteCurrency,
  fundamentals,
  totalPortfolioValueEur,
  displayCurrency,
  fxRates,
}: {
  userId: string;
  ticker: string;
  shares: number;
  /** Average cost per share of the open position, in EUR (account currency). */
  avgCostEur: number;
  /** Live price in the ticker's quote currency, or null if unavailable. */
  currentPrice: number | null;
  /** Currency the price/EPS/multiples live in. */
  quoteCurrency: string;
  fundamentals: Fundamentals | undefined;
  /** Total portfolio market value, in the display currency. */
  totalPortfolioValueEur: number;
  displayCurrency: Currency;
  fxRates: Record<string, number>;
}) {
  const { t, i18n } = useTranslation();
  const [model, setModel] = useState<ValuationModel | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setTab] = useState<ValuationTab>("scenarios");
  const dirtyRef = useRef(false);

  // Quote currency, falling back to the display currency when Yahoo didn't
  // report one (keeps formatting + FX conversions consistent).
  const qc = (quoteCurrency || displayCurrency) as Currency;

  // Load the saved model (or the deep-value defaults) for this holding.
  useEffect(() => {
    let cancelled = false;
    dirtyRef.current = false;
    setModel(null);
    getScenarioModel(userId, ticker)
      .then((m) => {
        if (!cancelled) setModel(m ?? defaultModel());
      })
      .catch(() => {
        if (!cancelled) setModel(defaultModel());
      });
    return () => {
      cancelled = true;
    };
  }, [userId, ticker]);

  // Debounced autosave — only after a real user edit (dirtyRef), never on the
  // initial load. All persistence goes to Postgres; no localStorage.
  useEffect(() => {
    if (!model || !dirtyRef.current) return;
    setSaveState("saving");
    const id = setTimeout(() => {
      saveScenarioModel(userId, ticker, model)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("idle"));
    }, 700);
    return () => clearTimeout(id);
  }, [model, userId, ticker]);

  function patch(fn: (m: ValuationModel) => ValuationModel) {
    dirtyRef.current = true;
    setSaveState("saving");
    setModel((m) => (m ? fn(m) : m));
  }

  // DCF assumptions live in the same persisted document. Merge over the
  // defaults so models saved before this panel (or before its model changed)
  // pick up any missing fields instead of carrying a partial config.
  function patchDcf(fn: (d: DcfConfig) => DcfConfig) {
    patch((m) => ({ ...m, dcf: fn({ ...defaultDcfConfig(), ...(m.dcf ?? {}) }) }));
  }

  // Auto base forward EPS: real Yahoo forward EPS → trailing EPS → derived
  // from forward P/E → null (manual only). Expressed in the quote currency.
  const baseEpsAuto = useMemo<number | null>(() => {
    const f = fundamentals;
    if (f?.forwardEps != null && Number.isFinite(f.forwardEps)) return f.forwardEps;
    if (f?.eps != null && Number.isFinite(f.eps)) return f.eps;
    if (
      f?.forwardPe != null &&
      f.forwardPe !== 0 &&
      currentPrice != null &&
      Number.isFinite(currentPrice)
    ) {
      return currentPrice / f.forwardPe;
    }
    return null;
  }, [fundamentals, currentPrice]);

  // Cost basis converted from EUR into the quote currency so it shares units
  // with price / EPS-derived fair values.
  const avgCostQc = useMemo(
    () => convert(avgCostEur, "EUR", qc, fxRates),
    [avgCostEur, qc, fxRates],
  );
  // Portfolio total in the quote currency (portfolio weight is a ratio, so the
  // unit cancels — we just need both sides in the same currency).
  const totalPortfolioValueQc = useMemo(
    () => convert(totalPortfolioValueEur, displayCurrency, qc, fxRates),
    [totalPortfolioValueEur, displayCurrency, qc, fxRates],
  );

  const effectiveBaseEps =
    model?.baseEpsOverride != null ? model.baseEpsOverride : baseEpsAuto;

  const result = useMemo(() => {
    if (!model || currentPrice == null) return null;
    return computeValuation({
      baseEps: effectiveBaseEps ?? 0,
      years: model.years,
      currentPrice,
      shares,
      avgCost: avgCostQc,
      dca: model.dca.addShares > 0 ? model.dca : null,
      totalPortfolioValue: totalPortfolioValueQc,
      epsTtm: fundamentals?.eps ?? null,
      scenarios: model.scenarios,
    });
  }, [
    model,
    effectiveBaseEps,
    currentPrice,
    shares,
    avgCostQc,
    totalPortfolioValueQc,
    fundamentals,
  ]);

  if (!model) {
    return <p className="text-xs text-slate-400">{t("common.loading")}</p>;
  }

  const fmt = (v: number | null | undefined) => formatMoney(v ?? null, qc);
  const baseEpsMissing = effectiveBaseEps == null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-slate-800">
          {t("valuation.title")}
        </h4>
        <SaveBadge state={saveState} />
      </div>

      <TabBar tab={tab} onChange={setTab} />

      {tab === "dcf" && (
        <DcfTab
          config={{ ...defaultDcfConfig(), ...model.dcf }}
          fundamentals={fundamentals}
          currentPrice={currentPrice}
          avgCostQc={avgCostQc}
          qc={qc}
          onChange={patchDcf}
        />
      )}

      {tab === "reverse" && (
        <ReverseDcfTab
          config={{ ...defaultDcfConfig(), ...model.dcf }}
          fundamentals={fundamentals}
          currentPrice={currentPrice}
          qc={qc}
          onChange={patchDcf}
        />
      )}

      {tab === "scenarios" && (
       <>
      {/* Position + fundamentals row */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Field label={t("scenario.shares")} value={shares.toFixed(4)} />
        <Field label={t("scenario.avgCost")} value={fmt(avgCostQc)} />
        <Field
          label={t("scenario.currentPrice")}
          value={currentPrice != null ? fmt(currentPrice) : "—"}
        />
        <Field
          label={t("scenario.peForward")}
          value={
            result?.peForward != null
              ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
                  result.peForward,
                )
              : "—"
          }
        />
      </div>

      {/* Base EPS + horizon */}
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("scenario.baseEps", { currency: qc })}
          </span>
          <input
            type="number"
            step="0.01"
            className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm"
            value={
              model.baseEpsOverride != null
                ? model.baseEpsOverride
                : baseEpsAuto != null
                  ? Number(baseEpsAuto.toFixed(4))
                  : ""
            }
            placeholder={t("scenario.manual")}
            onChange={(e) => {
              const v = e.target.value;
              patch((m) => ({
                ...m,
                baseEpsOverride: v === "" ? null : Number(v),
              }));
            }}
          />
        </label>
        {model.baseEpsOverride != null && baseEpsAuto != null && (
          <button
            className="text-xs text-brand-700 underline pb-1"
            onClick={() => patch((m) => ({ ...m, baseEpsOverride: null }))}
          >
            {t("scenario.useAuto")}
          </button>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("scenario.horizon")}
          </span>
          <input
            type="number"
            step="1"
            min="1"
            className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
            value={model.years}
            onChange={(e) =>
              patch((m) => ({ ...m, years: Math.max(0, Number(e.target.value) || 0) }))
            }
          />
        </label>
      </div>

      {baseEpsMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("scenario.baseEpsMissing")}
        </div>
      )}

      {/* Scenario table */}
      <ScenarioTable
        model={model}
        result={result}
        qc={qc}
        onChange={patch}
      />

      {/* DCA simulator */}
      <DcaSimulator model={model} result={result} qc={qc} fmt={fmt} onChange={patch} />

      {/* Expected value + valuation ruler */}
      {result && currentPrice != null && !baseEpsMissing && (
        <>
          <ExpectedSummary result={result} qc={qc} fmt={fmt} />
          <ValuationRuler
            result={result}
            currentPrice={currentPrice}
            scenarios={model.scenarios}
            qc={qc}
          />
        </>
      )}
       </>
      )}
    </div>
  );
}

function TabBar({
  tab,
  onChange,
}: {
  tab: ValuationTab;
  onChange: (t: ValuationTab) => void;
}) {
  const { t } = useTranslation();
  const tabs: { id: ValuationTab; label: string }[] = [
    { id: "scenarios", label: t("valuation.tabs.scenarios") },
    { id: "dcf", label: t("valuation.tabs.dcf") },
    { id: "reverse", label: t("valuation.tabs.reverse") },
  ];
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          onClick={() => onChange(tb.id)}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === tb.id
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useTranslation();
  if (state === "idle") return null;
  return (
    <span className="text-[11px] text-slate-400">
      {state === "saving" ? t("scenario.saving") : t("scenario.saved")}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function ScenarioTable({
  model,
  result,
  qc,
  onChange,
}: {
  model: ValuationModel;
  result: ReturnType<typeof computeValuation> | null;
  qc: Currency;
  onChange: (fn: (m: ValuationModel) => ValuationModel) => void;
}) {
  const { t } = useTranslation();
  const resById = new Map(result?.perScenario.map((r) => [r.id, r]) ?? []);

  function updateScenario(id: string, patch: Partial<ScenarioInput>) {
    onChange((m) => ({
      ...m,
      scenarios: m.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }
  function removeScenario(id: string) {
    onChange((m) => ({ ...m, scenarios: m.scenarios.filter((s) => s.id !== id) }));
  }
  function addScenario() {
    onChange((m) => {
      if (m.scenarios.length >= MAX_SCENARIOS) return m;
      const color =
        NEW_SCENARIO_COLORS[(m.scenarios.length - 3) % NEW_SCENARIO_COLORS.length] ??
        "#64748b";
      return {
        ...m,
        scenarios: [
          ...m.scenarios,
          {
            id: `sc-${Date.now()}`,
            name: t("scenario.newScenario"),
            color,
            epsCagrPct: 8,
            exitMultiple: 12,
            probabilityPct: 0,
          },
        ],
      };
    });
  }

  const probWarn = result && !result.probNormalized;

  return (
    <div className="overflow-x-auto">
      <table className="table-base min-w-[640px]">
        <thead>
          <tr>
            <th>{t("scenario.cols.name")}</th>
            <th className="text-right">{t("scenario.cols.cagr")}</th>
            <th className="text-right">{t("scenario.cols.multiple")}</th>
            <th className="text-right">{t("scenario.cols.prob")}</th>
            <th className="text-right">{t("scenario.cols.fairValue")}</th>
            <th className="text-right">{t("scenario.cols.vsPrice")}</th>
            <th className="text-right">{t("scenario.cols.vsCost")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {model.scenarios.map((s) => {
            const r = resById.get(s.id);
            return (
              <tr key={s.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                      value={s.color}
                      onChange={(e) => updateScenario(s.id, { color: e.target.value })}
                    />
                    <input
                      className="w-24 rounded-md border border-slate-200 px-1.5 py-0.5 text-sm"
                      value={s.name}
                      onChange={(e) => updateScenario(s.id, { name: e.target.value })}
                    />
                  </div>
                </td>
                <td className="text-right">
                  <NumCell
                    value={s.epsCagrPct}
                    step="0.5"
                    suffix="%"
                    onChange={(v) => updateScenario(s.id, { epsCagrPct: v })}
                  />
                </td>
                <td className="text-right">
                  <NumCell
                    value={s.exitMultiple}
                    step="0.5"
                    suffix="×"
                    onChange={(v) => updateScenario(s.id, { exitMultiple: v })}
                  />
                </td>
                <td className="text-right">
                  <NumCell
                    value={s.probabilityPct}
                    step="1"
                    suffix="%"
                    onChange={(v) => updateScenario(s.id, { probabilityPct: v })}
                  />
                </td>
                <td className="text-right font-medium">
                  {r ? formatMoney(r.fairValue, qc) : "—"}
                </td>
                <td
                  className={`text-right ${tone(r?.upsideVsPrice)}`}
                >
                  {formatPct(r?.upsideVsPrice)}
                </td>
                <td className={`text-right ${tone(r?.upsideVsCost)}`}>
                  {formatPct(r?.upsideVsCost)}
                </td>
                <td className="text-right">
                  {model.scenarios.length > 1 && (
                    <button
                      className="text-slate-300 hover:text-rose-500"
                      title={t("scenario.remove")}
                      onClick={() => removeScenario(s.id)}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="text-xs text-slate-400">
              {model.scenarios.length < MAX_SCENARIOS && (
                <button className="text-brand-700 underline" onClick={addScenario}>
                  + {t("scenario.addScenario")}
                </button>
              )}
            </td>
            <td className={`text-right text-xs ${probWarn ? "text-amber-600 font-medium" : "text-slate-400"}`}>
              Σ {result ? Math.round(result.probSum) : 0}%
            </td>
            <td colSpan={4} className="text-xs text-amber-600">
              {probWarn ? t("scenario.probWarn") : ""}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function NumCell({
  value,
  step,
  suffix,
  onChange,
}: {
  value: number;
  step: string;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        type="number"
        step={step}
        className="w-16 rounded-md border border-slate-200 px-1.5 py-0.5 text-sm text-right"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
    </span>
  );
}

function DcaSimulator({
  model,
  result,
  qc,
  fmt,
  onChange,
}: {
  model: ValuationModel;
  result: ReturnType<typeof computeValuation> | null;
  qc: Currency;
  fmt: (v: number | null | undefined) => string;
  onChange: (fn: (m: ValuationModel) => ValuationModel) => void;
}) {
  const { t } = useTranslation();
  const active = model.dca.addShares > 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t("scenario.dcaTitle")}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("scenario.dcaShares")}
          </span>
          <input
            type="number"
            step="0.0001"
            min="0"
            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
            value={model.dca.addShares}
            onChange={(e) =>
              onChange((m) => ({
                ...m,
                dca: { ...m.dca, addShares: Math.max(0, Number(e.target.value) || 0) },
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {t("scenario.dcaPrice", { currency: qc })}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
            value={model.dca.addPrice}
            onChange={(e) =>
              onChange((m) => ({
                ...m,
                dca: { ...m.dca, addPrice: Math.max(0, Number(e.target.value) || 0) },
              }))
            }
          />
        </label>
        {active && result && (
          <>
            <Field label={t("scenario.dcaNewCost")} value={fmt(result.blendedCost)} />
            <Field
              label={t("scenario.dcaWeight")}
              value={formatPct(result.portfolioWeight)}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ExpectedSummary({
  result,
  qc,
  fmt,
}: {
  result: ReturnType<typeof computeValuation>;
  qc: Currency;
  fmt: (v: number | null | undefined) => string;
}) {
  const { t } = useTranslation();
  void qc;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-lg border-2 px-4 py-3" style={{ borderColor: GOLD }}>
        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          {t("scenario.expectedValue")}
        </p>
        <p className="text-xl font-bold" style={{ color: GOLD }}>
          {fmt(result.expectedValue)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          {t("scenario.evVsPrice")}
        </p>
        <p className={`text-xl font-semibold ${tone(result.expectedUpsideVsPrice)}`}>
          {formatPct(result.expectedUpsideVsPrice)}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          {t("scenario.evVsCost")}
        </p>
        <p className={`text-xl font-semibold ${tone(result.expectedUpsideVsCost)}`}>
          {formatPct(result.expectedUpsideVsCost)}
        </p>
      </div>
    </div>
  );
}

type RulerMarker = {
  key: string;
  label: string;
  value: number;
  color: string;
  gold?: boolean;
};

// Horizontal "valuation ruler": every fair value + current price + blended
// cost + the expected value laid out on a single min→max axis with padding.
// Labels alternate above/below the axis so adjacent markers don't collide.
// Hand-rolled SVG, matching the project's chart style (no chart library).
function ValuationRuler({
  result,
  currentPrice,
  scenarios,
  qc,
}: {
  result: ReturnType<typeof computeValuation>;
  currentPrice: number;
  scenarios: ScenarioInput[];
  qc: Currency;
}) {
  const { t } = useTranslation();
  const colorById = new Map(scenarios.map((s) => [s.id, s.color]));
  const nameById = new Map(scenarios.map((s) => [s.id, s.name]));

  const markers: RulerMarker[] = [
    ...result.perScenario.map((r) => ({
      key: r.id,
      label: nameById.get(r.id) ?? r.id,
      value: r.fairValue,
      color: colorById.get(r.id) ?? "#64748b",
    })),
    { key: "price", label: t("scenario.priceMarker"), value: currentPrice, color: PRICE_COLOR },
    { key: "cost", label: t("scenario.costMarker"), value: result.blendedCost, color: COST_COLOR },
    { key: "ev", label: t("scenario.evMarker"), value: result.expectedValue, color: GOLD, gold: true },
  ].filter((m) => Number.isFinite(m.value));

  const values = markers.map((m) => m.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const pad = span * 0.12;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;

  const W = 700;
  const H = 132;
  const marginX = 16;
  const axisY = H / 2;
  const innerW = W - marginX * 2;
  const x = (v: number) =>
    marginX + ((v - domainMin) / (domainMax - domainMin)) * innerW;

  // Alternate label side by value order so neighbours don't overlap.
  const order = [...markers].sort((a, b) => a.value - b.value);
  const sideByKey = new Map<string, "top" | "bottom">();
  order.forEach((m, i) => sideByKey.set(m.key, i % 2 === 0 ? "top" : "bottom"));

  const nf = (v: number) =>
    formatMoney(v, qc).replace(/ /g, " ");

  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t("scenario.rulerTitle")}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 480 }}
        role="img"
        aria-label={t("scenario.rulerTitle")}
      >
        {/* axis */}
        <line x1={marginX} y1={axisY} x2={W - marginX} y2={axisY} stroke="#cbd5e1" strokeWidth={2} />
        {markers.map((m) => {
          const px = x(m.value);
          const side = sideByKey.get(m.key) ?? "top";
          const tickTop = side === "top";
          const labelY = tickTop ? axisY - 30 : axisY + 38;
          const valueY = tickTop ? axisY - 18 : axisY + 50;
          const r = m.gold ? 7 : 5;
          return (
            <g key={m.key}>
              <line
                x1={px}
                y1={tickTop ? axisY - 10 : axisY}
                x2={px}
                y2={tickTop ? axisY : axisY + 10}
                stroke={m.color}
                strokeWidth={m.gold ? 2.5 : 1.5}
              />
              <circle
                cx={px}
                cy={axisY}
                r={r}
                fill={m.gold ? GOLD : "#fff"}
                stroke={m.color}
                strokeWidth={m.gold ? 2.5 : 2}
              />
              <text
                x={px}
                y={labelY}
                textAnchor="middle"
                className="select-none"
                style={{
                  fontSize: 11,
                  fontWeight: m.gold ? 700 : 600,
                  fill: m.gold ? "#a8842a" : "#475569",
                }}
              >
                {m.label}
              </text>
              <text
                x={px}
                y={valueY}
                textAnchor="middle"
                className="select-none"
                style={{ fontSize: 10, fill: m.gold ? "#a8842a" : "#94a3b8" }}
              >
                {nf(m.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function tone(v: number | null | undefined): string {
  if (v == null) return "";
  return v > 0 ? "text-emerald-600" : v < 0 ? "text-rose-600" : "";
}


// ── Simple DCF / Reverse DCF (Qualtrim-style, per share) ───────────────────

/**
 * Resolve the effective per-share base metric from the saved config + cached
 * fundamentals. EPS uses Yahoo's forward (then trailing) EPS; FCF/share derives
 * freeCashflow / shares (shares fall back to marketCap / price). All figures
 * are in the ticker's quote currency. A manual override always wins.
 */
function deriveBaseMetric(
  config: DcfConfig,
  f: Fundamentals | undefined,
  currentPrice: number | null,
) {
  let baseAuto: number | null;
  if (config.metric === "eps") {
    baseAuto = f?.forwardEps ?? f?.eps ?? null;
  } else {
    const shares =
      f?.sharesOutstanding ??
      (f?.marketCap != null && currentPrice != null && currentPrice !== 0
        ? f.marketCap / currentPrice
        : null);
    baseAuto =
      f?.freeCashflow != null && shares != null && shares !== 0
        ? f.freeCashflow / shares
        : null;
  }
  const base = config.baseOverride ?? baseAuto;
  return { base, baseAuto, missing: base == null };
}

/** Number input editing a decimal value as a percentage (stores the decimal). */
function PctField({
  label,
  value,
  step = 0.25,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (decimal: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          step={step}
          className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-right"
          value={Number((value * 100).toFixed(4))}
          onChange={(e) => onChange((Number(e.target.value) || 0) / 100)}
        />
        <span className="text-xs text-slate-400">%</span>
      </span>
    </label>
  );
}

/** Plain numeric field with a label + optional suffix; never produces null. */
function ValField({
  label,
  value,
  step,
  suffix,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step?: string;
  suffix?: string;
  min?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          step={step ?? "any"}
          min={min}
          className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm text-right"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

/** Override field for the per-share base metric; "" clears the override. */
function BaseField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type="number"
        step="0.01"
        className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm text-right"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
      />
    </label>
  );
}

function MetricToggle({
  metric,
  onChange,
}: {
  metric: DcfMetric;
  onChange: (m: DcfMetric) => void;
}) {
  const { t } = useTranslation();
  const opts: DcfMetric[] = ["eps", "fcfShare"];
  return (
    <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs">
      {opts.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded px-2.5 py-1 font-medium transition-colors ${
            metric === m ? "bg-brand-600 text-white" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {t(`dcf.metric.${m}`)}
        </button>
      ))}
    </div>
  );
}

function DcfTab({
  config,
  fundamentals,
  currentPrice,
  avgCostQc,
  qc,
  onChange,
}: {
  config: DcfConfig;
  fundamentals: Fundamentals | undefined;
  currentPrice: number | null;
  avgCostQc: number;
  qc: Currency;
  onChange: (fn: (d: DcfConfig) => DcfConfig) => void;
}) {
  const { t, i18n } = useTranslation();
  const { base, baseAuto, missing } = deriveBaseMetric(config, fundamentals, currentPrice);
  const metricName = t(`dcf.metric.${config.metric}`);
  const negative = base != null && base <= 0;

  const result = useMemo(() => {
    if (base == null || base <= 0) return null;
    return calculateSimpleDCF({
      baseMetric: base,
      growthRate: config.growthRate,
      years: config.years,
      exitMultiple: config.exitMultiple,
      desiredReturn: config.desiredReturn,
      currentPrice,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, base, currentPrice]);

  const fmt = (v: number | null | undefined) => formatMoney(v ?? null, qc);
  const nf = (v: number, d = 2) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: d }).format(v);
  const fair = result?.fairValue ?? null;
  const upsideVsCost = fair != null && avgCostQc ? fair / avgCostQc - 1 : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-slate-500">{t("dcf.intro")}</p>
        <MetricToggle
          metric={config.metric}
          onChange={(m) => onChange((c) => ({ ...c, metric: m, baseOverride: null }))}
        />
      </div>

      {/* Assumptions */}
      <div className="flex flex-wrap items-end gap-4">
        <BaseField
          label={t("dcf.base", { metric: metricName, currency: qc })}
          value={config.baseOverride ?? (baseAuto != null ? Number(baseAuto.toFixed(4)) : null)}
          placeholder={t("scenario.manual")}
          onChange={(v) => onChange((c) => ({ ...c, baseOverride: v }))}
        />
        <PctField
          label={t("dcf.growth")}
          value={config.growthRate}
          step={0.5}
          onChange={(v) => onChange((c) => ({ ...c, growthRate: v }))}
        />
        <ValField
          label={t("dcf.horizon")}
          value={config.years}
          step="1"
          min="1"
          suffix={t("dcf.yearsShort")}
          onChange={(v) => onChange((c) => ({ ...c, years: Math.max(1, Math.round(v)) }))}
        />
        <ValField
          label={t("dcf.exitMultiple")}
          value={config.exitMultiple}
          step="0.5"
          suffix="×"
          onChange={(v) => onChange((c) => ({ ...c, exitMultiple: Math.max(0, v) }))}
        />
        <PctField
          label={t("dcf.desiredReturn")}
          value={config.desiredReturn}
          step={0.5}
          onChange={(v) => onChange((c) => ({ ...c, desiredReturn: v }))}
        />
      </div>

      {missing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("dcf.missing", { metric: metricName })}
        </div>
      )}
      {negative && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("dcf.negative", { metric: metricName })}
        </div>
      )}

      {result && !missing && !negative && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border-2 px-4 py-3" style={{ borderColor: GOLD }}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("dcf.fairValue")}
              </p>
              <p className="text-xl font-bold" style={{ color: GOLD }}>
                {fmt(fair)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("dcf.vsPrice")}
              </p>
              <p className={`text-xl font-semibold ${tone(result.upsideVsPrice)}`}>
                {formatPct(result.upsideVsPrice)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("dcf.impliedReturn")}
              </p>
              <p className={`text-xl font-semibold ${tone(result.impliedReturn)}`}>
                {formatPct(result.impliedReturn)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Field
              label={t("dcf.futureMetric", { metric: metricName })}
              value={nf(result.futureMetric)}
            />
            <Field
              label={t("dcf.futurePrice", { years: config.years })}
              value={fmt(result.futurePrice)}
            />
            <Field label={t("dcf.vsCost")} value={formatPct(upsideVsCost)} />
            <Field
              label={t("scenario.currentPrice")}
              value={currentPrice != null ? fmt(currentPrice) : "—"}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ReverseDcfTab({
  config,
  fundamentals,
  currentPrice,
  qc,
  onChange,
}: {
  config: DcfConfig;
  fundamentals: Fundamentals | undefined;
  currentPrice: number | null;
  qc: Currency;
  onChange: (fn: (d: DcfConfig) => DcfConfig) => void;
}) {
  const { t, i18n } = useTranslation();
  const { base, missing } = deriveBaseMetric(config, fundamentals, currentPrice);
  const metricName = t(`dcf.metric.${config.metric}`);
  const negative = base != null && base <= 0;

  const implied = useMemo(() => {
    if (base == null || base <= 0) return null;
    return impliedGrowth({
      currentPrice,
      baseMetric: base,
      years: config.years,
      exitMultiple: config.exitMultiple,
      desiredReturn: config.desiredReturn,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, base, currentPrice]);

  const nf1 = (v: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(v * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-slate-500">{t("dcf.reverseIntro")}</p>
        <MetricToggle
          metric={config.metric}
          onChange={(m) => onChange((c) => ({ ...c, metric: m, baseOverride: null }))}
        />
      </div>

      {/* Shared assumptions (same config as the DCF tab). */}
      <div className="flex flex-wrap items-end gap-4">
        <ValField
          label={t("dcf.exitMultiple")}
          value={config.exitMultiple}
          step="0.5"
          suffix="×"
          onChange={(v) => onChange((c) => ({ ...c, exitMultiple: Math.max(0, v) }))}
        />
        <PctField
          label={t("dcf.desiredReturn")}
          value={config.desiredReturn}
          step={0.5}
          onChange={(v) => onChange((c) => ({ ...c, desiredReturn: v }))}
        />
        <ValField
          label={t("dcf.horizon")}
          value={config.years}
          step="1"
          min="1"
          suffix={t("dcf.yearsShort")}
          onChange={(v) => onChange((c) => ({ ...c, years: Math.max(1, Math.round(v)) }))}
        />
        <Field
          label={t("scenario.currentPrice")}
          value={currentPrice != null ? formatMoney(currentPrice, qc) : "—"}
        />
      </div>

      {missing ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("dcf.missing", { metric: metricName })}
        </div>
      ) : negative ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("dcf.negative", { metric: metricName })}
        </div>
      ) : implied == null ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
          {t("dcf.reverseUnsolvable")}
        </div>
      ) : (
        <>
          <div className="rounded-lg border-2 px-4 py-3" style={{ borderColor: GOLD }}>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {t("dcf.impliedGrowth", { metric: metricName })}
            </p>
            <p className="text-2xl font-bold" style={{ color: GOLD }}>
              {nf1(implied)}%
              <span className="ml-1 text-sm font-normal text-slate-400">
                /{t("dcf.perYear")} · {config.years} {t("dcf.yearsShort")}
              </span>
            </p>
          </div>
          <p className="text-sm text-slate-600">
            {t("dcf.reverseSentence", {
              metric: metricName,
              implied: nf1(implied),
              years: config.years,
            })}
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
            {t("dcf.reverseCompare", {
              assumed: nf1(config.growthRate),
              verdict:
                implied > config.growthRate
                  ? t("dcf.verdictOptimistic")
                  : t("dcf.verdictPessimistic"),
            })}
          </div>
        </>
      )}
    </div>
  );
}
