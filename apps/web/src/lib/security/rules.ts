/**
 * Who uses two-factor sign-in (Phase 6, confirmed): required for the
 * platform admin, school admins and bursars; the school decides for
 * teachers; optional for parents; not offered to pupils (shared phones,
 * and their accounts only reach their own work).
 */

export type AnyRole = "PLATFORM_ADMIN" | "SCHOOL_ADMIN" | "ACCOUNTANT" | "TEACHER" | "PARENT" | "STUDENT";

// Phase 7: the school nurse holds pupils' health records, so 2FA is required too.
const ALWAYS: ReadonlySet<string> = new Set(["PLATFORM_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT", "SCHOOL_NURSE"]);

export interface SchoolRule {
  requireTeacher2fa: boolean;
  /** Platform-set for shared demo schools: nobody there is *required* to use 2FA. */
  exempt?: boolean;
}

export function twoFactorRequired(role: string, school: SchoolRule | null): boolean {
  if (role === "PLATFORM_ADMIN") return true;
  if (school?.exempt) return false;
  if (ALWAYS.has(role)) return true;
  return role === "TEACHER" && Boolean(school?.requireTeacher2fa);
}

export function twoFactorOffered(role: string): boolean {
  return role !== "STUDENT";
}

/** Where a signed-in session stands. */
export type AuthStage = "ok" | "verify" | "setup";

/**
 * - 2FA on and this session hasn't passed the code step → "verify".
 * - 2FA off but the role requires it → "setup" (nothing else works until done).
 * - otherwise "ok".
 */
export function authStage(input: { role: string; twoFactorEnabled: boolean; sessionPassed2fa: boolean; school: SchoolRule | null }): AuthStage {
  if (input.twoFactorEnabled) return input.sessionPassed2fa ? "ok" : "verify";
  return twoFactorRequired(input.role, input.school) ? "setup" : "ok";
}
