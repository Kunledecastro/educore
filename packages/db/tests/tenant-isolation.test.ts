import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import { forTenant } from "../src/tenant-scope";
import { withRls } from "../src/rls";

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

/**
 * Layer #2 on its own: Postgres RLS, with the Prisma filter taken out of the
 * picture entirely (raw SQL, no WHERE clause). If these pass, a bug in the
 * Prisma extension still could not leak another school's data.
 */
describe("tenant isolation (database RLS layer, no app-level filter)", () => {
  it("a raw SELECT with no WHERE sees only the caller's tenant", async () => {
    const rows = await withRls(tenantA.id, (tx) =>
      tx.$queryRaw<{ id: string }[]>`SELECT id FROM students`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.id === studentB.id)).toBe(false);
  });

  it("a raw INSERT into another tenant is rejected by the RLS policy", async () => {
    await expect(
      withRls(tenantA.id, (tx) =>
        tx.$executeRaw`INSERT INTO students (id, "tenantId", "admissionNo", "firstName", "lastName", "updatedAt")
                       VALUES (${`rls-x-${Date.now()}`}, ${tenantB.id}, 'X-1', 'X', 'Y', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a raw UPDATE of another tenant's row changes nothing", async () => {
    const changed = await withRls(tenantA.id, (tx) =>
      tx.$executeRaw`UPDATE students SET "firstName" = 'HACKED' WHERE id = ${studentB.id}`,
    );
    expect(changed).toBe(0);
  });

  it("the tenant row itself: only your own school is visible", async () => {
    const rows = await withRls(tenantA.id, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants`);
    expect(rows.map((r) => r.id)).toEqual([tenantA.id]);
  });

  it("with no tenant set, RLS fails closed (zero rows)", async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE educore_app`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM students`;
    });
    expect(rows).toHaveLength(0);
  });

  // Migration 0008 (onboarding checklist): the tenant row is writable from a
  // school's session for ONE column only, and only on its own row.
  it("a school can set its own onboarding flag — and nothing else on the tenant row", async () => {
    const own = await withRls(tenantA.id, (tx) =>
      tx.$executeRaw`UPDATE tenants SET "onboardingDismissedAt" = now(), "updatedAt" = now() WHERE id = ${tenantA.id}`,
    );
    expect(own).toBe(1);

    const other = await withRls(tenantA.id, (tx) =>
      tx.$executeRaw`UPDATE tenants SET "onboardingDismissedAt" = now() WHERE id = ${tenantB.id}`,
    );
    expect(other).toBe(0);

    await expect(
      withRls(tenantA.id, (tx) => tx.$executeRaw`UPDATE tenants SET plan = 'PREMIUM' WHERE id = ${tenantA.id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withRls(tenantA.id, (tx) => tx.$executeRaw`UPDATE tenants SET settings = '{}' WHERE id = ${tenantA.id}`),
    ).rejects.toThrow(/permission denied/);
  });

  // Migration 0009 (academic settings): new tenant-owned tables get the same RLS.
  it("grade bands, terms and academic settings are invisible and unwritable across schools", async () => {
    await withRls(tenantB.id, (tx) =>
      tx.$executeRaw`INSERT INTO grade_bands (id, "tenantId", "minScore", grade) VALUES (${`gb-b-${Date.now()}`}, ${tenantB.id}, 0, 'F')`,
    );
    const seenByA = await withRls(tenantA.id, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM grade_bands WHERE "tenantId" = ${tenantB.id}`);
    expect(seenByA).toHaveLength(0);

    await expect(
      withRls(tenantA.id, (tx) =>
        tx.$executeRaw`INSERT INTO academic_settings (id, "tenantId", "updatedAt") VALUES (${`as-x-${Date.now()}`}, ${tenantB.id}, now())`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withRls(tenantA.id, (tx) =>
        tx.$executeRaw`INSERT INTO terms (id, "tenantId", "academicYearId", name, "order", "startDate", "endDate")
                       VALUES (${`t-x-${Date.now()}`}, ${tenantB.id}, ${academicYearA.id}, 'X', 1, '2026-09-01', '2026-12-01')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
