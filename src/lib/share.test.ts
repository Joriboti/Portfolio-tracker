import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare } from "./share";
import { defaultModel } from "./scenarioValuation";

describe("share link codec", () => {
  it("round-trips a full valuation state", () => {
    const state = {
      t: "NVDA",
      tab: "dcf",
      m: { ...defaultModel(), years: 7 },
    };
    const decoded = decodeShare(encodeShare(state));
    expect(decoded).not.toBeNull();
    expect(decoded!.t).toBe("NVDA");
    expect(decoded!.tab).toBe("dcf");
    expect(decoded!.m?.years).toBe(7);
    expect(decoded!.m?.scenarios).toEqual(state.m.scenarios);
  });

  it("round-trips non-ASCII scenario names (UTF-8 safe)", () => {
    const m = defaultModel();
    m.scenarios[0].name = "Escenari optimista €→ü";
    const decoded = decodeShare(encodeShare({ t: "IAG.MC", m }));
    expect(decoded?.m?.scenarios?.[0].name).toBe("Escenari optimista €→ü");
  });

  it("degrades to null on garbage input", () => {
    expect(decodeShare("not-base64!!!")).toBeNull();
    expect(decodeShare("")).toBeNull();
    // Valid base64 of valid JSON but missing the ticker field.
    expect(decodeShare(encodeShare({ t: "" } as never))).toBeNull();
  });
});
