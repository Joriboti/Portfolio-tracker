import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/components/LocaleLink";
import { canonicalPair, pairSlug, parsePairSlug } from "@/lib/compare";
import { withLocale } from "@/lib/locale";
import tickers from "@/data/tickers.json";

// The way into the head-to-head pages. Until this existed they were only
// reachable from a company page that happened to be in a curated pair, or by
// typing the URL — which is how it was actually being used.
//
// A datalist rather than a <select>: it suggests the covered companies while
// still accepting any symbol the market data knows, the same deal
// /explore/:ticker offers.

const CURATED = tickers as { symbol: string; name: string }[];
const LIST_ID = "compare-ticker-options";

export function ComparePicker({
  initialA = "",
  initialB = "",
}: {
  initialA?: string;
  initialB?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();

  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [error, setError] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    // The input may hold either a symbol or the "AAPL — Apple Inc." label the
    // datalist offers, so take the leading symbol either way.
    const clean = (v: string) => v.trim().split(/[\s—]/)[0].toUpperCase();
    const pair = parsePairSlug(`${clean(a)}-vs-${clean(b)}`);
    if (!pair) {
      setError(t("compare.pickerError"));
      return;
    }
    setError("");
    navigate(withLocale(`/explore/compare/${pairSlug(canonicalPair(pair))}`, locale));
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <datalist id={LIST_ID}>
        {CURATED.map((c) => (
          <option key={c.symbol} value={c.symbol}>
            {c.name}
          </option>
        ))}
      </datalist>
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label={t("compare.pickerA")}
          value={a}
          onChange={setA}
          placeholder="AAPL"
        />
        <span className="pb-2 text-sm text-slate-400">vs</span>
        <Field
          label={t("compare.pickerB")}
          value={b}
          onChange={setB}
          placeholder="MSFT"
        />
        <button type="submit" className="btn-primary px-4 py-2 text-sm">
          {t("compare.pickerCta")}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : (
        <p className="text-xs text-slate-400">{t("compare.pickerHint")}</p>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex-1 basis-32">
      <span className="block text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        list={LIST_ID}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm uppercase"
      />
    </label>
  );
}
