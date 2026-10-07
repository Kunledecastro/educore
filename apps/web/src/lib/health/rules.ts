/**
 * Who may do what with health data (Phase 7). Pure and unit-tested; the data
 * layer applies these before every read and write, and logs every read of a
 * full record.
 *
 * - The nurse: every pupil in the school.
 * - Parents: their own children only.
 * - School admins: the list and statuses; full records only when the school
 *   switches "admins can open full records" on — and never while EduCore
 *   support is working as the admin (impersonation).
 * - Everyone else (teachers, bursars, pupils, the platform team): no records.
 */

export type HealthRole = "SCHOOL_NURSE" | "PARENT" | "SCHOOL_ADMIN" | string;

export interface HealthActor {
  role: HealthRole;
  /** Parents: their children. */
  childIds: readonly string[];
  /** The school's setting. */
  adminFullAccess: boolean;
  /** EduCore support working as a school admin. */
  impersonating: boolean;
}

export function canOpenRecord(a: HealthActor, studentId: string): boolean {
  if (a.impersonating) return false;
  if (a.role === "SCHOOL_NURSE") return true;
  if (a.role === "PARENT") return a.childIds.includes(studentId);
  if (a.role === "SCHOOL_ADMIN") return a.adminFullAccess;
  return false;
}

/** Parents fill in (with consent); the nurse edits and verifies. Admins never edit. */
export function canEditRecord(a: HealthActor, studentId: string): boolean {
  if (a.impersonating) return false;
  if (a.role === "SCHOOL_NURSE") return true;
  return a.role === "PARENT" && a.childIds.includes(studentId);
}

export function canVerify(a: HealthActor): boolean {
  return !a.impersonating && a.role === "SCHOOL_NURSE";
}

/** The school-wide list (names and statuses — no health details). */
export function canSeeList(a: HealthActor): boolean {
  return a.role === "SCHOOL_NURSE" || a.role === "SCHOOL_ADMIN";
}

export type ProfileStatus = "SUBMITTED" | "VERIFIED" | "CHANGED";

/** After a save: a parent's change needs (re)checking; the nurse's save can verify. */
export function statusAfterSave(saver: "PARENT" | "SCHOOL_NURSE", before: ProfileStatus | null, verify: boolean): ProfileStatus {
  if (saver === "SCHOOL_NURSE") return verify ? "VERIFIED" : (before ?? "SUBMITTED");
  return before === "VERIFIED" || before === "CHANGED" ? "CHANGED" : "SUBMITTED";
}
