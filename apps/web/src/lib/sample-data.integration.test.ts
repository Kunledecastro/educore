import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, prisma, withRls } from "@educore/db";
import { countActiveStudents } from "./entitlements-data";
import { loadOnboardingFacts } from "./onboarding-data";
import { loadSampleData, PUPILS_PER_CLASS, removeSampleData, SAMPLE_CLASSES, SampleDataError, sampleDataStatus } from "./sample-data";

/**
 * Sample data for trial schools against a real Postgres (migrations through
 * 0033): loads only into an empty school; never ticks the school's own
 * set-up steps; sample teachers can't sign in; removal deletes exactly what
 * was loaded and refuses while the school's own pupils sit in a sample
 * class; schools never see or remove each other's sample data.
 */

const stamp = Date.now();
const NOW = new Date("2026-10-12T09:00:00Z"); // a Monday: the ten weekdays before are 28 Sep – 9 Oct
let A: string;
let B: string;
let C: string;
const ids: Record<string, string> = {};
const ctx = (tenantId: string, actorId: string) => ({ tenantId, actorId, ipAddress: "127.0.0.1", userAgent: "test" });

beforeAll(async () => {
  const [a, b, c] = await Promise.all(
    ["A", "B", "C"].map((k) => prisma.tenant.create({ data: { name: `Sample ${k}`, slug: `smp-${k.toLowerCase()}-${stamp}`, subdomain: `smp-${k.toLowerCase()}-${stamp}` } })),
  );
  A = a!.id;
  B = b!.id;
  C = c!.id; // no academic year
  for (const t of [A, B]) {
    const year = await prisma.academicYear.create({ data: { tenantId: t, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
    ids[`year${t === A ? "A" : "B"}`] = year.id;
  }
  await prisma.term.create({ data: { tenantId: A, academicYearId: ids.yearA!, name: "First", order: 1, startDate: new Date("2026-09-07"), endDate: new Date("2026-12-18"), isCurrent: true } });
  // School B has already started setting up: one class.
  ids.bClass = (await prisma.classGrade.create({ data: { tenantId: B, academicYearId: ids.yearB!, name: "Primary 1" } })).id;
  for (const [k, t] of [["admin", A], ["bAdmin", B], ["cAdmin", C]] as const) {
    ids[k] = (await prisma.user.create({ data: { tenantId: t, email: `${k}-${stamp}@sample.test`, name: k, role: "SCHOOL_ADMIN" } })).id;
  }
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B, C] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("loading sample data", () => {
  it("is offered only to a school with a year and no classes or pupils", async () => {
    expect(await sampleDataStatus(A)).toEqual({ loaded: false, canLoad: true, pupils: 0 });
    expect((await sampleDataStatus(B)).canLoad).toBe(false);
    expect((await sampleDataStatus(C)).canLoad).toBe(false);
    await expect(loadSampleData(ctx(B, ids.bAdmin!), NOW)).rejects.toEqual(new SampleDataError("notEmpty"));
    await expect(loadSampleData(ctx(C, ids.cAdmin!), NOW)).rejects.toEqual(new SampleDataError("noYear"));
    expect(await prisma.student.count({ where: { tenantId: { in: [B, C] } } })).toBe(0);
  });

  it("adds labelled classes, pupils, two weeks of attendance and a first test in each subject", async () => {
    const r = await loadSampleData(ctx(A, ids.admin!), NOW);
    const pupils = SAMPLE_CLASSES.length * PUPILS_PER_CLASS;
    expect(r).toEqual({ pupils, attendance: pupils * 10, marks: pupils * 4 });
    const classes = await prisma.classGrade.findMany({ where: { tenantId: A }, select: { name: true } });
    expect(classes.map((c) => c.name).sort()).toEqual(["JSS 1 (sample)", "JSS 2 (sample)"]);
    const days = await prisma.attendance.findMany({ where: { tenantId: A }, distinct: ["date"], select: { date: true }, orderBy: { date: "asc" } });
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    const scores = await prisma.mark.findMany({ where: { tenantId: A }, select: { score: true } });
    expect(scores.every((m) => m.score >= 28 && m.score <= 98)).toBe(true);
    expect(await sampleDataStatus(A)).toEqual({ loaded: true, canLoad: false, pupils });
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "SampleData", action: "CREATE" } })).toBe(1);
  });

  it("sample teachers are switched off, have no password and an address that can't receive mail", async () => {
    const teachers = await prisma.user.findMany({ where: { tenantId: A, role: "TEACHER" } });
    expect(teachers).toHaveLength(2);
    for (const t of teachers) {
      expect(t.isActive).toBe(false);
      expect(t.passwordHash).toBeNull();
      expect(t.email).toMatch(/@sample\.invalid$/);
    }
  });

  it("doesn't tick the school's own set-up steps, count towards the plan's pupil limit or get billed", async () => {
    expect(await countActiveStudents(prisma, A)).toBe(0);
    const f = await loadOnboardingFacts(forTenant(A), ids.admin!);
    expect([f.classCount, f.sectionCount, f.subjectCount, f.assignmentCount, f.studentCount, f.teacherCount]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("only once", async () => {
    await expect(loadSampleData(ctx(A, ids.admin!), NOW)).rejects.toEqual(new SampleDataError("alreadyLoaded"));
  });
});

describe("isolation", () => {
  it("another school can't see, count or remove this school's sample data", async () => {
    expect(await withRls(B, (tx) => tx.sampleRecord.count())).toBe(0);
    expect(await withRls(B, (tx) => tx.sampleRecord.count({ where: { tenantId: A } }))).toBe(0);
    await expect(removeSampleData(ctx(B, ids.bAdmin!))).rejects.toEqual(new SampleDataError("notLoaded"));
    expect(await prisma.sampleRecord.count({ where: { tenantId: A } })).toBeGreaterThan(0);
  });

  it("the app can add and remove markers but never edit them", async () => {
    await expect(withRls(A, (tx) => tx.sampleRecord.updateMany({ data: { recordId: "x" } }))).rejects.toThrow();
  });
});

describe("removing sample data", () => {
  it("is refused while the school's own pupil sits in a sample class", async () => {
    const sampleClass = await prisma.classGrade.findFirstOrThrow({ where: { tenantId: A, name: "JSS 1 (sample)" }, include: { sections: true } });
    const own = await prisma.student.create({ data: { tenantId: A, admissionNo: `OWN-${stamp}`, firstName: "Real", lastName: "Pupil", classId: sampleClass.id, sectionId: sampleClass.sections[0]!.id, academicYearId: ids.yearA } });
    ids.own = own.id;
    await expect(removeSampleData(ctx(A, ids.admin!))).rejects.toEqual(new SampleDataError("inUse"));
    expect(await prisma.student.count({ where: { tenantId: A } })).toBe(SAMPLE_CLASSES.length * PUPILS_PER_CLASS + 1);
  });

  it("deletes exactly what was loaded and keeps everything the school added", async () => {
    const ownClass = await prisma.classGrade.create({ data: { tenantId: A, academicYearId: ids.yearA!, name: "Basic 1" } });
    await prisma.student.update({ where: { id: ids.own! }, data: { classId: ownClass.id, sectionId: null } });
    const ownSubject = await prisma.subject.create({ data: { tenantId: A, name: "French", code: "FRE" } });

    expect(await countActiveStudents(prisma, A)).toBe(1); // the school's own pupil does count
    expect(await removeSampleData(ctx(A, ids.admin!))).toEqual({ pupils: SAMPLE_CLASSES.length * PUPILS_PER_CLASS });
    expect(await prisma.student.findMany({ where: { tenantId: A }, select: { id: true } })).toEqual([{ id: ids.own }]);
    expect(await prisma.classGrade.findMany({ where: { tenantId: A }, select: { id: true } })).toEqual([{ id: ownClass.id }]);
    expect(await prisma.subject.findMany({ where: { tenantId: A }, select: { id: true } })).toEqual([{ id: ownSubject.id }]);
    expect(await prisma.user.count({ where: { tenantId: A, role: "TEACHER" } })).toBe(0);
    expect(await prisma.attendance.count({ where: { tenantId: A } })).toBe(0);
    expect(await prisma.mark.count({ where: { tenantId: A } })).toBe(0);
    expect(await prisma.assessmentType.count({ where: { tenantId: A } })).toBe(0);
    expect(await prisma.sampleRecord.count({ where: { tenantId: A } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "SampleData", action: "DELETE" } })).toBe(1);
    // School B untouched throughout.
    expect(await prisma.classGrade.count({ where: { tenantId: B } })).toBe(1);
  });

  it("and can't be loaded again once the school has its own pupils", async () => {
    await expect(loadSampleData(ctx(A, ids.admin!), NOW)).rejects.toEqual(new SampleDataError("notEmpty"));
  });
});
