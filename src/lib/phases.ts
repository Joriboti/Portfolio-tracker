// A status state machine for multi-phase work (an upload, a refresh), with
// one rule the UI can't enforce on its own: every phase stays on screen for at
// least `minMs` before the next one replaces it, so a phase that finishes in
// 20ms doesn't flicker past. Pure — no React — so it can be tested with a
// fake clock; `usePhases` in the same file is the thin hook around it.

import { useMemo, useState } from "react";

export const IMPORT_PHASES = [
  "uploading",
  "parsing",
  "resolving",
  "fetching",
  "computing",
  "done",
] as const;
export type ImportPhase = (typeof IMPORT_PHASES)[number];

export type Progress = { done: number; total: number };

export type PhaseState<P extends string> = {
  /** `idle` before/after a run; `error` after a failure (see `error.phase`). */
  phase: P | "idle" | "error";
  progress: Progress | null;
  error: { message: string; phase: P } | null;
  /** Increments per run, so a stale async continuation can tell it was superseded. */
  run: number;
};

type Opts<P extends string> = {
  minMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onChange?: (state: PhaseState<P>) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PhaseSequencer<P extends string> {
  private state: PhaseState<P> = { phase: "idle", progress: null, error: null, run: 0 };
  private enteredAt = 0;
  private readonly minMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onChange: (state: PhaseState<P>) => void;

  constructor(opts: Opts<P> = {}) {
    this.minMs = opts.minMs ?? 400;
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
    this.onChange = opts.onChange ?? (() => {});
  }

  get current(): PhaseState<P> {
    return this.state;
  }

  private set(patch: Partial<PhaseState<P>>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  /** Begin a run: clears any previous error/progress. Returns the run id. */
  start(): number {
    const run = this.state.run + 1;
    this.state = { phase: "idle", progress: null, error: null, run };
    this.enteredAt = this.now();
    this.onChange(this.state);
    return run;
  }

  /** Wait until the phase on screen has had its minimum display time. */
  async settle(): Promise<void> {
    if (this.state.phase === "idle") return;
    const shown = this.now() - this.enteredAt;
    if (shown < this.minMs) await this.sleep(this.minMs - shown);
  }

  /** Move to `phase` — after the current one has been visible for `minMs`. */
  async enter(phase: P, progress: Progress | null = null): Promise<void> {
    await this.settle();
    this.enteredAt = this.now();
    this.set({ phase, progress, error: null });
  }

  /** Update the progress counter of the current phase (no minimum wait). */
  progress(done: number, total: number): void {
    this.set({ progress: { done, total } });
  }

  /** Fail in `phase` — also after the current one has had its minimum. */
  async fail(phase: P, message: string): Promise<void> {
    await this.settle();
    this.enteredAt = this.now();
    this.set({ phase: "error", error: { message, phase } });
  }

  /** Back to idle (hides the indicator). Waits out the minimum first. */
  async reset(): Promise<void> {
    await this.settle();
    this.set({ phase: "idle", progress: null, error: null });
  }
}

/** React binding: a stable sequencer whose state changes re-render. */
export function usePhases<P extends string>(minMs = 400): [PhaseState<P>, PhaseSequencer<P>] {
  const [state, setState] = useState<PhaseState<P>>({
    phase: "idle",
    progress: null,
    error: null,
    run: 0,
  });
  const seq = useMemo(() => new PhaseSequencer<P>({ minMs, onChange: setState }), [minMs]);
  return [state, seq];
}

/** Resolve once at least `minMs` have passed since `startedAt`. */
export async function holdFor(startedAt: number, minMs = 400): Promise<void> {
  const left = minMs - (Date.now() - startedAt);
  if (left > 0) await defaultSleep(left);
}
