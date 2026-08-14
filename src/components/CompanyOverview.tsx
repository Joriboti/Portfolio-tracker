import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStatements, type LiveCompany } from "@/lib/api";
import {
  annualLabel,
  cashFlowPanel,
  estimateBar,
  formatCompact,
  formatSignedPct,
  quarterLabel,
  ttm,
  yoyLatest,
  type CompanyStatements,
  type SeriesPoint,
  type StatementMetrics,
} from "@/lib/statements";
import { QuarterlyBars, type BarSeries } from "@/components/QuarterlyBars";
import { CompanyInsights } from "@/components/CompanyInsights";

// "Resum" tab of /explore/:ticker — Qualtrim-style company overview: stat
// panels (Valuation / Cash Flow / Margins & Growth / Balance / Dividend) over
// a grid of quarterly/annual financial charts. Statements + panel extras come
// from fundamentals-get's `?statements=` mode; headline stats reuse the
// already-loaded LiveCompany fundamentals. All figures are in the company's
// filing/quote currency.

const PALETTE = {
  price: "#16a34a",
  revenue: "#f59e0b",
  ebitda: "#7dd3fc",
  netIncome: "#fdba74",
  fcf: "#fb923c",
  eps: "#eab308",
  cash: "#22c55e",
  debt: "#ef4444",
  dividends: "#14b8a6",
  buybacks: "#c084fc",
  shares: "#64748b",
  sbc: "#f472b6",
  rnd: "#818cf8",
  sga: "#a5b4fc",
};

export function CompanyOverview({ company }: { company: LiveCompany }) {
  const { t } = useTranslation();
  const [data, setData] = useState<CompanyStatements | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<"q" | "a">("q");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getStatements(company.ticker)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setFailed(d == null);
        // Young cache → few quarters; annual view carries the trend better.
        if (d && d.quarters.length < 4 && d.annual.length >= 4) setPeriod("a");
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [company.ticker]);

  const ccy = company.currency;
  const f = company.fundamentals;
  const money = (v: number) => formatCompact(v, ccy);
  const pct = (v: number | null) =>
    v == null ? "—" : formatSignedPct(v);
  const ratio = (v: number | null) => (v == null ? "—" : v.toFixed(2));

  const panel = data?.panel ?? null;
  const quarters = data?.quarters ?? [];

  const cf = useMemo(
    () =>
      cashFlowPanel({
        freeCashflow: f.freeCashflow,
        sharesOutstanding: f.sharesOutstanding,
        price: company.price,
        sbcTtm: ttm(quarters, "sbc"),
      }),
    [f.freeCashflow, f.sharesOutstanding, company.price, quarters],
  );

  const revenueYoY = useMemo(() => yoyLatest(quarters, "revenue"), [quarters]);
  const earningsYoY = useMemo(() => yoyLatest(quarters, "netIncome"), [quarters]);

  const nextYearPe =
    company.price != null && panel?.nextYearEps
      ? company.price / panel.nextYearEps
      : null;
  const peRow = [f.trailingPe, f.forwardPe, nextYearPe]
    .map((v) => (v == null ? "—" : v.toFixed(2)))
    .join(" | ");

  const netCash =
    f.totalCash != null && f.totalDebt != null ? f.totalCash - f.totalDebt : null;

  return (
    <div className="space-y-5">
      {/* ───────── Stat panels ───────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatPanel title={t("company.panels.valuation")}>
          <Row label={t("company.rows.marketCap")} value={f.marketCap != null ? money(f.marketCap) : "—"} />
          <Row label={t("company.rows.pe")} value={peRow} />
          <Row label={t("company.rows.priceToSales")} value={ratio(panel?.priceToSales ?? null)} />
          <Row label={t("company.rows.evToEbitda")} value={ratio(panel?.evToEbitda ?? null)} />
          <Row label={t("company.rows.priceToBook")} value={ratio(f.priceToBook)} />
        </StatPanel>

        <StatPanel title={t("company.panels.cashflow")}>
          <Row
            label={t("company.rows.fcfYield")}
            value={cf.fcfYield == null ? "—" : formatSignedPct(cf.fcfYield)}
            hint={
              cf.fcfPerShare != null && company.price != null
                ? `${cf.fcfPerShare.toFixed(2)} / ${company.price.toFixed(2)}`
                : undefined
            }
          />
          <Row
            label={t("company.rows.adjFcfYield")}
            value={cf.adjFcfYield == null ? "—" : formatSignedPct(cf.adjFcfYield)}
            hint={
              cf.adjFcfPerShare != null && company.price != null
                ? `${cf.adjFcfPerShare.toFixed(2)} / ${company.price.toFixed(2)}`
                : undefined
            }
          />
          <Row label={t("company.rows.sbcImpact")} value={pct(cf.sbcImpact)} />
        </StatPanel>

        <StatPanel title={t("company.panels.marginsGrowth")}>
          <Row label={t("company.rows.profitMargin")} value={pct(f.profitMargin)} />
          <Row label={t("company.rows.operatingMargin")} value={pct(panel?.operatingMargin ?? null)} />
          <Row label={t("company.rows.earningsYoY")} value={pct(earningsYoY)} />
          <Row label={t("company.rows.revenueYoY")} value={pct(revenueYoY)} />
        </StatPanel>

        <StatPanel title={t("company.panels.balance")}>
          <Row label={t("company.rows.cash")} value={f.totalCash != null ? money(f.totalCash) : "—"} />
          <Row label={t("company.rows.debt")} value={f.totalDebt != null ? money(f.totalDebt) : "—"} />
          <Row
            label={t("company.rows.netCash")}
            value={netCash != null ? money(netCash) : "—"}
            tone={netCash == null ? undefined : netCash >= 0 ? "pos" : "neg"}
          />
        </StatPanel>

        <StatPanel title={t("company.panels.dividend")}>
          <Row label={t("company.rows.divYield")} value={pct(f.dividendYield)} />
          <Row label={t("company.rows.payoutRatio")} value={pct(panel?.payoutRatio ?? null)} />
          <Row
            label={t("company.rows.payoutDate")}
            value={
              panel?.dividendDate
                ? new Date(panel.dividendDate).toLocaleDateString()
                : "—"
            }
          />
        </StatPanel>

        {/* Price chart shares the panel row on lg */}
        {data && data.prices.length > 1 && (
          <PriceChart prices={data.prices} title={t("company.charts.price")} ccy={ccy} />
        )}
      </div>

      {/* ───────── Charts grid ───────── */}
      {loading && (
        <p className="text-sm text-slate-500">{t("company.loading")}</p>
      )}
      {!loading && failed && (
        <p className="text-sm text-slate-500">{t("company.noData")}</p>
      )}
      {!loading && data && (
        <ChartsGrid data={data} period={period} setPeriod={setPeriod} ccy={ccy} />
      )}

      {/* ───────── Insights (Notion-authored, self-hides) ───────── */}
      <CompanyInsights ticker={company.ticker} />
    </div>
  );
}

/* ───────────────────────── charts grid ───────────────────────── */

function ChartsGrid({
  data,
  period,
  setPeriod,
  ccy,
}: {
  data: CompanyStatements;
  period: "q" | "a";
  setPeriod: (p: "q" | "a") => void;
  ccy: string | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ChartCfg | null>(null);
  // EDGAR backfill can push the quarterly series past 100 periods; cap the
  // VIEW (not the stored data) to a readable recent window and let the annual
  // toggle carry the multi-decade trend, like the reference dashboards.
  const QUARTER_CAP = 24;
  const ANNUAL_CAP = 16;
  const rows =
    period === "q"
      ? data.quarters.slice(-QUARTER_CAP)
      : data.annual.slice(-ANNUAL_CAP);
  const label = period === "q" ? quarterLabel : annualLabel;

  // Aligned label/value extraction: one label per period that has ANY of the
  // chart's keys, so multi-series charts (Cash & Debt) never mis-align.
  const chart = (keys: (keyof StatementMetrics)[], flip = false) => {
    const kept = rows.filter((r) => keys.some((k) => r.metrics[k] != null));
    return {
      labels: kept.map((r) => label(r.periodEnd)),
      values: keys.map((k) =>
        kept.map((r) => {
          const v = r.metrics[k];
          return v == null ? null : flip ? Math.abs(v) : v;
        }),
      ),
    };
  };

  const money = (v: number) => formatCompact(v, ccy);
  const perShare = (v: number) => v.toFixed(2);

  // Analyst consensus for the quarter in progress, drawn as a ghost bar after
  // the last actual. Quarterly view only — the annual axis has no counterpart.
  const estimateFor = (key: "revenue" | "eps"): SeriesPoint | null =>
    period === "q" ? estimateBar(data.quarters, data.panel?.estimates, key) : null;

  const single = (
    titleKey: string,
    key: keyof StatementMetrics,
    color: string,
    format: (v: number) => string = money,
    flip = false,
    estimate: SeriesPoint | null = null,
  ): ChartCfg => {
    const c = chart([key], flip);
    return {
      title: t(titleKey),
      labels: c.labels,
      series: [{ name: t(titleKey), color, values: c.values[0] }],
      format,
      estimate,
      estimateLabel: estimate ? t("company.charts.estimate") : undefined,
    };
  };

  const cashDebt = chart(["cash", "totalDebt"]);
  const roc = chart(["dividendsPaid", "buybacks"], true);
  const expenses = chart(["rnd", "sga"]);

  const duo = (
    titleKey: string,
    c: { labels: string[]; values: Array<Array<number | null>> },
    names: [string, string],
    colors: [string, string],
    stacked: boolean,
  ): ChartCfg => ({
    title: t(titleKey),
    labels: c.labels,
    series: [
      { name: names[0], color: colors[0], values: c.values[0] },
      { name: names[1], color: colors[1], values: c.values[1] },
    ],
    stacked,
    format: money,
  });

  const charts: ChartCfg[] = [
    single(
      "company.charts.revenue",
      "revenue",
      PALETTE.revenue,
      money,
      false,
      estimateFor("revenue"),
    ),
    single("company.charts.ebitda", "ebitda", PALETTE.ebitda),
    single("company.charts.netIncome", "netIncome", PALETTE.netIncome),
    single("company.charts.fcf", "fcf", PALETTE.fcf),
    single("company.charts.eps", "eps", PALETTE.eps, perShare, false, estimateFor("eps")),
    duo(
      "company.charts.cashDebt",
      cashDebt,
      [t("company.rows.cash"), t("company.rows.debt")],
      [PALETTE.cash, PALETTE.debt],
      false,
    ),
    duo(
      "company.charts.returnOfCapital",
      roc,
      [t("company.charts.dividends"), t("company.charts.buybacks")],
      [PALETTE.dividends, PALETTE.buybacks],
      true,
    ),
    // No shares-outstanding chart. The series mixes two different things —
    // Yahoo reports a diluted weighted average for the period, EDGAR's
    // cover-page count is the shares issued on the filing date — so the bars
    // stepped up and down over history and read as wrong wherever the two
    // sources met. Buybacks (below) tell the same story from one source.
    single("company.charts.sbc", "sbc", PALETTE.sbc),
    duo(
      "company.charts.expenses",
      expenses,
      ["R&D", "SG&A"],
      [PALETTE.rnd, PALETTE.sga],
      true,
    ),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1.5">
        {(["q", "a"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-full border px-3 py-1 text-xs ${
              period === p
                ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t(p === "q" ? "company.toggle.quarterly" : "company.toggle.annual")}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {charts.map((c) => (
          <QuarterlyBars key={c.title} {...c} onExpand={() => setExpanded(c)} />
        ))}
      </div>
      <p className="text-[11px] text-slate-400">{t("company.depthNote")}</p>

      {expanded && (
        <ChartModal cfg={expanded} onClose={() => setExpanded(null)} />
      )}
    </div>
  );
}

/* ───────────────────────── expand-chart modal ───────────────────────── */

type ChartCfg = {
  title: string;
  labels: string[];
  series: BarSeries[];
  stacked?: boolean;
  format: (v: number) => string;
  estimate?: SeriesPoint | null;
  estimateLabel?: string;
};

function ChartModal({ cfg, onClose }: { cfg: ChartCfg; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-9 right-0 text-2xl leading-none text-white/80 hover:text-white"
          aria-label={t("common.close")}
        >
          &times;
        </button>
        <QuarterlyBars {...cfg} />
      </div>
    </div>
  );
}

/* ───────────────────────── price chart ───────────────────────── */

function PriceChart({
  prices,
  title,
  ccy,
}: {
  prices: CompanyStatements["prices"];
  title: string;
  ccy: string | null;
}) {
  const W = 320;
  const H = 130;
  const PAD = 6;
  const closes = prices.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (prices.length - 1)) * (W - PAD * 2);
  const y = (v: number) => 14 + ((max - v) / span) * (H - 14 - 8);
  const path = closes.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const area = `${path} L${x(prices.length - 1).toFixed(1)},${H - 8} L${x(0).toFixed(1)},${H - 8} Z`;
  const change = closes[closes.length - 1] / closes[0] - 1;
  const up = change >= 0;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">{title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {formatSignedPct(change)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={title}>
        <path d={area} fill={up ? "#16a34a" : "#e11d48"} opacity={0.12} />
        <path d={path} fill="none" stroke={up ? "#16a34a" : "#e11d48"} strokeWidth={1.6} />
        <text x={PAD} y={9} fontSize={8.5} fill="#94a3b8">
          {formatCompact(max, ccy)}
        </text>
      </svg>
    </div>
  );
}

/* ───────────────────────── panel bits ───────────────────────── */

function StatPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <dl className="mt-2 space-y-1.5">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1 last:border-0">
      <dt className="text-xs text-slate-500">
        {label}
        {hint && <span className="ml-1 text-[10px] text-slate-400">({hint})</span>}
      </dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${
          tone === "pos"
            ? "text-emerald-600"
            : tone === "neg"
              ? "text-rose-600"
              : "text-slate-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
