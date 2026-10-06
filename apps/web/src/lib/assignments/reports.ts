import { withRls, type Prisma } from "@educore/db";
import type { AssignmentViewer } from "./data";

/**
 * Assignment reports (Phase 5.3): how much work each class handed in, per
 * subject, and who is missing what. Staff only — admins see the school;
 * teachers the classes they teach or are form teacher of. Drafts never count.
 * "Not handed in" = past the due date with nothing, or recorded so by the
 * teacher. Paper work counts once the teacher has recorded it.
 */

export interface CompletionRow {
  sectionId: string;
  className: string;
  subjectId: string;
  subject: string;
  assignments: number;
  /** Pupils × assignments, counting only assignments past their due date. */
  due: number;
  handedIn: number;
  late: number;
  missing: number;
  marked: number;
  /** Handed in ÷ due, 0–100, or null when nothing is due yet. */
  rate: number | null;
}

function scope(v: AssignmentViewer, termId?: string): Prisma.AssignmentWhereInput {
  return {
    tenantId: v.tenantId,
    status: { not: "DRAFT" },
    academicYear: { isActive: true },
    ...(termId ? { termId } : {}),
    ...(v.role === "SCHOOL_ADMIN" ? {} : { sectionId: { in: v.sectionIds } }),
  };
}

export async function completionReport(v: AssignmentViewer, opts: { termId?: string } = {}, now: Date = new Date()): Promise<CompletionRow[]> {
  if (v.role !== "SCHOOL_ADMIN" && v.role !== "TEACHER") return [];
  return withRls(v.tenantId, async (tx) => {
    const list = await tx.assignment.findMany({
      where: scope(v, opts.termId),
      select: {
        id: true,
        dueAt: true,
        sectionId: true,
        subjectId: true,
        section: { select: { name: true, class: { select: { name: true, order: true } } } },
        subject: { select: { name: true } },
        submissions: { select: { studentId: true, status: true, isLate: true, isMissing: true } },
      },
    });
    const sectionIds = [...new Set(list.map((a) => a.sectionId))];
    const pupils = sectionIds.length
      ? await tx.student.findMany({ where: { tenantId: v.tenantId, sectionId: { in: sectionIds }, status: "ACTIVE" }, select: { id: true, sectionId: true } })
      : [];
    const bySection = new Map<string, Set<string>>();
    for (const p of pupils) {
      if (!p.sectionId) continue;
      const set = bySection.get(p.sectionId) ?? new Set<string>();
      set.add(p.id);
      bySection.set(p.sectionId, set);
    }
    const rows = new Map<string, CompletionRow & { order: number }>();
    for (const a of list) {
      const key = `${a.sectionId}:${a.subjectId}`;
      const row = rows.get(key) ?? {
        sectionId: a.sectionId,
        className: `${a.section.class.name} ${a.section.name}`,
        subjectId: a.subjectId,
        subject: a.subject.name,
        assignments: 0,
        due: 0,
        handedIn: 0,
        late: 0,
        missing: 0,
        marked: 0,
        rate: null,
        order: a.section.class.order,
      };
      row.assignments++;
      const inClass = bySection.get(a.sectionId) ?? new Set<string>();
      const subs = a.submissions.filter((s) => inClass.has(s.studentId));
      const handed = subs.filter((s) => !s.isMissing);
      row.handedIn += handed.length;
      row.late += handed.filter((s) => s.isLate).length;
      row.marked += subs.filter((s) => s.status === "MARKED" && !s.isMissing).length;
      if (a.dueAt.getTime() < now.getTime()) {
        row.due += inClass.size;
        row.missing += inClass.size - handed.length;
      } else {
        row.missing += subs.filter((s) => s.isMissing).length;
      }
      rows.set(key, row);
    }
    return [...rows.values()]
      .map((r) => ({ ...r, rate: r.due > 0 ? Math.round((Math.min(r.handedIn, r.due) / r.due) * 100) : null }))
      .sort((x, y) => x.order - y.order || x.className.localeCompare(y.className) || x.subject.localeCompare(y.subject))
      .map(({ order: _o, ...r }) => r);
  });
}

export interface MissingRow {
  student: { id: string; name: string; admissionNo: string };
  missing: { assignmentId: string; title: string; subject: string; dueAt: Date }[];
}

/** One class: each pupil and the work past its due date they haven't handed in. Pupils with nothing missing are left out. */
export async function missingWork(v: AssignmentViewer, sectionId: string, opts: { termId?: string } = {}, now: Date = new Date()): Promise<{ className: string; rows: MissingRow[] } | null> {
  if (v.role !== "SCHOOL_ADMIN" && v.role !== "TEACHER") return null;
  if (v.role === "TEACHER" && !v.sectionIds.includes(sectionId)) return null;
  return withRls(v.tenantId, async (tx) => {
    const section = await tx.section.findFirst({ where: { id: sectionId, tenantId: v.tenantId }, select: { name: true, class: { select: { name: true } } } });
    if (!section) return null;
    const [list, pupils] = await Promise.all([
      tx.assignment.findMany({
        where: { ...scope(v, opts.termId), sectionId, dueAt: { lt: now } },
        orderBy: [{ dueAt: "asc" }, { title: "asc" }],
        select: { id: true, title: true, dueAt: true, subject: { select: { name: true } }, submissions: { select: { studentId: true, isMissing: true } } },
      }),
      tx.student.findMany({ where: { tenantId: v.tenantId, sectionId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
    ]);
    const rows = pupils
      .map((p) => ({
        student: { id: p.id, name: `${p.firstName} ${p.lastName}`, admissionNo: p.admissionNo },
        missing: list
          .filter((a) => {
            const s = a.submissions.find((x) => x.studentId === p.id);
            return !s || s.isMissing;
          })
          .map((a) => ({ assignmentId: a.id, title: a.title, subject: a.subject.name, dueAt: a.dueAt })),
      }))
      .filter((r) => r.missing.length > 0)
      .sort((x, y) => y.missing.length - x.missing.length || x.student.name.localeCompare(y.student.name));
    return { className: `${section.class.name} ${section.name}`, rows };
  });
}
