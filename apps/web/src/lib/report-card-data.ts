import "server-only";
import { Role, type TenantScopedClient } from "@educore/db";
import { attendanceSummaries } from "./attendance-data";
import { loadClassResults } from "./class-results";
import type { RequestContext } from "./guard";
import { buildSnapshot, type ReportSnapshot } from "./report-card";
import { NotFoundError } from "./run-action";
import { teacherSectionIds } from "./teacher-sections";
import { parseTenantSettings } from "./tenant-settings";

/**
 * Who may work on a section's report cards:
 *   SCHOOL_ADMIN → every section (writes the principal's comment, generates)
 *   TEACHER      → only sections they're FORM teacher of (writes the teacher's comment)
 * Anything else → "not found".
 */
export async function reportCardSectionIdsFor(ctx: RequestContext): Promise<string[] | "all"> {
  if (ctx.user.role === Role.SCHOOL_ADMIN) return "all";
  if (ctx.user.role === Role.TEACHER) return (await teacherSectionIds(ctx.db, ctx.user.id)).formSectionIds;
  return [];
}

export async function loadReportCardSection(ctx: RequestContext, sectionId: string) {
  const allowed = await reportCardSectionIdsFor(ctx);
  if (allowed !== "all" && !allowed.includes(sectionId)) throw new NotFoundError();
  const section = await ctx.db.section.findFirst({
    where: { id: sectionId },
    include: {
      class: { include: { academicYear: true } },
      formTeacher: { select: { user: { select: { name: true } } } },
    },
  });
  if (!section) throw new NotFoundError();
  return section;
}

/**
 * Builds the frozen snapshot for each given student of a section, for one
 * term — everything the PDF will show. Used by the background job; reads
 * only through the tenant-scoped client.
 */
export async function buildSectionSnapshots(
  db: TenantScopedClient,
  opts: { tenantId: string; termId: string; sectionId: string; studentIds: string[]; now: Date },
): Promise<Map<string, ReportSnapshot>> {
  const [tenant, term, section, options, bands, cards] = await Promise.all([
    db.tenant.findFirst({ where: { id: opts.tenantId }, select: { name: true, settings: true } }),
    db.term.findFirst({ where: { id: opts.termId }, include: { academicYear: true } }),
    db.section.findFirst({
      where: { id: opts.sectionId },
      select: { name: true, classId: true, class: { select: { name: true } }, formTeacher: { select: { user: { select: { name: true } } } } },
    }),
    db.academicSettings.findFirst({ select: { showPosition: true } }),
    db.gradeBand.findMany({ orderBy: { minScore: "desc" } }),
    db.reportCard.findMany({
      where: { termId: opts.termId, studentId: { in: opts.studentIds } },
      select: { studentId: true, teacherComment: true, principalComment: true },
    }),
  ]);
  if (!tenant || !term || !section) throw new NotFoundError();
  const settings = parseTenantSettings(tenant.settings);
  const nextTerm = await db.term.findFirst({
    where: { academicYearId: term.academicYearId, order: { gt: term.order } },
    orderBy: { order: "asc" },
    select: { startDate: true },
  });
  const results = await loadClassResults(db, section.classId, term.id);
  const attendance = await attendanceSummaries(db, opts.studentIds, { from: term.startDate, to: term.endDate });
  const commentsFor = new Map(cards.map((c) => [c.studentId, c]));

  const out = new Map<string, ReportSnapshot>();
  for (const student of results.students) {
    if (!opts.studentIds.includes(student.id) || student.sectionId !== opts.sectionId) continue;
    const c = commentsFor.get(student.id);
    out.set(
      student.id,
      buildSnapshot({
        now: opts.now,
        school: { name: tenant.name, locale: settings.locale, dateStyle: settings.dateStyle },
        className: section.class.name,
        year: { name: term.academicYear.name },
        term,
        nextTerm,
        results,
        student,
        attendance: attendance.get(student.id)!,
        bands,
        showPosition: options?.showPosition ?? false,
        comments: { teacher: c?.teacherComment ?? null, teacherName: section.formTeacher?.user.name ?? null, principal: c?.principalComment ?? null },
      }),
    );
  }
  return out;
}

/** A run still QUEUED/RUNNING after this long is treated as dead (lets an admin try again). */
export const STALE_RUN_MS = 15 * 60 * 1000;
