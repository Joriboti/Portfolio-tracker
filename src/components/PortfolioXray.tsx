import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LocaleLink } from "@/components/LocaleLink";
import { useTranslation } from "react-i18next";
import {
  parseWorkbook,
  aggregatePositions,
  type Transaction,
  type Dividend,
  type Interest,
  type Position,
} from "@/lib/excel-parser";
import { getLiveCompany, getPortfolio, getSotpQuotes } from "@/lib/api";
import { formatMoney, formatPct } from "@/lib/currency";
import { useUser } from "@/hooks/useUser";
import { getTrialTxns, hasTrial, setTrialFromExcel } from "@/lib/trial";
import {
  computeXray,
  type XrayReport,
  type XrayHoldingInput,
  type Region,
} from "@/lib/xray";

// Cap the number of live company lookups a single X-ray triggers. Positions are
// cost-sorted, so the largest holdings (the ones that actually move the grade)
// are always covered; a very long tail is truncated to keep the run snappy.
const MAX_LOOKUPS = 40;
const CONCURRENCY = 5;

// Ceiling for the dashboard-portfolio fetch. It normally answers in ~3s; past
// this the panel stops spinning and offers a retry instead of hanging.
const LOAD_TIMEOUT_MS = 20_000;

// Reject if `p` hasn't settled in `ms`. The underlying request is left to
// finish on its own — nothing reads it once the race is lost.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const REGION_COLORS: Record<Region, string> = {
  US: "#e0762a",
  Europe: "#3b6ea5",
  UK: "#6b5bd0",
  Asia: "#2fa37a",
  Crypto: "#d0a03a",
  Other: "#8a7f6d",
};

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#2fa37a";
  if (grade.startsWith("B")) return "#6fae3a";
  if (grade.startsWith("C")) return "#d69a2a";
  if (grade.startsWith("D")) return "#d9722a";
  return "#d1442a";
}

// Run an async mapper over `items` with a fixed concurrency ceiling, preserving
// input order. Keeps the Yahoo fan-out bounded (no 40 simultaneous requests).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Convert an amount in `ccy` to EUR using {currency: priceInUSD} rates (the
// EURUSD=X convention Yahoo returns). GBp (pence) is GBP/100. Returns null when
// a needed rate is missing, so the holding is valued at cost rather than wrong.
function toEur(amount: number, ccy: string | null, rates: Record<string, number>): number | null {
  const eur = rates["EUR"];
  if (!eur) return null;
  const c = ccy ?? "USD";
  let usd: number;
  if (c === "USD") usd = amount;
  else if (c === "GBp" || c === "GBX") {
    const gbp = rates["GBP"];
    if (!gbp) return null;
    usd = (amount / 100) * gbp;
  } else {
    const r = rates[c];
    if (!r) return null;
    usd = amount * r;
  }
  return usd / eur;
}

type Mode = "input" | "loading" | "result" | "error";
type Tab = "saved" | "excel" | "manual";
type ManualRow = { ticker: string; shares: string; avgCost: string };

// The portfolio the visitor already has in the app — the Excel they imported
// into the dashboard (account) or the anonymous trial portfolio in
// sessionStorage. Loaded lazily, only when the "saved" tab is opened.
type SavedPortfolio = {
  txns: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
  from: "account" | "trial";
};
type SavedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | ({ status: "ready" } & SavedPortfolio);

export function PortfolioXray() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();

  const [mode, setMode] = useState<Mode>("input");
  const [tab, setTab] = useState<Tab>("excel");
  const [report, setReport] = useState<XrayReport | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  // Where the analysed transactions came from. "saved" ones already live in the
  // dashboard, so the "continue" CTA must not re-import them.
  const [source, setSource] = useState<Tab>("excel");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [manual, setManual] = useState<ManualRow[]>([
    { ticker: "", shares: "", avgCost: "" },
  ]);
  const [saved, setSaved] = useState<SavedState>({ status: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  // A signed-in user, or an anonymous visitor mid-trial, already has a
  // portfolio in the app; only then is the third tab worth showing.
  const [trialAvailable] = useState(hasTrial);
  const hasSavedSource = user != null || trialAvailable;

  // Pre-select the saved portfolio the first time we know one exists (the
  // session resolves a tick after mount), but never yank the tab from under
  // someone who has already picked one.
  const tabTouched = useRef(false);
  useEffect(() => {
    if (tabTouched.current || !hasSavedSource) return;
    tabTouched.current = true;
    setTab("saved");
  }, [hasSavedSource]);

  function selectTab(next: Tab) {
    tabTouched.current = true;
    setTab(next);
  }

  // Fetch the dashboard portfolio while the tab is open: the account's imported
  // Excel when signed in, otherwise the anonymous trial.
  //
  // The whole run is keyed on one primitive — the session identity while the
  // tab is open — so the effect fires exactly once per (tab, user) pair and its
  // cleanup fires only when that pair really changes or the component goes
  // away. That matters more than it looks: an earlier version guarded the run
  // with a `mounted` ref and a "already loaded this key" ref, and any remount
  // in between starting the fetch and its response (React hides and re-runs a
  // subtree that suspends after mount) dropped the result on the floor while
  // the ref still said "loaded" — the panel then spun forever with no way out.
  // Re-running the effect on remount is what makes this self-healing.
  //
  // Primitives only in the dependency list: the session object gets a fresh
  // identity on most renders, and depending on it would restart the fetch on
  // every one of them.
  const userId = user?.id ?? null;
  const requestKey = tab === "saved" ? (userId ?? "anon") : null;
  // Bumping this re-runs the load with the same key (the retry button).
  const [reloadNonce, setReloadNonce] = useState(0);
  // Only a successful load is remembered, so toggling the tabs doesn't refetch
  // while an error or an empty result always gets another chance.
  const cache = useRef<{ key: string; state: SavedState } | null>(null);
  useEffect(() => {
    if (requestKey == null) return;
    const hit = cache.current;
    if (hit && hit.key === requestKey && hit.state.status === "ready") {
      setSaved(hit.state);
      return;
    }
    let stale = false;
    setSaved({ status: "loading" });

    const fromTrial = (): SavedState => {
      const trial = getTrialTxns();
      return trial.length > 0
        ? { status: "ready", txns: trial, dividends: [], interests: [], from: "trial" }
        : { status: "empty" };
    };

    void (async () => {
      let next: SavedState;
      if (userId) {
        try {
          // A hung request must not strand the panel on the spinner: past the
          // ceiling we show the error state, which offers a retry.
          const d = await withTimeout(getPortfolio(userId), LOAD_TIMEOUT_MS);
          next =
            d.transactions.length > 0
              ? {
                  status: "ready",
                  txns: d.transactions,
                  dividends: d.dividends,
                  interests: d.interests,
                  from: "account",
                }
              : fromTrial();
        } catch {
          next = { status: "error" };
        }
      } else {
        next = fromTrial();
      }
      if (stale) return;
      if (next.status === "ready") cache.current = { key: requestKey, state: next };
      setSaved(next);
    })();

    return () => {
      stale = true;
    };
  }, [requestKey, userId, reloadNonce]);

  // Preview of what the saved portfolio will analyse (open positions only).
  const savedPositions = useMemo(
    () => (saved.status === "ready" ? aggregatePositions(saved.txns).filter((p) => p.isOpen) : []),
    [saved],
  );

  async function generate(t0: Transaction[], divs: Dividend[], ints: Interest[]) {
    setError("");
    let positions = aggregatePositions(t0).filter((p) => p.isOpen);
    if (positions.length === 0) {
      setError(t("xray.errors.noPositions"));
      setMode("error");
      return;
    }
    setTruncated(positions.length > MAX_LOOKUPS);
    positions = positions.slice(0, MAX_LOOKUPS);

    setTxns(t0);
    setProgress({ done: 0, total: positions.length });
    setMode("loading");

    try {
      // 1) Fetch live company data (price, currency, sector, P/E) per holding.
      const companies = await mapLimit(positions, CONCURRENCY, async (p) => {
        const c = await getLiveCompany(p.ticker).catch(() => null);
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        return c;
      });

      // 2) One batched FX call for every distinct non-USD quote currency present
      //    (plus EUR, our base). GBp is priced off GBP.
      const ccys = new Set<string>(["EUR"]);
      for (const c of companies) {
        const q = c?.currency;
        if (q && q !== "USD") ccys.add(q === "GBp" || q === "GBX" ? "GBP" : q);
      }
      const fxSymbols = [...ccys].map((c) => `${c}USD=X`);
      const fxMap = await getSotpQuotes(fxSymbols).catch(
        () => ({}) as Awaited<ReturnType<typeof getSotpQuotes>>,
      );
      const rates: Record<string, number> = {};
      for (const c of ccys) {
        const price = fxMap[`${c}USD=X`.toUpperCase()]?.price;
        if (price != null) rates[c] = price;
      }

      // 3) Assemble the pure X-ray input.
      const holdings: XrayHoldingInput[] = positions.map((p, i) => {
        const c = companies[i];
        const price = c?.price ?? null;
        const mvQc = price != null ? price * p.shares : null;
        const marketValueEur = mvQc != null ? toEur(mvQc, c?.currency ?? null, rates) : null;
        return {
          ticker: p.ticker,
          shares: p.shares,
          costEur: p.totalCost,
          avgCostEur: p.avgCost,
          realizedPlEur: p.realizedPL,
          marketValueEur,
          currency: c?.currency ?? null,
          sector: c?.fundamentals?.sector ?? null,
          trailingPe: c?.fundamentals?.trailingPe ?? null,
        };
      });

      setReport(computeXray({ holdings, txns: t0, dividends: divs, interests: ints }));
      setMode("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMode("error");
    }
  }

  async function onFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      if (parsed.transactions.length === 0) {
        setError(t("xray.errors.parse"));
        setMode("error");
        return;
      }
      setSource("excel");
      await generate(parsed.transactions, parsed.dividends, parsed.interests);
    } catch {
      setError(t("xray.errors.parse"));
      setMode("error");
    }
  }

  function onSavedSubmit() {
    if (saved.status !== "ready") return;
    setSource("saved");
    void generate(saved.txns, saved.dividends, saved.interests);
  }

  function onManualSubmit() {
    const rows = manual
      .map((r) => ({
        ticker: r.ticker.trim().toUpperCase(),
        shares: parseFloat(r.shares.replace(",", ".")),
        avgCost: parseFloat(r.avgCost.replace(",", ".")),
      }))
      .filter((r) => r.ticker && Number.isFinite(r.shares) && r.shares > 0 && Number.isFinite(r.avgCost) && r.avgCost > 0);
    if (rows.length === 0) {
      setError(t("xray.errors.manual"));
      setMode("error");
      return;
    }
    const built: Transaction[] = rows.map((r) => ({
      ticker: r.ticker,
      shares: r.shares,
      buyPrice: r.avgCost,
      buyValue: r.shares * r.avgCost,
      buyDate: null,
      sellShares: null,
      sellPrice: null,
      sellValue: null,
      sellDate: null,
      result: null,
      portfolio: "manual",
    }));
    setSource("manual");
    void generate(built, [], []);
  }

  function reset() {
    setReport(null);
    setTxns([]);
    setError("");
    setTruncated(false);
    setMode("input");
  }

  function continueToDashboard() {
    // A saved portfolio is already in the dashboard (account or trial);
    // re-seeding the trial would duplicate it on the way in.
    if (source !== "saved") setTrialFromExcel(txns);
    navigate("/dashboard");
  }

  if (mode === "loading") {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="card text-center py-12">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
        <p className="text-slate-600">{t("xray.loading", { done: progress.done, total: progress.total })}</p>
        <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="card text-center py-10">
        <p className="text-rose-600">{error}</p>
        <button onClick={reset} className="btn-ghost mt-4 text-sm px-4 py-2">
          {t("xray.tryAgain")}
        </button>
      </div>
    );
  }

  if (mode === "result" && report) {
    return (
      <XrayResult
        report={report}
        truncated={truncated}
        onReset={reset}
        onContinue={continueToDashboard}
      />
    );
  }

  // ----- input -----
  return (
    <div className="card">
      <div className="mb-5 flex flex-wrap gap-2">
        {hasSavedSource && (
          <TabBtn active={tab === "saved"} onClick={() => selectTab("saved")}>
            {t("xray.tabSaved")}
          </TabBtn>
        )}
        <TabBtn active={tab === "excel"} onClick={() => selectTab("excel")}>
          {t("xray.tabExcel")}
        </TabBtn>
        <TabBtn active={tab === "manual"} onClick={() => selectTab("manual")}>
          {t("xray.tabManual")}
        </TabBtn>
      </div>

      {tab === "saved" ? (
        <SavedPanel
          saved={saved}
          positions={savedPositions}
          onGenerate={onSavedSubmit}
          onRetry={() => {
            cache.current = null;
            setReloadNonce((n) => n + 1);
          }}
          onUseExcel={() => selectTab("excel")}
        />
      ) : tab === "excel" ? (
        <div>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <span className="font-medium text-slate-700">{t("xray.dropTitle")}</span>
            <span className="mt-1 text-sm text-slate-500">{t("xray.dropHint")}</span>
          </label>
          <p className="mt-3 text-center text-xs text-slate-400">{t("xray.privacy")}</p>
          <p className="mt-4 text-center text-sm text-slate-500">
            {t("xray.needFormat")}{" "}
            <LocaleLink to="/upload" className="text-brand-700 hover:underline">
              {t("xray.needFormatLink")}
            </LocaleLink>
          </p>
        </div>
      ) : (
        <div>
          <div className="space-y-2">
            <div className="hidden gap-2 px-1 text-[11px] uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-[1fr_90px_110px_32px]">
              <span>{t("xray.manualTicker")}</span>
              <span className="text-right">{t("xray.manualShares")}</span>
              <span className="text-right">{t("xray.manualAvg")}</span>
              <span />
            </div>
            {manual.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_110px_32px] gap-2">
                <input
                  value={r.ticker}
                  onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, ticker: e.target.value } : x)))}
                  placeholder="AAPL"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm uppercase"
                />
                <input
                  value={r.shares}
                  onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, shares: e.target.value } : x)))}
                  inputMode="decimal"
                  placeholder="10"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-right"
                />
                <input
                  value={r.avgCost}
                  onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, avgCost: e.target.value } : x)))}
                  inputMode="decimal"
                  placeholder="150"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-right"
                />
                <button
                  onClick={() => setManual((m) => (m.length > 1 ? m.filter((_, j) => j !== i) : m))}
                  className="text-slate-300 hover:text-rose-500"
                  aria-label={t("xray.manualRemove")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setManual((m) => [...m, { ticker: "", shares: "", avgCost: "" }])}
            className="mt-3 text-sm font-medium text-brand-700 hover:underline"
          >
            {t("xray.manualAdd")}
          </button>
          <p className="mt-2 text-xs text-slate-400">{t("xray.manualHint")}</p>
          <button onClick={onManualSubmit} className="btn-primary mt-4 w-full">
            {t("xray.generate")}
          </button>
        </div>
      )}
    </div>
  );
}

// "Use the portfolio I already have" tab: analyses the Excel imported into the
// dashboard (or the anonymous trial) without asking for the file again.
function SavedPanel({
  saved,
  positions,
  onGenerate,
  onRetry,
  onUseExcel,
}: {
  saved: SavedState;
  positions: Position[];
  onGenerate: () => void;
  onRetry: () => void;
  onUseExcel: () => void;
}) {
  const { t } = useTranslation();

  if (saved.status === "loading" || saved.status === "idle") {
    return (
      <div className="flex items-center gap-3 py-8 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
        {t("xray.saved.loading")}
      </div>
    );
  }

  if (saved.status === "error") {
    return (
      <div className="py-6">
        <p className="text-sm text-rose-600">{t("xray.saved.error")}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-medium text-brand-700">
          <button onClick={onRetry} className="hover:underline">
            {t("xray.tryAgain")}
          </button>
          <button onClick={onUseExcel} className="hover:underline">
            {t("xray.saved.useExcel")} →
          </button>
        </div>
      </div>
    );
  }

  if (saved.status === "empty" || positions.length === 0) {
    return (
      <div className="py-6">
        <p className="text-sm text-slate-600">{t("xray.saved.empty")}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-medium text-brand-700">
          <LocaleLink to="/upload" className="hover:underline">
            {t("xray.saved.upload")} →
          </LocaleLink>
          <button onClick={onUseExcel} className="hover:underline">
            {t("xray.saved.useExcel")} →
          </button>
        </div>
      </div>
    );
  }

  const totalCost = positions.reduce((s, p) => s + p.totalCost, 0);
  const top = [...positions].sort((a, b) => b.totalCost - a.totalCost).slice(0, 5);
  const rest = positions.length - top.length;

  return (
    <div>
      <p className="text-sm text-slate-600">
        {t(saved.from === "account" ? "xray.saved.fromAccount" : "xray.saved.fromTrial")}
      </p>

      <div className="mt-4 border-t border-slate-200">
        {top.map((p) => (
          <div
            key={p.ticker}
            className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 text-sm"
          >
            <span className="font-medium text-slate-800">{p.ticker}</span>
            <span className="tabular-nums text-slate-500">
              {p.shares.toLocaleString("ca-ES", { maximumFractionDigits: 4 })} ·{" "}
              {formatMoney(p.totalCost, "EUR")}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-b border-slate-200 py-2 text-sm">
          <span className="text-slate-500">
            {rest > 0
              ? t("xray.saved.more", { count: rest, all: positions.length })
              : t("xray.saved.total", { count: positions.length })}
          </span>
          <span className="tabular-nums font-medium text-slate-700">
            {formatMoney(totalCost, "EUR")}
          </span>
        </div>
      </div>

      <button onClick={onGenerate} className="btn-primary mt-4 w-full">
        {t("xray.generate")}
      </button>
      <p className="mt-3 text-center text-xs text-slate-400">{t("xray.saved.hint")}</p>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Result view
// ---------------------------------------------------------------------------

function XrayResult({
  report,
  truncated,
  onReset,
  onContinue,
}: {
  report: XrayReport;
  truncated: boolean;
  onReset: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const si = report.sinceInception;

  const cardSvg = useMemo(() => buildCardSvg(report, {
    brand: "TrimmTrack",
    url: "trimmtrack.com/radiografia",
    kicker: t("xray.card.kicker"),
    scoreOf: t("xray.card.scoreOf", { score: report.score }),
    holdings: t("xray.card.holdings"),
    topPos: t("xray.card.topPos"),
    effN: t("xray.card.effN"),
    ret: t("xray.card.return"),
    cta: t("xray.card.cta"),
    regions: Object.fromEntries(
      (["US", "Europe", "UK", "Asia", "Crypto", "Other"] as Region[]).map((r) => [r, t(`xray.regions.${r}`)]),
    ) as Record<Region, string>,
  }), [report, t]);

  function download() {
    downloadPng(cardSvg, "trimmtrack-radiografia.png");
  }

  return (
    <div className="space-y-6">
      {/* Shareable card preview */}
      <div className="overflow-hidden rounded-2xl shadow-card">
        <div
          className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          // The card is our own generated SVG string (no user HTML) — safe to inline.
          dangerouslySetInnerHTML={{ __html: cardSvg }}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={download} className="btn-primary text-sm px-4 py-2">
          {t("xray.downloadImage")}
        </button>
        <button onClick={onContinue} className="btn-ghost text-sm px-4 py-2">
          {t("xray.continue")}
        </button>
        <button onClick={onReset} className="text-sm px-4 py-2 text-slate-500 hover:text-slate-800">
          {t("xray.another")}
        </button>
      </div>

      {truncated && (
        <p className="text-xs text-amber-600">{t("xray.truncated", { max: MAX_LOOKUPS })}</p>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label={t("xray.metrics.holdings")} value={String(report.holdingsCount)} />
        <Tile label={t("xray.metrics.value")} value={formatMoney(report.totalValueEur, "EUR")} />
        <Tile label={t("xray.metrics.topPos")} value={formatPct(report.concentration.top1)} />
        <Tile
          label={t("xray.metrics.effN")}
          value={report.concentration.effectiveN.toLocaleString("ca-ES", { maximumFractionDigits: 1 })}
        />
        <Tile
          label={t("xray.metrics.return")}
          value={formatPct(si.returnPct)}
          tone={si.returnPct == null ? undefined : si.returnPct >= 0 ? "pos" : "neg"}
        />
        <Tile
          label={t("xray.metrics.irr")}
          value={formatPct(si.irr)}
          tone={si.irr == null ? undefined : si.irr >= 0 ? "pos" : "neg"}
        />
      </div>

      {/* Geography */}
      <Section title={t("xray.geoTitle")}>
        <StackBar slices={report.regions.map((r) => ({ ...r, color: REGION_COLORS[r.key as Region] ?? REGION_COLORS.Other }))} />
        <Legend
          items={report.regions.map((r) => ({
            label: t(`xray.regions.${r.key}`),
            weight: r.weight,
            color: REGION_COLORS[r.key as Region] ?? REGION_COLORS.Other,
          }))}
        />
      </Section>

      {/* Sectors (when covered) */}
      {report.sectors && (
        <Section title={t("xray.sectorTitle")}>
          <Legend
            items={report.sectors.slice(0, 8).map((s, i) => ({
              label: s.key,
              weight: s.weight,
              color: SECTOR_PALETTE[i % SECTOR_PALETTE.length],
            }))}
            bars
          />
          {report.sectorCoverage < 0.95 && (
            <p className="mt-2 text-xs text-slate-400">
              {t("xray.coverage", { pct: formatPct(report.sectorCoverage) })}
            </p>
          )}
        </Section>
      )}

      {/* Weighted P/E */}
      {report.weightedPe != null && (
        <Section title={t("xray.valuationTitle")}>
          <p className="text-slate-700">
            {t("xray.weightedPe")}:{" "}
            <span className="font-semibold text-slate-900">
              {report.weightedPe.toLocaleString("ca-ES", { maximumFractionDigits: 1 })}×
            </span>
          </p>
          {report.peCoverage < 0.95 && (
            <p className="mt-1 text-xs text-slate-400">{t("xray.coverage", { pct: formatPct(report.peCoverage) })}</p>
          )}
        </Section>
      )}

      {/* Risk flags */}
      <Section title={t("xray.flagsTitle")}>
        {report.flags.length === 0 ? (
          <p className="text-emerald-600">{t("xray.noFlags")}</p>
        ) : (
          <ul className="space-y-2.5">
            {report.flags.map((f) => {
              const valueStr =
                f.id === "fewHoldings" || f.id === "manyTiny"
                  ? String(f.value ?? "")
                  : f.value != null
                    ? formatPct(f.value)
                    : "";
              const label =
                f.id === "regionBias" && f.label ? t(`xray.regions.${f.label}`) : (f.label ?? "");
              return (
                <li key={f.id} className="flex gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      f.severity === "high" ? "bg-rose-500" : f.severity === "med" ? "bg-amber-500" : "bg-slate-300"
                    }`}
                  />
                  <div>
                    <p className="font-medium text-slate-800">{t(`xray.flags.${f.id}.title`)}</p>
                    <p className="text-sm text-slate-500">
                      {t(`xray.flags.${f.id}.desc`, { value: valueStr, label })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Convert CTA */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100/60 p-6 ring-1 ring-brand-200">
        <h3 className="text-lg font-semibold text-slate-900">{t("xray.convertTitle")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("xray.convertBody")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={onContinue} className="btn-primary text-sm px-4 py-2">
            {t("xray.continue")}
          </button>
          <LocaleLink to="/auth/sign-in?next=/dashboard" className="btn-ghost text-sm px-4 py-2">
            {t("xray.signUp")}
          </LocaleLink>
        </div>
      </div>

      <p className="text-xs text-slate-400">{t("xray.disclaimer")}</p>
    </div>
  );
}

const SECTOR_PALETTE = ["#e0762a", "#3b6ea5", "#2fa37a", "#6b5bd0", "#d0a03a", "#c0563a", "#5a8f6a", "#8a7f6d"];

function Tile({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-rose-600" : "text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function StackBar({ slices }: { slices: Array<{ key: string; weight: number; color: string }> }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full">
      {slices.map((s) => (
        <div key={s.key} style={{ width: `${s.weight * 100}%`, background: s.color }} title={`${s.key} ${Math.round(s.weight * 100)}%`} />
      ))}
    </div>
  );
}

function Legend({
  items,
  bars,
}: {
  items: Array<{ label: string; weight: number; color: string }>;
  bars?: boolean;
}) {
  return (
    <div className={`mt-3 ${bars ? "space-y-2" : "flex flex-wrap gap-x-5 gap-y-1.5"}`}>
      {items.map((it) => (
        <div key={it.label} className={bars ? "" : "flex items-center gap-2"}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
              {it.label}
            </span>
            <span className="tabular-nums text-slate-500">{formatPct(it.weight)}</span>
          </div>
          {bars && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${it.weight * 100}%`, background: it.color }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shareable card (self-contained SVG string → PNG)
// ---------------------------------------------------------------------------

type CardLabels = {
  brand: string;
  url: string;
  kicker: string;
  scoreOf: string;
  holdings: string;
  topPos: string;
  effN: string;
  ret: string;
  cta: string;
  regions: Record<Region, string>;
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Compass mark (from Logo.tsx), translated/scaled into a <g>. Self-contained so
// the whole card rasterises to PNG with no external references.
function compassMark(x: number, y: number, size: number): string {
  const s = size / 32;
  return `<g transform="translate(${x},${y}) scale(${s})">
    <circle cx="16" cy="16" r="14" fill="none" stroke="#e9dcc4" stroke-width="2.2"/>
    <path d="M16 5 L16.61 14.52 L19.89 12.11 L17.48 15.39 L27 16 L17.48 16.61 L19.89 19.89 L16.61 17.48 L16 27 L15.39 17.48 L12.11 19.89 L14.52 16.61 L5 16 L14.52 15.39 L12.11 12.11 L15.39 14.52 Z" fill="#c99160"/>
    <path d="M16 4.6 L18.4 16 L13.6 16 Z" fill="#f2802a"/>
    <path d="M16 27.4 L18.4 16 L13.6 16 Z" fill="#e9dcc4"/>
    <circle cx="16" cy="16" r="2" fill="#e9dcc4"/>
    <circle cx="16" cy="16" r="1.05" fill="#f2802a"/>
  </g>`;
}

function buildCardSvg(report: XrayReport, L: CardLabels): string {
  const W = 1200;
  const H = 630;
  const gc = gradeColor(report.grade);
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const cream = "#f3ead9";
  const muted = "#b3a793";

  const si = report.sinceInception;
  const retStr = si.returnPct == null ? "—" : `${si.returnPct >= 0 ? "+" : ""}${Math.round(si.returnPct * 100)}%`;
  const rows: Array<[string, string]> = [
    [L.holdings, String(report.holdingsCount)],
    [L.topPos, `${Math.round(report.concentration.top1 * 100)}%`],
    [L.effN, report.concentration.effectiveN.toLocaleString("en", { maximumFractionDigits: 1 })],
    [L.ret, retStr],
  ];

  // Region stacked bar geometry.
  const barX = 64;
  const barW = W - 128;
  const barY = 486;
  let cx = barX;
  const segs = report.regions
    .map((r) => {
      const w = r.weight * barW;
      const seg = `<rect x="${cx.toFixed(1)}" y="${barY}" width="${Math.max(0, w - 2).toFixed(1)}" height="14" rx="3" fill="${REGION_COLORS[r.key as Region] ?? REGION_COLORS.Other}"/>`;
      cx += w;
      return seg;
    })
    .join("");
  const legend = report.regions
    .slice(0, 5)
    .map((r, i) => {
      const lx = barX + i * 210;
      const label = L.regions[r.key as Region] ?? r.key;
      return `<g transform="translate(${lx},${barY + 40})">
        <rect x="0" y="-9" width="11" height="11" rx="2" fill="${REGION_COLORS[r.key as Region] ?? REGION_COLORS.Other}"/>
        <text x="18" y="0" font-family="${sans}" font-size="17" fill="${muted}">${esc(label)} ${Math.round(r.weight * 100)}%</text>
      </g>`;
    })
    .join("");

  const rowSvg = rows
    .map(([label, val], i) => {
      const y = 214 + i * 62;
      return `<text x="720" y="${y}" font-family="${sans}" font-size="20" fill="${muted}">${esc(label)}</text>
        <text x="${W - 64}" y="${y}" text-anchor="end" font-family="${serif}" font-size="34" font-weight="600" fill="${cream}">${esc(val)}</text>
        <line x1="720" y1="${y + 20}" x2="${W - 64}" y2="${y + 20}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
  <defs>
    <radialGradient id="glow" cx="18%" cy="8%" r="80%">
      <stop offset="0%" stop-color="#3a2412"/>
      <stop offset="55%" stop-color="#20150c"/>
      <stop offset="100%" stop-color="#160f08"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${gc}"/>

  ${compassMark(64, 54, 46)}
  <text x="122" y="76" font-family="${serif}" font-size="30" font-weight="600" fill="${cream}">Trimm<tspan fill="#f2802a">Track</tspan></text>
  <text x="122" y="100" font-family="${sans}" font-size="15" fill="${muted}">${esc(L.url)}</text>

  <text x="64" y="180" font-family="${sans}" font-size="18" letter-spacing="3" fill="${muted}">${esc(L.kicker.toUpperCase())}</text>

  <circle cx="230" cy="336" r="128" fill="none" stroke="${gc}" stroke-width="8" stroke-opacity="0.9"/>
  <text x="230" y="360" text-anchor="middle" font-family="${serif}" font-size="150" font-weight="700" fill="${cream}">${esc(report.grade)}</text>
  <text x="230" y="512" text-anchor="middle" font-family="${sans}" font-size="24" fill="${muted}">${esc(L.scoreOf)}</text>

  ${rowSvg}

  ${segs}
  ${legend}

  <text x="${W - 64}" y="${H - 34}" text-anchor="end" font-family="${sans}" font-size="18" fill="${muted}">${esc(L.cta)}</text>
</svg>`;
}

// Rasterise the self-contained SVG string to a 2× PNG and trigger a download.
function downloadPng(svg: string, filename: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = 1200 * scale;
    canvas.height = 630 * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, 1200, 630);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      const href = URL.createObjectURL(b);
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
    }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
