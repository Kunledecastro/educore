import { describe, expect, it } from "vitest";
import {
  addDays,
  canEditRegister,
  daysBetween,
  diffRegister,
  mergeCounts,
  isSchoolDay,
  parseDateParam,
  registerState,
  summarizeAttendance,
} from "./attendance";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const year = { startDate: d("2026-09-01"), endDate: d("2027-07-31") };
const today = d("2026-10-14"); // a Wednesday

describe("canEditRegister", () => {
  const teacher = (date: string, editDays = 7) => canEditRegister({ date: d(date), today, isAdmin: false, editDays, year });
  const admin = (date: string) => canEditRegister({ date: d(date), today, isAdmin: true, editDays: 7, year });

  it("teachers can mark today and up to N days back", () => {
    expect(teacher("2026-10-14").allowed).toBe(true);
    expect(teacher("2026-10-07").allowed).toBe(true);
    expect(teacher("2026-10-06")).toEqual({ allowed: false, reason: "tooOld" });
  });
  it("0 days means today only", () => {
    expect(teacher("2026-10-14", 0).allowed).toBe(true);
    expect(teacher("2026-10-13", 0)).toEqual({ allowed: false, reason: "tooOld" });
  });
  it("nobody can mark the future — not even admins", () => {
    expect(teacher("2026-10-15")).toEqual({ allowed: false, reason: "future" });
    expect(admin("2026-10-15")).toEqual({ allowed: false, reason: "future" });
  });
  it("admins can correct any earlier date in the year", () => {
    expect(admin("2026-09-01").allowed).toBe(true);
  });
  it("dates outside the academic year are refused for everyone", () => {
    expect(admin("2026-08-31")).toEqual({ allowed: false, reason: "outsideYear" });
  });
});

describe("summarizeAttendance", () => {
  it("counts each status and the rate", () => {
    const s = summarizeAttendance(["PRESENT", "PRESENT", "LATE", "ABSENT"]);
    expect(s).toMatchObject({ present: 2, late: 1, absent: 1, excused: 0, marked: 4, rate: 75 });
  });
  it("late counts as attended", () => {
    expect(summarizeAttendance(["LATE", "LATE"]).rate).toBe(100);
  });
  it("excused absences don't lower the rate", () => {
    expect(summarizeAttendance(["PRESENT", "EXCUSED", "EXCUSED"]).rate).toBe(100);
    expect(summarizeAttendance(["PRESENT", "ABSENT", "EXCUSED"]).rate).toBe(50);
  });
  it("rounds to one decimal place", () => {
    expect(summarizeAttendance(["PRESENT", "PRESENT", "ABSENT"]).rate).toBe(66.7);
  });
  it("nothing to measure → null, not 0% or 100%", () => {
    expect(summarizeAttendance([]).rate).toBeNull();
    expect(summarizeAttendance(["EXCUSED"]).rate).toBeNull();
  });
});

describe("diffRegister", () => {
  const existing = [
    { studentId: "a", status: "PRESENT" as const, remark: null },
    { studentId: "b", status: "ABSENT" as const, remark: "Sick" },
  ];

  it("re-saving an unchanged register changes nothing", () => {
    expect(diffRegister(existing, existing)).toEqual([]);
  });
  it("finds new and changed entries only", () => {
    const changes = diffRegister(existing, [
      { studentId: "a", status: "PRESENT", remark: null },
      { studentId: "b", status: "EXCUSED", remark: "Sick" },
      { studentId: "c", status: "LATE", remark: null },
    ]);
    expect(changes.map((c) => `${c.kind}:${c.entry.studentId}`)).toEqual(["update:b", "create:c"]);
    expect(changes[0]).toMatchObject({ kind: "update", before: { status: "ABSENT" } });
  });
  it("treats a whitespace-only remark as no remark", () => {
    expect(diffRegister(existing, [{ studentId: "a", status: "PRESENT", remark: "   " }])).toEqual([]);
    expect(diffRegister([], [{ studentId: "z", status: "PRESENT", remark: "  hi " }])[0]?.entry.remark).toBe("hi");
  });
  it("a remark change alone is a change", () => {
    expect(diffRegister(existing, [{ studentId: "b", status: "ABSENT", remark: "Hospital" }])).toHaveLength(1);
  });
  it("students left out of a submission are not touched", () => {
    expect(diffRegister(existing, [])).toEqual([]);
  });
});

describe("registerState", () => {
  it("classifies a section's register for the day", () => {
    expect(registerState(0, 0)).toBe("empty");
    expect(registerState(30, 0)).toBe("notTaken");
    expect(registerState(30, 12)).toBe("partial");
    expect(registerState(30, 30)).toBe("taken");
  });
});

describe("dates", () => {
  it("weekends aren't school days", () => {
    expect(isSchoolDay(d("2026-10-17"))).toBe(false); // Saturday
    expect(isSchoolDay(d("2026-10-18"))).toBe(false); // Sunday
    expect(isSchoolDay(d("2026-10-19"))).toBe(true);
  });
  it("parses ?date= strictly", () => {
    expect(parseDateParam("2026-10-01", today).toISOString().slice(0, 10)).toBe("2026-10-01");
    for (const bad of ["2026-02-31", "yesterday", "", undefined, "2026-1-1"]) {
      expect(parseDateParam(bad, today)).toBe(today);
    }
    expect(parseDateParam(["2026-10-02", "x"], today).toISOString().slice(0, 10)).toBe("2026-10-02");
  });
  it("adds and counts days across month ends", () => {
    expect(addDays(d("2026-10-31"), 1).toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(daysBetween(d("2026-09-28"), d("2026-10-05"))).toBe(7);
  });
});

describe("mergeCounts", () => {
  it("adds counts and recomputes the rate from the totals (not an average of rates)", () => {
    const a = summarizeAttendance(["PRESENT", "PRESENT", "PRESENT", "ABSENT"]); // 75%
    const b = summarizeAttendance(["ABSENT"]); // 0%
    expect(mergeCounts([a, b])).toMatchObject({ present: 3, absent: 2, marked: 5, rate: 60 });
  });
  it("an empty list has no rate", () => {
    expect(mergeCounts([]).rate).toBeNull();
  });
});
