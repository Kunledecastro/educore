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
 * Defense-in-depth layer #1 (of two — see prisma/migrations/*_rls for the
 * PostgreSQL Row Level Security layer that backs this up at the database
 * level). This Prisma Client Extension transparently injects `tenantId` into
 * every query issued against a tenant-owned model, so application code can
 * never accidentally read or write across tenants by forgetting a `where`
 * clause.
 *
 * Usage: never import the bare `prisma` singleton in request-handling code.
 * Instead call `forTenant(tenantId)` (or `platformPrisma()` for
 * PLATFORM_ADMIN routes, which intentionally bypasses scoping) and use the
 * client it returns for the lifetime of that request.
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
          if (!model || !TENANT_OWNED_MODELS.has(model)) {
            return query(args);
          }

          const a = args as Record<string, any>;

          if (operation === "create") {
            a.data = { ...(a.data ?? {}), tenantId };
          } else if (operation === "createMany") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((row: Record<string, any>) => ({ ...row, tenantId }));
          } else if (READ_ACTIONS.has(operation) || WRITE_WHERE_ACTIONS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          }

          return query(a);
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
