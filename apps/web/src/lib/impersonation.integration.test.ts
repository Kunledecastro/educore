import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { ImpersonationError, resolveImpersonation, startImpersonation, stopImpersonation } from "./impersonation";

/**
 * Support impersonation and the platform tables against a real Postgres
 * (migrations through 0017): who can be impersonated, that the cookie alone
 * is never enough, expiry and stopping, both audit trails, and that school
 * sessions can't see or touch platform tables.
 */

process.env.NEXTAUTH_SECRET ??= "integration-test-secret";
const stamp = Date.now();
let A: string;
let B: string;
let platformAdmin: string;
let otherPlatformAdmin: string;
let schoolAdmin: string;
let teacher: string;
let suspendedAdmin: string;
const actor = () => ({ id: platformAdmin, ipAddress: "127.0.0.1", userAgent: "test" });

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "Imp A", slug: `imp-a-${stamp}`, subdomain: `imp-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "Imp B (suspended)", slug: `imp-b-${stamp}`, subdomain: `imp-b-${stamp}`, status: "SUSPENDED" } }),
  ]);
  A = a.id;
  B = b.id;
  const mk = (email: string, role: "PLATFORM_ADMIN" | "SCHOOL_ADMIN" | "TEACHER", tenantId: string | null) =>
    prisma.user.create({ data: { email: `${email}-${stamp}@example.test`, name: email, role, tenantId } }).then((u) => u.id);
  platformAdmin = await mk("pa", "PLATFORM_ADMIN", null);
  otherPlatformAdmin = await mk("pa2", "PLATFORM_ADMIN", null);
  schoolAdmin = await mk("sa", "SCHOOL_ADMIN", A);
  teacher = await mk("t", "TEACHER", A);
  suspendedAdmin = await mk("sb", "SCHOOL_ADMIN", B);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("support impersonation", () => {
  it("only an active school admin of an active school can be impersonated", async () => {
    await expect(startImpersonation(actor(), teacher, "ticket 1")).rejects.toMatchObject({ code: "notSchoolAdmin" });
    await expect(startImpersonation(actor(), suspendedAdmin, "ticket 1")).rejects.toBeInstanceOf(ImpersonationError);
    await expect(startImpersonation(actor(), "nope-not-a-user", "ticket 1")).rejects.toMatchObject({ code: "notFound" });
  });

  it("starts a 30-minute session, recorded in the platform log AND the school's own log", async () => {
    const now = new Date();
    const { cookie, expiresAt, tenantId } = await startImpersonation(actor(), schoolAdmin, "Ticket #142: report cards", now);
    expect(tenantId).toBe(A);
    expect(expiresAt.getTime() - now.getTime()).toBe(30 * 60_000);
    const imp = await resolveImpersonation(platformAdmin, cookie, now);
    expect(imp?.target).toMatchObject({ id: schoolAdmin, tenantId: A, role: "SCHOOL_ADMIN" });
    expect(await prisma.platformAuditLog.count({ where: { actorId: platformAdmin, action: "IMPERSONATION_START", tenantId: A } })).toBe(1);
    const schoolLog = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: A, entityType: "SupportSession" } });
    expect(schoolLog).toMatchObject({ actorId: schoolAdmin, impersonatorId: platformAdmin, action: "CREATE" });
  });

  it("the cookie alone is never enough: another platform admin, an expired time or a forged cookie get nothing", async () => {
    const now = new Date();
    const { cookie } = await startImpersonation(actor(), schoolAdmin, "Ticket #143", now);
    expect(await resolveImpersonation(otherPlatformAdmin, cookie, now)).toBeNull();
    expect(await resolveImpersonation(platformAdmin, cookie, new Date(now.getTime() + 31 * 60_000))).toBeNull();
    expect(await resolveImpersonation(platformAdmin, cookie.slice(0, -2) + "xx", now)).toBeNull();
  });

  it("starting a new session ends the previous one; stopping ends it for good", async () => {
    const now = new Date();
    const first = await startImpersonation(actor(), schoolAdmin, "Ticket #144", now);
    const second = await startImpersonation(actor(), schoolAdmin, "Ticket #145", now);
    expect(await resolveImpersonation(platformAdmin, first.cookie, now)).toBeNull();
    expect(await resolveImpersonation(platformAdmin, second.cookie, now)).not.toBeNull();
    expect(await stopImpersonation(actor())).toBe(1);
    expect(await resolveImpersonation(platformAdmin, second.cookie, now)).toBeNull();
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "SupportSession", action: "UPDATE" } })).toBe(1);
  });

  it("a session ends the moment the school is suspended or the admin deactivated", async () => {
    const now = new Date();
    const { cookie } = await startImpersonation(actor(), schoolAdmin, "Ticket #146", now);
    await prisma.user.update({ where: { id: schoolAdmin }, data: { isActive: false } });
    expect(await resolveImpersonation(platformAdmin, cookie, now)).toBeNull();
    await prisma.user.update({ where: { id: schoolAdmin }, data: { isActive: true } });
    expect(await resolveImpersonation(platformAdmin, cookie, now)).not.toBeNull();
  });
});

describe("platform tables", () => {
  it("are invisible and unwritable for school sessions", async () => {
    await expect(withRls(A, (tx) => tx.$queryRaw`SELECT count(*) FROM platform_audit_logs`)).rejects.toThrow(/permission denied/);
    await expect(withRls(A, (tx) => tx.$queryRaw`SELECT count(*) FROM impersonation_sessions`)).rejects.toThrow(/permission denied/);
    await expect(
      withRls(A, (tx) => tx.$executeRaw`INSERT INTO platform_audit_logs (id, action, "entityType", "entityId") VALUES (${`x-${stamp}`}, 'X', 'X', 'X')`),
    ).rejects.toThrow(/permission denied/);
  });

  it("the platform audit log is append-only even for the owner", async () => {
    await expect(prisma.platformAuditLog.updateMany({ data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.platformAuditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
