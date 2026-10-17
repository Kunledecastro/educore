import { describe, expect, it } from "vitest";
import { MODULES, type Module } from "./entitlements";
import { attendanceByTerm, canDownloadProfile, feeRows, homeworkSummary, profileSections, sectionForYear, toMinor, type HomeworkItem } from "./pupil-profile";

const ALL = new Set<Module>(MODULES);
const NONE = new Set<Module>();

describe("who gets which sections", () => {
  it("school admins get everything their plan includes", () => {
    expect(profileSections("SCHOOL_ADMIN", ALL)).toEqual(["details", "guardians", "attendance", "results", "homework", "fees", "health"]);
  });

  it("teachers never get fees", () => {
    expect(profileSections("TEACHER", ALL)).toEqual(["details", "guardians", "attendance", "results", "homework", "health"]);
  });

  it("bursars get details, guardians and fees only — no results, attendance or health", () => {
    expect(profileSections("ACCOUNTANT", ALL)).toEqual(["details", "guardians", "fees"]);
  });

  it("the nurse gets details, guardians and health alerts only", () => {
    expect(profileSections("SCHOOL_NURSE", ALL)).toEqual(["details", "guardians", "health"]);
  });

  it("parents get their child's record but not the list of other guardians", () => {
    expect(profileSections("PARENT", ALL)).toEqual(["details", "attendance", "results", "homework", "fees", "health"]);
  });

  it("pupils, the platform team and unknown roles get nothing", () => {
    for (const role of ["STUDENT", "PLATFORM_ADMIN", "SOMETHING"]) {
      expect(profileSections(role, ALL)).toEqual([]);
      expect(canDownloadProfile(role)).toBe(false);
    }
  });

  it("modules outside the plan are left out", () => {
    expect(profileSections("SCHOOL_ADMIN", NONE)).toEqual(["details", "guardians"]);
    const starter = new Set<Module>(["attendance", "assessments", "timetable", "messaging"]);
    expect(profileSections("SCHOOL_ADMIN", starter)).toEqual(["details", "guardians", "attendance", "results"]);
    expect(profileSections("ACCOUNTANT", starter)).toEqual(["details", "guardians"]);
  });

  it("EduCore support working as a school admin never gets health alerts", () => {
    expect(profileSections("SCHOOL_ADMIN", ALL, { impersonating: true })).not.toContain("health");
  });
});

describe("which class a pupil was in, in a past year", () => {
  it("uses the section most of the year's registers were taken in", () => {
    expect(sectionForYear({ attendanceSectionIds: ["a", "b", "b", null], markSectionIds: ["a"] })).toBe("b");
  });

  it("falls back to where marks were entered", () => {
    expect(sectionForYear({ attendanceSectionIds: [null], markSectionIds: ["c", "c"] })).toBe("c");
  });

  it("is null when the year left no trace", () => {
    expect(sectionForYear({ attendanceSectionIds: [], markSectionIds: [] })).toBeNull();
  });
});

describe("attendance by term", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const terms = [
    { id: "t1", name: "First", startDate: d("2026-09-07"), endDate: d("2026-12-18") },
    { id: "t2", name: "Second", startDate: d("2027-01-11"), endDate: d("2027-04-02") },
    { id: "t3", name: "Third", startDate: d("2027-04-26"), endDate: d("2027-07-23") },
  ];

  it("splits by term (dates inclusive), skips empty terms and totals the year", () => {
    const r = attendanceByTerm(
      [
        { date: d("2026-09-07"), status: "PRESENT" },
        { date: d("2026-12-18"), status: "ABSENT" },
        { date: d("2027-01-11"), status: "LATE" },
        { date: d("2027-01-04"), status: "PRESENT" }, // holiday class: year total only
      ],
      terms,
    );
    expect(r.terms.map((x) => [x.termId, x.counts.marked])).toEqual([["t1", 2], ["t2", 1]]);
    expect(r.terms[0]!.counts.rate).toBe(50);
    expect(r.year).toMatchObject({ present: 2, absent: 1, late: 1, marked: 4, rate: 75 });
  });
});

describe("homework summary", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const past = new Date("2026-10-01T12:00:00Z");
  const future = new Date("2026-10-30T12:00:00Z");
  const items: HomeworkItem[] = [
    { dueAt: past, maxScore: 20, marksReleased: true, submission: { status: "MARKED", isLate: false, isMissing: false, score: 15 } }, // 75%
    { dueAt: past, maxScore: 10, marksReleased: false, submission: { status: "MARKED", isLate: true, isMissing: false, score: 5 } }, // 50%, not released
    { dueAt: past, maxScore: null, marksReleased: false, submission: null }, // not handed in
    { dueAt: past, maxScore: 10, marksReleased: true, submission: { status: "MARKED", isLate: false, isMissing: true, score: 0 } }, // recorded missing
    { dueAt: future, maxScore: 10, marksReleased: false, submission: null }, // not due yet
  ];

  it("counts like the class completion report", () => {
    expect(homeworkSummary(items, now, { family: false })).toEqual({ set: 5, due: 4, handedIn: 2, late: 1, missing: 2, rate: 50, averagePercent: 62.5, marked: 2 });
  });

  it("families only see released marks", () => {
    const s = homeworkSummary(items, now, { family: true });
    expect(s.averagePercent).toBe(75);
    expect(s.marked).toBe(1);
  });

  it("nothing due yet has no completion rate", () => {
    expect(homeworkSummary([items[4]!], now, { family: false })).toMatchObject({ due: 0, missing: 0, rate: null, averagePercent: null });
  });
});

describe("fees", () => {
  it("adds up in kobo, skips cancelled bills and never shows a negative balance", () => {
    const r = feeRows([
      { label: "First", status: "PARTIALLY_PAID", subtotal: "150000.00", discountTotal: "15000.00", totalDue: "135000.00", amountPaid: "100000.10" },
      { label: "Cancelled", status: "CANCELLED", subtotal: "999.00", discountTotal: "0", totalDue: "999.00", amountPaid: "0" },
      { label: "Second", status: "PAID", subtotal: "120000.00", discountTotal: "0", totalDue: "120000.00", amountPaid: "120500.00" },
    ]);
    expect(r.rows.map((x) => x.label)).toEqual(["First", "Second"]);
    expect(r.rows[0]).toMatchObject({ billedMinor: 15_000_000, discountMinor: 1_500_000, paidMinor: 10_000_010, balanceMinor: 3_499_990 });
    expect(r.rows[1]!.balanceMinor).toBe(0);
    expect(r.total).toEqual({ billedMinor: 27_000_000, discountMinor: 1_500_000, paidMinor: 22_050_010, balanceMinor: 3_499_990 });
  });

  it("converts money without float drift", () => {
    expect(toMinor("0.29")).toBe(29);
    expect(toMinor(1234.56)).toBe(123456);
    expect(toMinor(null)).toBe(0);
  });
});
