import { describe, expect, it } from "vitest";
import { PhaseSequencer, type PhaseState } from "./phases";

type P = "a" | "b" | "done";

function harness(minMs = 400) {
  let clock = 1000;
  const slept: number[] = [];
  const seen: PhaseState<P>[] = [];
  const seq = new PhaseSequencer<P>({
    minMs,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    onChange: (s) => seen.push(s),
  });
  return { seq, slept, seen, tick: (ms: number) => (clock += ms) };
}

describe("PhaseSequencer", () => {
  it("holds a fast phase on screen for the minimum before moving on", async () => {
    const { seq, slept, seen, tick } = harness();
    seq.start();
    await seq.enter("a");
    tick(50);
    await seq.enter("b");
    expect(slept).toEqual([350]);
    expect(seen.map((s) => s.phase)).toEqual(["idle", "a", "b"]);
  });

  it("does not wait when the phase has already been shown long enough", async () => {
    const { seq, slept, tick } = harness();
    seq.start();
    await seq.enter("a");
    tick(900);
    await seq.enter("b");
    expect(slept).toEqual([]);
  });

  it("never waits on the way out of idle", async () => {
    const { seq, slept } = harness();
    seq.start();
    await seq.enter("a");
    expect(slept).toEqual([]);
  });

  it("applies the minimum to the error transition too", async () => {
    const { seq, slept, seen, tick } = harness();
    seq.start();
    await seq.enter("a");
    tick(10);
    await seq.fail("a", "boom");
    expect(slept).toEqual([390]);
    expect(seen.at(-1)).toMatchObject({ phase: "error", error: { message: "boom", phase: "a" } });
  });

  it("updates progress without a wait and clears it on the next phase", async () => {
    const { seq, slept, seen, tick } = harness();
    seq.start();
    await seq.enter("a", { done: 0, total: 3 });
    seq.progress(2, 3);
    expect(slept).toEqual([]);
    expect(seen.at(-1)?.progress).toEqual({ done: 2, total: 3 });
    tick(500);
    await seq.enter("b");
    expect(seen.at(-1)?.progress).toBeNull();
  });

  it("numbers runs so a stale continuation can be ignored", async () => {
    const { seq } = harness();
    const first = seq.start();
    const second = seq.start();
    expect(second).toBe(first + 1);
    expect(seq.current.run).toBe(second);
  });

  it("resets to idle only after the minimum", async () => {
    const { seq, slept, seen, tick } = harness();
    seq.start();
    await seq.enter("done");
    tick(100);
    await seq.reset();
    expect(slept).toEqual([300]);
    expect(seen.at(-1)?.phase).toBe("idle");
  });
});
