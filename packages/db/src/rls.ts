import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client";

/**
 * Runs a multi-statement unit of work (background jobs, bulk imports, raw
 * SQL) inside ONE transaction with the same database-layer isolation that
 * `forTenant()` applies per operation: `app.tenant_id` is set and the
 * connection switches to the RLS-bound `educore_app` role (no BYPASSRLS),
 * both transaction-locally so nothing leaks across pooled connections.
 *
 * Inside `fn`, every row read or written is limited to `tenantId` by the
 * Postgres RLS policies (migrations 0002/0003/0004) — even a raw query with
 * no WHERE clause. Still pass `tenantId` explicitly on writes: RLS rejects
 * a row whose tenantId doesn't match rather than filling it in.
 */
export async function withRls<T>(
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  if (!tenantId) throw new Error("withRls() called without a tenantId");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx.$executeRaw`SET LOCAL ROLE educore_app`;
      return fn(tx as unknown as PrismaClient);
    },
    { timeout: options?.timeoutMs ?? 15_000 },
  );
}
