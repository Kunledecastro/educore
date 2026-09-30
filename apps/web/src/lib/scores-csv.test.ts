import { describe, expect, it } from "vitest";
import { parseCsv } from "./imports/csv";
import { mapScoresCsv } from "./scores-csv";

const students = [
  { id: "s1", admissionNo: "GA-2026-0001" },
  { id: "s2", admissionNo: "GA-2026-0002" },
];
const components = [
  { id: "c1", name: "CA1", maxScore: 20 },
  { id: "c2", name: "Exam", maxScore: 60 },
];
const run = (csv: string) => mapScoresCsv(parseCsv(csv), students, components);

describe("mapScoresCsv", () => {
  it("reads the gradebook's own export shape", () => {
    const r = run("admission_no,last_name,first_name,CA1,Exam,total,grade\nGA-2026-0001,Okonkwo,Amaka,15,45,60,B\nGA-2026-0002,Balogun,Tunde,18,52,70,A\n");
    expect(r.issues).toEqual([]);
    expect(r.ignoredColumns).toEqual([]);
    expect(r.cells).toEqual([
      { studentId: "s1", componentId: "c1", score: 15 },
      { studentId: "s1", componentId: "c2", score: 45 },
      { studentId: "s2", componentId: "c1", score: 18 },
      { studentId: "s2", componentId: "c2", score: 52 },
    ]);
  });

  it("matches headers loosely and admission numbers case-insensitively", () => {
    const r = run("Admission No.;ca1;EXAM\nga-2026-0001;12,5;40\n");
    expect(r.cells).toContainEqual({ studentId: "s1", componentId: "c1", score: 12.5 });
    expect(r.issues).toEqual([]);
  });

  it("blank cells leave scores alone (never clear them)", () => {
    const r = run("admission_no,CA1,Exam\nGA-2026-0001,,45\nGA-2026-0002,-,\n");
    expect(r.cells).toEqual([{ studentId: "s1", componentId: "c2", score: 45 }]);
  });

  it("reports unknown and repeated students, non-numbers and out-of-range scores with row numbers", () => {
    const r = run("admission_no,CA1,Exam\nGA-9999,10,10\nGA-2026-0001,abc,61\nGA-2026-0001,1,1\n");
    expect(r.issues).toEqual([
      { row: 2, code: "unknownStudent", value: "GA-9999" },
      { row: 3, code: "notANumber", column: "CA1", value: "abc" },
      { row: 3, code: "outOfRange", column: "Exam", value: "61", max: 60 },
      { row: 4, code: "duplicateStudent", value: "GA-2026-0001" },
    ]);
    expect(r.cells).toEqual([]);
  });

  it("rejects negative or 3-decimal scores", () => {
    expect(run("admission_no,CA1\nGA-2026-0001,-3\n").issues[0]).toMatchObject({ code: "notANumber" });
    expect(run("admission_no,CA1\nGA-2026-0001,1.234\n").issues[0]).toMatchObject({ code: "outOfRange" });
  });

  it("needs an admission number column and at least one component column", () => {
    expect(run("name,CA1\nAmaka,10\n").issues).toEqual([{ row: 0, code: "noAdmissionColumn" }]);
    expect(run("admission_no,Homework\nGA-2026-0001,10\n").issues).toEqual([{ row: 0, code: "noComponentColumns" }]);
  });

  it("lists columns it didn't recognise", () => {
    expect(run("admission_no,CA1,Homework\nGA-2026-0001,10,3\n").ignoredColumns).toEqual(["Homework"]);
  });
});
