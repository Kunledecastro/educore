import { describe, expect, it } from "vitest";
import { summarizeAttendance } from "./attendance";
import { DEFAULT_GRADE_BANDS } from "./grading";
import { buildSnapshot, cardState, parseSnapshot, type SnapshotInput } from "./report-card";
import { subjectTotal } from "./results";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const total = (a: number | null, b: number | null) => subjectTotal([{ weight: 40, maxScore: 40, score: a }, { weight: 60, maxScore: 60, score: b }]);

const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  now: new Date("2026-12-19T10:00:00Z"),
  school: { name: "Greenfield Academy", locale: "en-NG", dateStyle: "medium" },
  className: "Grade 5",
  year: { name: "2026/2027" },
  term: { name: "First term", startDate: d("2026-09-07"), endDate: d("2026-12-18") },
  nextTerm: { startDate: d("2027-01-05") },
  results: {
    subjects: [
      { id: "eng", name: "English", code: "ENG" },
      { id: "math", name: "Mathematics", code: "MATH" },
      { id: "sci", name: "Science", code: "SCI" },
    ],
    components: [{ id: "c1", name: "Midterm", weight: 40 }, { id: "c2", name: "Exam", weight: 60 }],
    subjectStats: { eng: { count: 6, average: 61.2, highest: 80, lowest: 40 }, math: { count: 6, average: 70, highest: 90, lowest: 50 } },
  },
  student: {
    id: "s1",
    firstName: "Amaka",
    lastName: "Okonkwo",
    admissionNo: "GA-2026-0001",
    sectionId: "sec",
    sectionName: "A",
    subjects: {
      eng: { total: total(30, 45), grade: { grade: "A", remark: "Excellent" }, parts: [30, 45] },
      math: { total: total(20, null), grade: null, parts: [20, null] },
    },
    average: 75,
    subjectCount: 1,
    incomplete: 1,
    position: 2,
    positionOutOf: 6,
  },
  attendance: summarizeAttendance(["PRESENT", "PRESENT", "ABSENT", "LATE"]),
  bands: DEFAULT_GRADE_BANDS,
  showPosition: false,
  comments: { teacher: "  A hard-working pupil.  ", teacherName: "Chinedu Eze", principal: "   " },
  ...over,
});

describe("buildSnapshot", () => {
  it("freezes everything the card shows, and the result is a valid snapshot", () => {
    const s = buildSnapshot(input());
    expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(s.student).toEqual({ name: "Amaka Okonkwo", admissionNo: "GA-2026-0001", className: "Grade 5", sectionName: "A" });
    expect(s.period).toEqual({ year: "2026/2027", term: "First term", from: "2026-09-07", to: "2026-12-18", nextTermStarts: "2027-01-05" });
    expect(s.attendance).toMatchObject({ present: 2, absent: 1, late: 1, rate: 75 });
  });

  it("lists only subjects the student takes, with component marks, grade and class average", () => {
    const s = buildSnapshot(input());
    expect(s.subjects.map((x) => x.name)).toEqual(["English", "Mathematics"]);
    expect(s.subjects[0]).toEqual({ name: "English", parts: [30, 45], total: 75, complete: true, grade: "A", remark: "Excellent", classAverage: 61.2 });
    // Incomplete subject: partial total shown, no grade.
    expect(s.subjects[1]).toMatchObject({ total: 20, complete: false, grade: null });
  });

  it("hides position unless the school shows positions", () => {
    expect(buildSnapshot(input()).summary.position).toBeNull();
    expect(buildSnapshot(input({ showPosition: true })).summary).toMatchObject({ position: 2, positionOutOf: 6 });
  });

  it("trims comments and drops blank ones", () => {
    expect(buildSnapshot(input()).comments).toEqual({ teacher: "A hard-working pupil.", teacherName: "Chinedu Eze", principal: null });
  });

  it("includes the grading key and handles a last term with no next term", () => {
    const s = buildSnapshot(input({ nextTerm: null }));
    expect(s.period.nextTermStarts).toBeNull();
    expect(s.gradingKey[0]).toEqual({ grade: "A", minScore: 70, maxScore: 100, remark: "Excellent" });
  });
});

describe("parseSnapshot", () => {
  it("rejects malformed or unknown-version data instead of drawing a broken card", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ v: 2 })).toBeNull();
    expect(parseSnapshot({ ...buildSnapshot(input()), subjects: "x" })).toBeNull();
  });
});

describe("cardState", () => {
  const snap = buildSnapshot(input());
  const gen = new Date("2026-12-19T10:00:00Z");
  it("not generated, ready, or outdated after a later comment change", () => {
    expect(cardState(null)).toBe("notGenerated");
    expect(cardState({ status: "PENDING", generatedAt: null, updatedAt: gen, snapshot: null })).toBe("notGenerated");
    expect(cardState({ status: "READY", generatedAt: gen, updatedAt: gen, snapshot: snap })).toBe("ready");
    expect(cardState({ status: "READY", generatedAt: gen, updatedAt: new Date(gen.getTime() + 60_000), snapshot: snap })).toBe("outdated");
  });
  it("a READY card with a broken snapshot counts as not generated", () => {
    expect(cardState({ status: "READY", generatedAt: gen, updatedAt: gen, snapshot: { v: 9 } })).toBe("notGenerated");
  });
});
