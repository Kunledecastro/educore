/**
 * Attendance rules (Phase 2, milestone 2.1; decision 4: one register per
 * class section per day). Pure and unit-tested — the register screen, the
 * save action, summaries and exports all use these.
 *
 * Dates are date-only values at UTC midnight (same convention as the rest
 * of the app); "today" always means today in the school's time zone
 * (`todayInTimeZone`).
 */

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

const DAY_MS = 86_400_000;
const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);

/** Whole days from `a` to `b` (b − a), ignoring time of day. */
export function daysBetween(a: Date, b: Date): number {
  return dayNumber(b) - dayNumber(a);
}

/** ASSUMPTION: school days are Monday–Friday. Registers aren't expected at weekends (but can still be taken). */
export function isSchoolDay(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6;
}

export type EditCheck =
  | { allowed: true }
  | { allowed: false; reason: "future" | "tooOld" | "outsideYear" };

/**
 * May this person take or change the register for `date`?
 *   - Nobody can mark a future date.
 *   - The date must be inside the academic year.
 *   - Teachers only within `editDays` of today (0 = today only); admins any past date in the year.
 */
export function canEditRegister(opts: {
  date: Date;
  today: Date;
  isAdmin: boolean;
  editDays: number;
  year: { startDate: Date; endDate: Date };
}): EditCheck {
  const { date, today, isAdmin, editDays, year } = opts;
  if (daysBetween(today, date) > 0) return { allowed: false, reason: "future" };
  if (daysBetween(year.startDate, date) < 0 || daysBetween(date, year.endDate) < 0) return { allowed: false, reason: "outsideYear" };
  if (!isAdmin && daysBetween(date, today) > editDays) return { allowed: false, reason: "tooOld" };
  return { allowed: true };
}

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Days with any register entry for this student. */
  marked: number;
  /**
   * Attendance rate, 0–100 with one decimal, or null when there's nothing to
   * measure. ASSUMPTION (stated in the UI): late counts as attended; excused
   * absences are left out of the calculation, so an authorised absence
   * doesn't lower a child's rate. rate = (present + late) / (marked − excused).
   */
  rate: number | null;
}

export function summarizeAttendance(statuses: readonly AttendanceStatusValue[]): AttendanceCounts {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const s of statuses) {
    if (s === "PRESENT") counts.present++;
    else if (s === "ABSENT") counts.absent++;
    else if (s === "LATE") counts.late++;
    else if (s === "EXCUSED") counts.excused++;
  }
  const marked = statuses.length;
  const counted = marked - counts.excused;
  const rate = counted > 0 ? Math.round(((counts.present + counts.late) / counted) * 1000) / 10 : null;
  return { ...counts, marked, rate };
}

/** Adds up several students' counts (e.g. a section total), with the rate recomputed from the sums. */
export function mergeCounts(list: readonly AttendanceCounts[]): AttendanceCounts {
  const sum = { present: 0, absent: 0, late: 0, excused: 0, marked: 0 };
  for (const c of list) {
    sum.present += c.present;
    sum.absent += c.absent;
    sum.late += c.late;
    sum.excused += c.excused;
    sum.marked += c.marked;
  }
  const counted = sum.marked - sum.excused;
  return { ...sum, rate: counted > 0 ? Math.round(((sum.present + sum.late) / counted) * 1000) / 10 : null };
}

export interface RegisterEntry {
  studentId: string;
  status: AttendanceStatusValue;
  remark: string | null;
}

export type RegisterChange =
  | { kind: "create"; entry: RegisterEntry }
  | { kind: "update"; entry: RegisterEntry; before: RegisterEntry };

/**
 * What a save actually changes: new entries and entries whose status or
 * remark differ. Unchanged rows are skipped, so re-saving a register writes
 * nothing and adds nothing to the audit log. Students with no entry in the
 * submission are left as they were (a register is never "cleared" by omission).
 */
export function diffRegister(existing: readonly RegisterEntry[], submitted: readonly RegisterEntry[]): RegisterChange[] {
  const byStudent = new Map(existing.map((e) => [e.studentId, e]));
  const changes: RegisterChange[] = [];
  for (const entry of submitted) {
    const normalized = { ...entry, remark: entry.remark?.trim() ? entry.remark.trim() : null };
    const before = byStudent.get(entry.studentId);
    if (!before) changes.push({ kind: "create", entry: normalized });
    else if (before.status !== normalized.status || (before.remark ?? null) !== normalized.remark) {
      changes.push({ kind: "update", entry: normalized, before });
    }
  }
  return changes;
}

/** Register state for a section on a day, for overview lists. */
export type RegisterState = "taken" | "partial" | "notTaken" | "empty";

export function registerState(studentCount: number, markedCount: number): RegisterState {
  if (studentCount === 0) return "empty";
  if (markedCount === 0) return "notTaken";
  return markedCount >= studentCount ? "taken" : "partial";
}

/** Parse `?date=YYYY-MM-DD` safely; anything else falls back to `fallback`. */
export function parseDateParam(value: string | string[] | undefined, fallback: Date): Date {
  const s = Array.isArray(value) ? value[0] : value;
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? fallback : d;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
