import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@educore/db";
import { caPreview, caSend, linkComponent } from "./ca-data";
import { AssignmentError, assignmentViewer, createAssignments, updateAssignment, type AssignmentViewer } from "./data";
import { completionReport, missingWork } from "./reports";
import { markMissing, recordWork } from "./submissions";

/**
 * Assignment marks → CA, and the reports, against a real Postgres
 * (migrations through 0027): who may link and send; the scaling and
 * averaging; the gradebook's published-results lock; existing scores kept
 * for pupils without marked work; audit; and the completion / missing-work
 * reports, scoped to the right staff and school.
 */

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
const DAY = 86400_000;
let A: string;
let B: string;
const ids: Record<string, string> = {};
const v: Record<string, AssignmentViewer> = {};

async function user(tenantId: string, key: string, role: "SCHOOL_ADMIN" | "TEACHER") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@ca.test`, name: key, role } })).id;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "CA A", slug: `ca-a-${stamp}`, subdomain: `ca-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "CA B", slug: `ca-b-${stamp}`, subdomain: `ca-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  const now = Date.now();
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "Current", startDate: new Date(now - 200 * DAY), endDate: new Date(now + 200 * DAY), isActive: true } });
  ids.year = year.id;
  ids.term = (await prisma.term.create({ data: { tenantId: A, academicYearId: year.id, name: "First term", order: 1, startDate: new Date(now - 60 * DAY), endDate: new Date(now + 60 * DAY) } })).id;
  ids.ca1 = (await prisma.assessmentType.create({ data: { tenantId: A, name: "CA1", weight: 20, order: 1 } })).id;
  ids.bCa = (await prisma.assessmentType.create({ data: { tenantId: B, name: "CA1", weight: 20, order: 1 } })).id;
  const jss1 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: year.id, name: "JSS1" } });
  ids.class = jss1.id;
  await Promise.all([user(A, "admin", "SCHOOL_ADMIN"), user(A, "t1", "TEACHER"), user(A, "t2", "TEACHER"), user(A, "t3", "TEACHER"), user(B, "bAdmin", "SCHOOL_ADMIN")]);
  const [t1, t2] = await Promise.all([
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t1!, employeeId: `CT1-${stamp}` } }),
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t2!, employeeId: `CT2-${stamp}` } }),
    prisma.teacher.create({ data: { tenantId: A, userId: ids.t3!, employeeId: `CT3-${stamp}` } }),
  ]);
  const s1 = await prisma.section.create({ data: { tenantId: A, classId: jss1.id, name: "A", formTeacherId: t2.id } });
  ids.s1 = s1.id;
  const maths = await prisma.subject.create({ data: { tenantId: A, name: "Mathematics", code: `CM${stamp}`.slice(0, 12) } });
  ids.maths = maths.id;
  await prisma.classSectionSubject.create({ data: { tenantId: A, sectionId: s1.id, subjectId: maths.id, teacherId: t1.id } });
  const mk = (n: string) => prisma.student.create({ data: { tenantId: A, admissionNo: `CA-${stamp}-${n}`, firstName: n, lastName: "Pupil", academicYearId: year.id, classId: jss1.id, sectionId: s1.id } });
  const [ada, chi, bola] = await Promise.all([mk("Ada"), mk("Chi"), mk("Bola")]);
  Object.assign(ids, { ada: ada.id, chi: chi.id, bola: bola.id });
  for (const [k, role] of [["admin", "SCHOOL_ADMIN"], ["t1", "TEACHER"], ["t2", "TEACHER"], ["t3", "TEACHER"]] as const) v[k] = await assignmentViewer(A, { id: ids[k]!, role });
  v.bAdmin = await assignmentViewer(B, { id: ids.bAdmin!, role: "SCHOOL_ADMIN" });

  const base = { instructions: "", mode: "PAPER" as const, subjectId: maths.id, sectionIds: [s1.id], publish: true };
  ids.hw1 = (await createAssignments(v.t1!, { ...base, title: "HW1", maxScore: 10, dueAt: new Date(now + 1 * DAY) }, meta))[0]!;
  ids.hw2 = (await createAssignments(v.t1!, { ...base, title: "HW2", maxScore: 20, dueAt: new Date(now + 2 * DAY) }, meta))[0]!;
  ids.essay = (await createAssignments(v.t1!, { ...base, title: "Essay", maxScore: null, dueAt: new Date(now + 2 * DAY) }, meta))[0]!;
  // Bola already has a CA1 score typed into the gradebook.
  const col = await prisma.assessment.create({ data: { tenantId: A, academicYearId: year.id, termId: ids.term, sectionId: s1.id, subjectId: maths.id, assessmentTypeId: ids.ca1, name: "Maths · CA1", maxScore: 20, date: new Date() } });
  ids.col = col.id;
  await prisma.mark.create({ data: { tenantId: A, assessmentId: col.id, studentId: bola.id, score: 12, enteredById: ids.t1! } });
  // Marks: Ada 5/10 and 18/20; Chi 8/10 only; Bola nothing.
  await recordWork(v.t1!, ids.hw1, ada.id, { score: 5, feedback: null }, meta);
  await recordWork(v.t1!, ids.hw2, ada.id, { score: 18, feedback: null }, meta);
  await recordWork(v.t1!, ids.hw1, chi.id, { score: 8, feedback: null }, meta);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("linking an assignment to CA", () => {
  it("only scored work, only by its teacher or an admin, only to this school's components", async () => {
    await expect(linkComponent(v.t1!, ids.essay!, ids.ca1!, meta)).rejects.toEqual(new AssignmentError("caNeedsScore"));
    await expect(linkComponent(v.t2!, ids.hw1!, ids.ca1!, meta)).rejects.toEqual(new AssignmentError("notAllowed")); // form teacher
    await expect(linkComponent(v.t3!, ids.hw1!, ids.ca1!, meta)).rejects.toEqual(new AssignmentError("notFound")); // doesn't teach the class
    await expect(linkComponent(v.bAdmin!, ids.hw1!, ids.bCa!, meta)).rejects.toEqual(new AssignmentError("notFound"));
    await expect(linkComponent(v.t1!, ids.hw1!, ids.bCa!, meta)).rejects.toEqual(new AssignmentError("notFound")); // another school's CA1
    await linkComponent(v.t1!, ids.hw1!, ids.ca1!, meta);
    await linkComponent(v.admin!, ids.hw2!, ids.ca1!, meta);
    expect(await prisma.assignment.count({ where: { id: { in: [ids.hw1!, ids.hw2!] }, assessmentTypeId: ids.ca1 } })).toBe(2);
  });

  it("a linked assignment can't lose its maximum score", async () => {
    await expect(updateAssignment(v.t1!, ids.hw1!, { title: "HW1", instructions: "", dueAt: new Date(Date.now() + DAY), maxScore: null, mode: "PAPER" }, meta)).rejects.toEqual(new AssignmentError("caNeedsScore"));
  });
});

describe("sending to the gradebook", () => {
  it("previews the averaged, scaled scores without writing anything", async () => {
    const p = await caPreview(v.t1!, ids.hw1!);
    expect(p).toMatchObject({ component: { name: "CA1" }, term: { name: "First term" }, columnMax: 20, published: false });
    expect(p.assignments.map((a) => [a.title, a.marked])).toEqual([["HW1", 2], ["HW2", 1]]);
    const by = Object.fromEntries(p.rows.map((r) => [r.student.name, [r.current, r.proposed, r.from]]));
    expect(by).toEqual({ "Ada Pupil": [null, 14, 2], "Bola Pupil": [12, null, 0], "Chi Pupil": [null, 16, 1] }); // (50%+90%)/2 of 20; 80% of 20
    expect(await prisma.mark.count({ where: { assessmentId: ids.col } })).toBe(1);
  });

  it("writes the scores (audited), keeps scores for pupils with no marked work, and is idempotent", async () => {
    await expect(caSend(v.t2!, ids.hw1!, meta)).rejects.toEqual(new AssignmentError("notAllowed"));
    expect(await caSend(v.t1!, ids.hw2!, meta)).toEqual({ created: 2, updated: 0, component: "CA1" });
    const marks = await prisma.mark.findMany({ where: { assessmentId: ids.col }, select: { studentId: true, score: true, remarks: true } });
    expect(Object.fromEntries(marks.map((m) => [m.studentId, m.score]))).toEqual({ [ids.ada!]: 14, [ids.chi!]: 16, [ids.bola!]: 12 });
    expect(marks.find((m) => m.studentId === ids.ada)!.remarks).toBe("From 2 assignments");
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "Mark", action: "CREATE" } })).toBe(2);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: ids.hw1! } })).caSentAt).not.toBeNull();
    expect(await caSend(v.t1!, ids.hw1!, meta)).toEqual({ created: 0, updated: 0, component: "CA1" });
  });

  it("a changed mark updates the CA score; the column's own maximum is respected", async () => {
    await prisma.assessment.update({ where: { id: ids.col! }, data: { maxScore: 40 } });
    await recordWork(v.t1!, ids.hw1!, ids.chi!, { score: 10, feedback: null }, meta);
    const r = await caSend(v.t1!, ids.hw1!, meta);
    expect(r.updated).toBe(2); // Ada 70% of 40 = 28, Chi 100% of 40 = 40
    const chi = await prisma.mark.findFirstOrThrow({ where: { assessmentId: ids.col, studentId: ids.chi } });
    expect(chi.score).toBe(40);
  });

  it("never writes into published results", async () => {
    const pub = await prisma.resultPublication.create({ data: { tenantId: A, termId: ids.term!, classId: ids.class! } });
    expect((await caPreview(v.t1!, ids.hw1!)).published).toBe(true);
    await expect(caSend(v.t1!, ids.hw1!, meta)).rejects.toEqual(new AssignmentError("caPublished"));
    await prisma.resultPublication.delete({ where: { id: pub.id } });
  });

  it("an unlinked assignment can't be sent; another school can't see it", async () => {
    await expect(caPreview(v.t1!, ids.essay!)).rejects.toEqual(new AssignmentError("caNotLinked"));
    await expect(caPreview(v.bAdmin!, ids.hw1!)).rejects.toEqual(new AssignmentError("notFound"));
  });
});

describe("reports", () => {
  it("completion per class and subject, counting only work past its due date as due", async () => {
    const later = new Date(Date.now() + 3 * DAY);
    await markMissing(v.t1!, ids.hw1!, meta, later); // Bola for HW1
    const [row] = await completionReport(v.t1!, {}, later);
    // 3 assignments (HW1, HW2, Essay) × 3 pupils due; handed in: HW1 Ada+Chi, HW2 Ada = 3
    expect(row).toMatchObject({ className: "JSS1 A", subject: "Mathematics", assignments: 3, due: 9, handedIn: 3, missing: 6, marked: 3, rate: 33 });
    expect(await completionReport(v.t3!, {}, later)).toEqual([]); // teaches nothing there
    expect(await completionReport(v.bAdmin!, {}, later)).toEqual([]);
    expect((await completionReport(v.admin!, { termId: ids.term }, later)).length).toBe(1);
  });

  it("missing work per pupil for one class, most missing first", async () => {
    const later = new Date(Date.now() + 3 * DAY);
    const r = (await missingWork(v.t2!, ids.s1!, {}, later))!; // form teacher may see
    expect(r.className).toBe("JSS1 A");
    expect(r.rows.map((x) => [x.student.name, x.missing.map((m) => m.title)])).toEqual([
      ["Bola Pupil", ["HW1", "Essay", "HW2"]],
      ["Chi Pupil", ["Essay", "HW2"]],
      ["Ada Pupil", ["Essay"]],
    ]);
    expect(await missingWork(v.t3!, ids.s1!, {}, later)).toBeNull();
    expect(await missingWork(v.bAdmin!, ids.s1!, {}, later)).toBeNull();
  });
});
