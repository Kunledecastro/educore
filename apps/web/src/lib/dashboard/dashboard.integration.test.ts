import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, prisma } from "@educore/db";
import { attendanceToday, attendanceTrend, debtors, feesByClass, latestPayments, parentChildren, registersNotTaken, remindersFor, teacherToday } from "./data";
import { remindRegister, RemindError } from "./remind";

/**
 * Dashboard data (Phase 9.1) against a real Postgres (migrations through
 * 0036): every figure comes from the viewer's own school only; a parent gets
 * only their own children; a teacher only their own lessons; a register
 * reminder goes once per class per day and never across schools.
 */

const stamp = Date.now();
const TODAY = new Date("2026-10-14T00:00:00Z"); // a Wednesday
let A: string;
let B: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const [a, b] = await Promise.all(["A", "B"].map((k) => prisma.tenant.create({ data: { name: `Dash ${k}`, slug: `dash-${k.toLowerCase()}-${stamp}`, subdomain: `dash-${k.toLowerCase()}-${stamp}` } })));
  A = a!.id;
  B = b!.id;
  for (const [k, t] of [["A", A], ["B", B]] as const) {
    const year = await prisma.academicYear.create({ data: { tenantId: t, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
    const term = await prisma.term.create({ data: { tenantId: t, academicYearId: year.id, name: "First", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true } });
    const teacherUser = await prisma.user.create({ data: { tenantId: t, email: `teach-${k}-${stamp}@dash.test`, name: `Teacher ${k}`, role: "TEACHER" } });
    const teacher = await prisma.teacher.create({ data: { tenantId: t, userId: teacherUser.id, employeeId: `T-${k}` } });
    const cls = await prisma.classGrade.create({ data: { tenantId: t, academicYearId: year.id, name: `JSS 1 ${k}` } });
    const section = await prisma.section.create({ data: { tenantId: t, classId: cls.id, name: "A", formTeacherId: teacher.id } });
    const subject = await prisma.subject.create({ data: { tenantId: t, name: "Maths", code: `MA${k}${stamp % 1000}` } });
    Object.assign(ids, { [`year${k}`]: year.id, [`term${k}`]: term.id, [`teacherUser${k}`]: teacherUser.id, [`teacher${k}`]: teacher.id, [`class${k}`]: cls.id, [`section${k}`]: section.id, [`subject${k}`]: subject.id });
    await prisma.timetableEntry.create({ data: { tenantId: t, classId: cls.id, sectionId: section.id, subjectId: subject.id, teacherId: teacher.id, academicYearId: year.id, dayOfWeek: 3, period: 1, startTime: "08:00", endTime: "08:40", room: "Lab" } });
    const admin = await prisma.user.create({ data: { tenantId: t, email: `admin-${k}-${stamp}@dash.test`, name: `Admin ${k}`, role: "SCHOOL_ADMIN" } });
    ids[`admin${k}`] = admin.id;
  }
  // School A: three pupils, two marked today (one absent), one not marked.
  for (let i = 0; i < 3; i++) {
    ids[`a${i}`] = (await prisma.student.create({ data: { tenantId: A, admissionNo: `DA-${stamp}-${i}`, firstName: `Pupil${i}`, lastName: "A", classId: ids.classA, sectionId: ids.sectionA, academicYearId: ids.yearA } })).id;
  }
  ids.b0 = (await prisma.student.create({ data: { tenantId: B, admissionNo: `DB-${stamp}`, firstName: "Other", lastName: "B", classId: ids.classB, sectionId: ids.sectionB, academicYearId: ids.yearB } })).id;
  const mark = (tenantId: string, studentId: string, sectionId: string, yearId: string, status: "PRESENT" | "ABSENT", date = TODAY) =>
    prisma.attendance.create({ data: { tenantId, studentId, sectionId, academicYearId: yearId, date, status, markedById: tenantId === A ? ids.teacherUserA! : ids.teacherUserB! } });
  await mark(A, ids.a0!, ids.sectionA!, ids.yearA!, "PRESENT");
  await mark(A, ids.a1!, ids.sectionA!, ids.yearA!, "ABSENT");
  await mark(A, ids.a0!, ids.sectionA!, ids.yearA!, "PRESENT", new Date("2026-10-07T00:00:00Z"));
  await mark(B, ids.b0!, ids.sectionB!, ids.yearB!, "PRESENT");
  // Fees: A has one overdue part-paid bill and one paid bill; B has a large bill.
  const bill = (tenantId: string, studentId: string, yearId: string, termId: string, no: string, total: string, paid: string, due: string, status: "ISSUED" | "PARTIALLY_PAID" | "PAID") =>
    prisma.invoice.create({ data: { tenantId, studentId, academicYearId: yearId, termId, invoiceNo: `${no}-${stamp}`, dueDate: new Date(due), status, subtotal: total, totalDue: total, amountPaid: paid } });
  const i0 = await bill(A, ids.a0!, ids.yearA!, ids.termA!, "A1", "100000.00", "40000.00", "2026-10-01", "PARTIALLY_PAID");
  await bill(A, ids.a2!, ids.yearA!, ids.termA!, "A2", "50000.00", "50000.00", "2026-11-01", "PAID");
  const ib = await bill(B, ids.b0!, ids.yearB!, ids.termB!, "B1", "900000.00", "0.00", "2026-10-01", "ISSUED");
  await prisma.payment.create({ data: { tenantId: A, invoiceId: i0.id, studentId: ids.a0!, amount: "40000.00", method: "CASH", paidAt: TODAY } });
  await prisma.payment.create({ data: { tenantId: B, invoiceId: ib.id, studentId: ids.b0!, amount: "1.00", method: "CASH", paidAt: TODAY } });
  // A parent of pupil a0 only.
  const parentUser = await prisma.user.create({ data: { tenantId: A, email: `parent-${stamp}@dash.test`, name: "Mrs Parent", role: "PARENT" } });
  ids.parent = parentUser.id;
  const guardian = await prisma.guardian.create({ data: { tenantId: A, userId: parentUser.id } });
  await prisma.studentGuardian.create({ data: { tenantId: A, studentId: ids.a0!, guardianId: guardian.id, relationship: "MOTHER" } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("admin and bursar figures come from this school only", () => {
  it("attendance today", async () => {
    expect(await attendanceToday(forTenant(A), TODAY)).toEqual({ pupils: 3, here: 1, absent: 1, marked: 2 });
    expect(await attendanceToday(forTenant(B), TODAY)).toEqual({ pupils: 1, here: 1, absent: 0, marked: 1 });
  });

  it("registers not taken, with the form teacher", async () => {
    const r = await registersNotTaken(forTenant(A), TODAY);
    expect(r.total).toBe(1);
    expect(r.missing).toEqual([{ sectionId: ids.sectionA, name: `JSS 1 A A`, formTeacher: "Teacher A", pupils: 3, reminded: false }]);
    expect((await registersNotTaken(forTenant(B), TODAY)).missing).toEqual([]);
  });

  it("weekly attendance trend", async () => {
    const trend = await attendanceTrend(forTenant(A), TODAY, { from: new Date("2026-09-07T00:00:00Z") });
    expect(trend).toEqual([{ week: "2026-10-05", rate: 100 }, { week: "2026-10-12", rate: 50 }]);
  });

  it("fees by class, largest balances and latest payments", async () => {
    expect(await feesByClass(forTenant(A), ids.termA!)).toEqual([{ key: ids.classA, name: "JSS 1 A", order: 0, billed: 15_000_000, paid: 9_000_000 }]);
    const owing = await debtors(forTenant(A), TODAY);
    expect(owing.top.map((d) => [d.studentId, d.owed, d.overdue])).toEqual([[ids.a0, 6_000_000, true]]);
    expect(owing.overdueFamilies).toBe(1);
    const pays = await latestPayments(forTenant(A));
    expect(pays.map((p) => [p.pupil, p.amountMinor])).toEqual([["Pupil0 A", 4_000_000]]);
  });
});

describe("parents see only their own children", () => {
  it("their linked child, with attendance this term and money owed", async () => {
    const kids = await parentChildren(forTenant(A), ids.parent!, { startDate: new Date("2026-09-07T00:00:00Z") }, TODAY);
    expect(kids.map((k) => k.id)).toEqual([ids.a0]);
    expect(kids[0]).toMatchObject({ attendanceRate: 100, absences: 0, owedMinor: 6_000_000, formTeacher: "Teacher A" });
  });

  it("nobody else's — not another parent, not another school", async () => {
    expect(await parentChildren(forTenant(A), ids.adminA!, null, TODAY)).toEqual([]);
    expect(await parentChildren(forTenant(B), ids.parent!, null, TODAY)).toEqual([]);
  });
});

describe("teachers see their own lessons", () => {
  it("today's lessons, with whether the register is taken", async () => {
    const lessons = await teacherToday(forTenant(A), ids.teacherA!, TODAY);
    expect(lessons).toEqual([expect.objectContaining({ time: "08:00–08:40", className: "JSS 1 A A", subject: "Maths", room: "Lab", registerTaken: true })]);
    expect(await teacherToday(forTenant(B), ids.teacherA!, TODAY)).toEqual([]);
  });
});

describe("register reminders", () => {
  const audit = (k: "A" | "B") => ({ tenantId: k === "A" ? A : B, actorId: ids[`admin${k}`]!, ipAddress: null, userAgent: null });

  it("go to the form teacher once per class per day, recorded and audited", async () => {
    const r = await remindRegister(audit("A"), ids.sectionA!, TODAY);
    expect(r).toEqual({ teacher: { email: `teach-A-${stamp}@dash.test`, name: "Teacher A" }, sectionName: "JSS 1 A A" });
    await expect(remindRegister(audit("A"), ids.sectionA!, TODAY)).rejects.toEqual(new RemindError("already"));
    expect((await registersNotTaken(forTenant(A), TODAY)).missing[0]!.reminded).toBe(true);
    expect(await remindersFor(forTenant(A), [ids.sectionA!], TODAY)).toEqual([{ sectionId: ids.sectionA, name: "JSS 1 A A" }]);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "RegisterReminder" } })).toBe(1);
  });

  it("can't be sent for another school's class", async () => {
    await expect(remindRegister(audit("B"), ids.sectionA!, TODAY)).rejects.toEqual(new RemindError("notFound"));
    expect(await remindersFor(forTenant(B), [ids.sectionA!], TODAY)).toEqual([]);
  });
});
