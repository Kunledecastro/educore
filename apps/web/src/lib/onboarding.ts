/**
 * Onboarding checklist (milestone 1.4). Pure logic: turns a few counts about
 * the school into an ordered list of setup steps. Nothing here is ticked by
 * hand — a step is done when the data says so, so the checklist can never
 * drift from reality (delete the last class and "Classes" goes back to to-do).
 *
 * The data is gathered in `onboarding-data.ts`; this file is fully
 * unit-tested and has no database or framework dependencies.
 */

export const ONBOARDING_STEP_IDS = ["academicYear", "classes", "staff", "assignments", "students", "invites"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export interface OnboardingFacts {
  /** Name of the school's active academic year, if it has one. */
  activeYearName: string | null;
  /** Classes and sections in the active year. */
  classCount: number;
  sectionCount: number;
  /** Active teacher accounts. */
  teacherCount: number;
  /** Subjects (school-wide) and teacher assignments in the active year. */
  subjectCount: number;
  assignmentCount: number;
  /** Active (enrolled) students in the active year. */
  studentCount: number;
  /**
   * Staff accounts (teachers, other admins, accountants — not the person
   * looking at the dashboard, not parents) and how many of them can sign in
   * or have a live invite.
   */
  staffAccountCount: number;
  staffReadyCount: number;
}

export type StepStatus = "done" | "todo" | "blocked";

export interface OnboardingStep {
  id: OnboardingStepId;
  status: StepStatus;
  /** True for the single step the admin should do next. */
  current: boolean;
  /** Steps that must be done first, when blocked. */
  waitingFor: OnboardingStepId[];
  /** Values for the step's progress line (i18n params). */
  progress: Record<string, number | string>;
  href: string;
  /** Optional second way to do the step (e.g. add one by hand vs. import a file). */
  secondaryHref?: string;
}

export interface OnboardingChecklist {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  next: OnboardingStep | null;
}

const PREREQUISITES: Record<OnboardingStepId, OnboardingStepId[]> = {
  academicYear: [],
  classes: ["academicYear"],
  staff: [],
  assignments: ["classes", "staff"],
  students: ["classes"],
  invites: ["staff"],
};

function isDone(id: OnboardingStepId, f: OnboardingFacts): boolean {
  switch (id) {
    case "academicYear":
      return f.activeYearName !== null;
    case "classes":
      return f.activeYearName !== null && f.sectionCount > 0;
    case "staff":
      return f.teacherCount > 0;
    case "assignments":
      return f.assignmentCount > 0;
    case "students":
      return f.studentCount > 0;
    case "invites":
      // Every staff account can sign in or has an invite waiting. Parents
      // are left out on purpose: schools usually invite them later, in
      // batches, and they shouldn't hold up the rest of setup.
      return f.staffAccountCount > 0 && f.staffReadyCount >= f.staffAccountCount;
  }
}

function progressFor(id: OnboardingStepId, f: OnboardingFacts): Record<string, number | string> {
  switch (id) {
    case "academicYear":
      return { name: f.activeYearName ?? "" };
    case "classes":
      return { classes: f.classCount, sections: f.sectionCount };
    case "staff":
      return { count: f.teacherCount };
    case "assignments":
      return { count: f.assignmentCount, subjects: f.subjectCount };
    case "students":
      return { count: f.studentCount };
    case "invites":
      return { ready: Math.min(f.staffReadyCount, f.staffAccountCount), total: f.staffAccountCount };
  }
}

const LINKS: Record<OnboardingStepId, { href: string; secondaryHref?: string }> = {
  academicYear: { href: "/academics" },
  classes: { href: "/academics/classes", secondaryHref: "/imports" },
  staff: { href: "/imports", secondaryHref: "/teachers" },
  assignments: { href: "/academics/assignments", secondaryHref: "/academics/subjects" },
  students: { href: "/imports", secondaryHref: "/students" },
  invites: { href: "/teachers", secondaryHref: "/staff" },
};

export function buildOnboardingChecklist(facts: OnboardingFacts): OnboardingChecklist {
  const done = new Map(ONBOARDING_STEP_IDS.map((id) => [id, isDone(id, facts)] as const));

  let currentAssigned = false;
  const steps = ONBOARDING_STEP_IDS.map((id): OnboardingStep => {
    const waitingFor = done.get(id) ? [] : PREREQUISITES[id].filter((p) => !done.get(p));
    const status: StepStatus = done.get(id) ? "done" : waitingFor.length ? "blocked" : "todo";
    const current = status === "todo" && !currentAssigned;
    if (current) currentAssigned = true;
    return { id, status, current, waitingFor, progress: progressFor(id, facts), ...LINKS[id] };
  });

  const doneCount = steps.filter((s) => s.status === "done").length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    next: steps.find((s) => s.current) ?? null,
  };
}
