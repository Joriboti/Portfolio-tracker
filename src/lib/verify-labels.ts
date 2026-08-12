// Bridges i18n into the artefact builders, which are deliberately
// translation-free: the PDF and the card take plain strings, so the same layout
// code renders a Catalan report and an English one with no branching.

import type { TFunction } from "i18next";
import type { ReportFormat, ReportLabels } from "./verify-report";

const REGION_KEYS = ["US", "Europe", "UK", "Asia", "Crypto", "Other"] as const;

export function buildReportLabels(
  t: TFunction,
  opts: { code: string; origin: string },
): ReportLabels {
  const host = opts.origin.replace(/^https?:\/\//, "");
  return {
    brand: "TrimmTrack",
    url: host,
    title: t("verify.docTitle"),
    tierLabel: t("verify.tierSelf"),
    attestation: t("verify.attestation"),
    issuedOn: t("verify.issuedOn"),
    distribution: t("verify.distribution"),
    regions: t("verify.regions"),
    sectors: t("verify.sectors"),
    keyFigures: t("verify.keyFigures"),
    holdings: t("verify.holdings"),
    topPosition: t("verify.topPosition"),
    effectiveN: t("verify.effectiveN"),
    totalReturn: t("verify.totalReturn"),
    irr: t("verify.irr"),
    totalValue: t("verify.totalValue"),
    totalCost: t("verify.totalCost"),
    realized: t("verify.realized"),
    dividends: t("verify.dividends"),
    other: t("verify.other"),
    grade: t("verify.grade"),
    verifyTitle: t("verify.howTitle"),
    verifyHint: t("verify.howBody", { host }),
    verifyShort: t("verify.cardFooter", { host, code: opts.code }),
    code: t("verify.code"),
    digest: t("verify.digest"),
    revoked: t("verify.revoked"),
    disclaimer: t("verify.disclaimer"),
    regionNames: Object.fromEntries(
      REGION_KEYS.map((k) => [k, t(`xray.regions.${k}`)]),
    ) as Record<string, string>,
  };
}

export function buildReportFormat(locale: string): ReportFormat {
  const nf = (dp: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    });
  return {
    pct: (v, signed) =>
      v == null ? "—" : `${signed && v >= 0 ? "+" : ""}${nf(1).format(v * 100)} %`,
    money: (v) => (v == null ? "—" : `${nf(0).format(v)} €`),
    number: (v, dp = 0) => nf(dp).format(v),
    date: (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString(locale, { dateStyle: "long" });
    },
  };
}
