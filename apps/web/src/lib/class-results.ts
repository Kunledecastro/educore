import "server-only";
import type { TenantScopedClient } from "@educore/db";
import { roundScore } from "./grading";
import { contribution, gradeForTotal, rank, stats, studentAverage, subjectTotal, type Stats, type SubjectTotal } from "./results";

export interface StudentResult {
  id: string;
  firstName: string;
  lastName: string;
  admissionNo: string;
  sectionId: string | null;
  sectionName: string | null;
  subjects: Record<
    string,
    {
      total: SubjectTotal;
      grade: { grade: string; remark: string | null } | null;
      /** Each component's marks out of its weight (1 d.p.), in `components` order; null = not scored. */
      parts: (number | null)[];
    }
  >;
  average: number | null;
  /** Complete subjects counted in the average. */
  subjectCount: number;
  /** Subjects with some but not all scores. */
  incomplete: number;
  /** Position in the student's section by average (ties shared), when there is an average. */
  position: number | null;
  positionOutOf: number;
}

export interface ClassResults {
  subjects: { id: string; name: string; code: string }[];
  /** The school's score components, in order (columns of `parts`). */
  components: { id: string; name: string; weight: number }[];
  students: StudentResult[];
  subjectStats: Record<string, Stats>;
  /** Scores still missing across the class (student × subject × component). */
  missingScores: number;
}

/**
 * A class's results for a term — the single calculation behind the results
 * page, families' view and (2.3) report cards. Tenant-scoped client only.
 *
 * ASSUMPTION: position is within the student's section (the arm they sit
 * in every day), not across all sections of the class.
 * A student takes the subjects taught in their section.
 */
export async function loadClassResults(db: TenantScopedClient, classId: string, termId: string, onlyStudentId?: string): Promise<ClassResults> {
  const [components, bands, students, offered, assessments] = await Promise.all([
    db.assessmentType.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] }),
    db.gradeBand.findMany({ orderBy: { minScore: "desc" } }),
    db.student.findMany({
      where: { classId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, admissionNo: true, sectionId: true, section: { select: { name: true } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    db.classSectionSubject.findMany({
      where: { section: { classId } },
      select: { sectionId: true, subject: { select: { id: true, name: true, code: true } } },
    }),
    db.assessment.findMany({
      where: { termId, section: { classId } },
      select: { sectionId: true, subjectId: true, assessmentTypeId: true, maxScore: true, marks: { select: { studentId: true, score: true } } },
    }),
  ]);

  const subjectsBySection = new Map<string, Map<string, { id: string; name: string; code: string }>>();
  for (const o of offered) {
    const m = subjectsBySection.get(o.sectionId) ?? new Map();
    m.set(o.subject.id, o.subject);
    subjectsBySection.set(o.sectionId, m);
  }
  const subjects = [...new Map(offered.map((o) => [o.subject.id, o.subject])).values()].sort((a, b) => a.name.localeCompare(b.name));

  const assessmentKey = (sectionId: string, subjectId: string, typeId: string) => `${sectionId}:${subjectId}:${typeId}`;
  const byKey = new Map(assessments.map((a) => [assessmentKey(a.sectionId, a.subjectId, a.assessmentTypeId), a]));
  const scoreOf = new Map<string, number>();
  for (const a of assessments) for (const m of a.marks) scoreOf.set(`${a.sectionId}:${a.subjectId}:${a.assessmentTypeId}:${m.studentId}`, m.score);

  let missingScores = 0;
  const results: StudentResult[] = students.map((s) => {
    const mySubjects = s.sectionId ? [...(subjectsBySection.get(s.sectionId)?.values() ?? [])] : [];
    const perSubject: StudentResult["subjects"] = {};
    for (const subj of mySubjects) {
      const cells = components.map((c) => {
        const a = byKey.get(assessmentKey(s.sectionId!, subj.id, c.id));
        const score = scoreOf.get(`${s.sectionId}:${subj.id}:${c.id}:${s.id}`) ?? null;
        if (score === null) missingScores++;
        return { weight: c.weight, maxScore: a?.maxScore ?? c.weight, score };
      });
      const total = subjectTotal(cells);
      const g = gradeForTotal(total, bands);
      const parts = cells.map((c) => {
        const v = contribution(c);
        return v === null ? null : roundScore(v);
      });
      perSubject[subj.id] = { total, grade: g ? { grade: g.grade, remark: g.remark } : null, parts };
    }
    const avg = studentAverage(Object.values(perSubject).map((x) => x.total));
    return {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      admissionNo: s.admissionNo,
      sectionId: s.sectionId,
      sectionName: s.section?.name ?? null,
      subjects: perSubject,
      average: avg.average,
      subjectCount: avg.subjects,
      incomplete: avg.incomplete,
      position: null,
      positionOutOf: 0,
    };
  });

  // Positions within each section.
  const bySection = new Map<string, StudentResult[]>();
  for (const r of results) {
    const key = r.sectionId ?? "";
    bySection.set(key, [...(bySection.get(key) ?? []), r]);
  }
  for (const group of bySection.values()) {
    const positions = rank(group.map((r) => ({ key: r.id, value: r.average })));
    const outOf = group.filter((r) => r.average !== null).length;
    for (const r of group) {
      r.position = positions.get(r.id) ?? null;
      r.positionOutOf = outOf;
    }
  }

  const subjectStats: Record<string, Stats> = {};
  for (const subj of subjects) {
    subjectStats[subj.id] = stats(results.map((r) => (r.subjects[subj.id]?.total.complete ? r.subjects[subj.id]!.total.total : null)));
  }

  return {
    subjects,
    components: components.map((c) => ({ id: c.id, name: c.name, weight: c.weight })),
    students: onlyStudentId ? results.filter((r) => r.id === onlyStudentId) : results,
    subjectStats,
    missingScores,
  };
}
