import "server-only";
import { recordAudit, Role, withRls, type AttendanceStatus, type AuditContext, type PrismaClient } from "@educore/db";

/**
 * Sample data for a new school (tester review, Oct 2026): try attendance,
 * the gradebook and report cards before importing your own spreadsheet.
 *
 * - Only for a school that hasn't added classes or pupils yet.
 * - Everything is labelled "(sample)" and listed in `sample_records`, so
 *   removal deletes exactly what was loaded — never the school's own data.
 * - Sample teachers are switched-off accounts with no password and an
 *   undeliverable address: they can't sign in and are never emailed.
 * - Marks are only added when the school has set up its terms (an
 *   assessment belongs to a term); attendance always is.
 */

export class SampleDataError extends Error {
  constructor(public readonly code: "noYear" | "notEmpty" | "alreadyLoaded" | "notLoaded" | "inUse") {
    super(code);
    this.name = "SampleDataError";
  }
}

type Tx = PrismaClient;

export const SAMPLE_CLASSES = ["JSS 1", "JSS 2"] as const;
export const PUPILS_PER_CLASS = 12;
const SUBJECTS = [
  { name: "Mathematics", code: "SMPL-MTH" },
  { name: "English Language", code: "SMPL-ENG" },
  { name: "Basic Science", code: "SMPL-SCI" },
  { name: "Social Studies", code: "SMPL-SOS" },
] as const;
const TEACHERS = [
  { name: "Ngozi Eze", subjects: ["SMPL-MTH", "SMPL-SCI"] },
  { name: "Tunde Bakare", subjects: ["SMPL-ENG", "SMPL-SOS"] },
] as const;
const FIRST = ["Chiamaka", "Tobi", "Aisha", "Emeka", "Fatima", "Seun", "Ifeoma", "Musa", "Kemi", "Uche", "Zainab", "Femi", "Adaora", "Ibrahim", "Bisola", "Chidi", "Halima", "Dayo", "Nneka", "Yusuf", "Funke", "Obinna", "Hauwa", "Kunle"] as const;
const LAST = ["Okafor", "Adeyemi", "Bello", "Nwosu", "Abubakar", "Ogunleye", "Eze", "Lawal", "Okonkwo", "Balogun", "Danjuma", "Afolabi"] as const;
export const SAMPLE_LABEL = " (sample)";

/** Deterministic "random" so sample data looks the same every time (and tests are stable). */
function seeded(n: number): number {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** The last `count` weekdays before `today` (UTC dates), not earlier than `from`. */
export function recentSchoolDays(today: Date, count: number, from: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let guard = 0; days.length < count && guard < count * 3; guard++) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d < from) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(new Date(d));
  }
  return days.reverse();
}

/** Mostly present, a few late, the odd absence. */
export function sampleStatus(pupil: number, day: number): AttendanceStatus {
  const r = seeded(pupil * 31 + day);
  return r < 0.06 ? "ABSENT" : r < 0.13 ? "LATE" : "PRESENT";
}

/** A believable spread of test scores out of 100. */
export function sampleScore(pupil: number, subject: number): number {
  const ability = 45 + seeded(pupil + 7) * 40;
  return Math.max(28, Math.min(98, Math.round(ability + (seeded(pupil * 13 + subject) - 0.5) * 24)));
}

async function mark(tx: Tx, tenantId: string, model: string, ids: string[]) {
  if (ids.length) await tx.sampleRecord.createMany({ data: ids.map((recordId) => ({ tenantId, model, recordId })) });
}

async function idsOf(tx: Tx, model: string): Promise<string[]> {
  return (await tx.sampleRecord.findMany({ where: { model }, select: { recordId: true } })).map((r) => r.recordId);
}

export async function sampleDataStatus(tenantId: string): Promise<{ loaded: boolean; canLoad: boolean; pupils: number }> {
  return withRls(tenantId, async (tx) => {
    const [markers, pupils, year] = await Promise.all([
      tx.sampleRecord.count(),
      tx.sampleRecord.count({ where: { model: "Student" } }),
      tx.academicYear.findFirst({ where: { isActive: true }, select: { id: true } }),
    ]);
    if (markers > 0) return { loaded: true, canLoad: false, pupils };
    if (!year) return { loaded: false, canLoad: false, pupils: 0 };
    const [students, classes] = await Promise.all([tx.student.count(), tx.classGrade.count({ where: { academicYearId: year.id } })]);
    return { loaded: false, canLoad: students === 0 && classes === 0, pupils: 0 };
  });
}

export async function loadSampleData(audit: AuditContext, now: Date = new Date()): Promise<{ pupils: number; marks: number; attendance: number }> {
  const { tenantId } = audit;
  return withRls(
    tenantId,
    async (tx) => {
      // One loader at a time per school.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      if ((await tx.sampleRecord.count()) > 0) throw new SampleDataError("alreadyLoaded");
      const year = await tx.academicYear.findFirst({ where: { isActive: true } });
      if (!year) throw new SampleDataError("noYear");
      if ((await tx.student.count()) > 0 || (await tx.classGrade.count({ where: { academicYearId: year.id } })) > 0) throw new SampleDataError("notEmpty");

      // Subjects and teachers.
      const subjects = await Promise.all(SUBJECTS.map((s) => tx.subject.create({ data: { tenantId, name: s.name + SAMPLE_LABEL, code: s.code }, select: { id: true } })));
      const subjectByCode = new Map(SUBJECTS.map((s, i) => [s.code as string, subjects[i]!.id]));
      const stamp = now.getTime().toString(36);
      const teacherUsers = [];
      const teacherBySubject = new Map<string, string>();
      for (const [i, t] of TEACHERS.entries()) {
        const user = await tx.user.create({
          data: { tenantId, role: Role.TEACHER, name: t.name + SAMPLE_LABEL, email: `sample-teacher-${i + 1}.${stamp}.${tenantId.slice(-8)}@sample.invalid`, isActive: false, passwordHash: null },
          select: { id: true },
        });
        const teacher = await tx.teacher.create({ data: { tenantId, userId: user.id, employeeId: `SAMPLE-T${i + 1}` }, select: { id: true } });
        teacherUsers.push(user.id);
        for (const code of t.subjects) teacherBySubject.set(code, teacher.id);
      }

      // Classes, one section each, subject teachers.
      const sections: { classId: string; sectionId: string }[] = [];
      for (const [i, name] of SAMPLE_CLASSES.entries()) {
        const cls = await tx.classGrade.create({ data: { tenantId, academicYearId: year.id, name: name + SAMPLE_LABEL, order: 900 + i }, select: { id: true } });
        const sec = await tx.section.create({ data: { tenantId, classId: cls.id, name: "A" }, select: { id: true } });
        sections.push({ classId: cls.id, sectionId: sec.id });
        await tx.classSectionSubject.createMany({ data: SUBJECTS.map((s) => ({ tenantId, sectionId: sec.id, subjectId: subjectByCode.get(s.code)!, teacherId: teacherBySubject.get(s.code)! })) });
      }

      // Pupils.
      const pupils: { id: string; sectionId: string; classId: string; n: number }[] = [];
      let n = 0;
      for (const s of sections) {
        for (let k = 0; k < PUPILS_PER_CLASS; k++, n++) {
          const st = await tx.student.create({
            data: {
              tenantId,
              academicYearId: year.id,
              classId: s.classId,
              sectionId: s.sectionId,
              admissionNo: `SAMPLE-${String(n + 1).padStart(3, "0")}`,
              firstName: FIRST[n % FIRST.length]!,
              lastName: LAST[(n * 5) % LAST.length]!,
              gender: n % 2 ? "M" : "F",
            },
            select: { id: true },
          });
          pupils.push({ id: st.id, sectionId: s.sectionId, classId: s.classId, n });
        }
      }

      // Attendance for the last two school weeks.
      const days = recentSchoolDays(now, 10, year.startDate);
      const attendance = pupils.flatMap((p) => days.map((date, d) => ({ tenantId, studentId: p.id, classId: p.classId, sectionId: p.sectionId, academicYearId: year.id, date, status: sampleStatus(p.n, d), markedById: audit.actorId! })));
      if (attendance.length) await tx.attendance.createMany({ data: attendance });

      // A first test in every subject, if the school has a current term.
      const term = (await tx.term.findFirst({ where: { academicYearId: year.id, isCurrent: true } })) ?? (await tx.term.findFirst({ where: { academicYearId: year.id, startDate: { lte: now }, endDate: { gte: now } } }));
      const assessmentIds: string[] = [];
      let createdTypeId: string | null = null;
      let markCount = 0;
      if (term) {
        let type = await tx.assessmentType.findFirst({ orderBy: { order: "asc" }, select: { id: true } });
        if (!type) {
          type = await tx.assessmentType.create({ data: { tenantId, name: "Test" + SAMPLE_LABEL, weight: 100, order: 0 }, select: { id: true } });
          createdTypeId = type.id;
        }
        const testDate = term.startDate > now ? term.startDate : now;
        for (const s of sections) {
          for (const [j, sub] of SUBJECTS.entries()) {
            const a = await tx.assessment.create({
              data: { tenantId, academicYearId: year.id, sectionId: s.sectionId, subjectId: subjectByCode.get(sub.code)!, assessmentTypeId: type.id, termId: term.id, name: "First test" + SAMPLE_LABEL, maxScore: 100, date: testDate },
              select: { id: true },
            });
            assessmentIds.push(a.id);
            const rows = pupils.filter((p) => p.sectionId === s.sectionId).map((p) => ({ tenantId, assessmentId: a.id, studentId: p.id, score: sampleScore(p.n, j), enteredById: audit.actorId! }));
            await tx.mark.createMany({ data: rows });
            markCount += rows.length;
          }
        }
      }

      await mark(tx, tenantId, "User", teacherUsers);
      await mark(tx, tenantId, "Subject", subjects.map((s) => s.id));
      await mark(tx, tenantId, "ClassGrade", sections.map((s) => s.classId));
      await mark(tx, tenantId, "Student", pupils.map((p) => p.id));
      await mark(tx, tenantId, "Assessment", assessmentIds);
      if (createdTypeId) await mark(tx, tenantId, "AssessmentType", [createdTypeId]);

      const summary = { pupils: pupils.length, marks: markCount, attendance: attendance.length };
      await recordAudit(audit, { action: "CREATE", entityType: "SampleData", entityId: tenantId, before: null, after: { ...summary, classes: sections.length, subjects: subjects.length } }, tx);
      return summary;
    },
    { timeoutMs: 30_000 },
  );
}

/** Deletes exactly what was loaded. Refused while the school's own pupils sit in a sample class. */
export async function removeSampleData(audit: AuditContext): Promise<{ pupils: number }> {
  const { tenantId } = audit;
  return withRls(
    tenantId,
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const [users, subjects, classes, students, assessments, types] = (await Promise.all(["User", "Subject", "ClassGrade", "Student", "Assessment", "AssessmentType"].map((m) => idsOf(tx, m)))) as [string[], string[], string[], string[], string[], string[]];
      if (![users, subjects, classes, students, assessments, types].some((l) => l.length)) throw new SampleDataError("notLoaded");

      // The school's own pupils placed in a sample class would lose their class: ask them to move first.
      const ownInSample = await tx.student.count({ where: { id: { notIn: students }, classId: { in: classes } } });
      if (ownInSample > 0) throw new SampleDataError("inUse");

      // Pupils first (their attendance, marks and links go with them), then what they hung off.
      await tx.student.deleteMany({ where: { id: { in: students } } });
      await tx.assessment.deleteMany({ where: { id: { in: assessments } } });
      await tx.classGrade.deleteMany({ where: { id: { in: classes } } }); // sections and subject teachers with them
      await tx.subject.deleteMany({ where: { id: { in: subjects } } });
      if (types.length) await tx.assessmentType.deleteMany({ where: { id: { in: types }, assessments: { none: {} } } });
      await tx.user.deleteMany({ where: { id: { in: users }, role: Role.TEACHER, passwordHash: null } }); // teacher rows with them
      await tx.sampleRecord.deleteMany({});

      await recordAudit(audit, { action: "DELETE", entityType: "SampleData", entityId: tenantId, before: { pupils: students.length, classes: classes.length, subjects: subjects.length }, after: null }, tx);
      return { pupils: students.length };
    },
    { timeoutMs: 30_000 },
  );
}

/** Ids the onboarding checklist leaves out, so sample data never ticks a real setup step. */
export async function sampleIds(tx: { sampleRecord: Pick<Tx["sampleRecord"], "findMany"> }): Promise<{ classIds: string[]; studentIds: string[]; subjectIds: string[] }> {
  const rows = await tx.sampleRecord.findMany({ where: { model: { in: ["ClassGrade", "Student", "Subject"] } }, select: { model: true, recordId: true } });
  const of = (m: string) => rows.filter((r) => r.model === m).map((r) => r.recordId);
  return { classIds: of("ClassGrade"), studentIds: of("Student"), subjectIds: of("Subject") };
}
