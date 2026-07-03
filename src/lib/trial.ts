// Anonymous "try before you register" store. Holds a small portfolio in
// sessionStorage so a visitor can taste the core dashboard + valuation models
// without an account. Capped (a taste, not the full product); exceeding a cap
// prompts sign-up. On sign-up the data is carried into the new account (see the
// carry-over effect in dashboard.tsx). Everything here is client-only — it never
// touches the DB.

import type { Transaction } from "./excel-parser";

const KEY = "trimm_trial_v1";
/** Fired on the window whenever the trial changes, so open views can refresh. */
export const TRIAL_EVENT = "trial-change";

// Caps (product decision).
export const TRIAL_MAX_ROWS = 30; // Excel transaction rows
export const TRIAL_MAX_POSITIONS = 10; // distinct tickers (manual add)

export function getTrialTxns(): Transaction[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Transaction[]) : [];
  } catch {
    return [];
  }
}

function save(txns: Transaction[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(txns));
  } catch {
    /* storage full/disabled — the trial just won't persist across reloads */
  }
  window.dispatchEvent(new Event(TRIAL_EVENT));
}

export function clearTrial() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(TRIAL_EVENT));
}

export function hasTrial(): boolean {
  return getTrialTxns().length > 0;
}

export function trialPositionCount(txns: Transaction[] = getTrialTxns()): number {
  return new Set(txns.map((t) => t.ticker.trim().toUpperCase())).size;
}

/** Replace the trial with an imported Excel, capped to the first N rows. */
export function setTrialFromExcel(txns: Transaction[]): { kept: number; capped: boolean } {
  const kept = txns.slice(0, TRIAL_MAX_ROWS);
  save(kept);
  return { kept: kept.length, capped: txns.length > TRIAL_MAX_ROWS };
}

/**
 * Append one manual holding. Returns false (and stores nothing) when it would
 * introduce a NEW ticker beyond the distinct-position cap. Adding shares to a
 * ticker already in the trial is always allowed.
 */
export function addTrialHolding(txn: Transaction): boolean {
  const cur = getTrialTxns();
  const key = txn.ticker.trim().toUpperCase();
  const isNew = !cur.some((t) => t.ticker.trim().toUpperCase() === key);
  if (isNew && trialPositionCount(cur) >= TRIAL_MAX_POSITIONS) return false;
  save([...cur, txn]);
  return true;
}
