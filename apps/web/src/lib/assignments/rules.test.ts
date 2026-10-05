import { describe, expect, it } from "vitest";
import { canDelete, canHandIn, canManage, canResubmit, canSee, familyState, isLate, validScore } from "./rules";

const a = { sectionId: "jss1a", subjectId: "maths", status: "PUBLISHED" as const, mode: "ONLINE" as const, dueAt: new Date("2026-10-10T15:00:00Z") };

describe("who manages and who sees", () => {
  it("teachers manage only the subjects they teach in that section; admins everything", () => {
    const t = { role: "TEACHER" as const, pairs: [{ sectionId: "jss1a", subjectId: "maths" }] };
    expect(canManage(t, a)).toBe(true);
    expect(canManage(t, { ...a, subjectId: "english" })).toBe(false);
    expect(canManage(t, { ...a, sectionId: "jss1b" })).toBe(false);
    expect(canManage({ role: "SCHOOL_ADMIN", pairs: [] }, a)).toBe(true);
    expect(canManage({ role: "PARENT", pairs: [] }, a)).toBe(false);
  });

  it("students and parents never see drafts, nor other sections", () => {
    const fam = { role: "STUDENT" as const, sectionIds: ["jss1a"], pairs: [] };
    expect(canSee(fam, a)).toBe(true);
    expect(canSee(fam, { ...a, status: "DRAFT" })).toBe(false);
    expect(canSee(fam, { ...a, sectionId: "jss1b" })).toBe(false);
    expect(canSee({ role: "PARENT", sectionIds: ["jss1a"], pairs: [] }, { ...a, status: "CLOSED" })).toBe(true);
    expect(canSee({ role: "ACCOUNTANT", sectionIds: ["jss1a"], pairs: [] }, a)).toBe(false);
  });

  it("teachers see their classes' published work, but only their own subject's drafts", () => {
    const t = { role: "TEACHER" as const, sectionIds: ["jss1a", "jss1b"], pairs: [{ sectionId: "jss1a", subjectId: "maths" }] };
    expect(canSee(t, { ...a, status: "DRAFT" })).toBe(true);
    expect(canSee(t, { ...a, subjectId: "english" })).toBe(true);
    expect(canSee(t, { ...a, subjectId: "english", status: "DRAFT" })).toBe(false);
    expect(canSee(t, { ...a, sectionId: "jss1b" })).toBe(true); // form section
    expect(canSee(t, { ...a, sectionId: "jss2a" })).toBe(false);
  });
});

describe("handing in", () => {
  it("only while published and online; paper work is recorded by the teacher", () => {
    expect(canHandIn(a)).toBe(true);
    expect(canHandIn({ ...a, status: "CLOSED" })).toBe(false);
    expect(canHandIn({ ...a, status: "DRAFT" })).toBe(false);
    expect(canHandIn({ ...a, mode: "PAPER" })).toBe(false);
  });
  it("can be redone until marked; late is after the due time", () => {
    expect(canResubmit(null)).toBe(true);
    expect(canResubmit({ status: "RETURNED" })).toBe(true);
    expect(canResubmit({ status: "MARKED" })).toBe(false);
    expect(isLate(new Date("2026-10-10T15:00:00Z"), a.dueAt)).toBe(false);
    expect(isLate(new Date("2026-10-10T15:00:01Z"), a.dueAt)).toBe(true);
  });
  it("an assignment goes only before anything is handed in", () => {
    expect(canDelete(0)).toBe(true);
    expect(canDelete(1)).toBe(false);
  });
});

describe("where the work stands", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  it("for the student and parent", () => {
    expect(familyState({ ...a, dueAt: new Date("2026-10-20T15:00:00Z") }, null, now)).toBe("todo");
    expect(familyState(a, null, now)).toBe("dueSoon");
    expect(familyState(a, null, new Date("2026-10-11T00:00:00Z"))).toBe("overdue");
    expect(familyState({ ...a, status: "CLOSED" }, null, now)).toBe("closed");
    expect(familyState(a, { status: "SUBMITTED" }, now)).toBe("handedIn");
    expect(familyState(a, { status: "RETURNED" }, now)).toBe("returned");
    expect(familyState(a, { status: "MARKED" }, now)).toBe("marked");
  });
  it("scores fit 0 … max with at most two decimals", () => {
    expect(validScore(7.5, 10)).toBe(true);
    expect(validScore(10, 10)).toBe(true);
    expect(validScore(10.5, 10)).toBe(false);
    expect(validScore(-1, 10)).toBe(false);
    expect(validScore(3.333, 10)).toBe(false);
    expect(validScore(5, null)).toBe(false);
  });
});
