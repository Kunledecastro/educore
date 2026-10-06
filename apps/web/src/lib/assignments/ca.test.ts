import { describe, expect, it } from "vitest";
import { caScores } from "./ca";

describe("caScores", () => {
  const m = (entries: [string, number][]) => new Map(entries);

  it("scales one assignment to the gradebook column", () => {
    const r = caScores(["ada", "chi"], [{ maxScore: 20, scores: m([["ada", 15], ["chi", 20]]) }], 10);
    expect(r.get("ada")).toEqual({ score: 7.5, from: 1 });
    expect(r.get("chi")).toEqual({ score: 10, from: 1 });
  });

  it("averages several assignments by percentage, not raw marks", () => {
    // 5/10 = 50%, 18/20 = 90% → 70% of 15 = 10.5
    const r = caScores(["ada"], [{ maxScore: 10, scores: m([["ada", 5]]) }, { maxScore: 20, scores: m([["ada", 18]]) }], 15);
    expect(r.get("ada")).toEqual({ score: 10.5, from: 2 });
  });

  it("leaves out unmarked work; no marked work at all → no score", () => {
    const r = caScores(["ada", "bola"], [{ maxScore: 10, scores: m([["ada", 8]]) }, { maxScore: 10, scores: m([]) }], 10);
    expect(r.get("ada")).toEqual({ score: 8, from: 1 });
    expect(r.get("bola")).toBeNull();
  });

  it("'not handed in' (0) counts, and results round to 2 decimals within the column", () => {
    const r = caScores(["ada"], [{ maxScore: 3, scores: m([["ada", 1]]) }, { maxScore: 10, scores: m([["ada", 0]]) }], 10);
    expect(r.get("ada")).toEqual({ score: 1.67, from: 2 });
    expect(caScores(["x"], [{ maxScore: 10, scores: m([["x", 12]]) }], 10).get("x")).toEqual({ score: 10, from: 1 });
  });
});
