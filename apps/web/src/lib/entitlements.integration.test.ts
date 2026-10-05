import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { countActiveStudents, hasStudentCapacity, loadEntitlements, loadPlans } from "./entitlements-data";
import { IMPORTERS } from "./imports/registry";
import { ImportRowError } from "./imports/errors";

/**
 * Plans and limits against a real Postgres (migrations through 0018): the
 * catalogue drives entitlements, schools can't read or change it, the
 * student limit holds under concurrency and in imports, and a trial lapses
 * to read-only.
 */

const stamp = Date.now();
let A: string;
let old: string;
let yearId: string;
let classId: string;
let starterBefore: { maxStudents: number | null };

beforeAll(async () => {
  const a = await prisma.tenant.create({ data: { name: "Plan A", slug: `plan-a-${stamp}`, subdomain: `plan-a-${stamp}`, plan: "STARTER" } });
  A = a.id;
  old = (await prisma.tenant.create({ data: { name: "Old trial", slug: `plan-old-${stamp}`, subdomain: `plan-old-${stamp}`, createdAt: new Date("2026-01-01") } })).id;
  const year = await prisma.academicYear.create({ data: { tenantId: A, name: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31"), isActive: true } });
  yearId = year.id;
  classId = (await prisma.classGrade.create({ data: { tenantId: A, academicYearId: yearId, name: "Grade 1", order: 1 } })).id;
  starterBefore = await prisma.planDefinition.findUniqueOrThrow({ where: { code: "STARTER" } });
});

afterAll(async () => {
  await prisma.planDefinition.update({ where: { code: "STARTER" }, data: { maxStudents: starterBefore.maxStudents } });
  await prisma.tenant.deleteMany({ where: { id: { in: [A, old] } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

const addStudent = (n: string) =>
  withRls(A, async (tx) => {
    const max = (await loadEntitlements(A)).maxStudents;
    if (!(await hasStudentCapacity(tx, A, max))) return "full" as const;
    await tx.student.create({ data: { tenantId: A, admissionNo: `PL-${stamp}-${n}`, firstName: "S", lastName: n, academicYearId: yearId, classId } });
    return "added" as const;
  });

describe("plans", () => {
  it("the catalogue is seeded and drives a school's entitlements", async () => {
    const plans = await loadPlans();
    expect(plans.map((p) => p.code)).toEqual(["FREE_TRIAL", "STARTER", "STANDARD", "PREMIUM"]);
    const e = await loadEntitlements(A);
    expect(e).toMatchObject({ plan: "STARTER", state: "active", maxStudents: 300 });
    expect(e.modules.has("fees")).toBe(false);
  });

  it("schools can't read or change the catalogue", async () => {
    await expect(withRls(A, (tx) => tx.$queryRaw`SELECT * FROM plans`)).rejects.toThrow(/permission denied/);
    await expect(withRls(A, (tx) => tx.$executeRaw`UPDATE plans SET "priceMinor" = 0`)).rejects.toThrow(/permission denied/);
  });

  it("rejects unknown modules and negative prices at the database", async () => {
    await expect(prisma.planDefinition.update({ where: { code: "STARTER" }, data: { modules: ["attendance", "teleportation"] } })).rejects.toThrow(/plans_modules_known/);
    await expect(prisma.planDefinition.update({ where: { code: "STARTER" }, data: { priceMinor: -1 } })).rejects.toThrow(/plans_price_nonneg/);
  });

  it("a trial past its 30 days is read-only", async () => {
    expect(await loadEntitlements(old)).toMatchObject({ state: "readOnly", canWrite: false });
    expect(await loadEntitlements("no-such-school")).toMatchObject({ state: "suspended", canWrite: false });
  });
});

describe("student limit", () => {
  it("holds when two enrolments race for the last place", async () => {
    await prisma.planDefinition.update({ where: { code: "STARTER" }, data: { maxStudents: 2 } });
    expect(await addStudent("1")).toBe("added");
    const results = await Promise.all([addStudent("2"), addStudent("3")]);
    expect(results.sort()).toEqual(["added", "full"]);
    expect(await countActiveStudents(prisma, A)).toBe(2);
  });

  it("imports update existing students but refuse new ones past the limit", async () => {
    const importer = IMPORTERS.STUDENTS;
    const ctx = { tenantId: A, actorId: null, options: { academicYearId: yearId } };
    const row = (admissionNo: string) => ({ admissionNo, firstName: "Imp", lastName: "Orted", classId, sectionId: null, academicYearId: yearId, gender: null, dateOfBirth: null, admissionDate: null, guardian: null });
    await expect(withRls(A, (tx) => importer.apply(tx, ctx, row(`PL-${stamp}-1`)))).resolves.toBeDefined();
    await expect(withRls(A, (tx) => importer.apply(tx, ctx, row(`PL-${stamp}-new`)))).rejects.toEqual(new ImportRowError("imports.issues.studentLimit"));
  });

  it("withdrawn students free their place", async () => {
    await prisma.student.updateMany({ where: { tenantId: A, admissionNo: `PL-${stamp}-1` }, data: { status: "WITHDRAWN" } });
    expect(await addStudent("4")).toBe("added");
  });
});
