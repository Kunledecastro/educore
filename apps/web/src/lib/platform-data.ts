import "server-only";
import { platformPrisma, type Plan, type Prisma, type TenantStatus } from "@educore/db";
import { parseListParams, type SearchParamsInput } from "./list-params";

/**
 * Platform console reads (Phase 4.0). These deliberately use the platform
 * client — above tenant isolation — and are only ever called from pages
 * that have already checked the caller is a platform admin.
 */

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "CANCELLED"] as const;
export const PLANS = ["FREE_TRIAL", "STARTER", "STANDARD", "PREMIUM"] as const;

export function tenantListQuery(sp: SearchParamsInput) {
  const params = parseListParams(sp, {
    sortable: ["name", "createdAt"] as const,
    defaultSort: "createdAt" as const,
    defaultDir: "desc",
    filters: { status: TENANT_STATUSES, plan: PLANS },
  });
  const where: Prisma.TenantWhereInput = {
    AND: [
      params.filters.status ? { status: params.filters.status as TenantStatus } : {},
      params.filters.plan ? { plan: params.filters.plan as Plan } : {},
      params.q
        ? { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { slug: { contains: params.q, mode: "insensitive" } }, { users: { some: { email: { contains: params.q, mode: "insensitive" } } } }] }
        : {},
    ],
  };
  const orderBy: Prisma.TenantOrderByWithRelationInput[] = params.sort === "name" ? [{ name: params.dir }] : [{ createdAt: params.dir }];
  return { params, where, orderBy: [...orderBy, { id: "asc" as const }] };
}

export interface TenantUsage {
  students: number;
  staff: number;
  parents: number;
  lastActivity: Date | null;
}

/** Usage for a page of schools, in a fixed number of grouped queries. */
export async function usageFor(tenantIds: string[]): Promise<Map<string, TenantUsage>> {
  const db = platformPrisma();
  const [students, users, activity] = await Promise.all([
    db.student.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, status: "ACTIVE" }, _count: { _all: true } }),
    db.user.groupBy({ by: ["tenantId", "role"], where: { tenantId: { in: tenantIds }, isActive: true }, _count: { _all: true } }),
    db.auditLog.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds } }, _max: { createdAt: true } }),
  ]);
  const out = new Map<string, TenantUsage>(tenantIds.map((id) => [id, { students: 0, staff: 0, parents: 0, lastActivity: null }]));
  for (const s of students) out.get(s.tenantId)!.students = s._count._all;
  for (const u of users) {
    const row = u.tenantId ? out.get(u.tenantId) : undefined;
    if (!row) continue;
    if (u.role === "PARENT") row.parents += u._count._all;
    else if (u.role !== "STUDENT") row.staff += u._count._all;
  }
  for (const a of activity) out.get(a.tenantId)!.lastActivity = a._max.createdAt;
  return out;
}

/** Trial days left (negative = trial over), from the subscription's period end or 30 days after creation. */
export function trialDaysLeft(t: { plan: Plan; createdAt: Date; subscription: { currentPeriodEnd: Date | null } | null }, now: Date = new Date()): number | null {
  if (t.plan !== "FREE_TRIAL") return null;
  const end = t.subscription?.currentPeriodEnd ?? new Date(t.createdAt.getTime() + 30 * 86_400_000);
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}
