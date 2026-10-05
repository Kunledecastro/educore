import { platformPrisma, type PrismaClient } from "@educore/db";
import { computeEntitlements, DEFAULT_PLANS, MODULES, type Entitlements, type Module, type PlanCode, type PlanSpec } from "./entitlements";

/**
 * Loading plans and a school's entitlements from the database (4.1). No
 * request APIs here, so background jobs (imports, billing runs) can use it
 * too; pages and actions go through the per-request cache in
 * entitlements-server.ts. Plans and subscriptions are platform tables, read
 * with the platform client — schools never query them directly.
 */

export interface PlanRow extends PlanSpec {
  name: string;
  isPublic: boolean;
  updatedAt: Date | null;
}

const KNOWN = new Set<string>(MODULES);

export function toPlanRow(r: { code: string; name: string; priceMinor: number; maxStudents: number | null; modules: string[]; isPublic: boolean; updatedAt: Date }): PlanRow {
  return {
    code: r.code as PlanCode,
    name: r.name,
    priceMinor: r.priceMinor,
    maxStudents: r.maxStudents,
    modules: r.modules.filter((m): m is Module => KNOWN.has(m)),
    isPublic: r.isPublic,
    updatedAt: r.updatedAt,
  };
}

/** The whole catalogue, in plan order. A plan missing from the table falls back to the built-in default. */
export async function loadPlans(): Promise<PlanRow[]> {
  const rows = await platformPrisma().planDefinition.findMany();
  const byCode = new Map(rows.map((r) => [r.code, toPlanRow(r)]));
  return (Object.keys(DEFAULT_PLANS) as PlanCode[]).map(
    (code) => byCode.get(code) ?? { ...DEFAULT_PLANS[code], name: code, isPublic: code !== "FREE_TRIAL", updatedAt: null },
  );
}

export async function loadEntitlements(tenantId: string, now: Date = new Date()): Promise<Entitlements> {
  const db = platformPrisma();
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true, status: true, createdAt: true, subscription: { select: { status: true, currentPeriodEnd: true } } },
  });
  // Fail closed: an unknown school has nothing.
  if (!tenant) return computeEntitlements({ tenantStatus: "SUSPENDED", tenantCreatedAt: now, plan: DEFAULT_PLANS.FREE_TRIAL, subscription: null }, now);
  const row = await db.planDefinition.findUnique({ where: { code: tenant.plan } });
  const plan = row ? toPlanRow(row) : DEFAULT_PLANS[tenant.plan as PlanCode];
  return computeEntitlements({ tenantStatus: tenant.status, tenantCreatedAt: tenant.createdAt, plan, subscription: tenant.subscription }, now);
}

/** Students that count against the plan's cap. */
export function countActiveStudents(db: { student: { count(args: { where: { tenantId: string; status: "ACTIVE" } }): Promise<number> } }, tenantId: string): Promise<number> {
  return db.student.count({ where: { tenantId, status: "ACTIVE" } });
}

/**
 * Inside a write transaction: may `adding` more ACTIVE students be enrolled?
 * Takes a per-school advisory lock first, so two enrolments at the same
 * moment can't both squeeze into the last place.
 */
export async function hasStudentCapacity(
  tx: Pick<PrismaClient, "student" | "$executeRaw">,
  tenantId: string,
  maxStudents: number | null,
  adding = 1,
): Promise<boolean> {
  if (maxStudents === null) return true;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-cap:${tenantId}`}))`;
  return (await countActiveStudents(tx, tenantId)) + adding <= maxStudents;
}
