import { useEffect, useState } from "react";
import type { Currency } from "./currency";

const STORAGE_KEY = "pt:displayCurrency";

export function useDisplayCurrency(): {
  currency: Currency;
  setCurrency: (c: Currency) => void;
} {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    if (typeof window === "undefined") return "EUR";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "EUR" || saved === "USD" || saved === "GBP" || saved === "CHF")
      return saved;
    return "EUR";
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, currency);
  }, [currency]);

  return { currency, setCurrency: setCurrencyState };
}
