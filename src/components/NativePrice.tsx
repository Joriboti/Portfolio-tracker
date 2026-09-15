import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatMoney, type Currency } from "@/lib/currency";
import { formatNative, numberLocale, type PositionRow } from "@/lib/money";

/**
 * The "current price" cell of a positions table.
 *
 * Shows the price in the display currency and, when the market quotes the
 * share in another currency, the native quote underneath — so a USD stock on
 * a EUR dashboard reads "809,30 €" over "934,48 US$" instead of a bare EUR
 * figure that looks wrong to anyone who knows the ticker. A quote that cannot
 * be converted (no rate for its currency yet) is shown native with a badge,
 * never as an unconverted number under the wrong label.
 */
export function NativeAwarePrice({
  row,
  display,
  fallback = "—",
}: {
  row: PositionRow;
  display: Currency;
  /** What to render when there is no quote at all. */
  fallback?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = numberLocale(i18n.language);

  if (row.price != null) {
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span>{formatMoney(row.price, display)}</span>
        {row.nativeDiffers && row.native && (
          <span
            className="text-[10px] font-normal text-slate-400"
            title={t("dashboard.nativeQuote", { currency: row.native.currency })}
          >
            {formatNative(row.native.price, row.native.currency, locale)}
          </span>
        )}
      </span>
    );
  }

  if (row.status === "no-fx" && row.native) {
    return (
      <span
        className="inline-flex flex-col items-end gap-0.5 leading-tight"
        title={t("dashboard.noFx", { currency: row.native.currency })}
      >
        <span>{formatNative(row.native.price, row.native.currency, locale)}</span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
          {t("dashboard.noFxBadge")}
        </span>
      </span>
    );
  }

  return <>{fallback}</>;
}
