/**
 * Student logins (Phase 5.0). Pure and unit-tested.
 *
 * - A school turns logins on for chosen classes (Settings → Student logins).
 * - A student signs in with the school's short name + their admission number
 *   + a password. The school prints a one-time password on a login slip; the
 *   student must choose their own at first sign-in.
 * - Students have no real email: their account carries an internal address
 *   under the reserved `.invalid` domain, which is never emailed or shown.
 */

export interface StudentLoginSettings {
  enabled: boolean;
  classIds: string[];
}

export const DEFAULT_STUDENT_LOGINS: StudentLoginSettings = { enabled: false, classIds: [] };

export function parseStudentLogins(raw: unknown): StudentLoginSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const classIds = Array.isArray(o.classIds) ? o.classIds.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 64).slice(0, 500) : [];
  return { enabled: o.enabled === true, classIds: [...new Set(classIds)] };
}

/** May a student in this class sign in? */
export function loginsAllowedFor(settings: StudentLoginSettings, classId: string | null): boolean {
  return settings.enabled && classId !== null && settings.classIds.includes(classId);
}

/** "<school short name>:<admission number>", lower case — what a student signs in with. */
export function studentUsername(schoolSlug: string, admissionNo: string): string {
  return `${schoolSlug.trim().toLowerCase()}:${admissionNo.trim().toLowerCase()}`;
}

/** The internal address on a student's account. Never emailed: `.invalid` is reserved and can't exist. */
export function studentInternalEmail(userKey: string): string {
  return `student-${userKey.toLowerCase()}@students.educore.invalid`;
}

export function isInternalStudentEmail(email: string): boolean {
  return email.toLowerCase().endsWith("@students.educore.invalid");
}

/** No 0/o, 1/l/i: easy to read off a printed slip. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * A one-time password like "kq7m-3vtp-x9": 10 random characters (~49 bits),
 * with dashes for reading aloud. `random` returns bytes (crypto in the app,
 * fixed in tests).
 */
export function temporaryPassword(random: (n: number) => Uint8Array): string {
  const out: string[] = [];
  // Rejection sampling: no bias towards early letters.
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < 10) {
    for (const b of random(16)) {
      if (b < limit && out.length < 10) out.push(ALPHABET[b % ALPHABET.length]!);
    }
  }
  const s = out.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export type StudentLoginState = "none" | "firstSignIn" | "active" | "disabled";

export function loginState(user: { isActive: boolean; mustChangePassword: boolean; passwordHash: string | null } | null): StudentLoginState {
  if (!user || !user.passwordHash) return "none";
  if (!user.isActive) return "disabled";
  return user.mustChangePassword ? "firstSignIn" : "active";
}
