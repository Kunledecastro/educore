import { describe, expect, it } from "vitest";
import {
  bandRanges,
  DEFAULT_GRADE_BANDS,
  DEFAULT_SCORE_COMPONENTS,
  gradeFor,
  roundScore,
  validateGradeBands,
  validateScoreComponents,
} from "./grading";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("roundScore", () => {
  it("rounds half up at one decimal place, without float artefacts", () => {
    expect(roundScore(69.95)).toBe(70);
    expect(roundScore(69.94)).toBe(69.9);
    expect(roundScore(1.005, 2)).toBe(1.01); // the classic toFixed trap
    expect(roundScore(0.1 + 0.2)).toBe(0.3);
    expect(roundScore(44.45)).toBe(44.5);
  });
  it("leaves whole numbers alone", () => {
    expect(roundScore(70)).toBe(70);
    expect(roundScore(0)).toBe(0);
  });
});

describe("gradeFor (default scale)", () => {
  const g = (total: number | null) => gradeFor(total, DEFAULT_GRADE_BANDS)?.grade ?? null;

  it("puts band boundaries in the higher band", () => {
    expect(g(70)).toBe("A");
    expect(g(69.9)).toBe("B");
    expect(g(60)).toBe("B");
    expect(g(45)).toBe("D");
    expect(g(44.9)).toBe("E");
    expect(g(40)).toBe("E");
    expect(g(39.9)).toBe("F");
  });

  it("decides on the rounded total: 69.95 shows as 70.0, so it's an A", () => {
    expect(g(69.95)).toBe("A");
    expect(g(69.94)).toBe("B");
  });

  it("covers the extremes", () => {
    expect(g(100)).toBe("A");
    expect(g(0)).toBe("F");
  });

  it("returns null for a missing score rather than failing someone", () => {
    expect(g(null)).toBeNull();
    expect(gradeFor(Number.NaN, DEFAULT_GRADE_BANDS)).toBeNull();
  });

  it("doesn't depend on the order the bands were entered", () => {
    const shuffled = [...DEFAULT_GRADE_BANDS].reverse();
    expect(gradeFor(65, shuffled)?.grade).toBe("B");
  });

  it("returns the remark with the grade", () => {
    expect(gradeFor(82, DEFAULT_GRADE_BANDS)?.remark).toBe("Excellent");
  });

  it("with a scale that doesn't start at 0, a very low score has no grade (validation prevents saving that)", () => {
    expect(gradeFor(10, [{ minScore: 50, grade: "P" }])).toBeNull();
  });
});

describe("validateGradeBands", () => {
  it("accepts the default scale", () => {
    expect(validateGradeBands(DEFAULT_GRADE_BANDS)).toEqual([]);
  });
  it("rejects an empty scale", () => {
    expect(codes(validateGradeBands([]))).toEqual(["empty"]);
  });
  it("requires a band starting at 0 so every score gets a grade", () => {
    expect(codes(validateGradeBands([{ minScore: 50, grade: "P" }]))).toContain("noZeroBand");
  });
  it("flags duplicates, blanks and out-of-range minimums, pointing at the row", () => {
    const issues = validateGradeBands([
      { minScore: 0, grade: "F" },
      { minScore: 0, grade: "E" },
      { minScore: 50, grade: "f" },
      { minScore: 101, grade: "A+" },
      { minScore: 60, grade: "  " },
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        { code: "duplicateMin", index: 1 },
        { code: "duplicateGrade", index: 2 },
        { code: "outOfRange", index: 3 },
        { code: "blankGrade", index: 4 },
      ]),
    );
  });
});

describe("bandRanges", () => {
  it("shows each band's range for display", () => {
    const r = bandRanges(DEFAULT_GRADE_BANDS).map((b) => `${b.grade} ${b.minScore}–${b.maxScore}`);
    expect(r).toEqual(["A 70–100", "B 60–69.9", "C 50–59.9", "D 45–49.9", "E 40–44.9", "F 0–39.9"]);
  });
});

describe("validateScoreComponents", () => {
  it("accepts the default CA1 20 + CA2 20 + Exam 60", () => {
    expect(validateScoreComponents(DEFAULT_SCORE_COMPONENTS)).toEqual([]);
  });
  it("requires components to add up to exactly 100", () => {
    expect(validateScoreComponents([{ name: "CA", weight: 30 }, { name: "Exam", weight: 60 }])).toEqual([{ code: "sumNot100", sum: 90 }]);
  });
  it("tolerates decimal weights that add up to 100", () => {
    expect(validateScoreComponents([
      { name: "T1", weight: 33.3 },
      { name: "T2", weight: 33.3 },
      { name: "T3", weight: 33.4 },
    ])).toEqual([]);
  });
  it("rejects zero/negative weights, blank and repeated names", () => {
    expect(codes(validateScoreComponents([
      { name: "Exam", weight: 100 },
      { name: "exam", weight: 0 },
      { name: " ", weight: -5 },
    ]))).toEqual(expect.arrayContaining(["duplicateName", "badWeight", "blankName"]));
  });
  it("rejects an empty list", () => {
    expect(codes(validateScoreComponents([]))).toEqual(["empty"]);
  });
});
