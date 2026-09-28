import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./client";

/**
 * Every model that carries a `tenantId` column. This is the single source of
 * truth the tenant-scoping extension below consults — a model NOT in this
 * set is treated as platform-level (e.g. Tenant itself, VerificationToken)
 * and is never auto-scoped. Keep this list in sync with schema.prisma.
 */
export const TENANT_OWNED_MODELS = new Set<Prisma.ModelName>([
  "User",
  "AcademicYear",
  "ClassGrade",
  "Section",
  "Subject",
  "ClassSectionSubject",
  "Student",
  "Guardian",
  "StudentGuardian",
  "Teacher",
  "Staff",
  "Attendance",
  "AssessmentType",
  "Assessment",
  "Mark",
  "ReportCard",
  "TimetableEntry",
  "Announcement",
  "MessageThread",
  "Message",
  "FeeType",
  "FeeStructure",
  "Invoice",
  "InvoiceLine",
  "Payment",
  "AuditLog",
  "ImportJob",
]);

const READ_ACTIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const WRITE_WHERE_ACTIONS = new Set(["update", "updateMany", "delete", "deleteMany", "upsert"]);

/**
 * Tenant-scoped Prisma client. Two independent layers, so a bug in one
 * cannot leak data on its own (architecture rule #1):
 *
 * 1. **Application layer** — `tenantId` is injected into every `where` /
 *    `data` for tenant-owned models, so code can't forget the filter or
 *    spoof another tenant's id in a create payload.
 * 2. **Database layer** — every operation runs in its own short transaction
 *    that first does `set_config('app.tenant_id', …, true)` and
 *    `SET LOCAL ROLE educore_app`. That role has no BYPASSRLS, so the
 *    Postgres RLS policies apply even if layer 1 were removed. Both settings
 *    are transaction-local, so they never leak across a pooled connection.
 *
 * Usage: request code never imports the bare `prisma` singleton — it calls
 * `forTenant(tenantId)` (via `requireUser()`), or `platformPrisma()` for
 * audited PLATFORM_ADMIN routes.
 *
 * Constraint: because each operation is already wrapped in a transaction,
 * don't call `$transaction` on this client. For multi-statement units of
 * work use `withRls(tenantId, tx => …)` from ./rls, which applies the same
 * two settings once for the whole transaction.
 */
export function forTenant(tenantId: string) {
  if (!tenantId) {
    throw new Error("forTenant() called without a tenantId — refusing to build an unscoped client");
  }

  return prisma.$extends({
    name: `tenant-scope:${tenantId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = (args ?? {}) as Record<string, any>;

          if (model && TENANT_OWNED_MODELS.has(model)) {
            if (operation === "create") {
              a.data = { ...(a.data ?? {}), tenantId };
            } else if (operation === "createMany") {
              const rows = Array.isArray(a.data) ? a.data : [a.data];
              a.data = rows.map((row: Record<string, any>) => ({ ...row, tenantId }));
            } else if (READ_ACTIONS.has(operation) || WRITE_WHERE_ACTIONS.has(operation)) {
              a.where = { ...(a.where ?? {}), tenantId };
            }
          }

          const [, , result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            prisma.$executeRaw`SET LOCAL ROLE educore_app`,
            query(a),
          ]);
          return result;
        },
      },
    },
  });
}

/**
 * Explicit escape hatch for PLATFORM_ADMIN routes, which by design operate
 * above tenant isolation (architecture rule #1). Every use of this client
 * MUST be paired with an AuditLog write and a route guarded by
 * `requireRole(Role.PLATFORM_ADMIN)` — see packages/auth.
 */
export function platformPrisma(): PrismaClient {
  return prisma;
}

export type TenantScopedClient = ReturnType<typeof forTenant>;
