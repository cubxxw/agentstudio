import { describe, expect, it } from "vitest";
import { normalizePins, movePin, togglePin } from "../../personal/src/conversation-pins";

describe("pinned conversation preferences", () => {
  it("recovers malformed saved preferences without breaking the inbox", () => {
    for (const value of [null, false, {}, "thr_a"]) expect(normalizePins(value)).toEqual([]);
    expect(normalizePins(["thr_b", 12, "", "thr_a", "thr_b", null])).toEqual(["thr_b", "thr_a"]);
  });

  it("adds at the end and unpins without changing other shortcuts", () => {
    expect(togglePin(["thr_b", "thr_a"], "thr_c")).toEqual(["thr_b", "thr_a", "thr_c"]);
    expect(togglePin(["thr_b", "thr_a", "thr_c"], "thr_a")).toEqual(["thr_b", "thr_c"]);
  });

  it("moves shortcuts in saved order, including when some are filtered out", () => {
    expect(movePin(["thr_a", "thr_hidden", "thr_b"], "thr_b", -1)).toEqual(["thr_a", "thr_b", "thr_hidden"]);
    expect(movePin(["thr_a", "thr_b"], "thr_a", -1)).toEqual(["thr_a", "thr_b"]);
    expect(movePin(["thr_a", "thr_b"], "unknown", 1)).toEqual(["thr_a", "thr_b"]);
  });
});
