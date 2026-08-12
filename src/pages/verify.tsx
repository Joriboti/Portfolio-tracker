import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getSnapshot, type FetchedSnapshot } from "@/lib/api";
import {
  isValidCode,
  recomputeDigest,
  shortDigest,
  type IssuedSnapshot,
  type SnapshotBody,
} from "@/lib/verify";
import { buildVerifiedCardSvg } from "@/lib/verify-report";
import { buildReportFormat, buildReportLabels } from "@/lib/verify-labels";
import { useSeo } from "@/lib/seo";

// Public check for a shared portfolio card. Anyone handed a code can open this
// page and see, in plain terms, what the card is and is not evidence of.
//
// The page does not take the API's word for the digest: it re-hashes the stored
// body in the browser and compares. That is the whole mechanism — if a shared
// image was edited, its printed digest will not be the one this page computes.

type Verdict =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "error"; message: string }
  | {
      kind: "checked";
      snapshot: IssuedSnapshot;
      /** The body no longer hashes to the digest it was issued with. */
      tampered: boolean;
      /** The digest holds, but it does not carry our HMAC. */
      unsigned: boolean;
      revokedAt: string | null;
    };

export function VerifyPage() {
  const { t, i18n } = useTranslation();
  const { code: codeParam } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<Verdict>(
    codeParam ? { kind: "loading" } : { kind: "unknown" },
  );

  const fmt = useMemo(() => buildReportFormat(i18n.language), [i18n.language]);

  useSeo({
    title: t("verify.seoTitle"),
    description: t("verify.seoDesc"),
    // A specific card is somebody's portfolio, not a landing page: keep every
    // /verify/:code out of the index and let only the bare /verify be listed.
    noindex: Boolean(codeParam),
  });

  useEffect(() => {
    const code = codeParam?.trim().toUpperCase();
    if (!code) {
      setVerdict({ kind: "unknown" });
      return;
    }
    if (!isValidCode(code)) {
      setVerdict({ kind: "unknown" });
      return;
    }
    let cancelled = false;
    setVerdict({ kind: "loading" });
    getSnapshot(code)
      .then(async (fetched: FetchedSnapshot) => {
        if (cancelled) return;
        const local = await recomputeDigest({
          code: fetched.code,
          issuedAt: fetched.issuedAt,
          canonical: fetched.canonical,
        });
        if (cancelled) return;

        let body: SnapshotBody | null = null;
        try {
          body = JSON.parse(fetched.canonical) as SnapshotBody;
        } catch {
          body = null;
        }
        if (!body) {
          setVerdict({ kind: "error", message: t("verify.errors.unreadable") });
          return;
        }

        // Two independent failures, reported differently because they mean
        // different things. A digest mismatch says the figures were edited. A
        // bad signature says only that we cannot confirm we issued this row —
        // which is also what a rotated SNAPSHOT_SECRET looks like, and it would
        // be wrong to accuse anyone of tampering over a key rotation.
        const tampered = local !== fetched.digest || !fetched.digestValid;
        const unsigned = !tampered && !fetched.signatureValid;

        setVerdict({
          kind: "checked",
          snapshot: {
            code: fetched.code,
            issuedAt: fetched.issuedAt,
            body,
            canonical: fetched.canonical,
            digest: fetched.digest,
            signatureValid: fetched.signatureValid,
          },
          tampered,
          unsigned,
          revokedAt: fetched.revokedAt,
        });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setVerdict(
          e.message.includes("404")
            ? { kind: "unknown" }
            : { kind: "error", message: e.message },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [codeParam, t]);

  const labels = useMemo(
    () =>
      buildReportLabels(t, {
        code: verdict.kind === "checked" ? verdict.snapshot.code : "",
        origin: typeof window !== "undefined" ? window.location.origin : "",
      }),
    [t, verdict],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = input.trim().toUpperCase();
    if (isValidCode(code)) navigate(`/verify/${code}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          {t("verify.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{t("verify.h1")}</h1>
        <p className="mt-3 text-slate-600">{t("verify.lead")}</p>
      </header>

      <form onSubmit={submit} className="flex flex-wrap gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder={t("verify.codePlaceholder")}
          maxLength={10}
          className="w-full max-w-xs rounded-md border border-slate-200 px-3 py-2 font-medium tracking-widest tabular-nums uppercase"
        />
        <button type="submit" className="btn-primary text-sm px-4 py-2">
          {t("verify.check")}
        </button>
      </form>

      {verdict.kind === "loading" && (
        <p className="text-slate-500">{t("common.loading")}</p>
      )}

      {verdict.kind === "unknown" && codeParam && (
        <Panel tone="warn" title={t("verify.result.unknownTitle")}>
          {t("verify.result.unknownBody")}
        </Panel>
      )}

      {verdict.kind === "error" && (
        <Panel tone="warn" title={t("verify.result.errorTitle")}>
          {verdict.message}
        </Panel>
      )}

      {verdict.kind === "checked" && (
        <div className="space-y-6">
          {verdict.tampered ? (
            <Panel tone="bad" title={t("verify.result.tamperedTitle")}>
              {t("verify.result.tamperedBody")}
            </Panel>
          ) : verdict.unsigned ? (
            <Panel tone="warn" title={t("verify.result.unsignedTitle")}>
              {t("verify.result.unsignedBody")}
            </Panel>
          ) : verdict.revokedAt ? (
            <Panel tone="warn" title={t("verify.result.revokedTitle")}>
              {t("verify.result.revokedBody", { date: fmt.date(verdict.revokedAt) })}
            </Panel>
          ) : (
            <Panel tone="good" title={t("verify.result.validTitle")}>
              {t("verify.result.validBody", { date: fmt.date(verdict.snapshot.issuedAt) })}
            </Panel>
          )}

          <div
            className="overflow-hidden rounded-xl ring-1 ring-slate-200 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            // Generated by us from the stored body — no user-supplied markup.
            dangerouslySetInnerHTML={{
              __html: buildVerifiedCardSvg(verdict.snapshot, labels, fmt),
            }}
          />

          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <Row label={t("verify.code")} value={verdict.snapshot.code} />
            <Row label={t("verify.issuedOn")} value={fmt.date(verdict.snapshot.issuedAt)} />
            <Row label={t("verify.digest")} value={shortDigest(verdict.snapshot.digest)} />
            <Row
              label={t("verify.tier")}
              value={t(verdict.snapshot.body.tier === "broker" ? "verify.tierBroker" : "verify.tierSelf")}
            />
          </dl>

          <section className="border-t border-slate-200 pt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("verify.meaningTitle")}
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <span className="text-emerald-600">✓</span>
                {t("verify.meaning.issued")}
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-600">✓</span>
                {t("verify.meaning.unedited")}
              </li>
              <li className="flex gap-2">
                <span className="text-slate-400">✕</span>
                {t("verify.meaning.notBroker")}
              </li>
            </ul>
          </section>
        </div>
      )}

      <p className="text-xs text-slate-400">{t("verify.disclaimer")}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium tabular-nums text-slate-800">{value}</dd>
    </>
  );
}

function Panel({
  tone,
  title,
  children,
}: {
  tone: "good" | "warn" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  const ring =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "bad"
        ? "border-rose-200 bg-rose-50"
        : "border-amber-200 bg-amber-50";
  const mark = tone === "good" ? "✓" : tone === "bad" ? "✕" : "!";
  const markColor =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-amber-600";
  return (
    <div className={`rounded-xl border px-5 py-4 ${ring}`}>
      <p className="flex items-center gap-2 font-semibold text-slate-900">
        <span className={markColor}>{mark}</span>
        {title}
      </p>
      <p className="mt-1 text-sm text-slate-600">{children}</p>
    </div>
  );
}
