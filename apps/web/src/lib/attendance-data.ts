import "server-only";
import { Role, type TenantScopedClient } from "@educore/db";
import { summarizeAttendance, type AttendanceCounts, type AttendanceStatusValue } from "./attendance";
import type { RequestContext } from "./guard";
import { NotFoundError } from "./run-action";
import { teacherSectionIds } from "./teacher-sections";

/**
 * Who may see or take which register (row-level rules for attendance):
 *   SCHOOL_ADMIN → every section in the school
 *   TEACHER      → sections they're form teacher of, or teach a subject in
 * Anyone else, or a section outside that set, gets "not found" — the same
 * answer as a section from another school, so nothing is revealed.
 */
export async function registerSectionIdsFor(ctx: RequestContext): Promise<string[] | "all"> {
  if (ctx.user.role === Role.SCHOOL_ADMIN) return "all";
  if (ctx.user.role === Role.TEACHER) return (await teacherSectionIds(ctx.db, ctx.user.id)).sectionIds;
  return [];
}

export async function loadRegisterSection(ctx: RequestContext, sectionId: string) {
  const allowed = await registerSectionIdsFor(ctx);
  if (allowed !== "all" && !allowed.includes(sectionId)) throw new NotFoundError();
  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    include: {
      class: { include: { academicYear: true } },
      formTeacher: { select: { id: true, user: { select: { name: true } } } },
    },
  });
  if (!section) throw new NotFoundError();
  return section;
}

/** Teachers' edit window (days) from the school's options; default 7. */
export async function attendanceEditDays(db: TenantScopedClient): Promise<number> {
  const options = await db.academicSettings.findFirst({ select: { attendanceEditDays: true } });
  return options?.attendanceEditDays ?? 7;
}

/** Enrolled (ACTIVE) students of a section, register order. */
export function sectionStudents(db: TenantScopedClient, sectionId: string) {
  return db.student.findMany({
    where: { sectionId, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, admissionNo: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

/**
 * Per-student counts for a date range (e.g. a term) in one query.
 * `studentIds` must already be scoped by the caller.
 */
export async function attendanceSummaries(
  db: TenantScopedClient,
  studentIds: string[],
  range: { from: Date; to: Date },
): Promise<Map<string, AttendanceCounts>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.attendance.findMany({
    where: { studentId: { in: studentIds }, date: { gte: range.from, lte: range.to } },
    select: { studentId: true, status: true },
  });
  const byStudent = new Map<string, AttendanceStatusValue[]>();
  for (const r of rows) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r.status);
    byStudent.set(r.studentId, list);
  }
  return new Map(studentIds.map((id) => [id, summarizeAttendance(byStudent.get(id) ?? [])]));
}

/**
 * Sections whose register isn't complete for `date`: sections (in the
 * active year, with at least one enrolled student) where fewer students
 * have an entry than are enrolled. `sectionIds` = "all" for admins.
 */
export async function incompleteRegisters(db: TenantScopedClient, date: Date, sectionIds: string[] | "all") {
  if (sectionIds !== "all" && sectionIds.length === 0) return { incomplete: 0, total: 0 };
  const sections = await db.section.findMany({
    where: {
      class: { academicYear: { isActive: true } },
      ...(sectionIds === "all" ? {} : { id: { in: sectionIds } }),
    },
    select: {
      id: true,
      _count: { select: { students: { where: { status: "ACTIVE" } } } },
    },
  });
  const withStudents = sections.filter((s) => s._count.students > 0);
  if (withStudents.length === 0) return { incomplete: 0, total: 0 };
  const marked = await db.attendance.groupBy({
    by: ["sectionId"],
    where: { date, sectionId: { in: withStudents.map((s) => s.id) }, student: { status: "ACTIVE" } },
    _count: { _all: true },
  });
  const markedBySection = new Map(marked.map((m) => [m.sectionId, m._count._all]));
  const incomplete = withStudents.filter((s) => (markedBySection.get(s.id) ?? 0) < s._count.students).length;
  return { incomplete, total: withStudents.length };
}
