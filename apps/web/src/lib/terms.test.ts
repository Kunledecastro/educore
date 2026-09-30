import { describe, expect, it } from "vitest";
import { resolveCurrentTerm, suggestTerms, validateTerm } from "./terms";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const year = { startDate: d("2026-09-07"), endDate: d("2027-07-23") };
const first = { id: "t1", name: "First term", startDate: d("2026-09-07"), endDate: d("2026-12-18") };
const second = { id: "t2", name: "Second term", startDate: d("2027-01-05"), endDate: d("2027-04-09") };

const codes = (i: { code: string }[]) => i.map((x) => x.code);

describe("validateTerm", () => {
  it("accepts a term inside the year that doesn't overlap", () => {
    expect(validateTerm({ name: "Third term", startDate: d("2027-04-26"), endDate: d("2027-07-23") }, year, [first, second])).toEqual([]);
  });
  it("rejects an end date on or before the start", () => {
    expect(codes(validateTerm({ name: "X", startDate: d("2027-05-01"), endDate: d("2027-05-01") }, year, []))).toContain("endBeforeStart");
  });
  it("rejects dates outside the academic year", () => {
    expect(codes(validateTerm({ name: "X", startDate: d("2026-08-01"), endDate: d("2026-10-01") }, year, []))).toContain("outsideYear");
    expect(codes(validateTerm({ name: "X", startDate: d("2027-07-01"), endDate: d("2027-08-01") }, year, []))).toContain("outsideYear");
  });
  it("rejects overlaps and names the other term", () => {
    expect(validateTerm({ name: "X", startDate: d("2026-12-01"), endDate: d("2027-01-10") }, year, [first, second])).toContainEqual({
      code: "overlaps",
      otherName: "First term",
    });
  });
  it("treats a shared boundary day as an overlap, but back-to-back days are fine", () => {
    expect(codes(validateTerm({ name: "X", startDate: d("2026-12-18"), endDate: d("2027-01-02") }, year, [first]))).toContain("overlaps");
    expect(validateTerm({ name: "X", startDate: d("2026-12-19"), endDate: d("2027-01-02") }, year, [first])).toEqual([]);
  });
  it("ignores itself when editing", () => {
    expect(validateTerm({ ...first, endDate: d("2026-12-20") }, year, [first, second])).toEqual([]);
  });
});

describe("suggestTerms", () => {
  it("splits the year into three back-to-back terms covering it exactly", () => {
    const [a, b, c] = suggestTerms(year);
    expect(a!.startDate.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(c!.endDate.toISOString().slice(0, 10)).toBe("2027-07-23");
    expect(b!.startDate.getTime() - a!.endDate.getTime()).toBe(86_400_000);
    expect(c!.startDate.getTime() - b!.endDate.getTime()).toBe(86_400_000);
    // Suggestions always pass validation against each other.
    const all = suggestTerms(year);
    all.forEach((t, i) => expect(validateTerm(t, year, all.filter((_, j) => j !== i))).toEqual([]));
  });
  it("supports another number of terms", () => {
    expect(suggestTerms(year, ["Semester 1", "Semester 2"])).toHaveLength(2);
  });
});

describe("resolveCurrentTerm", () => {
  it("prefers the term the school marked current", () => {
    expect(resolveCurrentTerm([first, { ...second, isCurrent: true }], d("2026-10-01"))?.id).toBe("t2");
  });
  it("otherwise picks the term containing today", () => {
    expect(resolveCurrentTerm([first, second], d("2027-02-01"))?.id).toBe("t2");
  });
  it("during a holiday, the term that just ended", () => {
    expect(resolveCurrentTerm([first, second], d("2026-12-25"))?.id).toBe("t1");
  });
  it("before the year starts, the first term; no terms → null", () => {
    expect(resolveCurrentTerm([second, first], d("2026-08-01"))?.id).toBe("t1");
    expect(resolveCurrentTerm([], d("2026-08-01"))).toBeNull();
  });
});
