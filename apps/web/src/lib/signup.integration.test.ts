import { afterAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@educore/auth";
import { forTenant, prisma } from "@educore/db";
import { loadEntitlements } from "./entitlements-data";
import { createSchool, SignupError, slugAvailable } from "./signup";

/**
 * Self-serve sign-up against a real Postgres: one transaction makes the
 * school (on the free trial) and its admin; short names and emails are
 * unique even when two sign-ups race; both audit logs record it; and the new
 * school sees nothing of any other school.
 */

const stamp = Date.now();
const created: string[] = [];
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
const school = (n: string) => ({ schoolName: `Sign-up School ${n}`, slug: `su-${n}-${stamp}`, adminName: `Admin ${n}`, email: `Admin.${n}.${stamp}@Example.test`, password: "Passw0rd!2345" });

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: created } } }).catch(() => undefined); // audit log is append-only
  await prisma.$disconnect();
});

describe("school sign-up", () => {
  it("creates the school on a 30-day trial with its first admin, audited in both logs", async () => {
    const input = school("a");
    expect(await slugAvailable(input.slug)).toBe(true);
    const { tenantId, userId } = await createSchool(input, meta);
    created.push(tenantId);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant).toMatchObject({ name: input.schoolName, slug: input.slug, subdomain: input.slug, plan: "FREE_TRIAL", status: "ACTIVE" });
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(admin).toMatchObject({ tenantId, role: "SCHOOL_ADMIN", isActive: true, email: input.email.toLowerCase() });
    expect(await verifyPassword(admin.passwordHash!, input.password)).toBe(true);

    expect(await loadEntitlements(tenantId)).toMatchObject({ state: "trial", plan: "FREE_TRIAL", canWrite: true });
    expect(await prisma.auditLog.count({ where: { tenantId, actorId: userId, action: "CREATE" } })).toBe(2);
    const platform = await prisma.platformAuditLog.findFirstOrThrow({ where: { tenantId, action: "TENANT_SIGNUP" } });
    expect(JSON.stringify(platform)).not.toContain(input.password);
    expect(await slugAvailable(input.slug)).toBe(false);
  });

  it("refuses a short name or email already in use", async () => {
    const a = school("a");
    await expect(createSchool({ ...school("b"), slug: a.slug }, meta)).rejects.toEqual(new SignupError("slugTaken"));
    await expect(createSchool({ ...school("b"), email: a.email.toUpperCase() }, meta)).rejects.toEqual(new SignupError("emailTaken"));
    // An existing school's subdomain counts too.
    const greenfieldLike = await prisma.tenant.create({ data: { name: "Other", slug: `other-${stamp}`, subdomain: `taken-sub-${stamp}` } });
    created.push(greenfieldLike.id);
    await expect(createSchool({ ...school("c"), slug: `taken-sub-${stamp}` }, meta)).rejects.toEqual(new SignupError("slugTaken"));
  });

  it("two sign-ups racing for the same short name: exactly one school is created", async () => {
    const slug = `su-race-${stamp}`;
    const results = await Promise.allSettled([createSchool({ ...school("r1"), slug }, meta), createSchool({ ...school("r2"), slug }, meta)]);
    const won = results.filter((r): r is PromiseFulfilledResult<{ tenantId: string; userId: string }> => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    created.push(won[0]!.value.tenantId);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toEqual(new SignupError("slugTaken"));
    expect(await prisma.tenant.count({ where: { slug } })).toBe(1);
    // The loser left nothing behind (no orphan admin).
    expect(await prisma.user.count({ where: { email: { in: [school("r1").email.toLowerCase(), school("r2").email.toLowerCase()] } } })).toBe(1);
  });

  it("a new school sees only itself", async () => {
    const { tenantId } = await createSchool(school("iso"), meta);
    created.push(tenantId);
    const db = forTenant(tenantId);
    expect(await db.student.count()).toBe(0);
    expect(await db.user.count()).toBe(1);
    expect((await db.auditLog.findMany()).every((a) => a.tenantId === tenantId)).toBe(true);
  });
});
