import { z } from "zod";

/**
 * Approval policies (Phase 8): which actions need a second person, who that
 * is, and from what amount a second step is needed. Pure and unit-tested;
 * stored per school in tenant settings (config-first) and read by the engine.
 */

export const APPROVAL_PROCESSES = ["DISCOUNT_ASSIGN", "INVOICE_CANCEL", "PAYMENT_REVERSAL", "DISCOUNT_RULE", "RESULTS_PUBLISH", "RESULTS_UNPUBLISH", "STUDENT_STATUS", "ANNOUNCEMENT_SCHOOL", "LEAVE"] as const;
export type ApprovalProcess = (typeof APPROVAL_PROCESSES)[number];

/** Roles that may ever be approvers. */
export const APPROVER_ROLES = ["SCHOOL_ADMIN", "ACCOUNTANT"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/**
 * Who may approve each process. Money (8.0): admins and bursars. Academic
 * (8.1): school admins only; a bursar never signs off results, even if named.
 */
export const PROCESS_APPROVER_ROLES: Record<ApprovalProcess, readonly ApproverRole[]> = {
  DISCOUNT_ASSIGN: APPROVER_ROLES,
  INVOICE_CANCEL: APPROVER_ROLES,
  PAYMENT_REVERSAL: APPROVER_ROLES,
  DISCOUNT_RULE: APPROVER_ROLES,
  RESULTS_PUBLISH: ["SCHOOL_ADMIN"],
  RESULTS_UNPUBLISH: ["SCHOOL_ADMIN"],
  STUDENT_STATUS: ["SCHOOL_ADMIN"],
  ANNOUNCEMENT_SCHOOL: ["SCHOOL_ADMIN"],
  LEAVE: ["SCHOOL_ADMIN"],
};

/** Processes that are always requests (8.2: staff leave), whatever the switch says. */
export const ALWAYS_ON: ReadonlySet<ApprovalProcess> = new Set<ApprovalProcess>(["LEAVE"]);

/** Which group a process belongs to (Settings → Approvals sections). */
export const PROCESS_GROUP: Record<ApprovalProcess, "money" | "academic" | "people"> = {
  DISCOUNT_ASSIGN: "money",
  INVOICE_CANCEL: "money",
  PAYMENT_REVERSAL: "money",
  DISCOUNT_RULE: "money",
  RESULTS_PUBLISH: "academic",
  RESULTS_UNPUBLISH: "academic",
  STUDENT_STATUS: "people",
  ANNOUNCEMENT_SCHOOL: "people",
  LEAVE: "people",
};

export const approvalStepSchema = z.object({
  roles: z.array(z.enum(APPROVER_ROLES)).max(APPROVER_ROLES.length).default([]),
  userIds: z.array(z.string().min(1).max(40)).max(20).default([]),
});
export type ApprovalStep = z.infer<typeof approvalStepSchema>;

export const processPolicySchema = z.object({
  enabled: z.boolean().default(false),
  expiryDays: z.number().int().min(1).max(30).default(7),
  step1: approvalStepSchema.default({ roles: ["SCHOOL_ADMIN"], userIds: [] }),
  /** A second step, used when the amount is at or above `secondStepFromMinor`. */
  step2: approvalStepSchema.nullable().default(null),
  /** Minor units (kobo). null with a step2 = always two steps. */
  secondStepFromMinor: z.number().int().min(0).nullable().default(null),
});
export type ProcessPolicy = z.infer<typeof processPolicySchema>;

export const DEFAULT_POLICY: ProcessPolicy = processPolicySchema.parse({});

/** The school's approval settings: one policy per process; anything unreadable falls back to "off". */
export const approvalsSettingsSchema = z
  .object(Object.fromEntries(APPROVAL_PROCESSES.map((p) => [p, processPolicySchema.catch(DEFAULT_POLICY).default(DEFAULT_POLICY)])) as Record<ApprovalProcess, z.ZodDefault<z.ZodCatch<typeof processPolicySchema>>>)
  .catch(Object.fromEntries(APPROVAL_PROCESSES.map((p) => [p, DEFAULT_POLICY])) as Record<ApprovalProcess, ProcessPolicy>)
  .default(Object.fromEntries(APPROVAL_PROCESSES.map((p) => [p, DEFAULT_POLICY])) as Record<ApprovalProcess, ProcessPolicy>);
export type ApprovalsSettings = Record<ApprovalProcess, ProcessPolicy>;

/** Processes that have an amount (and so can have a second step by amount). */
export const HAS_AMOUNT: Record<ApprovalProcess, boolean> = { DISCOUNT_ASSIGN: true, INVOICE_CANCEL: true, PAYMENT_REVERSAL: true, DISCOUNT_RULE: false, RESULTS_PUBLISH: false, RESULTS_UNPUBLISH: false, STUDENT_STATUS: false, ANNOUNCEMENT_SCHOOL: false, LEAVE: false };

/** How many steps a request needs. */
export function stepsFor(policy: ProcessPolicy, amountMinor: number | null): 1 | 2 {
  if (!policy.step2) return 1;
  if (policy.secondStepFromMinor === null) return 2;
  if (amountMinor === null) return 1;
  return amountMinor >= policy.secondStepFromMinor ? 2 : 1;
}

export interface Person {
  id: string;
  role: string;
  isActive: boolean;
}

/** Can this person decide this step? Never their own request, never an earlier step's approver, only active approvers who match. */
export function canDecideStep(step: ApprovalStep, person: Person, ctx: { requesterId: string | null; earlierApproverIds: readonly string[]; allowedRoles?: readonly string[] }): boolean {
  if (!person.isActive) return false;
  if (!(ctx.allowedRoles ?? APPROVER_ROLES).includes(person.role)) return false;
  if (person.id === ctx.requesterId) return false;
  if (ctx.earlierApproverIds.includes(person.id)) return false;
  return step.roles.includes(person.role as ApproverRole) || step.userIds.includes(person.id);
}

/** Everyone in `people` who could decide the step (for "is there anybody?" and notifications). */
export function eligibleApprovers<P extends Person>(step: ApprovalStep, people: readonly P[], ctx: { requesterId: string | null; earlierApproverIds?: readonly string[]; allowedRoles?: readonly string[] }): P[] {
  return people.filter((p) => canDecideStep(step, p, { requesterId: ctx.requesterId, earlierApproverIds: ctx.earlierApproverIds ?? [], allowedRoles: ctx.allowedRoles }));
}

/**
 * A two-step request needs two different people: is that possible at all?
 * (Step 1 and step 2 must not be the only same single person.)
 */
export function hasEnoughApprovers(policy: ProcessPolicy, steps: 1 | 2, people: readonly Person[], requesterId: string | null, allowedRoles?: readonly string[]): boolean {
  const first = eligibleApprovers(policy.step1, people, { requesterId, allowedRoles });
  if (first.length === 0) return false;
  if (steps === 1) return true;
  const second = eligibleApprovers(policy.step2!, people, { requesterId, allowedRoles });
  if (second.length === 0) return false;
  // Some pair of different people must exist.
  return first.some((a) => second.some((b) => b.id !== a.id));
}

export function expiryFrom(now: Date, policy: ProcessPolicy): Date {
  return new Date(now.getTime() + policy.expiryDays * 86_400_000);
}

/** A reminder once a request has waited this long (and again each day after). */
export const REMIND_AFTER_MS = 2 * 86_400_000;
export function reminderDue(createdAt: Date, remindedAt: Date | null, now: Date): boolean {
  if (now.getTime() - createdAt.getTime() < REMIND_AFTER_MS) return false;
  return !remindedAt || now.getTime() - remindedAt.getTime() >= 86_400_000;
}

/** Settings warnings shown to the admin (a step nobody, or only one person, can decide). */
export function policyWarnings(policy: ProcessPolicy, people: readonly Person[], allowedRoles?: readonly string[]): ("step1None" | "step1One" | "step2None" | "step2SamePeople" | "step2NoThreshold")[] {
  const out: ReturnType<typeof policyWarnings> = [];
  const first = eligibleApprovers(policy.step1, people, { requesterId: null, allowedRoles });
  if (first.length === 0) out.push("step1None");
  else if (first.length === 1) out.push("step1One");
  if (policy.step2) {
    const second = eligibleApprovers(policy.step2, people, { requesterId: null, allowedRoles });
    if (second.length === 0) out.push("step2None");
    else if (!first.some((a) => second.some((b) => b.id !== a.id))) out.push("step2SamePeople");
  }
  return out;
}
