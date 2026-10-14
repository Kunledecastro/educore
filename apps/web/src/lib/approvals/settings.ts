import "server-only";
import { platformPrisma, recordAudit, type Prisma } from "@educore/db";
import { parseTenantSettings } from "../tenant-settings";
import { ApprovalError, type Actor, type Meta } from "./engine";
import { HAS_AMOUNT, PROCESS_APPROVER_ROLES, processPolicySchema, type ApprovalProcess, type ProcessPolicy } from "./policy";

/**
 * Settings → Approvals (Phase 8.0): a school admin sets one process's
 * policy. Named approvers must be this school's admins or bursars (admins only for results); a second
 * step only exists for processes with an amount. Support working as a school
 * admin can't change these controls. Audited (before/after).
 */
export async function saveProcessPolicy(actor: Actor, process: ApprovalProcess, input: unknown, meta: Meta): Promise<ProcessPolicy> {
  if (actor.role !== "SCHOOL_ADMIN" || actor.impersonating) throw new ApprovalError("notAllowed");
  const parsed = processPolicySchema.parse(input);
  // Roles that can't approve this process are dropped (e.g. bursars for results).
  const allowed = PROCESS_APPROVER_ROLES[process] as readonly string[];
  const keep = (step: ProcessPolicy["step1"]) => ({ ...step, roles: step.roles.filter((r) => allowed.includes(r)) });
  const scoped: ProcessPolicy = { ...parsed, step1: keep(parsed.step1), step2: parsed.step2 ? keep(parsed.step2) : null };
  const next: ProcessPolicy = HAS_AMOUNT[process] ? scoped : { ...scoped, step2: null, secondStepFromMinor: null };
  const db = platformPrisma();
  const named = [...new Set([...next.step1.userIds, ...(next.step2?.userIds ?? [])])];
  if (named.length) {
    const ok = await db.user.count({ where: { tenantId: actor.tenantId, id: { in: named }, role: { in: [...PROCESS_APPROVER_ROLES[process]] } } });
    if (ok !== named.length) throw new ApprovalError("notAllowed");
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { settings: true } });
    const raw = t.settings && typeof t.settings === "object" && !Array.isArray(t.settings) ? (t.settings as Record<string, unknown>) : {};
    const current = parseTenantSettings(raw).approvals;
    const approvals = { ...current, [process]: next };
    await tx.tenant.update({ where: { id: actor.tenantId }, data: { settings: { ...raw, approvals } as unknown as Prisma.InputJsonValue } });
    await recordAudit({ tenantId: actor.tenantId, actorId: actor.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: "UPDATE", entityType: "Tenant", entityId: actor.tenantId, before: { approvals: { [process]: current[process] } }, after: { approvals: { [process]: next } } }, tx);
  });
  return next;
}
