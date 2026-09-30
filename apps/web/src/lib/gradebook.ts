import "server-only";
import { Role, type TenantScopedClient } from "@educore/db";
import { todayInTimeZone } from "./format";
import type { RequestContext } from "./guard";
import { gradeForTotal, subjectTotal, type SubjectTotal } from "./results";
import { NotFoundError } from "./run-action";
import { resolveTermRange } from "./term-range";

/**
 * Which gradebooks (section + subject) someone may open:
 *   SCHOOL_ADMIN → every subject offered in a section (a teacher assignment exists)
 *   TEACHER      → only subjects they teach in that section — being form
 *                  teacher doesn't give access to other teachers' subjects.
 * Anything else answers "not found", like another school's ids.
 */
export async function gradebookPairsFor(ctx: RequestContext, yearId: string) {
  const where =
    ctx.user.role === Role.SCHOOL_ADMIN
      ? { section: { class: { academicYearId: yearId } } }
      : ctx.user.role === Role.TEACHER
        ? { section: { class: { academicYearId: yearId } }, teacher: { userId: ctx.user.id } }
        : null;
  if (!where) return [];
  return ctx.db.classSectionSubject.findMany({
    where,
    select: {
      sectionId: true,
      subjectId: true,
      section: { select: { name: true, classId: true, class: { select: { name: true, order: true } } } },
      subject: { select: { name: true, code: true } },
      teacher: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ section: { class: { order: "asc" } } }, { section: { name: "asc" } }, { subject: { name: "asc" } }],
  });
}

export async function assertGradebookAccess(ctx: RequestContext, sectionId: string, subjectId: string) {
  const pair = await ctx.db.classSectionSubject.findFirst({
    where: {
      sectionId,
      subjectId,
      ...(ctx.user.role === Role.SCHOOL_ADMIN ? {} : ctx.user.role === Role.TEACHER ? { teacher: { userId: ctx.user.id } } : { id: "__none__" }),
    },
    select: {
      section: { select: { id: true, name: true, classId: true, class: { select: { name: true, academicYear: true } } } },
      subject: { select: { id: true, name: true, code: true } },
    },
  });
  if (!pair) throw new NotFoundError();
  return pair;
}

export interface GradebookComponent {
  id: string;
  name: string;
  weight: number;
  /** Marked out of — the existing assessment's maxScore, else the weight. */
  maxScore: number;
  assessmentId: string | null;
}

export interface GradebookRow {
  student: { id: string; firstName: string; lastName: string; admissionNo: string };
  scores: Record<string, number | null>; // componentId → score
  total: SubjectTotal;
  grade: { grade: string; remark: string | null } | null;
}

/** Everything the gradebook grid, its export and its import need, for one section + subject + term. */
export async function loadGradebook(ctx: RequestContext, sectionId: string, subjectId: string, termParam: string | string[] | undefined, timezone: string) {
  const { section, subject } = await assertGradebookAccess(ctx, sectionId, subjectId);
  const year = section.class.academicYear;
  const range = await resolveTermRange(ctx.db, year, termParam, todayInTimeZone(timezone));
  const db: TenantScopedClient = ctx.db;

  const [types, assessments, students, bands, publication] = await Promise.all([
    db.assessmentType.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] }),
    range.term
      ? db.assessment.findMany({
          where: { termId: range.term.id, sectionId, subjectId },
          include: { marks: { select: { studentId: true, score: true } } },
        })
      : Promise.resolve([]),
    db.student.findMany({
      where: { sectionId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, admissionNo: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    db.gradeBand.findMany({ orderBy: { minScore: "desc" } }),
    range.term ? db.resultPublication.findFirst({ where: { termId: range.term.id, classId: section.classId } }) : Promise.resolve(null),
  ]);

  const byType = new Map(assessments.map((a) => [a.assessmentTypeId, a]));
  const components: GradebookComponent[] = types.map((t) => {
    const a = byType.get(t.id);
    return { id: t.id, name: t.name, weight: t.weight, maxScore: a?.maxScore ?? t.weight, assessmentId: a?.id ?? null };
  });
  const scoreOf = new Map<string, number>();
  for (const a of assessments) for (const m of a.marks) scoreOf.set(`${a.assessmentTypeId}:${m.studentId}`, m.score);

  const rows: GradebookRow[] = students.map((student) => {
    const scores: Record<string, number | null> = {};
    for (const c of components) scores[c.id] = scoreOf.get(`${c.id}:${student.id}`) ?? null;
    const total = subjectTotal(components.map((c) => ({ weight: c.weight, maxScore: c.maxScore, score: scores[c.id] ?? null })));
    const g = gradeForTotal(total, bands);
    return { student, scores, total, grade: g ? { grade: g.grade, remark: g.remark } : null };
  });

  return { section, subject, year, range, components, rows, bands, publication };
}
