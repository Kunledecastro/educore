import { describe, expect, it } from "vitest";
import { academicYearSchema, assignmentSchema, classSchema, deleteBlockers, sectionSchema, subjectSchema } from "./academics";

function errorsOf(result: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("academicYearSchema", () => {
  it("accepts a normal school year and returns UTC-midnight dates", () => {
    const r = academicYearSchema.parse({ name: " 2027/2028 ", startDate: "2027-09-01", endDate: "2028-07-31" });
    expect(r.name).toBe("2027/2028");
    expect(r.startDate.toISOString()).toBe("2027-09-01T00:00:00.000Z");
  });

  it("rejects end before start, impossible dates and absurd lengths", () => {
    expect(errorsOf(academicYearSchema.safeParse({ name: "X", startDate: "2027-09-01", endDate: "2027-08-01" }))).toEqual({
      endDate: "validation.endBeforeStart",
    });
    expect(errorsOf(academicYearSchema.safeParse({ name: "X", startDate: "2027-02-31", endDate: "2027-08-01" }))).toMatchObject({
      startDate: "validation.invalidDate",
    });
    expect(errorsOf(academicYearSchema.safeParse({ name: "X", startDate: "2027-09-01", endDate: "2062-07-31" }))).toEqual({
      endDate: "validation.yearTooLong",
    });
  });

  it("requires a name and caps its length", () => {
    expect(errorsOf(academicYearSchema.safeParse({ name: "  ", startDate: "2027-09-01", endDate: "2028-07-31" }))).toEqual({
      name: "validation.required",
    });
    expect(errorsOf(academicYearSchema.safeParse({ name: "x".repeat(41), startDate: "2027-09-01", endDate: "2028-07-31" }))).toEqual({
      name: "validation.tooLong",
    });
  });
});

describe("classSchema / sectionSchema", () => {
  it("defaults order to 0 and parses numeric strings", () => {
    expect(classSchema.parse({ academicYearId: "y1", name: "JSS 1", order: "" }).order).toBe(0);
    expect(classSchema.parse({ academicYearId: "y1", name: "JSS 1", order: "7" }).order).toBe(7);
  });
  it("rejects non-integer or out-of-range numbers", () => {
    expect(errorsOf(classSchema.safeParse({ academicYearId: "y1", name: "A", order: "1.5" }))).toEqual({ order: "validation.integer" });
    expect(errorsOf(sectionSchema.safeParse({ classId: "c1", name: "A", capacity: "0" }))).toEqual({ capacity: "validation.outOfRange" });
    expect(sectionSchema.parse({ classId: "c1", name: "A", capacity: "" }).capacity).toBeUndefined();
  });
});

describe("subjectSchema", () => {
  it("uppercases codes and enforces the format", () => {
    expect(subjectSchema.parse({ name: "Mathematics", code: "math-1" }).code).toBe("MATH-1");
    expect(errorsOf(subjectSchema.safeParse({ name: "Maths", code: "MA TH" }))).toEqual({ code: "validation.codeFormat" });
    expect(errorsOf(subjectSchema.safeParse({ name: "Maths", code: "-MATH" }))).toEqual({ code: "validation.codeFormat" });
  });
});

describe("assignmentSchema", () => {
  it("requires all three ids", () => {
    expect(Object.keys(errorsOf(assignmentSchema.safeParse({ sectionId: "", subjectId: "s", teacherId: "" })))).toEqual([
      "sectionId",
      "teacherId",
    ]);
  });
});

describe("deleteBlockers", () => {
  it("never allows deleting the active year", () => {
    expect(deleteBlockers({ isActiveYear: true })).toEqual(["activeYear"]);
  });
  it("lists every kind of real record still attached", () => {
    expect(deleteBlockers({ students: 3, invoices: 1, classes: 0 })).toEqual(["students", "invoices"]);
  });
  it("is empty when nothing is attached", () => {
    expect(deleteBlockers({})).toEqual([]);
  });
});
