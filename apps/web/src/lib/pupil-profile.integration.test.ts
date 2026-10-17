import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, prisma, type Role } from "@educore/db";
import { MODULES, type Module } from "./entitlements";
import { healthKey } from "./health/data";
import { loadPupilProfile, recordProfileDownload, type ProfileViewer } from "./pupil-profile-data";
import { encryptSecret } from "./security/secrets";

process.env.HEALTH_DATA_KEY ??= "test-health-key-0123456789";

/**
 * Pupil profile report (Phase 10.0) against a real Postgres: every viewer
 * reaches only pupils in their own row scope and school, gets only the
 * sections their role and plan allow, families see only published results
 * and released marks, and each download is audited in the right school.
 *
 * School A: pupil P was in JSS 1 B last year and is in JSS 2 A now; Q is a
 * classmate in JSS 2 A. Last year's first term is published; this year's isn't.
 */

const stamp = Date.now();
const NOW = new Date("2026-10-17T12:00:00Z");
const ALL = new Set<Module>(MODULES);
let A: string;
let B: string;
const ids: Record<string, string> = {};
const users: Record<string, { id: string; role: Role; name: string; email: string; tenantId: string }> = {};

const viewer = (key: string, impersonation: unknown = null): ProfileViewer => {
  const u = users[key]!;
  return { user: { ...u }, db: forTenant(u.tenantId), isPlatformAdmin: false, impersonation };
};
const load = (key: string, studentId: string, modules: ReadonlySet<Module> = ALL) => loadPupilProfile(viewer(key), studentId, { modules, now: NOW });

beforeAll(async () => {
  const [a, b] = await Promise.all(["A", "B"].map((k) => prisma.tenant.create({ data: { name: `Profile ${k}`, slug: `prof-${k.toLowerCase()}-${stamp}`, subdomain: `prof-${k.toLowerCase()}-${stamp}` } })));
  A = a!.id;
  B = b!.id;
  const user = async (key: string, tenantId: string, role: Role, name: string) => {
    const u = await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@profile.test`, name, role } });
    users[key] = { id: u.id, role, name, email: u.email, tenantId };
    return u;
  };

  // School A people
  await user("admin", A, "SCHOOL_ADMIN", "Admin A");
  await user("bursar", A, "ACCOUNTANT", "Bursar A");
  await user("nurse", A, "SCHOOL_NURSE", "Nurse A");
  const tUser = await user("teacher", A, "TEACHER", "Mr Form");
  const t2User = await user("otherTeacher", A, "TEACHER", "Mrs Other");
  const teacher = await prisma.teacher.create({ data: { tenantId: A, userId: tUser.id, employeeId: "T1" } });
  const otherTeacher = await prisma.teacher.create({ data: { tenantId: A, userId: t2User.id, employeeId: "T2" } });

  // Two years, one term each
  const y1 = await prisma.academicYear.create({ data: { tenantId: A, name: "2025/2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31"), isActive: false } });
  const y2 = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  const t1 = await prisma.term.create({ data: { tenantId: A, academicYearId: y1.id, name: "First term", order: 1, startDate: new Date("2025-09-08"), endDate: new Date("2025-12-19") } });
  const t2 = await prisma.term.create({ data: { tenantId: A, academicYearId: y2.id, name: "First term", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true } });
  const c1 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: y1.id, name: "JSS 1" } });
  const c2 = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: y2.id, name: "JSS 2" } });
  const c2other = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: y2.id, name: "JSS 3" } });
  const s1 = await prisma.section.create({ data: { tenantId: A, classId: c1.id, name: "B" } });
  const s2 = await prisma.section.create({ data: { tenantId: A, classId: c2.id, name: "A", formTeacherId: teacher.id } });
  const sOther = await prisma.section.create({ data: { tenantId: A, classId: c2other.id, name: "A", formTeacherId: otherTeacher.id } });
  const maths = await prisma.subject.create({ data: { tenantId: A, name: "Mathematics", code: `MA${stamp % 1000}` } });
  await prisma.classSectionSubject.createMany({
    data: [
      { tenantId: A, sectionId: s1.id, subjectId: maths.id, teacherId: otherTeacher.id },
      { tenantId: A, sectionId: s2.id, subjectId: maths.id, teacherId: teacher.id },
      { tenantId: A, sectionId: sOther.id, subjectId: maths.id, teacherId: otherTeacher.id },
    ],
  });
  Object.assign(ids, { y1: y1.id, y2: y2.id, t1: t1.id, t2: t2.id, s1: s1.id, s2: s2.id });

  // Pupils
  const P = await prisma.student.create({ data: { tenantId: A, admissionNo: `P-${stamp}`, firstName: "Adaeze", lastName: "Okafor", classId: c2.id, sectionId: s2.id, academicYearId: y2.id, admissionDate: new Date("2025-09-08") } });
  const Q = await prisma.student.create({ data: { tenantId: A, admissionNo: `Q-${stamp}`, firstName: "Bayo", lastName: "Adeyemi", classId: c2.id, sectionId: s2.id, academicYearId: y2.id } });
  ids.P = P.id;
  ids.Q = Q.id;

  // Parents: one of P, one of Q only
  for (const [key, child] of [["parentP", P.id], ["parentQ", Q.id]] as const) {
    const u = await user(key, A, "PARENT", `Parent of ${key}`);
    const g = await prisma.guardian.create({ data: { tenantId: A, userId: u.id, phone: "+234 800 000 0000" } });
    await prisma.studentGuardian.create({ data: { tenantId: A, studentId: child, guardianId: g.id, relationship: "MOTHER", isPrimary: true } });
  }
  await user("pupil", A, "STUDENT", "Adaeze");
  await prisma.student.update({ where: { id: P.id }, data: { userId: users.pupil!.id } });

  // Attendance: last year in JSS 1 B, this year in JSS 2 A
  const reg = (date: string, sectionId: string, yearId: string, status: "PRESENT" | "ABSENT" | "LATE") =>
    prisma.attendance.create({ data: { tenantId: A, studentId: P.id, sectionId, academicYearId: yearId, date: new Date(`${date}T00:00:00Z`), status, markedById: tUser.id } });
  await reg("2025-10-01", s1.id, y1.id, "PRESENT");
  await reg("2025-10-02", s1.id, y1.id, "ABSENT");
  await reg("2026-10-05", s2.id, y2.id, "PRESENT");
  await reg("2026-10-06", s2.id, y2.id, "LATE");

  // Scores: components CA 40 + Exam 60; grade bands; positions on
  const ca = await prisma.assessmentType.create({ data: { tenantId: A, name: "CA", weight: 40, order: 1 } });
  const exam = await prisma.assessmentType.create({ data: { tenantId: A, name: "Exam", weight: 60, order: 2 } });
  await prisma.gradeBand.createMany({ data: [{ tenantId: A, minScore: 70, grade: "A", remark: "Excellent" }, { tenantId: A, minScore: 0, grade: "F", remark: "Fail" }] });
  await prisma.academicSettings.create({ data: { tenantId: A, showPosition: true } });
  const assess = (yearId: string, termId: string, sectionId: string, typeId: string, max: number) =>
    prisma.assessment.create({ data: { tenantId: A, academicYearId: yearId, termId, sectionId, subjectId: maths.id, assessmentTypeId: typeId, name: "x", maxScore: max, date: new Date("2025-10-10") } });
  const mark = (assessmentId: string, studentId: string, score: number) => prisma.mark.create({ data: { tenantId: A, assessmentId, studentId, score, enteredById: tUser.id } });
  const a1ca = await assess(y1.id, t1.id, s1.id, ca.id, 40);
  const a1ex = await assess(y1.id, t1.id, s1.id, exam.id, 60);
  await mark(a1ca.id, P.id, 30);
  await mark(a1ex.id, P.id, 45); // 75 → A
  const a2ca = await assess(y2.id, t2.id, s2.id, ca.id, 40);
  const a2ex = await assess(y2.id, t2.id, s2.id, exam.id, 60);
  await mark(a2ca.id, P.id, 20);
  await mark(a2ex.id, P.id, 30); // 50 → F
  await mark(a2ca.id, Q.id, 36);
  await mark(a2ex.id, Q.id, 54); // 90 → Q first, P second
  await prisma.resultPublication.create({ data: { tenantId: A, termId: t1.id, classId: c1.id } });

  // Homework this year: one published and marked (marks not yet released), one draft that never counts
  const hw = await prisma.assignment.create({ data: { tenantId: A, academicYearId: y2.id, termId: t2.id, sectionId: s2.id, subjectId: maths.id, title: "Fractions", dueAt: new Date("2026-10-10T16:00:00Z"), maxScore: 10, status: "PUBLISHED", publishedAt: new Date("2026-10-03T08:00:00Z") } });
  await prisma.assignment.create({ data: { tenantId: A, academicYearId: y2.id, termId: t2.id, sectionId: s2.id, subjectId: maths.id, title: "Draft", dueAt: new Date("2026-10-01T16:00:00Z"), status: "DRAFT" } });
  await prisma.assignmentSubmission.create({ data: { tenantId: A, assignmentId: hw.id, studentId: P.id, status: "MARKED", score: 8, isLate: true, markedAt: new Date("2026-10-12T10:00:00Z") } });

  // Fees: one part-paid bill, one cancelled
  await prisma.invoice.create({ data: { tenantId: A, studentId: P.id, academicYearId: y2.id, termId: t2.id, invoiceNo: `INV-${stamp}-1`, dueDate: new Date("2026-10-01"), status: "PARTIALLY_PAID", subtotal: "150000.00", discountTotal: "15000.00", totalDue: "135000.00", amountPaid: "100000.00" } });
  await prisma.invoice.create({ data: { tenantId: A, studentId: P.id, academicYearId: y2.id, termId: t2.id, invoiceNo: `INV-${stamp}-2`, dueDate: new Date("2026-10-01"), status: "CANCELLED", subtotal: "999.00", totalDue: "999.00", cancelledAt: new Date("2026-10-02"), cancelReason: "Billed twice" } });

  // A health alert written by the nurse
  await prisma.healthAlert.create({ data: { tenantId: A, studentId: P.id, category: "ALLERGY", severity: "SEVERE", textEnc: encryptSecret("Severe peanut allergy, EpiPen in bag", healthKey()) } });

  // School B: its own admin and pupil
  await user("adminB", B, "SCHOOL_ADMIN", "Admin B");
  const yB = await prisma.academicYear.create({ data: { tenantId: B, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  ids.PB = (await prisma.student.create({ data: { tenantId: B, admissionNo: `B-${stamp}`, firstName: "Other", lastName: "School", academicYearId: yB.id } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("a school admin's report", () => {
  it("covers every year, newest first, with the class from that year's own records", async () => {
    const p = (await load("admin", ids.P!))!;
    expect(p.sections).toEqual(["details", "guardians", "attendance", "results", "homework", "fees", "health"]);
    expect(p.pupil).toMatchObject({ name: "Adaeze Okafor", className: "JSS 2 A", formTeacher: "Mr Form" });
    expect(p.years.map((y) => [y.name, y.className, y.current])).toEqual([
      ["2026/2027", "JSS 2 A", true],
      ["2025/2026", "JSS 1 B", false],
    ]);
  });

  it("has attendance by term, results with grades and position, homework without drafts, fees without cancelled bills, and alerts", async () => {
    const p = (await load("admin", ids.P!))!;
    const [now, last] = p.years;
    expect(now!.attendance!.year).toMatchObject({ present: 1, late: 1, rate: 100 });
    expect(last!.attendance!.year).toMatchObject({ present: 1, absent: 1, rate: 50 });
    expect(now!.results).toEqual([expect.objectContaining({ name: "First term", published: false, average: 50, position: 2, positionOutOf: 2, subjects: [expect.objectContaining({ name: "Mathematics", total: 50, grade: "F" })] })]);
    expect(last!.results).toEqual([expect.objectContaining({ published: true, average: 75, subjects: [expect.objectContaining({ grade: "A", remark: "Excellent" })] })]);
    expect(now!.homework!.year).toMatchObject({ set: 1, handedIn: 1, late: 1, missing: 0, averagePercent: 80 });
    expect(p.fees!.rows).toHaveLength(1);
    expect(p.fees!.total).toEqual({ billedMinor: 15_000_000, discountMinor: 1_500_000, paidMinor: 10_000_000, balanceMinor: 3_500_000 });
    expect(p.health).toEqual([{ category: "ALLERGY", severity: "SEVERE", text: "Severe peanut allergy, EpiPen in bag" }]);
    expect(p.guardians).toEqual([expect.objectContaining({ name: "Parent of parentP", relationship: "MOTHER", phone: "+234 800 000 0000" })]);
  });

  it("leaves out what the school's plan doesn't include", async () => {
    const starter = new Set<Module>(["attendance", "assessments", "timetable", "messaging"]);
    const p = (await load("admin", ids.P!, starter))!;
    expect(p.sections).toEqual(["details", "guardians", "attendance", "results"]);
    expect(p.fees).toBeUndefined();
    expect(p.health).toBeUndefined();
    expect(p.years[0]!.homework).toBeUndefined();
  });

  it("support working as the admin gets no health alerts", async () => {
    const p = (await loadPupilProfile(viewer("admin", { platformAdminId: "x" }), ids.P!, { modules: ALL, now: NOW }))!;
    expect(p.sections).not.toContain("health");
    expect(p.health).toBeUndefined();
  });
});

describe("parents see only their own child, and only what families may see", () => {
  it("their child: published results only, released marks only, no other guardians", async () => {
    const p = (await load("parentP", ids.P!))!;
    expect(p.family).toBe(true);
    expect(p.sections).toEqual(["details", "attendance", "results", "homework", "fees", "health"]);
    expect(p.guardians).toBeUndefined();
    expect(p.years.find((y) => y.name === "2026/2027")!.results).toBeUndefined(); // not published
    expect(p.years.find((y) => y.name === "2025/2026")!.results).toHaveLength(1);
    expect(p.years[0]!.homework!.year.averagePercent).toBeNull(); // marked, but not released
    expect(p.health).toHaveLength(1);
  });

  it("another family's child: nothing at all", async () => {
    expect(await load("parentQ", ids.P!)).toBeNull();
  });
});

describe("staff see only what their role allows", () => {
  it("the form teacher gets the pupil, without fees", async () => {
    const p = (await load("teacher", ids.P!))!;
    expect(p.sections).toEqual(["details", "guardians", "attendance", "results", "homework", "health"]);
    expect(p.fees).toBeUndefined();
  });

  it("a teacher of another class gets nothing", async () => {
    expect(await load("otherTeacher", ids.P!)).toBeNull();
  });

  it("the bursar gets details, guardians and fees — never results, attendance or health", async () => {
    const p = (await load("bursar", ids.P!))!;
    expect(p.sections).toEqual(["details", "guardians", "fees"]);
    expect(p.years.every((y) => !y.attendance && !y.results && !y.homework)).toBe(true);
    expect(p.health).toBeUndefined();
    expect(p.fees!.total.balanceMinor).toBe(3_500_000);
  });

  it("the nurse gets details, guardians and alerts only", async () => {
    const p = (await load("nurse", ids.P!))!;
    expect(p.sections).toEqual(["details", "guardians", "health"]);
    expect(p.years.every((y) => !y.attendance && !y.results && !y.homework)).toBe(true);
    expect(p.fees).toBeUndefined();
  });

  it("pupils don't get the report, even their own", async () => {
    expect(await load("pupil", ids.P!)).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("school B can't reach school A's pupil, and the other way round", async () => {
    expect(await load("adminB", ids.P!)).toBeNull();
    expect(await load("admin", ids.PB!)).toBeNull();
  });

  it("school B's own pupil comes back with nothing from school A", async () => {
    const p = (await load("adminB", ids.PB!))!;
    expect(p.pupil.name).toBe("Other School");
    expect(p.years.every((y) => !y.attendance && !y.results && !y.homework)).toBe(true);
    expect(p.fees!.rows).toEqual([]);
    expect(p.health).toEqual([]);
  });
});

describe("audit", () => {
  it("each download is recorded in the pupil's school, with the sections and years but not the contents", async () => {
    const p = (await load("bursar", ids.P!))!;
    await recordProfileDownload({ tenantId: A, actorId: users.bursar!.id, ipAddress: "10.0.0.1", userAgent: "test" }, p);
    const rows = await prisma.auditLog.findMany({ where: { tenantId: A, entityType: "PupilProfileReport", entityId: ids.P! } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: users.bursar!.id, action: "CREATE", ipAddress: "10.0.0.1" });
    expect(rows[0]!.after).toMatchObject({ sections: ["details", "guardians", "fees"], years: ["2026/2027", "2025/2026"] });
    expect(JSON.stringify(rows[0]!.after)).not.toContain("150000");
    expect(await prisma.auditLog.count({ where: { tenantId: B, entityType: "PupilProfileReport" } })).toBe(0);
  });
});
