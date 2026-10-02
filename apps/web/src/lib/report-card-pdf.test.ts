import { describe, expect, it } from "vitest";
import { summarizeAttendance } from "./attendance";
import { DEFAULT_GRADE_BANDS } from "./grading";
import { buildSnapshot } from "./report-card";
import { fileSlug, renderReportCards } from "./report-card-pdf";
import { subjectTotal } from "./results";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const snapshot = (locale: string, name: string) =>
  buildSnapshot({
    now: new Date("2026-12-19T10:00:00Z"),
    school: { name: "Greenfield Academy", locale, dateStyle: "medium" },
    className: "Grade 5",
    year: { name: "2026/2027" },
    term: { name: "First term", startDate: d("2026-09-07"), endDate: d("2026-12-18") },
    nextTerm: { startDate: d("2027-01-05") },
    results: {
      subjects: [{ id: "eng", name: "English", code: "ENG" }],
      components: [{ id: "c1", name: "CA", weight: 40 }, { id: "c2", name: "Exam", weight: 60 }],
      subjectStats: { eng: { count: 6, average: 61.2, highest: 80, lowest: 40 } },
    },
    student: {
      id: "s1",
      firstName: name,
      lastName: "Ọlábísí",
      admissionNo: "GA-2026-0001",
      sectionId: "sec",
      sectionName: "A",
      subjects: { eng: { total: subjectTotal([{ weight: 40, maxScore: 40, score: 30 }, { weight: 60, maxScore: 60, score: 45 }]), grade: { grade: "A", remark: "Excellent" }, parts: [30, 45] } },
      average: 75,
      subjectCount: 1,
      incomplete: 0,
      position: 1,
      positionOutOf: 6,
    },
    attendance: summarizeAttendance(["PRESENT", "LATE"]),
    bands: DEFAULT_GRADE_BANDS,
    showPosition: true,
    comments: { teacher: "Ẹ ṣé — a good term.", teacherName: "Chinedu Eze", principal: "Keep it up." },
  });

describe("renderReportCards", () => {
  it("renders a multi-page PDF with the bundled Noto Sans font (needed for Ọ, ẹ, ṣ)", async () => {
    const pdf = await renderReportCards([snapshot("en-NG", "Adébáyọ̀"), snapshot("en-NG", "Ifẹ́olúwa")], "Grade 5 A");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdf.toString("latin1");
    expect(text).toMatch(/NotoSans/);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("renders in French for a French-speaking school", async () => {
    const pdf = await renderReportCards([snapshot("fr-SN", "Awa")], "x");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});

describe("fileSlug", () => {
  it("makes safe file names from names with accents", () => {
    expect(fileSlug("Adébáyọ̀ Ọlábísí")).toBe("adebayo-olabisi");
    expect(fileSlug("../../etc")).toBe("etc");
    expect(fileSlug("???")).toBe("report-card");
  });
});
