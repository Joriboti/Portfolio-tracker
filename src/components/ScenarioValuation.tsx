import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { convert, formatMoney, formatPct, type Currency } from "@/lib/currency";
import {
  computeValuation,
  defaultModel,
  newDcaBuy,
  normalizeDca,
  MAX_SCENARIOS,
  type ScenarioInput,
  type ValuationModel,
  type DcaBuy,
} from "@/lib/scenarioValuation";
import {
  calculateSimpleDCF,
  impliedGrowth,
  defaultDcfConfig,
  type DcfConfig,
  type DcfMetric,
} from "@/lib/dcf";
import {
  grahamValue,
  grahamGrowthClamped,
  defaultGrahamConfig,
  type GrahamConfig,
} from "@/lib/graham";
import {
  monteCarloSimpleDCF,
  defaultMonteCarloConfig,
  type MonteCarloConfig,
  type MonteCarloResult,
} from "@/lib/montecarlo";
import {
  calculateNAV,
  withDiscount,
  newHolding,
  defaultSotpConfig,
  type SotpConfig,
  type SotpHolding,
} from "@/lib/sotp";
import {
  getScenarioModel,
  saveScenarioModel,
  getSotpQuotes,
  type Fundamentals,
  type SotpLiveQuote,
} from "@/lib/api";

export type ValuationTab =
  | "scenarios"
  | "dcf"
  | "reverse"
  | "graham"
  | "montecarlo"
  | "sotp";

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
  initialModel,
  initialTab,
  onStateChange,
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
  /** Starting model (e.g. decoded from a share link); wins over the saved one. */
  initialModel?: Partial<ValuationModel> | null;
  /** Tab to open on mount (e.g. from a share link). */
  initialTab?: ValuationTab | null;
  /** Reports the live model + tab upwards (used to build share links). */
  onStateChange?: (model: ValuationModel, tab: ValuationTab) => void;
}) {
  const { t, i18n } = useTranslation();
  const [model, setModel] = useState<ValuationModel | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tab, setTab] = useState<ValuationTab>(initialTab ?? "scenarios");
  const dirtyRef = useRef(false);

  // Quote currency, falling back to the display currency when Yahoo didn't
  // report one (keeps formatting + FX conversions consistent).
  const qc = (quoteCurrency || displayCurrency) as Currency;

  // Load the saved model (or the deep-value defaults) for this holding.
  useEffect(() => {
    let cancelled = false;
    dirtyRef.current = false;
    setModel(null);
    // A share-link model wins over anything saved: merge it over the defaults
    // (tolerates partial/older shapes) and skip the fetch. It stays ephemeral
    // until the user edits — then the normal autosave path persists it (for
    // logged-in users), which is exactly "import these assumptions".
    if (initialModel) {
      setModel({
        ...defaultModel(),
        ...initialModel,
        dca: normalizeDca(initialModel.dca),
      });
      return;
    }
    // Anonymous (no userId — e.g. the public Explore page): run the panel
    // ephemerally with the defaults. No fetch, no persistence; visitors can
    // still try every model in memory, they just can't save.
    if (!userId) {
      setModel(defaultModel());
      return;
    }
    getScenarioModel(userId, ticker)
      .then((m) => {
        // Migrate the persisted DCA shape: pre-multi-buy models stored a single
        // { addShares, addPrice } object; normalize it to the buy list.
        if (!cancelled) setModel(m ? { ...m, dca: normalizeDca(m.dca) } : defaultModel());
      })
      .catch(() => {
        if (!cancelled) setModel(defaultModel());
      });
    return () => {
      cancelled = true;
    };
    // initialModel is decoded once by the caller (stable), so it belongs in
    // the deps without causing re-runs on every render.
  }, [userId, ticker, initialModel]);

  // Surface the live state so the caller can build share links from it.
  useEffect(() => {
    if (model && onStateChange) onStateChange(model, tab);
  }, [model, tab, onStateChange]);

  // Debounced autosave — only after a real user edit (dirtyRef), never on the
  // initial load. All persistence goes to Postgres; no localStorage.
  useEffect(() => {
    // No userId → ephemeral (public Explore): never persist.
    if (!model || !dirtyRef.current || !userId) return;
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
  function patchGraham(fn: (g: GrahamConfig) => GrahamConfig) {
    patch((m) => ({ ...m, graham: fn({ ...defaultGrahamConfig(), ...(m.graham ?? {}) }) }));
  }
  function patchMc(fn: (c: MonteCarloConfig) => MonteCarloConfig) {
    patch((m) => ({ ...m, mc: fn({ ...defaultMonteCarloConfig(), ...(m.mc ?? {}) }) }));
  }
  function patchSotp(fn: (s: SotpConfig) => SotpConfig) {
    patch((m) => ({ ...m, sotp: fn({ ...defaultSotpConfig(), ...(m.sotp ?? {}) }) }));
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
      dca: model.dca,
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

      {tab === "graham" && (
        <GrahamTab
          config={{ ...defaultGrahamConfig(), ...model.graham }}
          fundamentals={fundamentals}
          currentPrice={currentPrice}
          avgCostQc={avgCostQc}
          qc={qc}
          onChange={patchGraham}
        />
      )}

      {tab === "montecarlo" && (
        <MonteCarloTab
          dcfConfig={{ ...defaultDcfConfig(), ...model.dcf }}
          mcConfig={{ ...defaultMonteCarloConfig(), ...model.mc }}
          fundamentals={fundamentals}
          currentPrice={currentPrice}
          qc={qc}
          onChange={patchMc}
        />
      )}

      {tab === "sotp" && (
        <SoTPTab
          config={{ ...defaultSotpConfig(), ...model.sotp }}
          currentPrice={currentPrice}
          qc={qc}
          fxRates={fxRates}
          onChange={patchSotp}
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
    { id: "graham", label: t("valuation.tabs.graham") },
    { id: "montecarlo", label: t("valuation.tabs.montecarlo") },
    { id: "sotp", label: t("valuation.tabs.sotp") },
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
  const buys = model.dca;
  const active = result != null && result.addedShares > 0;

  function updateBuy(id: string, patch: Partial<DcaBuy>) {
    onChange((m) => ({
      ...m,
      dca: m.dca.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }
  function removeBuy(id: string) {
    onChange((m) => ({ ...m, dca: m.dca.filter((b) => b.id !== id) }));
  }
  function addBuy() {
    onChange((m) => ({ ...m, dca: [...m.dca, newDcaBuy()] }));
  }

  const fmtQty = (n: number) => Number(n.toFixed(4)).toLocaleString();

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t("scenario.dcaTitle")}
      </p>

      {buys.length === 0 ? (
        <p className="mb-2 text-xs text-slate-400">{t("scenario.dcaEmpty")}</p>
      ) : (
        <div className="mb-2 space-y-1.5">
          <div className="flex items-center gap-2 px-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            <span className="w-24">{t("scenario.dcaShares")}</span>
            <span className="w-24">{t("scenario.dcaPrice", { currency: qc })}</span>
            <span className="w-24 text-right">{t("scenario.dcaSubtotal")}</span>
            <span className="w-6" />
          </div>
          {buys.map((b) => (
            <div key={b.id} className="flex items-center gap-2">
              <input
                type="number"
                step="0.0001"
                min="0"
                className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
                value={b.shares}
                onChange={(e) =>
                  updateBuy(b.id, { shares: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
                value={b.price}
                onChange={(e) =>
                  updateBuy(b.id, { price: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              <span className="w-24 text-right text-sm text-slate-500">
                {b.shares > 0 && b.price > 0 ? fmt(b.shares * b.price) : "—"}
              </span>
              <button
                className="w-6 text-slate-300 hover:text-rose-500"
                title={t("scenario.dcaRemove")}
                onClick={() => removeBuy(b.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="text-xs font-medium text-brand-700 underline" onClick={addBuy}>
        + {t("scenario.dcaAddBuy")}
      </button>

      {active && result && (
        <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-slate-200 pt-3">
          <Field label={t("scenario.dcaTotalShares")} value={fmtQty(result.addedShares)} />
          <Field label={t("scenario.dcaInvested")} value={fmt(result.addedInvested)} />
          <Field label={t("scenario.dcaNewCost")} value={fmt(result.blendedCost)} />
          <Field label={t("scenario.dcaWeight")} value={formatPct(result.portfolioWeight)} />
        </div>
      )}
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

          <DcfPathChart
            currentPrice={currentPrice}
            futurePrice={result.futurePrice}
            baseMetric={base as number}
            growthRate={config.growthRate}
            exitMultiple={config.exitMultiple}
            years={config.years}
            qc={qc}
          />
        </>
      )}
    </div>
  );
}

/** Projected price path, Qualtrim-style: a dotted line per year from today's
 *  price compounding to the estimated future price (implied-return path). When
 *  there's no live price it falls back to metric×multiple per year. */
function DcfPathChart({
  currentPrice,
  futurePrice,
  baseMetric,
  growthRate,
  exitMultiple,
  years,
  qc,
}: {
  currentPrice: number | null;
  futurePrice: number;
  baseMetric: number;
  growthRate: number;
  exitMultiple: number;
  years: number;
  qc: Currency;
}) {
  const { t } = useTranslation();
  const n = Math.max(1, Math.round(years));
  const anchored = currentPrice != null && currentPrice > 0 && futurePrice > 0;
  const values: number[] = [];
  for (let y = 0; y <= n; y++) {
    if (anchored) {
      // Smooth path from today's price to the future price (CAGR between them).
      values.push(currentPrice * Math.pow(futurePrice / currentPrice, y / n));
    } else {
      values.push(baseMetric * Math.pow(1 + growthRate / 100, y) * exitMultiple);
    }
  }
  if (!values.every((v) => Number.isFinite(v) && v > 0)) return null;

  const W = 560;
  const H = 200;
  const padL = 56;
  const padR = 14;
  const padT = 14;
  const padB = 22;
  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const span = maxV - minV || 1;
  const x = (i: number) => padL + (i / n) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - minV) / span) * (H - padT - padB);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const ticks = [minV, minV + span / 2, maxV];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t("dcf.pathTitle", { years: n })}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("dcf.pathTitle", { years: n })}>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tk)} x2={W - padR} y2={y(tk)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={y(tk) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
              {formatMoney(tk, qc)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#059669" strokeWidth={2} />
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="#059669" />
        ))}
        {values.map((_, i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">
            {i === 0 ? t("dcf.pathNow") : `+${i}`}
          </text>
        ))}
      </svg>
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

// ── Graham intrinsic value ─────────────────────────────────────────────────

function GrahamTab({
  config,
  fundamentals,
  currentPrice,
  avgCostQc,
  qc,
  onChange,
}: {
  config: GrahamConfig;
  fundamentals: Fundamentals | undefined;
  currentPrice: number | null;
  avgCostQc: number;
  qc: Currency;
  onChange: (fn: (g: GrahamConfig) => GrahamConfig) => void;
}) {
  const { t } = useTranslation();
  const epsAuto = fundamentals?.eps ?? fundamentals?.forwardEps ?? null;
  const eps = config.epsOverride ?? epsAuto;
  const missing = eps == null;
  const negative = eps != null && eps <= 0;

  const value =
    eps != null && eps > 0
      ? grahamValue(eps, config.growthPct, config.aaaYieldPct)
      : null;
  const clamped = grahamGrowthClamped(config.growthPct);

  const fmt = (v: number | null | undefined) => formatMoney(v ?? null, qc);
  const vsPrice = value != null && currentPrice ? value / currentPrice - 1 : null;
  const vsCost = value != null && avgCostQc ? value / avgCostQc - 1 : null;

  return (
    <div className="space-y-4">
      <p className="max-w-xl text-xs text-slate-500">{t("graham.intro")}</p>

      <div className="flex flex-wrap items-end gap-4">
        <BaseField
          label={t("graham.eps", { currency: qc })}
          value={config.epsOverride ?? (epsAuto != null ? Number(epsAuto.toFixed(4)) : null)}
          placeholder={t("scenario.manual")}
          onChange={(v) => onChange((c) => ({ ...c, epsOverride: v }))}
        />
        <ValField
          label={t("graham.growth")}
          value={config.growthPct}
          step="0.5"
          suffix="%"
          onChange={(v) => onChange((c) => ({ ...c, growthPct: Math.max(0, v) }))}
        />
        <ValField
          label={t("graham.aaaYield")}
          value={config.aaaYieldPct}
          step="0.1"
          suffix="%"
          onChange={(v) => onChange((c) => ({ ...c, aaaYieldPct: v }))}
        />
      </div>

      {missing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("graham.missing")}
        </div>
      )}
      {negative && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("graham.negative")}
        </div>
      )}

      {value != null && !missing && !negative && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border-2 px-4 py-3" style={{ borderColor: GOLD }}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("graham.value")}
              </p>
              <p className="text-xl font-bold" style={{ color: GOLD }}>
                {fmt(value)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("dcf.vsPrice")}
              </p>
              <p className={`text-xl font-semibold ${tone(vsPrice)}`}>{formatPct(vsPrice)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {t("dcf.vsCost")}
              </p>
              <p className={`text-xl font-semibold ${tone(vsCost)}`}>{formatPct(vsCost)}</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500">
            {t("graham.screenNote")}
            {clamped && ` — ${t("graham.clampNote", { cap: 15 })}`}
          </div>
        </>
      )}
    </div>
  );
}

// ── Monte Carlo (distribution over the Simple DCF) ─────────────────────────

function MonteCarloTab({
  dcfConfig,
  mcConfig,
  fundamentals,
  currentPrice,
  qc,
  onChange,
}: {
  dcfConfig: DcfConfig;
  mcConfig: MonteCarloConfig;
  fundamentals: Fundamentals | undefined;
  currentPrice: number | null;
  qc: Currency;
  onChange: (fn: (c: MonteCarloConfig) => MonteCarloConfig) => void;
}) {
  const { t } = useTranslation();
  const { base, missing } = deriveBaseMetric(dcfConfig, fundamentals, currentPrice);
  const metricName = t(`dcf.metric.${dcfConfig.metric}`);
  const negative = base != null && base <= 0;

  const result = useMemo<MonteCarloResult | null>(() => {
    if (base == null || base <= 0) return null;
    return monteCarloSimpleDCF(
      {
        baseMetric: base,
        growthRate: dcfConfig.growthRate,
        years: dcfConfig.years,
        exitMultiple: dcfConfig.exitMultiple,
        desiredReturn: dcfConfig.desiredReturn,
        currentPrice,
      },
      { growthSd: mcConfig.growthSd, multipleSd: mcConfig.multipleSd },
      5000,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dcfConfig, mcConfig, base, currentPrice]);

  const fmt = (v: number | null | undefined) => formatMoney(v ?? null, qc);

  return (
    <div className="space-y-4">
      <p className="max-w-xl text-xs text-slate-500">
        {t("mc.intro", { metric: metricName })}
      </p>

      {/* Point inputs come from the DCF tab; here we set the uncertainty. */}
      <div className="flex flex-wrap items-end gap-4">
        <PctField
          label={t("mc.growthSd")}
          value={mcConfig.growthSd}
          step={0.5}
          onChange={(v) => onChange((c) => ({ ...c, growthSd: Math.max(0, v) }))}
        />
        <ValField
          label={t("mc.multipleSd")}
          value={mcConfig.multipleSd}
          step="0.5"
          suffix="×"
          onChange={(v) => onChange((c) => ({ ...c, multipleSd: Math.max(0, v) }))}
        />
        <div className="pb-1 text-[11px] text-slate-400">
          {t("mc.pointHint", {
            growth: (dcfConfig.growthRate * 100).toFixed(1),
            multiple: dcfConfig.exitMultiple,
          })}
        </div>
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

      {result && result.runs > 0 && !missing && !negative && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("mc.p10")}</p>
              <p className="text-lg font-semibold text-rose-600">{fmt(result.p10)}</p>
            </div>
            <div className="rounded-lg border-2 px-4 py-3" style={{ borderColor: GOLD }}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("mc.p50")}</p>
              <p className="text-lg font-bold" style={{ color: GOLD }}>
                {fmt(result.p50)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("mc.p90")}</p>
              <p className="text-lg font-semibold text-emerald-600">{fmt(result.p90)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("mc.mean")}</p>
              <p className="text-lg font-semibold text-slate-700">{fmt(result.mean)}</p>
            </div>
          </div>

          <p className="text-sm text-slate-600">
            {t("mc.sentence", { p10: fmt(result.p10), p90: fmt(result.p90) })}
          </p>

          <McHistogram result={result} currentPrice={currentPrice} qc={qc} />
        </>
      )}
    </div>
  );
}

// Hand-rolled SVG histogram (no chart lib, matching the project's style), with
// vertical markers for the median fair value and the current price.
function McHistogram({
  result,
  currentPrice,
  qc,
}: {
  result: MonteCarloResult;
  currentPrice: number | null;
  qc: Currency;
}) {
  const { t } = useTranslation();
  const bins = result.bins;
  if (bins.length === 0) return null;

  const W = 700;
  const H = 180;
  const marginX = 16;
  const marginTop = 12;
  const axisY = H - 28;
  const innerW = W - marginX * 2;
  const domainMin = bins[0].x0;
  const domainMax = bins[bins.length - 1].x1;
  const span = domainMax - domainMin || Math.abs(domainMax) || 1;
  const x = (v: number) => marginX + ((v - domainMin) / span) * innerW;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const barH = (c: number) => ((axisY - marginTop) * c) / maxCount;

  const nf = (v: number) => formatMoney(v, qc);
  const showPrice =
    currentPrice != null && currentPrice >= domainMin && currentPrice <= domainMax;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }} role="img">
        {/* bars */}
        {bins.map((b, i) => {
          const bx = x(b.x0);
          const bw = Math.max(1, x(b.x1) - x(b.x0) - 1);
          const h = barH(b.count);
          return (
            <rect
              key={i}
              x={bx}
              y={axisY - h}
              width={bw}
              height={h}
              fill="#cbd5e1"
              rx={1}
            />
          );
        })}
        {/* axis */}
        <line x1={marginX} y1={axisY} x2={W - marginX} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />

        {/* median marker */}
        <g>
          <line x1={x(result.p50)} y1={marginTop} x2={x(result.p50)} y2={axisY} stroke={GOLD} strokeWidth={2} />
          <text x={x(result.p50)} y={marginTop + 2} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: "#a8842a" }}>
            {t("mc.median")} {nf(result.p50)}
          </text>
        </g>

        {/* current price marker */}
        {showPrice && (
          <g>
            <line
              x1={x(currentPrice!)}
              y1={marginTop}
              x2={x(currentPrice!)}
              y2={axisY}
              stroke={PRICE_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text x={x(currentPrice!)} y={axisY + 16} textAnchor="middle" style={{ fontSize: 10, fill: "#64748b" }}>
              {t("scenario.priceMarker")} {nf(currentPrice!)}
            </text>
          </g>
        )}

        {/* p10 / p90 axis labels */}
        <text x={x(result.p10)} y={axisY + 16} textAnchor="middle" style={{ fontSize: 10, fill: "#94a3b8" }}>
          P10 {nf(result.p10)}
        </text>
        <text x={x(result.p90)} y={axisY + 16} textAnchor="middle" style={{ fontSize: 10, fill: "#94a3b8" }}>
          P90 {nf(result.p90)}
        </text>
      </svg>
    </div>
  );
}

// ── Sum of the parts / NAV (holding companies) ─────────────────────────────

function SoTPTab({
  config,
  currentPrice,
  qc,
  fxRates,
  onChange,
}: {
  config: SotpConfig;
  currentPrice: number | null;
  qc: Currency;
  fxRates: Record<string, number>;
  onChange: (fn: (s: SotpConfig) => SotpConfig) => void;
}) {
  const { t } = useTranslation();
  const [quotes, setQuotes] = useState<Record<string, SotpLiveQuote>>({});
  const [loading, setLoading] = useState(false);

  // Distinct listed tickers, stable-keyed so the fetch only re-runs when the
  // set actually changes (not on every stake/name keystroke).
  const tickerKey = useMemo(() => {
    const set = new Set(
      config.holdings
        .map((h) => (h.ticker ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
    return [...set].sort().join(",");
  }, [config.holdings]);

  useEffect(() => {
    if (!tickerKey) {
      setQuotes({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(() => {
      getSotpQuotes(tickerKey.split(","))
        .then((q) => {
          if (!cancelled) setQuotes(q);
        })
        .catch(() => {
          if (!cancelled) setQuotes({});
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [tickerKey]);

  const result = useMemo(() => {
    const quoteMap: Record<string, { marketCap: number | null; currency: string | null }> = {};
    for (const [k, v] of Object.entries(quotes)) {
      quoteMap[k] = { marketCap: v.marketCap, currency: v.currency };
    }
    return withDiscount(calculateNAV(config, quoteMap, fxRates, qc), currentPrice);
  }, [config, quotes, fxRates, qc, currentPrice]);

  const fmt = (v: number | null | undefined) => formatMoney(v ?? null, qc);

  function updateHolding(id: string, patch: Partial<SotpHolding>) {
    onChange((s) => ({
      ...s,
      holdings: s.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  }
  function removeHolding(id: string) {
    onChange((s) => ({ ...s, holdings: s.holdings.filter((h) => h.id !== id) }));
  }
  function addHolding() {
    onChange((s) => ({ ...s, holdings: [...s.holdings, newHolding()] }));
  }

  return (
    <div className="space-y-4">
      <p className="max-w-xl text-xs text-slate-500">{t("sotp.intro")}</p>

      {/* Stakes table */}
      <div className="overflow-x-auto">
        <table className="table-base min-w-[640px]">
          <thead>
            <tr>
              <th>{t("sotp.cols.name")}</th>
              <th>{t("sotp.cols.ticker")}</th>
              <th className="text-right">{t("sotp.cols.stake")}</th>
              <th className="text-right">{t("sotp.cols.manual", { currency: qc })}</th>
              <th className="text-right">{t("sotp.cols.value")}</th>
              <th className="text-right">{t("sotp.cols.weight")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {config.holdings.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-center text-xs text-slate-400">
                  {t("sotp.empty")}
                </td>
              </tr>
            )}
            {config.holdings.map((h) => {
              const row = result.breakdown.find((b) => b.id === h.id);
              return (
                <tr key={h.id}>
                  <td>
                    <input
                      className="w-28 rounded-md border border-slate-200 px-1.5 py-0.5 text-sm"
                      value={h.name}
                      placeholder={t("sotp.cols.name")}
                      onChange={(e) => updateHolding(h.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="w-20 rounded-md border border-slate-200 px-1.5 py-0.5 text-sm uppercase"
                      value={h.ticker ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateHolding(h.id, {
                          ticker: e.target.value.trim() === "" ? null : e.target.value.trim(),
                        })
                      }
                    />
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-0.5">
                      <input
                        type="number"
                        step="0.1"
                        className="w-16 rounded-md border border-slate-200 px-1.5 py-0.5 text-right text-sm"
                        value={Number((h.stakePct * 100).toFixed(4))}
                        onChange={(e) =>
                          updateHolding(h.id, {
                            stakePct: (Number(e.target.value) || 0) / 100,
                          })
                        }
                      />
                      <span className="text-xs text-slate-400">%</span>
                    </span>
                  </td>
                  <td className="text-right">
                    <input
                      type="number"
                      step="any"
                      className="w-24 rounded-md border border-slate-200 px-1.5 py-0.5 text-right text-sm"
                      value={h.manualValue ?? ""}
                      placeholder={h.ticker ? t("sotp.auto") : "—"}
                      onChange={(e) =>
                        updateHolding(h.id, {
                          manualValue: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="text-right font-medium">{row ? fmt(row.value) : "—"}</td>
                  <td className="text-right text-slate-500">
                    {row ? formatPct(row.weight) : "—"}
                    {row?.fromManual && h.ticker && (
                      <span className="ml-1 text-[10px] text-amber-500" title={t("sotp.fallback")}>
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      className="text-slate-300 hover:text-rose-500"
                      title={t("sotp.remove")}
                      onClick={() => removeHolding(h.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="text-xs">
                <button className="text-brand-700 underline" onClick={addHolding}>
                  + {t("sotp.addHolding")}
                </button>
                {loading && <span className="ml-3 text-slate-400">{t("sotp.loading")}</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Holding-level adjustments */}
      <div className="flex flex-wrap items-end gap-4">
        <ValField
          label={t("sotp.netDebt", { currency: qc })}
          value={config.netDebt}
          step="any"
          onChange={(v) => onChange((s) => ({ ...s, netDebt: v }))}
        />
        <ValField
          label={t("sotp.shares")}
          value={config.sharesOutstanding}
          step="any"
          onChange={(v) => onChange((s) => ({ ...s, sharesOutstanding: Math.max(0, v) }))}
        />
        <ValField
          label={t("sotp.targetDiscount")}
          value={Number((config.targetDiscount * 100).toFixed(2))}
          step="1"
          suffix="%"
          onChange={(v) =>
            onChange((s) => ({ ...s, targetDiscount: Math.min(100, Math.max(0, v)) / 100 }))
          }
        />
        {result.discountToNav != null && (
          <button
            type="button"
            className="pb-1 text-xs text-brand-700 underline"
            title={t("sotp.useMarketDiscountHint")}
            onClick={() =>
              onChange((s) => ({
                ...s,
                targetDiscount: Math.min(1, Math.max(0, result.discountToNav ?? 0)),
              }))
            }
          >
            {t("sotp.useMarketDiscount", { pct: formatPct(result.discountToNav) })}
          </button>
        )}
      </div>

      {config.holdings.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("sotp.gav")}</p>
            <p className="truncate text-base font-semibold tabular-nums text-slate-700" title={fmt(result.gav)}>{fmt(result.gav)}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("sotp.nav")}</p>
            <p className="truncate text-base font-semibold tabular-nums text-slate-700" title={fmt(result.nav)}>{fmt(result.nav)}</p>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("sotp.navPerShare")}</p>
            <p className="truncate text-base font-semibold tabular-nums text-slate-700" title={fmt(result.navPerShare)}>{fmt(result.navPerShare)}</p>
          </div>
          <div className="min-w-0 rounded-lg border-2 px-3 py-3" style={{ borderColor: GOLD }}>
            <p className="truncate text-[10px] uppercase tracking-wide text-slate-400">
              {config.targetDiscount > 0
                ? t("sotp.targetPriceWithDiscount", { pct: formatPct(config.targetDiscount) })
                : t("sotp.targetPrice")}
            </p>
            <p className="truncate text-base font-bold tabular-nums" style={{ color: GOLD }} title={fmt(result.targetPrice)}>
              {fmt(result.targetPrice)}
            </p>
            {result.targetPrice != null &&
              currentPrice != null &&
              Number.isFinite(currentPrice) &&
              currentPrice !== 0 && (
                <p
                  className={`mt-0.5 truncate text-[11px] font-medium ${
                    result.targetPrice >= currentPrice ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {formatPct(result.targetPrice / currentPrice - 1)} {t("sotp.vsPrice")}
                </p>
              )}
          </div>
          <div className="min-w-0 rounded-lg border border-slate-200 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{t("sotp.discount")}</p>
            <p
              className={`truncate text-base font-semibold tabular-nums ${
                result.discountToNav == null
                  ? ""
                  : result.discountToNav > 0
                    ? "text-emerald-600"
                    : "text-rose-600"
              }`}
            >
              {formatPct(result.discountToNav)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
