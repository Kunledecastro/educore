import { describe, expect, it } from "vitest";
import { buildOnboardingChecklist, ONBOARDING_STEP_IDS, type OnboardingFacts } from "./onboarding";

const empty: OnboardingFacts = {
  activeYearName: null,
  classCount: 0,
  sectionCount: 0,
  teacherCount: 0,
  subjectCount: 0,
  assignmentCount: 0,
  studentCount: 0,
  staffAccountCount: 0,
  staffReadyCount: 0,
};

const complete: OnboardingFacts = {
  activeYearName: "2026/2027",
  classCount: 6,
  sectionCount: 12,
  teacherCount: 8,
  subjectCount: 10,
  assignmentCount: 40,
  studentCount: 320,
  staffAccountCount: 10,
  staffReadyCount: 10,
};

const status = (facts: OnboardingFacts) =>
  Object.fromEntries(buildOnboardingChecklist(facts).steps.map((s) => [s.id, s.status]));

describe("buildOnboardingChecklist", () => {
  it("lists every step in the order a school should do them", () => {
    expect(buildOnboardingChecklist(empty).steps.map((s) => s.id)).toEqual([...ONBOARDING_STEP_IDS]);
  });

  it("brand-new school: the academic year comes first; steps that need earlier ones wait", () => {
    const c = buildOnboardingChecklist(empty);
    expect(status(empty)).toEqual({
      academicYear: "todo",
      classes: "blocked",
      staff: "todo",
      assignments: "blocked",
      students: "blocked",
      invites: "blocked",
    });
    expect(c.next?.id).toBe("academicYear");
    expect(c.doneCount).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.steps.find((s) => s.id === "assignments")?.waitingFor).toEqual(["classes", "staff"]);
  });

  it("marks exactly one step as current", () => {
    for (const facts of [empty, { ...empty, activeYearName: "2026/2027" }, complete]) {
      expect(buildOnboardingChecklist(facts).steps.filter((s) => s.current).length).toBeLessThanOrEqual(1);
    }
  });

  it("moves on as data arrives", () => {
    const withYear = { ...empty, activeYearName: "2026/2027" };
    expect(buildOnboardingChecklist(withYear).next?.id).toBe("classes");

    const withClasses = { ...withYear, classCount: 2, sectionCount: 3 };
    expect(buildOnboardingChecklist(withClasses).next?.id).toBe("staff");
    expect(status(withClasses).students).toBe("todo");

    const withStaff = { ...withClasses, teacherCount: 2, staffAccountCount: 2 };
    expect(buildOnboardingChecklist(withStaff).next?.id).toBe("assignments");
  });

  it("a class without sections doesn't count — students need a section to sit in", () => {
    expect(status({ ...empty, activeYearName: "Y", classCount: 3, sectionCount: 0 }).classes).toBe("todo");
  });

  it("classes only count in an active year", () => {
    expect(status({ ...empty, classCount: 3, sectionCount: 3 }).classes).toBe("blocked");
  });

  it("invites are done only when every staff account can sign in or has an invite", () => {
    const base = { ...complete, staffAccountCount: 5 };
    expect(status({ ...base, staffReadyCount: 4 }).invites).toBe("todo");
    expect(status({ ...base, staffReadyCount: 5 }).invites).toBe("done");
    // No staff at all is not "done" — there's nobody to invite yet.
    expect(status({ ...base, teacherCount: 0, staffAccountCount: 0, staffReadyCount: 0 }).invites).toBe("blocked");
  });

  it("progress never reports more ready than total", () => {
    const c = buildOnboardingChecklist({ ...complete, staffAccountCount: 3, staffReadyCount: 7 });
    expect(c.steps.find((s) => s.id === "invites")?.progress).toEqual({ ready: 3, total: 3 });
  });

  it("a fully set-up school is complete with no next step", () => {
    const c = buildOnboardingChecklist(complete);
    expect(c.complete).toBe(true);
    expect(c.doneCount).toBe(6);
    expect(c.next).toBeNull();
  });

  it("goes back to to-do if data is removed (nothing is ticked by hand)", () => {
    expect(status({ ...complete, studentCount: 0 }).students).toBe("todo");
    expect(buildOnboardingChecklist({ ...complete, studentCount: 0 }).complete).toBe(false);
  });

  it("every step links somewhere inside the app", () => {
    for (const s of buildOnboardingChecklist(empty).steps) {
      expect(s.href.startsWith("/")).toBe(true);
      if (s.secondaryHref) expect(s.secondaryHref.startsWith("/")).toBe(true);
    }
  });
});
