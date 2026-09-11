import { Prisma } from "@prisma/client";
import { prisma } from "./client";

/**
 * Entities the architecture spec calls out by name (rule #3: "Every
 * create/update/delete on grades, attendance, fees, and user records writes
 * an audit entry"). `entityType` also accepts any other string so a route
 * can log something ad-hoc, but these four are the ones that MUST never be
 * mutated without going through `withAudit`.
 */
export const AUDITED_ENTITY_TYPES = ["Mark", "Attendance", "Invoice", "Payment", "FeeStructure", "User"] as const;
export type AuditedEntityType = (typeof AUDITED_ENTITY_TYPES)[number];

export interface AuditContext {
  tenantId: string;
  actorId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Writes one immutable AuditLog row. AuditLog has no update/delete route
 * anywhere in the app — see packages/auth permission matrix, where every
 * role (including SCHOOL_ADMIN) is granted `read` only on `auditLog`, never
 * `update` or `delete`.
 */
export async function recordAudit(
  ctx: AuditContext,
  params: {
    action: "CREATE" | "UPDATE" | "DELETE";
    entityType: AuditedEntityType | (string & {});
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: (params.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      after: (params.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });
}

/**
 * Audit-log interceptor (architecture rule #3). Wraps a single
 * create/update/delete call: runs the mutation, then records an immutable
 * before/after AuditLog entry. Any route touching Mark, Attendance, Invoice,
 * Payment, FeeStructure, or User MUST go through this rather than calling
 * `prisma.<model>.update/delete(...)` directly, so no audited write can ever
 * skip logging.
 *
 * For updates/deletes, pass `before` (the row as it looked before the
 * mutation — fetch it in the caller, since Prisma has no built-in
 * before-hook) so the audit trail can show what changed.
 */
export async function withAudit<T extends { id: string }>(
  ctx: AuditContext,
  params: {
    action: "CREATE" | "UPDATE" | "DELETE";
    entityType: AuditedEntityType | (string & {});
    before?: unknown;
    mutate: () => Promise<T>;
  },
): Promise<T> {
  const after = await params.mutate();
  await recordAudit(ctx, {
    action: params.action,
    entityType: params.entityType,
    entityId: after.id,
    before: params.before,
    after: params.action === "DELETE" ? undefined : after,
  });
  return after;
}
