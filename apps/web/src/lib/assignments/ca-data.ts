import { recordAudit, withRls } from "@educore/db";
import { isValidScore } from "../results";
import { caScores, type LinkedAssignmentMarks } from "./ca";
import { AssignmentError, audit, loadManageable, type AssignmentViewer, type Meta, type Tx } from "./data";

/**
 * Assignment marks into the gradebook (Phase 5.3). A teacher links an
 * assignment to a score component (e.g. CA1); later, from any assignment in
 * the group, they preview the CA scores for the class and confirm. Writing
 * follows the gradebook's own rules: the teacher of that subject (or an
 * admin), the active year, never into published results, scores within the
 * column's maximum, each change audited.
 */

/** Link (or unlink) an assignment to a score component. Only scored work can be linked. */
export async function linkComponent(v: AssignmentViewer, assignmentId: string, assessmentTypeId: string | null, meta: Meta) {
  await withRls(v.tenantId, async (tx) => {
    const a = await loadManageable(tx, v, assignmentId);
    if (assessmentTypeId) {
      if (a.maxScore === null) throw new AssignmentError("caNeedsScore");
      const t = await tx.assessmentType.findFirst({ where: { id: assessmentTypeId, tenantId: v.tenantId }, select: { id: true } });
      if (!t) throw new AssignmentError("notFound");
    }
    if (a.assessmentTypeId === assessmentTypeId) return;
    await tx.assignment.update({ where: { id: a.id }, data: { assessmentTypeId } });
    await recordAudit(audit(v, meta), { action: "UPDATE", entityType: "Assignment", entityId: a.id, before: { assessmentTypeId: a.assessmentTypeId }, after: { assessmentTypeId } }, tx);
  });
}

export interface CaPreview {
  component: { id: string; name: string };
  term: { id: string; name: string };
  /** What the gradebook column is marked out of. */
  columnMax: number;
  published: boolean;
  yearActive: boolean;
  assignments: { id: string; title: string; maxScore: number; marked: number; waiting: number }[];
  rows: { student: { id: string; name: string; admissionNo: string }; current: number | null; proposed: number | null; from: number }[];
}

async function buildPreview(tx: Tx, v: AssignmentViewer, assignmentId: string): Promise<CaPreview & { classId: string; sectionId: string; subjectId: string; academicYearId: string; assessmentId: string | null }> {
  const a = await loadManageable(tx, v, assignmentId);
  if (!a.assessmentTypeId) throw new AssignmentError("caNotLinked");
  if (!a.termId) throw new AssignmentError("caNoTerm");
  const [component, term, section, year] = await Promise.all([
    tx.assessmentType.findFirstOrThrow({ where: { id: a.assessmentTypeId, tenantId: v.tenantId } }),
    tx.term.findFirstOrThrow({ where: { id: a.termId, tenantId: v.tenantId }, select: { id: true, name: true } }),
    tx.section.findFirstOrThrow({ where: { id: a.sectionId, tenantId: v.tenantId }, select: { classId: true } }),
    tx.academicYear.findFirstOrThrow({ where: { id: a.academicYearId, tenantId: v.tenantId }, select: { isActive: true } }),
  ]);
  const group = await tx.assignment.findMany({
    where: { tenantId: v.tenantId, sectionId: a.sectionId, subjectId: a.subjectId, termId: a.termId, assessmentTypeId: a.assessmentTypeId, status: { not: "DRAFT" }, maxScore: { not: null } },
    orderBy: { dueAt: "asc" },
    include: { submissions: { select: { studentId: true, status: true, score: true } } },
  });
  const [pupils, assessment, published] = await Promise.all([
    tx.student.findMany({ where: { tenantId: v.tenantId, sectionId: a.sectionId, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
    tx.assessment.findFirst({ where: { tenantId: v.tenantId, termId: a.termId, sectionId: a.sectionId, subjectId: a.subjectId, assessmentTypeId: a.assessmentTypeId }, include: { marks: { select: { studentId: true, score: true } } } }),
    tx.resultPublication.findFirst({ where: { tenantId: v.tenantId, termId: a.termId, classId: section.classId }, select: { id: true } }),
  ]);
  const columnMax = assessment?.maxScore ?? component.weight;
  const linked: LinkedAssignmentMarks[] = group.map((g) => ({
    maxScore: Number(g.maxScore),
    scores: new Map(g.submissions.filter((s) => s.status === "MARKED" && s.score !== null).map((s) => [s.studentId, Number(s.score)])),
  }));
  const proposed = caScores(pupils.map((p) => p.id), linked, columnMax);
  const current = new Map(assessment?.marks.map((m) => [m.studentId, m.score]) ?? []);
  const pupilIds = new Set(pupils.map((p) => p.id));
  return {
    component: { id: component.id, name: component.name },
    term,
    columnMax,
    published: Boolean(published),
    yearActive: year.isActive,
    assignments: group.map((g) => {
      const subs = g.submissions.filter((s) => pupilIds.has(s.studentId));
      const marked = subs.filter((s) => s.status === "MARKED").length;
      return { id: g.id, title: g.title, maxScore: Number(g.maxScore), marked, waiting: subs.length - marked };
    }),
    rows: pupils.map((p) => {
      const r = proposed.get(p.id) ?? null;
      return { student: { id: p.id, name: `${p.firstName} ${p.lastName}`, admissionNo: p.admissionNo }, current: current.get(p.id) ?? null, proposed: r?.score ?? null, from: r?.from ?? 0 };
    }),
    classId: section.classId,
    sectionId: a.sectionId,
    subjectId: a.subjectId,
    academicYearId: a.academicYearId,
    assessmentId: assessment?.id ?? null,
  };
}

/** What sending would do, pupil by pupil. Nothing is written. */
export async function caPreview(v: AssignmentViewer, assignmentId: string): Promise<CaPreview> {
  const p = await withRls(v.tenantId, (tx) => buildPreview(tx, v, assignmentId));
  return { component: p.component, term: p.term, columnMax: p.columnMax, published: p.published, yearActive: p.yearActive, assignments: p.assignments, rows: p.rows };
}

/**
 * Write the CA scores into the gradebook. Recomputed here (never trusted
 * from the browser); pupils without marked work keep whatever the gradebook
 * has. Returns how many scores were created / changed.
 */
export async function caSend(v: AssignmentViewer, assignmentId: string, meta: Meta, now: Date = new Date()) {
  return withRls(
    v.tenantId,
    async (tx) => {
      const p = await buildPreview(tx, v, assignmentId);
      if (!p.yearActive) throw new AssignmentError("caYearInactive");
      if (p.published) throw new AssignmentError("caPublished");
      const ctx = audit(v, meta);
      let assessmentId = p.assessmentId;
      if (!assessmentId) {
        const term = await tx.term.findFirstOrThrow({ where: { id: p.term.id, tenantId: v.tenantId } });
        const subject = await tx.subject.findFirstOrThrow({ where: { id: p.subjectId, tenantId: v.tenantId }, select: { name: true } });
        const date = now < term.startDate ? term.startDate : now > term.endDate ? term.endDate : now;
        const created = await tx.assessment.create({
          data: { tenantId: v.tenantId, academicYearId: p.academicYearId, termId: p.term.id, sectionId: p.sectionId, subjectId: p.subjectId, assessmentTypeId: p.component.id, name: `${subject.name} · ${p.component.name}`, maxScore: p.columnMax, date },
        });
        await recordAudit(ctx, { action: "CREATE", entityType: "Assessment", entityId: created.id, after: created }, tx);
        assessmentId = created.id;
      }
      const existing = await tx.mark.findMany({ where: { tenantId: v.tenantId, assessmentId } });
      let created = 0;
      let updated = 0;
      for (const r of p.rows) {
        if (r.proposed === null) continue;
        if (!isValidScore(r.proposed, p.columnMax)) throw new AssignmentError("badScore");
        const before = existing.find((m) => m.studentId === r.student.id);
        const remarks = `From ${r.from} assignment${r.from === 1 ? "" : "s"}`;
        if (!before) {
          const after = await tx.mark.create({ data: { tenantId: v.tenantId, assessmentId, studentId: r.student.id, score: r.proposed, remarks, enteredById: v.userId } });
          await recordAudit(ctx, { action: "CREATE", entityType: "Mark", entityId: after.id, after: { ...after, source: "assignments" } }, tx);
          created++;
        } else if (before.score !== r.proposed) {
          const after = await tx.mark.update({ where: { id: before.id }, data: { score: r.proposed, remarks, enteredById: v.userId } });
          await recordAudit(ctx, { action: "UPDATE", entityType: "Mark", entityId: after.id, before, after: { ...after, source: "assignments" } }, tx);
          updated++;
        }
      }
      await tx.assignment.updateMany({ where: { tenantId: v.tenantId, id: { in: p.assignments.map((x) => x.id) } }, data: { caSentAt: now } });
      return { created, updated, component: p.component.name };
    },
    { timeoutMs: 30_000 },
  );
}

/** The school's score components, for the "counts towards" choice. */
export async function scoreComponents(tenantId: string) {
  return withRls(tenantId, (tx) => tx.assessmentType.findMany({ where: { tenantId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true, weight: true } }));
}
