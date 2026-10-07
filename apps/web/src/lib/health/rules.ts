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
 *
 * Alerts (7.1) are deliberately wider: short, action-focused notes the nurse
 * writes so teachers can keep a child safe. Teachers see them for pupils in
 * sections they teach or are form teacher of; admins for the whole school;
 * parents for their own children. Only the nurse writes them.
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
  /** Teachers: the sections they teach or are form teacher of. */
  sectionIds?: readonly string[];
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

/** Alerts: who may see a pupil's alerts (needs the pupil's current section for teachers). */
export function canSeeAlerts(a: HealthActor, pupil: { id: string; sectionId: string | null }): boolean {
  if (a.impersonating) return false;
  switch (a.role) {
    case "SCHOOL_NURSE":
    case "SCHOOL_ADMIN":
      return true;
    case "PARENT":
      return a.childIds.includes(pupil.id);
    case "TEACHER":
      return pupil.sectionId !== null && (a.sectionIds ?? []).includes(pupil.sectionId);
    default:
      return false;
  }
}

/** Only the nurse writes alerts. */
export function canManageAlerts(a: HealthActor): boolean {
  return !a.impersonating && a.role === "SCHOOL_NURSE";
}

/**
 * The emergency card: "full" adds allergies, regular medicines, blood group
 * and genotype (for those who may open the record); "basic" is alerts and
 * emergency contacts (teachers on a trip); null is no card.
 */
export type CardLevel = "full" | "basic" | null;
export function cardLevel(a: HealthActor, pupil: { id: string; sectionId: string | null }): CardLevel {
  if (canOpenRecord(a, pupil.id)) return "full";
  return canSeeAlerts(a, pupil) ? "basic" : null;
}

export const ALERT_CATEGORIES = ["ALLERGY", "ASTHMA", "SICKLE_CELL", "DIABETES", "EPILEPSY", "OTHER"] as const;
export const ALERT_SEVERITIES = ["MILD", "MODERATE", "SEVERE"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Most serious first, then by category — the order badges and cards show them in. */
export function sortAlerts<T extends { severity: AlertSeverity; category: AlertCategory }>(alerts: T[]): T[] {
  const rank = (s: AlertSeverity) => ALERT_SEVERITIES.length - 1 - ALERT_SEVERITIES.indexOf(s);
  return [...alerts].sort((x, y) => rank(x.severity) - rank(y.severity) || ALERT_CATEGORIES.indexOf(x.category) - ALERT_CATEGORIES.indexOf(y.category));
}

// ---------------------------------------------------------------------------
// Clinic visits (7.2)
// ---------------------------------------------------------------------------

export const COMPLAINTS = ["HEADACHE", "FEVER", "STOMACH_ACHE", "VOMITING", "DIARRHOEA", "COLD_FLU", "INJURY", "ASTHMA", "SICKLE_CELL_CRISIS", "ALLERGIC_REACTION", "MENSTRUAL", "TOOTHACHE", "EYE", "SKIN", "DIZZINESS", "OTHER"] as const;
export const OUTCOMES = ["BACK_TO_CLASS", "RESTED", "SENT_HOME", "REFERRED"] as const;
export type Complaint = (typeof COMPLAINTS)[number];
export type Outcome = (typeof OUTCOMES)[number];

/** Only the nurse records visits. */
export function canRecordVisit(a: HealthActor): boolean {
  return !a.impersonating && a.role === "SCHOOL_NURSE";
}

/**
 * What of a visit someone sees. "full": the complaint, care and medicines
 * (the nurse; parents for their own child; admins if the school allows full
 * records). "summary": only when the pupil was in the clinic and the outcome
 * (teachers of the pupil's class; other admins) — never why.
 */
export type VisitView = "full" | "summary" | null;
export function visitView(a: HealthActor, pupil: { id: string; sectionId: string | null }): VisitView {
  if (canOpenRecord(a, pupil.id)) return "full";
  if (a.impersonating) return null;
  if (a.role === "SCHOOL_ADMIN") return "summary";
  if (a.role === "TEACHER") return canSeeAlerts(a, pupil) ? "summary" : null;
  return null;
}

/** "Sent home" and "referred to hospital" are urgent for parents. */
export function isUrgent(outcome: string | null | undefined): boolean {
  return outcome === "SENT_HOME" || outcome === "REFERRED";
}

/**
 * Medicine may only be given if the parent permitted it in advance (or it's
 * the pupil's own medicine that the profile says is taken at school).
 * Returns what isn't allowed (empty = fine).
 */
export function disallowedMedicines(given: { code: string; name?: string }[], allowed: { permitted: readonly string[]; ownAtSchool: readonly string[] }): string[] {
  const own = allowed.ownAtSchool.map((n) => n.trim().toLowerCase());
  return given
    .filter((g) => (g.code === "own" ? !own.includes((g.name ?? "").trim().toLowerCase()) : !allowed.permitted.includes(g.code)))
    .map((g) => (g.code === "own" ? g.name ?? "own" : g.code));
}

/** Health data of a pupil who has left is deleted this long after they left (never sooner than 30 days, in case they return). */
export const MIN_RETENTION_DAYS = 30;
export function retentionDue(leftAt: Date, years: number, now: Date): boolean {
  const due = new Date(leftAt);
  due.setUTCFullYear(due.getUTCFullYear() + Math.max(0, Math.floor(years)));
  const floor = new Date(leftAt.getTime() + MIN_RETENTION_DAYS * 86_400_000);
  return now >= (due > floor ? due : floor);
}
