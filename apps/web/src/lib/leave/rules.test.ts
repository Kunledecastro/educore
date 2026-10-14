import { describe, expect, it } from "vitest";
import { balance, checkRequest, day, leaveRequestSchema, monthDays, overlaps, workingDays } from "./rules";

const year = { startDate: day("2026-09-01"), endDate: day("2027-07-31") };
const base = { year, typeActive: true, allowance: 20, taken: 0, pending: 0, others: [] };

describe("staff leave rules (Phase 8.2)", () => {
  it("counts working days, Monday to Friday, both ends included", () => {
    expect(workingDays(day("2026-10-19"), day("2026-10-23"))).toBe(5); // Mon–Fri
    expect(workingDays(day("2026-10-19"), day("2026-10-26"))).toBe(6); // into next Monday
    expect(workingDays(day("2026-10-24"), day("2026-10-25"))).toBe(0); // a weekend
    expect(workingDays(day("2026-10-21"), day("2026-10-21"))).toBe(1);
    expect(workingDays(day("2026-10-23"), day("2026-10-19"))).toBe(0);
  });

  it("pending requests count against what's left", () => {
    expect(balance(20, 5, 3)).toEqual({ allowance: 20, taken: 5, pending: 3, left: 12 });
    expect(balance(5, 4, 3).left).toBe(0);
  });

  it("refuses weekends only, dates outside the school year, overlaps, a switched-off type, and going over the balance", () => {
    expect(checkRequest({ ...base, start: day("2026-10-19"), end: day("2026-10-23") })).toEqual({ refusal: null, days: 5 });
    expect(checkRequest({ ...base, start: day("2026-10-24"), end: day("2026-10-25") }).refusal).toBe("noWorkingDays");
    expect(checkRequest({ ...base, start: day("2027-07-30"), end: day("2027-08-03") }).refusal).toBe("outsideYear");
    expect(checkRequest({ ...base, start: day("2026-10-19"), end: day("2026-10-23"), others: [{ start: day("2026-10-23"), end: day("2026-10-27") }] }).refusal).toBe("overlap");
    expect(checkRequest({ ...base, typeActive: false, start: day("2026-10-19"), end: day("2026-10-19") }).refusal).toBe("typeInactive");
    expect(checkRequest({ ...base, taken: 14, pending: 2, start: day("2026-10-19"), end: day("2026-10-23") }).refusal).toBe("balance"); // 5 > 4 left
    expect(checkRequest({ ...base, taken: 14, pending: 1, start: day("2026-10-19"), end: day("2026-10-23") }).refusal).toBeNull(); // exactly 5 left
  });

  it("overlap includes touching on the same day", () => {
    expect(overlaps({ start: day("2026-10-19"), end: day("2026-10-20") }, { start: day("2026-10-20"), end: day("2026-10-22") })).toBe(true);
    expect(overlaps({ start: day("2026-10-19"), end: day("2026-10-19") }, { start: day("2026-10-20"), end: day("2026-10-22") })).toBe(false);
  });

  it("the form: real dates, end not before start, a short note", () => {
    expect(leaveRequestSchema.safeParse({ leaveTypeId: "t1", startDate: "2026-10-19", endDate: "2026-10-23" }).success).toBe(true);
    expect(leaveRequestSchema.safeParse({ leaveTypeId: "t1", startDate: "2026-10-23", endDate: "2026-10-19" }).success).toBe(false);
    expect(leaveRequestSchema.safeParse({ leaveTypeId: "t1", startDate: "19/10/2026", endDate: "2026-10-23" }).success).toBe(false);
    expect(leaveRequestSchema.safeParse({ leaveTypeId: "t1", startDate: "2026-10-19", endDate: "2026-10-23", note: "x".repeat(301) }).success).toBe(false);
  });

  it("month days for the calendar", () => {
    expect(monthDays(2026, 1)).toHaveLength(28);
    expect(monthDays(2026, 9)[0]!.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});
