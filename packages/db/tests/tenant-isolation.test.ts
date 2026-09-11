import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { forTenant } from "../src/tenant-scope";

/**
 * Integration tests for the most important guarantee in this codebase:
 * Tenant A can never read, write, or delete Tenant B's data — not even by
 * accident (forgetting a `where` clause) or by a malicious client trying to
 * spoof `tenantId` in a create payload.
 *
 * Requires a real Postgres reachable at DATABASE_URL with migrations
 * applied (see package.json "test" script / DEPLOYMENT.md).
 */

let tenantA: { id: string };
let tenantB: { id: string };
let academicYearA: { id: string };
let studentA: { id: string };
let studentB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: "Tenant A School", slug: `tenant-a-${Date.now()}`, subdomain: `tenant-a-${Date.now()}` },
  });
  tenantB = await prisma.tenant.create({
    data: { name: "Tenant B School", slug: `tenant-b-${Date.now()}`, subdomain: `tenant-b-${Date.now()}` },
  });

  academicYearA = await prisma.academicYear.create({
    data: {
      tenantId: tenantA.id,
      name: "2026/2027",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-07-31"),
      isActive: true,
    },
  });
  const academicYearB = await prisma.academicYear.create({
    data: {
      tenantId: tenantB.id,
      name: "2026/2027",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-07-31"),
      isActive: true,
    },
  });

  studentA = await prisma.student.create({
    data: { tenantId: tenantA.id, admissionNo: "A-0001", firstName: "Amara", lastName: "Okoye", academicYearId: academicYearA.id },
  });
  studentB = await prisma.student.create({
    data: { tenantId: tenantB.id, admissionNo: "B-0001", firstName: "Bello", lastName: "Musa", academicYearId: academicYearB.id },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("tenant isolation (forTenant scoping)", () => {
  it("findMany with no where clause still only returns the caller's own tenant", async () => {
    const dbA = forTenant(tenantA.id);
    const students = await dbA.student.findMany({});
    expect(students).toHaveLength(1);
    expect(students[0]!.id).toBe(studentA.id);
    expect(students.some((s) => s.id === studentB.id)).toBe(false);
  });

  it("findUnique by another tenant's id returns null, never the row", async () => {
    const dbA = forTenant(tenantA.id);
    const found = await dbA.student.findUnique({ where: { id: studentB.id } });
    expect(found).toBeNull();
  });

  it("updateMany targeting another tenant's row id affects zero rows", async () => {
    const dbA = forTenant(tenantA.id);
    const result = await dbA.student.updateMany({
      where: { id: studentB.id },
      data: { firstName: "HACKED" },
    });
    expect(result.count).toBe(0);

    const stillIntact = await prisma.student.findUnique({ where: { id: studentB.id } });
    expect(stillIntact?.firstName).toBe("Bello");
  });

  it("deleteMany targeting another tenant's row id deletes nothing", async () => {
    const dbA = forTenant(tenantA.id);
    const result = await dbA.student.deleteMany({ where: { id: studentB.id } });
    expect(result.count).toBe(0);

    const stillThere = await prisma.student.findUnique({ where: { id: studentB.id } });
    expect(stillThere).not.toBeNull();
  });

  it("create ignores a spoofed tenantId in the payload and forces the caller's own tenant", async () => {
    const dbA = forTenant(tenantA.id);
    // @ts-expect-error — deliberately trying to smuggle another tenant's id
    const created = await dbA.student.create({
      data: {
        tenantId: tenantB.id, // attempted spoof
        admissionNo: `A-SPOOF-${Date.now()}`,
        firstName: "Spoofed",
        lastName: "Attempt",
      },
    });
    expect(created.tenantId).toBe(tenantA.id);

    // Tenant B's scoped view must never see it either.
    const dbB = forTenant(tenantB.id);
    const visibleToB = await dbB.student.findUnique({ where: { id: created.id } });
    expect(visibleToB).toBeNull();
  });

  it("count() is scoped the same way as findMany()", async () => {
    const dbA = forTenant(tenantA.id);
    const dbB = forTenant(tenantB.id);
    const countA = await dbA.student.count();
    const countB = await dbB.student.count();
    // Tenant A has its original student + the spoof-create from the test
    // above (which landed in A); Tenant B has exactly its original student.
    expect(countA).toBeGreaterThanOrEqual(2);
    expect(countB).toBe(1);
  });

  it("forTenant() refuses to build an unscoped client", () => {
    // @ts-expect-error — intentionally omitting the required tenantId
    expect(() => forTenant()).toThrow();
  });
});
