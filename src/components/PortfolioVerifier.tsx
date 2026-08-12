import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Position, Transaction, Dividend, Interest } from "@/lib/excel-parser";
import type { Fundamentals, PriceQuote, SnapshotListRow } from "@/lib/api";
import {
  createBrokerSnapshot,
  createSnapshot,
  listSnapshots,
  revokeSnapshot,
} from "@/lib/api";
import { convert, type Currency } from "@/lib/currency";
import { computeXray, type XrayHoldingInput } from "@/lib/xray";
import {
  buildSnapshotBody,
  canonicalizeBody,
  recomputeDigest,
  shortDigest,
  verifyUrl,
  type IssuedSnapshot,
  type SnapshotBody,
} from "@/lib/verify";
import { buildReportPdf, buildVerifiedCardSvg } from "@/lib/verify-report";
import { buildReportFormat, buildReportLabels } from "@/lib/verify-labels";
import { downloadBlob, downloadSvgAsPng } from "@/lib/download";

const CARD_W = 1200;
const CARD_H = 630;

type Props = {
  userId: string;
  positions: Position[];
  quotes: Record<string, PriceQuote>;
  fxRates: Record<string, number>;
  fundamentals: Record<string, Fundamentals>;
  txns: Transaction[];
  dividends: Dividend[];
  interests: Interest[];
};

type State =
  | { status: "idle" }
  | { status: "issuing" }
  | { status: "issued"; snapshot: IssuedSnapshot }
  | { status: "error"; message: string };

/**
 * Issues a signed snapshot of the portfolio and turns it into the two
 * artefacts: a one-page PDF and a shareable card.
 *
 * The figures are computed here, in the browser, from the same data the
 * dashboard is already showing — which is exactly what the "self-reported"
 * tier claims and no more. What the server adds is the part the client cannot
 * fake: an issue time and an HMAC over the digest, so a card can be traced back
 * to a snapshot this app really issued, and any later edit to the image breaks
 * the match.
 */
export function PortfolioVerifier({
  userId,
  positions,
  quotes,
  fxRates,
  fundamentals,
  txns,
  dividends,
  interests,
}: Props) {
  const { t, i18n } = useTranslation();
  const [amounts, setAmounts] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const [issued, setIssued] = useState<SnapshotListRow[]>([]);
  const [copied, setCopied] = useState(false);
  // Broker tier. The credentials live in component state for the length of one
  // request and are never persisted — not to localStorage, not anywhere.
  const [source, setSource] = useState<"self" | "ibkr">("self");
  const [flexToken, setFlexToken] = useState("");
  const [flexQueryId, setFlexQueryId] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);

  const fmt = useMemo(() => buildReportFormat(i18n.language), [i18n.language]);

  useEffect(() => {
    let cancelled = false;
    listSnapshots(userId)
      .then((r) => !cancelled && setIssued(r.snapshots))
      .catch(() => {
        /* the list is a convenience; failing to load it must not block issuing */
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Everything the report needs, derived from data the dashboard already holds
  // — no extra network round-trip to publish a card.
  const report = useMemo(() => {
    const holdings: XrayHoldingInput[] = positions.map((p) => {
      const quote = quotes[p.ticker];
      const marketValueEur = quote
        ? convert(quote.price, (quote.currency ?? "EUR") as Currency, "EUR", fxRates) *
          p.shares
        : null;
      return {
        ticker: p.ticker,
        shares: p.shares,
        costEur: p.totalCost,
        avgCostEur: p.avgCost,
        realizedPlEur: p.realizedPL,
        marketValueEur,
        currency: quote?.currency ?? null,
        sector: fundamentals[p.ticker]?.sector ?? null,
        trailingPe: fundamentals[p.ticker]?.trailingPe ?? null,
      };
    });
    if (holdings.length === 0) return null;
    return computeXray({ holdings, txns, dividends, interests });
  }, [positions, quotes, fxRates, fundamentals, txns, dividends, interests]);

  const labels = useMemo(
    () =>
      buildReportLabels(t, {
        code: state.status === "issued" ? state.snapshot.code : "",
        origin: typeof window !== "undefined" ? window.location.origin : "",
        tier: state.status === "issued" ? state.snapshot.body.tier : "self",
        broker: state.status === "issued" ? state.snapshot.body.broker : null,
      }),
    [t, state],
  );

  async function issue() {
    if (!report) return;
    setState({ status: "issuing" });
    setCopied(false);
    try {
      const body = buildSnapshotBody({ report, amounts });
      const canonical = canonicalizeBody(body);
      const { code, issuedAt, digest } = await createSnapshot(userId, canonical);

      // Recompute locally rather than trusting the response: if the two ever
      // disagree, the artefacts would print a digest that does not verify, and
      // we would rather fail here than hand the user a broken card.
      const local = await recomputeDigest({ code, issuedAt, canonical });
      if (local !== digest) {
        setState({ status: "error", message: t("verify.errors.digestMismatch") });
        return;
      }

      setState({
        status: "issued",
        snapshot: { code, issuedAt, body, canonical, digest, signatureValid: true },
      });
      setIssued((prev) => [
        {
          code,
          issuedAt,
          tier: body.tier,
          broker: body.broker,
          amounts: body.amounts,
          digest,
          revokedAt: null,
        },
        ...prev,
      ]);
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }

  /**
   * Broker tier. Nothing is computed here: the server fetches the positions
   * from IBKR, derives the figures and signs them, and we render exactly the
   * body it returned — the same bytes the digest covers.
   */
  async function issueFromBroker() {
    setState({ status: "issuing" });
    setCopied(false);
    setSkipped([]);
    try {
      const r = await createBrokerSnapshot(userId, flexToken, flexQueryId, amounts);
      const local = await recomputeDigest({
        code: r.code,
        issuedAt: r.issuedAt,
        canonical: r.canonical,
      });
      if (local !== r.digest) {
        setState({ status: "error", message: t("verify.errors.digestMismatch") });
        return;
      }
      const body = JSON.parse(r.canonical) as SnapshotBody;
      setSkipped(r.skipped);
      setState({
        status: "issued",
        snapshot: {
          code: r.code,
          issuedAt: r.issuedAt,
          body,
          canonical: r.canonical,
          digest: r.digest,
          signatureValid: true,
        },
      });
      setIssued((prev) => [
        {
          code: r.code,
          issuedAt: r.issuedAt,
          tier: "broker",
          broker: body.broker,
          amounts: body.amounts,
          digest: r.digest,
          revokedAt: null,
        },
        ...prev,
      ]);
      // The token has done its job; drop it from the page too.
      setFlexToken("");
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }

  async function revoke(code: string) {
    try {
      const { revokedAt } = await revokeSnapshot(userId, code);
      setIssued((prev) => prev.map((s) => (s.code === code ? { ...s, revokedAt } : s)));
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }

  const snapshot = state.status === "issued" ? state.snapshot : null;
  const cardSvg = useMemo(
    () => (snapshot ? buildVerifiedCardSvg(snapshot, labels, fmt) : null),
    [snapshot, labels, fmt],
  );

  function downloadPdf() {
    if (!snapshot) return;
    downloadBlob(
      buildReportPdf(snapshot, labels, fmt).toBlob(),
      `trimmtrack-${snapshot.code}.pdf`,
    );
  }

  function downloadCard() {
    if (!cardSvg || !snapshot) return;
    downloadSvgAsPng(cardSvg, `trimmtrack-${snapshot.code}.png`, CARD_W, CARD_H);
  }

  async function copyLink() {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(verifyUrl(snapshot.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is on screen to copy by hand */
    }
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-slate-900">{t("verify.sectionTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("verify.sectionBody")}</p>
        </div>
      </div>

      {
        <>
          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap gap-2">
              <SourceBtn active={source === "self"} onClick={() => setSource("self")}>
                {t("verify.sourceSelf")}
              </SourceBtn>
              <SourceBtn active={source === "ibkr"} onClick={() => setSource("ibkr")}>
                {t("verify.sourceIbkr")}
              </SourceBtn>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t(source === "ibkr" ? "verify.sourceIbkrHint" : "verify.sourceSelfHint")}
            </p>
            {/* A broker card is built from the broker's data, so an empty local
                portfolio only blocks the self-reported route. */}
            {source === "self" && !report && (
              <p className="mt-2 text-sm text-slate-400">{t("verify.noPositions")}</p>
            )}
          </div>

          {source === "ibkr" && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-slate-600">{t("verify.flexToken")}</span>
                  <input
                    value={flexToken}
                    onChange={(e) => setFlexToken(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="123456789012345"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-slate-600">{t("verify.flexQueryId")}</span>
                  <input
                    value={flexQueryId}
                    onChange={(e) => setFlexQueryId(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="123456"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-400">{t("verify.flexHelp")}</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={amounts}
                onChange={(e) => setAmounts(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              />
              {t("verify.includeAmounts")}
            </label>
            <span className="text-xs text-slate-400">{t("verify.includeAmountsHint")}</span>
            <button
              onClick={() => void (source === "ibkr" ? issueFromBroker() : issue())}
              disabled={
                state.status === "issuing" ||
                (source === "ibkr"
                  ? flexToken.length < 6 || flexQueryId.length < 3
                  : !report)
              }
              className="btn-primary ml-auto text-sm px-4 py-2 disabled:opacity-50"
            >
              {state.status === "issuing"
                ? t("verify.issuing")
                : source === "ibkr"
                  ? t("verify.generateVerified")
                  : t("verify.generate")}
            </button>
          </div>

          {skipped.length > 0 && (
            <p className="mt-3 text-xs text-amber-600">
              {t("verify.skipped", { tickers: skipped.join(", ") })}
            </p>
          )}

          {state.status === "error" && (
            <p className="mt-3 text-sm text-rose-600">{state.message}</p>
          )}

          {snapshot && cardSvg && (
            <div className="mt-5 space-y-4">
              <div
                className="overflow-hidden rounded-xl ring-1 ring-slate-200 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                // Our own generated SVG string — no user-supplied markup.
                dangerouslySetInnerHTML={{ __html: cardSvg }}
              />

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={downloadPdf} className="btn-primary text-sm px-4 py-2">
                  {t("verify.downloadPdf")}
                </button>
                <button onClick={downloadCard} className="btn-ghost text-sm px-4 py-2">
                  {t("verify.downloadPng")}
                </button>
                <button
                  onClick={() => void copyLink()}
                  className="text-sm px-4 py-2 text-brand-700 hover:underline"
                >
                  {copied ? t("verify.copied") : t("verify.copyLink")}
                </button>
              </div>

              <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-slate-500">{t("verify.code")}</dt>
                <dd className="font-medium tabular-nums text-slate-800">{snapshot.code}</dd>
                <dt className="text-slate-500">{t("verify.digest")}</dt>
                <dd className="tabular-nums text-slate-800">{shortDigest(snapshot.digest)}</dd>
                <dt className="text-slate-500">{t("verify.link")}</dt>
                <dd className="break-all text-slate-800">{verifyUrl(snapshot.code)}</dd>
              </dl>
            </div>
          )}

          {issued.length > 0 && (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("verify.issuedTitle")}
              </h3>
              <div className="mt-2">
                {issued.map((s) => (
                  <div
                    key={s.code}
                    className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-100 py-2 text-sm"
                  >
                    <span className="font-medium tabular-nums text-slate-800">{s.code}</span>
                    <span className="text-slate-400">
                      {fmt.date(s.issuedAt)}
                      {s.amounts ? ` · ${t("verify.withAmounts")}` : ""}
                    </span>
                    {s.revokedAt ? (
                      <span className="text-rose-600">{t("verify.revoked")}</span>
                    ) : (
                      <button
                        onClick={() => void revoke(s.code)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        {t("verify.revoke")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      }
    </section>
  );
}

function SourceBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
