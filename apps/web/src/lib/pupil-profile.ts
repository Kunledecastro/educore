/**
 * Pupil profile report (Phase 10.0): the rules, pure and unit-tested.
 *
 * The report is one PDF of everything the school holds about a pupil's time
 * at school. Each viewer gets only the sections they could already see on
 * screen, and only for modules in the school's plan:
 *
 *   section   │ admin │ teacher │ bursar │ nurse │ parent
 *   ──────────┼───────┼─────────┼────────┼───────┼────────
 *   details   │   ✓   │    ✓    │   ✓    │   ✓   │   ✓
 *   guardians │   ✓   │    ✓    │   ✓    │   ✓   │   —   (parents don't see other guardians, e.g. separated families)
 *   attendance│   ✓   │    ✓    │   —    │   —   │   ✓
 *   results   │   ✓   │    ✓    │   —    │   —   │   ✓   (parents: published terms only)
 *   homework  │   ✓   │    ✓    │   —    │   —   │   ✓   (parents: released marks only)
 *   fees      │   ✓   │    —    │   ✓    │   —   │   ✓
 *   health    │   ✓   │    ✓    │   —    │   ✓   │   ✓   (alerts only — never the medical record)
 *
 * Pupils themselves and the platform team (outside a school) get no report.
 */
import type { AttendanceCounts, AttendanceStatusValue } from "./attendance";
import { summarizeAttendance } from "./attendance";
import type { Module } from "./entitlements";

export const PROFILE_SECTIONS = ["details", "guardians", "attendance", "results", "homework", "fees", "health"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const PROFILE_ROLES = ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "SCHOOL_NURSE", "PARENT"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

const BY_ROLE: Record<ProfileRole, readonly ProfileSection[]> = {
  SCHOOL_ADMIN: ["details", "guardians", "attendance", "results", "homework", "fees", "health"],
  TEACHER: ["details", "guardians", "attendance", "results", "homework", "health"],
  ACCOUNTANT: ["details", "guardians", "fees"],
  SCHOOL_NURSE: ["details", "guardians", "health"],
  PARENT: ["details", "attendance", "results", "homework", "fees", "health"],
};

/** The plan module each section needs (details and guardians need none). */
const MODULE_OF: Partial<Record<ProfileSection, Module>> = {
  attendance: "attendance",
  results: "assessments",
  homework: "assignments",
  fees: "fees",
  health: "health",
};

export function canDownloadProfile(role: string): role is ProfileRole {
  return (PROFILE_ROLES as readonly string[]).includes(role);
}

/**
 * The sections this viewer gets, in report order. Empty for anyone who may
 * not download a profile at all. Support staff working as a school admin
 * (impersonation) never get health alerts, matching the rest of the app.
 */
export function profileSections(role: string, modules: ReadonlySet<Module>, opts: { impersonating?: boolean } = {}): ProfileSection[] {
  if (!canDownloadProfile(role)) return [];
  const mine = new Set(BY_ROLE[role]);
  return PROFILE_SECTIONS.filter((s) => {
    if (!mine.has(s)) return false;
    if (s === "health" && opts.impersonating) return false;
    const m = MODULE_OF[s];
    return !m || modules.has(m);
  });
}

/** Families see published results and released homework marks only. */
export function isFamily(role: string): boolean {
  return role === "PARENT" || role === "STUDENT";
}

// ---------------------------------------------------------------------------
// Which class a pupil was in, in a past year
// ---------------------------------------------------------------------------

/**
 * EduCore has no promotion history yet: a pupil row holds only the CURRENT
 * class. For a past year, the class is read from that year's own records —
 * the section the pupil's registers were most often taken in, else the
 * section their marks were entered in. Ties go to the section seen last.
 * Returns null when the year left no trace.
 */
export function sectionForYear(evidence: { attendanceSectionIds: readonly (string | null)[]; markSectionIds: readonly string[] }): string | null {
  const pick = (ids: readonly (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [id, n] of counts) {
      if (n >= bestN) {
        best = id;
        bestN = n;
      }
    }
    return best;
  };
  return pick(evidence.attendanceSectionIds) ?? pick(evidence.markSectionIds);
}

// ---------------------------------------------------------------------------
// Attendance by term
// ---------------------------------------------------------------------------

export interface TermWindow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * A year's register entries split by term (inclusive dates), plus the whole
 * year. Entries outside every term (e.g. a holiday class) count only in the
 * year total. Terms with no entries are left out.
 */
export function attendanceByTerm(
  records: readonly { date: Date; status: AttendanceStatusValue }[],
  terms: readonly TermWindow[],
): { terms: { termId: string; name: string; counts: AttendanceCounts }[]; year: AttendanceCounts } {
  const out: { termId: string; name: string; counts: AttendanceCounts }[] = [];
  for (const t of terms) {
    const from = day(t.startDate);
    const to = day(t.endDate);
    const inTerm = records.filter((r) => day(r.date) >= from && day(r.date) <= to).map((r) => r.status);
    if (inTerm.length > 0) out.push({ termId: t.id, name: t.name, counts: summarizeAttendance(inTerm) });
  }
  return { terms: out, year: summarizeAttendance(records.map((r) => r.status)) };
}

// ---------------------------------------------------------------------------
// Homework
// ---------------------------------------------------------------------------

export interface HomeworkItem {
  dueAt: Date;
  /** Out of; null = not scored. */
  maxScore: number | null;
  /** Marks shared with families (Phase 5.2). */
  marksReleased: boolean;
  submission: { status: "SUBMITTED" | "RETURNED" | "MARKED"; isLate: boolean; isMissing: boolean; score: number | null } | null;
}

export interface HomeworkSummary {
  set: number;
  /** Past their due date (the only ones that can be "not handed in"). */
  due: number;
  handedIn: number;
  late: number;
  missing: number;
  /** Handed in ÷ due, 0–100 (whole number), null when nothing is due yet. */
  rate: number | null;
  /** Mean of marked work as a percentage of its maximum, 1 d.p.; null when none. */
  averagePercent: number | null;
  marked: number;
}

/**
 * Same counting as the class completion report (Phase 5.3): "not handed in"
 * is work past its due date with nothing, or recorded so by the teacher.
 * Families only count marks the teacher has released.
 */
export function homeworkSummary(items: readonly HomeworkItem[], now: Date, opts: { family: boolean }): HomeworkSummary {
  let due = 0;
  let handedIn = 0;
  let late = 0;
  let missing = 0;
  const percents: number[] = [];
  for (const a of items) {
    const sub = a.submission;
    const handed = sub !== null && !sub.isMissing;
    if (handed) {
      handedIn++;
      if (sub.isLate) late++;
    }
    const isDue = a.dueAt.getTime() < now.getTime();
    if (isDue) {
      due++;
      if (!handed) missing++;
    } else if (sub?.isMissing) {
      missing++;
    }
    const markVisible = !opts.family || a.marksReleased;
    if (handed && sub.status === "MARKED" && sub.score !== null && a.maxScore && a.maxScore > 0 && markVisible) {
      percents.push((sub.score / a.maxScore) * 100);
    }
  }
  const avg = percents.length ? Math.round((percents.reduce((x, y) => x + y, 0) / percents.length) * 10) / 10 : null;
  return {
    set: items.length,
    due,
    handedIn,
    late,
    missing,
    rate: due > 0 ? Math.round((Math.min(handedIn, due) / due) * 100) : null,
    averagePercent: avg,
    marked: percents.length,
  };
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** Money in minor units (kobo), from a Decimal-ish value — never floats for sums. */
export function toMinor(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value.toString());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export interface FeeRow {
  label: string;
  billedMinor: number;
  discountMinor: number;
  paidMinor: number;
  balanceMinor: number;
}

/**
 * One row per invoice (in the order given); cancelled invoices are left out.
 * Billed = before discounts; balance = total due − paid, never below zero
 * (an overpayment sits as credit elsewhere).
 */
export function feeRows(
  invoices: readonly { label: string; status: string; subtotal: { toString(): string }; discountTotal: { toString(): string }; totalDue: { toString(): string }; amountPaid: { toString(): string } }[],
): { rows: FeeRow[]; total: Omit<FeeRow, "label"> } {
  const rows = invoices
    .filter((i) => i.status !== "CANCELLED")
    .map((i) => {
      const due = toMinor(i.totalDue);
      const paid = toMinor(i.amountPaid);
      return { label: i.label, billedMinor: toMinor(i.subtotal), discountMinor: toMinor(i.discountTotal), paidMinor: paid, balanceMinor: Math.max(0, due - paid) };
    });
  const total = rows.reduce(
    (t, r) => ({ billedMinor: t.billedMinor + r.billedMinor, discountMinor: t.discountMinor + r.discountMinor, paidMinor: t.paidMinor + r.paidMinor, balanceMinor: t.balanceMinor + r.balanceMinor }),
    { billedMinor: 0, discountMinor: 0, paidMinor: 0, balanceMinor: 0 },
  );
  return { rows, total };
}

/** Whole years of age on a date (UTC calendar). */
export function ageOn(dob: Date, today: Date): number {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** Downloads per user per window — enough for a busy office, too few to scrape a school. */
export const PROFILE_DOWNLOAD_LIMIT = { limit: 60, windowMs: 10 * 60_000 } as const;
