import { describe, expect, it } from "vitest";
import { DEFAULT_GRADE_BANDS } from "./grading";
import { contribution, gradeForTotal, isValidScore, rank, stats, studentAverage, subjectTotal } from "./results";

// CA1 20 + CA2 20 + Exam 60, each marked out of its own weight.
const cells = (ca1: number | null, ca2: number | null, exam: number | null) => [
  { weight: 20, maxScore: 20, score: ca1 },
  { weight: 20, maxScore: 20, score: ca2 },
  { weight: 60, maxScore: 60, score: exam },
];

describe("contribution", () => {
  it("scales a score marked out of maxScore to the component weight", () => {
    expect(contribution({ weight: 20, maxScore: 50, score: 40 })).toBe(16);
    expect(contribution({ weight: 40, maxScore: 100, score: 75 })).toBe(30); // old "Midterm out of 100" worth 40
  });
  it("unscored → null (never 0)", () => {
    expect(contribution({ weight: 20, maxScore: 20, score: null })).toBeNull();
  });
});

describe("subjectTotal", () => {
  it("adds the components", () => {
    expect(subjectTotal(cells(15, 18, 45))).toEqual({ total: 78, complete: true, scoredCount: 3 });
  });
  it("rounds to one decimal place", () => {
    // 13/20*20 + 14.5/20*20 + 41.33/60*60 = 68.83 → 68.8
    expect(subjectTotal(cells(13, 14.5, 41.33)).total).toBe(68.8);
  });
  it("is incomplete while any component is missing — and gets no grade", () => {
    const t = subjectTotal(cells(15, 18, null));
    expect(t).toEqual({ total: 33, complete: false, scoredCount: 2 });
    expect(gradeForTotal(t, DEFAULT_GRADE_BANDS)).toBeNull();
  });
  it("nothing scored → no total", () => {
    expect(subjectTotal(cells(null, null, null))).toEqual({ total: null, complete: false, scoredCount: 0 });
  });
  it("zero is a real score", () => {
    expect(subjectTotal(cells(0, 0, 0))).toEqual({ total: 0, complete: true, scoredCount: 3 });
  });
  it("grades complete totals with the school's scale", () => {
    expect(gradeForTotal(subjectTotal(cells(15, 18, 45)), DEFAULT_GRADE_BANDS)?.grade).toBe("A");
    expect(gradeForTotal(subjectTotal(cells(10, 10, 19)), DEFAULT_GRADE_BANDS)?.grade).toBe("F");
  });
});

describe("isValidScore", () => {
  it("accepts 0 to max with up to 2 decimals", () => {
    expect(isValidScore(0, 20)).toBe(true);
    expect(isValidScore(20, 20)).toBe(true);
    expect(isValidScore(12.75, 20)).toBe(true);
  });
  it("rejects negatives, over-max, 3 decimals and NaN", () => {
    expect(isValidScore(-1, 20)).toBe(false);
    expect(isValidScore(20.5, 20)).toBe(false);
    expect(isValidScore(12.345, 20)).toBe(false);
    expect(isValidScore(Number.NaN, 20)).toBe(false);
  });
});

describe("stats", () => {
  it("average, highest, lowest over present values", () => {
    expect(stats([78, 64, null, 91])).toEqual({ count: 3, average: 77.7, highest: 91, lowest: 64 });
  });
  it("empty → nulls", () => {
    expect(stats([null, undefined])).toEqual({ count: 0, average: null, highest: null, lowest: null });
  });
});

describe("rank", () => {
  it("shares positions on ties and skips the next (1, 2, 2, 4)", () => {
    const r = rank([
      { key: "a", value: 90 },
      { key: "b", value: 85 },
      { key: "c", value: 85 },
      { key: "d", value: 70 },
    ]);
    expect([...r.entries()]).toEqual([["a", 1], ["b", 2], ["c", 2], ["d", 4]]);
  });
  it("ties on the displayed (1 d.p.) value", () => {
    const r = rank([{ key: "a", value: 72.44 }, { key: "b", value: 72.36 }]);
    expect(r.get("a")).toBe(1);
    expect(r.get("b")).toBe(1);
  });
  it("students with no value get no position", () => {
    const r = rank([{ key: "a", value: null }, { key: "b", value: 50 }]);
    expect(r.has("a")).toBe(false);
    expect(r.get("b")).toBe(1);
  });
});

describe("studentAverage", () => {
  it("averages complete subjects only and counts incomplete ones", () => {
    const result = studentAverage([subjectTotal(cells(15, 18, 45)), subjectTotal(cells(10, 12, 38)), subjectTotal(cells(15, null, null))]);
    expect(result).toEqual({ average: 69, subjects: 2, incomplete: 1 });
  });
  it("no complete subjects → no average", () => {
    expect(studentAverage([subjectTotal(cells(null, null, null))]).average).toBeNull();
  });
});
