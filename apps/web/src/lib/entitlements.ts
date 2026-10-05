/**
 * Plans, modules and subscription state (Phase 4.1) — the single source of
 * truth for "may this school use X right now?". Pure and unit-tested, like
 * the RBAC matrix. RBAC says what a ROLE may do; entitlements say what the
 * SCHOOL has paid for. Both must pass.
 */
import type { Action, Resource } from "@educore/auth";

export const MODULES = ["attendance", "assessments", "reportCards", "timetable", "fees", "onlinePayments", "messaging"] as const;
export type Module = (typeof MODULES)[number];

export type PlanCode = "FREE_TRIAL" | "STARTER" | "STANDARD" | "PREMIUM";

export interface PlanSpec {
  code: PlanCode;
  /** Price per active student per month, minor units (kobo). 0 for the trial. */
  priceMinor: number;
  /** null = unlimited */
  maxStudents: number | null;
  modules: Module[];
}

/** Placeholder catalogue (confirmed 2026-10-05); the platform console edits the `plans` table, this seeds it. */
export const DEFAULT_PLANS: Record<PlanCode, PlanSpec> = {
  FREE_TRIAL: { code: "FREE_TRIAL", priceMinor: 0, maxStudents: 500, modules: [...MODULES] },
  STARTER: { code: "STARTER", priceMinor: 30_000, maxStudents: 300, modules: ["attendance", "assessments", "timetable", "messaging"] },
  STANDARD: { code: "STANDARD", priceMinor: 50_000, maxStudents: 1500, modules: ["attendance", "assessments", "reportCards", "timetable", "fees", "messaging"] },
  PREMIUM: { code: "PREMIUM", priceMinor: 80_000, maxStudents: null, modules: [...MODULES] },
};

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 7;

/** Which module a resource belongs to. Anything not listed is core (always available). */
export const RESOURCE_MODULE: Partial<Record<Resource, Module>> = {
  attendance: "attendance",
  assessment: "assessments",
  mark: "assessments",
  results: "assessments",
  reportCard: "reportCards",
  timetable: "timetable",
  feeStructure: "fees",
  invoice: "fees",
  payment: "fees",
  announcement: "messaging",
  message: "messaging",
};

export type SubscriptionState =
  | "trial" // free trial running: everything in the trial plan
  | "active" // paid and current
  | "grace" // payment failed / period ended, within the grace window: full access + warning
  | "readOnly" // trial over, or grace over, or cancelled: view and export only
  | "suspended"; // suspended by the platform (sign-in is already blocked)

export interface EntitlementInput {
  tenantStatus: "ACTIVE" | "SUSPENDED" | "CANCELLED";
  tenantCreatedAt: Date;
  plan: PlanSpec;
  subscription: { status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "INCOMPLETE"; currentPeriodEnd: Date | null } | null;
}

export interface Entitlements {
  plan: PlanCode;
  state: SubscriptionState;
  modules: ReadonlySet<Module>;
  maxStudents: number | null;
  /** When the trial ends, the paid period ends, or the grace window ends — whatever applies now. */
  until: Date | null;
  /** Writes allowed at all (false in readOnly/suspended). */
  canWrite: boolean;
}

const days = (n: number) => n * 86_400_000;

export function computeEntitlements(input: EntitlementInput, now: Date = new Date()): Entitlements {
  const base = { plan: input.plan.code, modules: new Set(input.plan.modules), maxStudents: input.plan.maxStudents };
  if (input.tenantStatus !== "ACTIVE") return { ...base, state: "suspended", until: null, canWrite: false };

  const sub = input.subscription;
  if (input.plan.code === "FREE_TRIAL") {
    const end = sub?.currentPeriodEnd ?? new Date(input.tenantCreatedAt.getTime() + days(TRIAL_DAYS));
    return now < end ? { ...base, state: "trial", until: end, canWrite: true } : { ...base, state: "readOnly", until: end, canWrite: false };
  }

  // A paid plan with no subscription row = set by the platform team (complimentary/manual) with no end.
  if (!sub) return { ...base, state: "active", until: null, canWrite: true };
  if (sub.status === "CANCELLED") return { ...base, state: "readOnly", until: sub.currentPeriodEnd, canWrite: false };
  const end = sub.currentPeriodEnd;
  if (end === null) return { ...base, state: sub.status === "ACTIVE" ? "active" : "grace", until: null, canWrite: true };
  if (now < end && sub.status === "ACTIVE") return { ...base, state: "active", until: end, canWrite: true };
  // Period over (or a failed payment): a grace window, then read-only.
  const graceEnd = new Date(Math.max(end.getTime(), sub.status === "PAST_DUE" && now < end ? now.getTime() : end.getTime()) + days(GRACE_DAYS));
  return now < graceEnd ? { ...base, state: "grace", until: graceEnd, canWrite: true } : { ...base, state: "readOnly", until: graceEnd, canWrite: false };
}

const WRITE_ACTIONS: ReadonlySet<Action> = new Set(["create", "update", "delete", "import"]);

export type EntitlementRefusal = { reason: "module"; module: Module } | { reason: "readOnly" } | null;

/**
 * May the school do `action` on `resource` right now? Reads of a module the
 * plan doesn't include are refused too (the page offers an upgrade). In
 * read-only state everything can still be READ and EXPORTED.
 */
export function checkEntitlement(e: Entitlements, resource: Resource, action: Action): EntitlementRefusal {
  const module = RESOURCE_MODULE[resource];
  if (module && !e.modules.has(module)) return { reason: "module", module };
  // A lapsed school must still be able to pay to get going again.
  if (e.state === "readOnly" && resource === "subscription") return null;
  if (!e.canWrite && WRITE_ACTIONS.has(action)) return { reason: "readOnly" };
  return null;
}

/** Can `adding` more active students be enrolled? */
export function studentCapacity(e: Entitlements, activeStudents: number, adding = 1): { ok: boolean; remaining: number | null } {
  if (e.maxStudents === null) return { ok: true, remaining: null };
  const remaining = Math.max(0, e.maxStudents - activeStudents);
  return { ok: adding <= remaining, remaining };
}

/** Monthly charge for a plan, minor units. */
export function monthlyChargeMinor(plan: PlanSpec, activeStudents: number): number {
  return plan.priceMinor * Math.max(0, activeStudents);
}
