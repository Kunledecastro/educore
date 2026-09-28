import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { forTenant } from "../src/tenant-scope";
import { withRls } from "../src/rls";

/**
 * Integration tests for milestone 1.1's database rules (migration 0006) and
 * tenant isolation of the academic-structure tables. Requires a real
 * Postgres at DATABASE_URL with all migrations applied.
 */

const stamp = Date.now();
let tenantA: { id: string };
let tenantB: { id: string };
let yearA: { id: string };
let yearB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({ data: { name: "Acad A", slug: `acad-a-${stamp}`, subdomain: `acad-a-${stamp}` } });
  tenantB = await prisma.tenant.create({ data: { name: "Acad B", slug: `acad-b-${stamp}`, subdomain: `acad-b-${stamp}` } });
  const dates = { startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") };
  yearA = await prisma.academicYear.create({ data: { tenantId: tenantA.id, name: "2026/2027", isActive: true, ...dates } });
  yearB = await prisma.academicYear.create({ data: { tenantId: tenantB.id, name: "2026/2027", isActive: true, ...dates } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("academic year rules", () => {
  it("allows only one active year per school", async () => {
    await expect(
      prisma.academicYear.create({
        data: { tenantId: tenantA.id, name: "2027/2028", isActive: true, startDate: new Date("2027-09-01"), endDate: new Date("2028-07-31") },
      }),
    ).rejects.toThrow();
  });

  it("…but each school has its own active year (the rule is per tenant)", async () => {
    const active = await prisma.academicYear.count({ where: { id: { in: [yearA.id, yearB.id] }, isActive: true } });
    expect(active).toBe(2);
  });

  it("rejects a year that ends before it starts", async () => {
    await expect(
      prisma.academicYear.create({
        data: { tenantId: tenantA.id, name: "Backwards", startDate: new Date("2027-09-01"), endDate: new Date("2027-01-01") },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate year name in the same school, allows it in another", async () => {
    await expect(
      prisma.academicYear.create({
        data: { tenantId: tenantA.id, name: "2026/2027", startDate: new Date("2030-09-01"), endDate: new Date("2031-07-31") },
      }),
    ).rejects.toThrow();
  });
});

describe("classes and sections", () => {
  it("rejects duplicate class names within a year and duplicate section names within a class", async () => {
    const cls = await prisma.classGrade.create({ data: { tenantId: tenantA.id, academicYearId: yearA.id, name: "JSS 1" } });
    await expect(prisma.classGrade.create({ data: { tenantId: tenantA.id, academicYearId: yearA.id, name: "JSS 1" } })).rejects.toThrow();
    await prisma.section.create({ data: { tenantId: tenantA.id, classId: cls.id, name: "A" } });
    await expect(prisma.section.create({ data: { tenantId: tenantA.id, classId: cls.id, name: "A" } })).rejects.toThrow();
    await expect(prisma.section.create({ data: { tenantId: tenantA.id, classId: cls.id, name: "Z", capacity: 0 } })).rejects.toThrow();
  });

  it("school A never sees school B's years or classes, even with no filter", async () => {
    await prisma.classGrade.create({ data: { tenantId: tenantB.id, academicYearId: yearB.id, name: "B-only class" } });
    const years = await forTenant(tenantA.id).academicYear.findMany({});
    expect(years.every((y) => y.id !== yearB.id)).toBe(true);
    const classes = await withRls(tenantA.id, (tx) => tx.$queryRaw<{ name: string }[]>`SELECT name FROM class_grades`);
    expect(classes.map((c) => c.name)).not.toContain("B-only class");
  });

  it("school A cannot look up school B's year by id (what the server actions rely on before linking)", async () => {
    const found = await withRls(tenantA.id, (tx) => tx.academicYear.findFirst({ where: { id: yearB.id } }));
    expect(found).toBeNull();
  });
});
