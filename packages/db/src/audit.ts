import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./client";
import { withRls } from "./rls";

/** Any client that can write an AuditLog row: the base client or an interactive-transaction client. */
type AuditWriter = Pick<PrismaClient, "auditLog">;

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
  client: AuditWriter = prisma,
) {
  await client.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: toAuditJson(params.before),
      after: toAuditJson(params.after),
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });
}

/** Fields that must never be copied into an audit trail, at any depth. */
const REDACTED_KEYS = new Set(["passwordHash", "password", "token", "access_token", "refresh_token", "id_token"]);

/**
 * Converts a row snapshot to plain JSON for the audit log: Dates become ISO
 * strings, Decimals/BigInts become strings, secrets are replaced by
 * "[REDACTED]". Exported for tests.
 */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 8) return "[TRUNCATED]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null && "toFixed" in value && typeof (value as { toString: unknown }).toString === "function" && !Array.isArray(value)) {
    // Prisma.Decimal
    return (value as { toString(): string }).toString();
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeForAudit(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? "[REDACTED]" : sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return value;
}

function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const clean = sanitizeForAudit(value);
  return clean === null ? Prisma.JsonNull : (clean as Prisma.InputJsonValue);
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

/**
 * The standard way to change audited data from a request: runs `run` inside
 * a tenant-bound RLS transaction (see ./rls) and writes the AuditLog row in
 * the SAME transaction — so the change and its audit entry commit together
 * or not at all. A mutation can never succeed silently without its trail.
 *
 * `run` receives the transaction client and returns the row's state before
 * (for UPDATE/DELETE — read it inside `run` so it's consistent) and after.
 * Writes inside `run` must set `tenantId` themselves; RLS rejects any row
 * whose tenantId isn't the context's tenant.
 */
export async function auditedMutation<T extends { id: string }>(
  ctx: AuditContext,
  params: {
    action: "CREATE" | "UPDATE" | "DELETE";
    entityType: AuditedEntityType | (string & {});
    run: (tx: PrismaClient) => Promise<{ before?: unknown; after: T }>;
  },
): Promise<T> {
  return withRls(ctx.tenantId, async (tx) => {
    const { before, after } = await params.run(tx);
    await recordAudit(
      ctx,
      {
        action: params.action,
        entityType: params.entityType,
        entityId: after.id,
        before: params.action === "CREATE" ? undefined : before,
        after: params.action === "DELETE" ? undefined : after,
      },
      tx,
    );
    return after;
  });
}
