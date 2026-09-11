import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client";

/**
 * Defense-in-depth layer #2: PostgreSQL Row Level Security (see the RLS
 * migration under prisma/migrations for the policies themselves).
 *
 * KNOWN PHASE-0 LIMITATION (documented per project working rules — stated
 * explicitly rather than silently glossed over): RLS policies compare each
 * tenant-owned row's `tenant_id` against the Postgres session variable
 * `app.tenant_id`. Setting that variable safely requires either (a) a
 * dedicated, non-pooled connection per request, or (b) wrapping the whole
 * unit of work in one transaction that opens with `SET LOCAL`, because a
 * bare session-level `SET` on a pgbouncer-pooled connection can leak one
 * tenant's context into the next request that reuses the same connection.
 *
 * `forTenant()` in tenant-scope.ts (layer #1, enforced on every ordinary
 * request via Prisma Client Extensions) does NOT currently call this — it
 * is the layer that protects the ordinary request path today. `withRls()`
 * below is for the paths that run outside a per-request Prisma call and
 * therefore most need the second guarantee: background jobs (report-card
 * generation, bulk CSV import) and any hand-written raw SQL. Wiring RLS
 * into the hot path for every ORM call too is the next hardening step,
 * tracked for Phase 1, once the background-job runner (Inngest/Trigger.dev)
 * gives us one connection per job rather than a shared pool.
 */
export async function withRls<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}
