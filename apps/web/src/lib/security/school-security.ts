import { platformPrisma, Prisma, recordAudit, recordPlatformAudit, withRls, type Role } from "@educore/db";
import { parseTenantSettings } from "../tenant-settings";
import { twoFactorRequired } from "./rules";

/**
 * A school's sign-in security (Phase 6.0): whether teachers must use 2FA, and
 * who in the school has it on. School admins only (the caller checks the
 * permission; the setting lives on the tenant row, written for the admin's
 * own school only).
 */

export async function getSchoolSecurity(tenantId: string): Promise<{ requireTeacher2fa: boolean; exempt: boolean }> {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const s = parseTenantSettings(t?.settings);
  return { ...s.security, exempt: s.platformFlags.twoFactorExempt };
}

/** Platform team only: mark a shared demo school as not requiring 2FA (or undo it). Audited in both logs. */
export async function setTwoFactorExempt(actor: { id: string; ipAddress: string | null; userAgent: string | null }, tenantId: string, exempt: boolean) {
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    if (!t) throw new Error("Tenant not found");
    const raw = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
    const before = parseTenantSettings(raw).platformFlags;
    await tx.tenant.update({ where: { id: tenantId }, data: { settings: { ...raw, platformFlags: { ...before, twoFactorExempt: exempt } } as unknown as Prisma.InputJsonValue } });
    await recordPlatformAudit({ actorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "TENANT_2FA_EXEMPT", tenantId, entityType: "Tenant", entityId: tenantId, before, after: { twoFactorExempt: exempt } }, tx);
    await recordAudit({ tenantId, actorId: null, impersonatorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "UPDATE", entityType: "Tenant", entityId: tenantId, before: { platformFlags: before }, after: { platformFlags: { twoFactorExempt: exempt } } }, tx);
  });
}

export async function saveSchoolSecurity(actor: { id: string; tenantId: string; ipAddress: string | null; userAgent: string | null }, requireTeacher2fa: boolean) {
  await platformPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { settings: true } });
    const raw = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
    const before = parseTenantSettings(raw).security;
    await tx.tenant.update({ where: { id: actor.tenantId }, data: { settings: { ...raw, security: { requireTeacher2fa } } as unknown as Prisma.InputJsonValue } });
    await recordAudit({ tenantId: actor.tenantId, actorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "UPDATE", entityType: "Tenant", entityId: actor.tenantId, before: { security: before }, after: { security: { requireTeacher2fa } } }, tx);
  });
}

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  required: boolean;
}

/** Staff and parents of the school with their 2FA status (pupils aren't offered it). Required-but-off first. */
export async function schoolAccounts(tenantId: string, opts: { q?: string; filter?: "all" | "missing" | "on"; skip?: number; take?: number } = {}) {
  const school = await getSchoolSecurity(tenantId);
  const requiredRoles: Role[] = school.exempt ? [] : ["SCHOOL_ADMIN", "ACCOUNTANT", "SCHOOL_NURSE", ...(school.requireTeacher2fa ? (["TEACHER"] as Role[]) : [])];
  const where: Prisma.UserWhereInput = {
    tenantId,
    role: { not: "STUDENT" },
    ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { email: { contains: opts.q, mode: "insensitive" } }] } : {}),
    ...(opts.filter === "on" ? { twoFactorEnabled: true } : {}),
    ...(opts.filter === "missing" ? { twoFactorEnabled: false, isActive: true, role: { in: requiredRoles } } : {}),
  };
  return withRls(tenantId, async (tx) => {
    const [rows, total, missing] = await Promise.all([
      tx.user.findMany({ where, orderBy: [{ role: "asc" }, { name: "asc" }], skip: opts.skip ?? 0, take: opts.take ?? 25, select: { id: true, name: true, email: true, role: true, isActive: true, twoFactorEnabled: true } }),
      tx.user.count({ where }),
      tx.user.count({ where: { tenantId, isActive: true, twoFactorEnabled: false, role: { in: requiredRoles } } }),
    ]);
    return {
      school,
      total,
      missing,
      rows: rows.map((u): AccountRow => ({ ...u, name: u.name ?? "", required: twoFactorRequired(u.role, school) })),
    };
  });
}
