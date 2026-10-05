/**
 * Assignment rules (Phase 5.1/5.2). Pure and unit-tested; the data layer
 * applies them inside the school's RLS transaction.
 *
 * - School admins manage every assignment. Teachers manage assignments for
 *   the subjects they teach in a section; they also see the published work
 *   of every section they teach or are form teacher of (not others' drafts).
 * - Students and parents see only published (or closed) assignments for the
 *   student's own section — never drafts.
 * - Work can be handed in while an assignment is published, after the due
 *   date too (marked late); not once it's closed, and not for paper-mode
 *   assignments (the teacher records those).
 * - An assignment can be deleted only before anyone has handed anything in.
 */

export type StaffRole = "SCHOOL_ADMIN" | "TEACHER";
export type AnyRole = StaffRole | "PARENT" | "STUDENT" | "ACCOUNTANT" | "PLATFORM_ADMIN";

export interface TeachingPair {
  sectionId: string;
  subjectId: string;
}

export interface AssignmentRef {
  sectionId: string;
  subjectId: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  mode: "ONLINE" | "PAPER";
  dueAt: Date;
}

export function canManage(actor: { role: AnyRole; pairs: readonly TeachingPair[] }, a: Pick<AssignmentRef, "sectionId" | "subjectId">): boolean {
  if (actor.role === "SCHOOL_ADMIN") return true;
  if (actor.role !== "TEACHER") return false;
  return actor.pairs.some((p) => p.sectionId === a.sectionId && p.subjectId === a.subjectId);
}

/**
 * Who can see it. `sectionIds`: teacher → sections taught or form sections;
 * student/parent → the student's (children's) sections.
 */
export function canSee(viewer: { role: AnyRole; sectionIds: readonly string[]; pairs: readonly TeachingPair[] }, a: Pick<AssignmentRef, "sectionId" | "subjectId" | "status">): boolean {
  if (viewer.role === "SCHOOL_ADMIN") return true;
  if (!viewer.sectionIds.includes(a.sectionId)) return false;
  // Teachers see their classes' published work; drafts only their own subject's.
  if (viewer.role === "TEACHER") return a.status !== "DRAFT" || canManage(viewer, a);
  if (viewer.role === "STUDENT" || viewer.role === "PARENT") return a.status !== "DRAFT";
  return false;
}

export function canHandIn(a: Pick<AssignmentRef, "status" | "mode">): boolean {
  return a.status === "PUBLISHED" && a.mode === "ONLINE";
}

/** Resubmitting is allowed until the work is marked (a returned piece can be handed in again). */
export function canResubmit(sub: { status: "SUBMITTED" | "RETURNED" | "MARKED" } | null): boolean {
  return sub === null || sub.status !== "MARKED";
}

export function isLate(submittedAt: Date, dueAt: Date): boolean {
  return submittedAt.getTime() > dueAt.getTime();
}

export function canDelete(submissionCount: number): boolean {
  return submissionCount === 0;
}

export type FamilyState = "todo" | "dueSoon" | "overdue" | "handedIn" | "returned" | "marked" | "closed";

const DUE_SOON_MS = 48 * 3600_000;

/** Where a piece of work stands, from the student's side. */
export function familyState(a: Pick<AssignmentRef, "status" | "dueAt" | "mode">, sub: { status: "SUBMITTED" | "RETURNED" | "MARKED" } | null, now: Date): FamilyState {
  if (sub?.status === "MARKED") return "marked";
  if (sub?.status === "RETURNED") return "returned";
  if (sub) return "handedIn";
  if (a.status === "CLOSED") return "closed";
  if (now > a.dueAt) return "overdue";
  return a.dueAt.getTime() - now.getTime() <= DUE_SOON_MS ? "dueSoon" : "todo";
}

/** A score must fit the assignment: 0 … max, at most two decimals. */
export function validScore(score: number, maxScore: number | null): boolean {
  if (maxScore === null) return false;
  return Number.isFinite(score) && score >= 0 && score <= maxScore && Math.round(score * 100) === score * 100;
}
