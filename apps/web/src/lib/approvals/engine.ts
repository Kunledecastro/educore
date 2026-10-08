import "server-only";
import { Prisma, platformPrisma, recordAudit, withRls, type PrismaClient } from "@educore/db";
import { parseTenantSettings } from "../tenant-settings";
import { APPROVER_ROLES, canDecideStep, eligibleApprovers, expiryFrom, hasEnoughApprovers, reminderDue, stepsFor, type ApprovalProcess, type ApprovalsSettings, type ApprovalStep, type Person, type ProcessPolicy } from "./policy";
import { errorCode, PROCESSES, type Summary } from "./processes";

/**
 * The approval engine (Phase 8.0): maker-checker for sensitive actions.
 *
 * - `requestApproval` checks the change could happen now, snapshots it and
 *   stores it as PENDING — nothing in the school's data changes.
 * - `decide` records one approver's decision. The final approval applies the
 *   change in the SAME transaction, through the same writer the screens use,
 *   with the request row locked — so it applies exactly once, and a change
 *   that is no longer possible fails safely (status FAILED, nothing applied).
 * - Nobody decides their own request or two steps of one request; EduCore
 *   support working as a school admin never decides.
 */

type Tx = PrismaClient;

export type ApprovalErrorCode = "notFound" | "notAllowed" | "noApprover" | "alreadyPending" | "notPending" | "expired" | "ownRequest" | "commentRequired" | "supportCannotDecide" | "changed";
export class ApprovalError extends Error {
  constructor(public readonly code: ApprovalErrorCode) {
    super(code);
    this.name = "ApprovalError";
  }
}

export interface Actor {
  tenantId: string;
  userId: string;
  role: string;
  impersonating: boolean;
}
export interface Meta {
  ipAddress: string | null;
  userAgent: string | null;
}

export async function approvalSettings(tenantId: string): Promise<ApprovalsSettings> {
  const t = await platformPrisma().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return parseTenantSettings(t?.settings).approvals;
}

/** Does this action need approval in this school right now? */
export async function approvalRequired(tenantId: string, process: ApprovalProcess): Promise<boolean> {
  return (await approvalSettings(tenantId))[process].enabled;
}

async function approverPool(tx: Tx, tenantId: string): Promise<(Person & { name: string; email: string })[]> {
  const users = await tx.user.findMany({ where: { tenantId, role: { in: [...APPROVER_ROLES] } }, select: { id: true, role: true, isActive: true, name: true, email: true } });
  return users.map((u) => ({ id: u.id, role: u.role, isActive: u.isActive, name: u.name ?? u.email, email: u.email }));
}

const stepOf = (policy: ProcessPolicy, n: number): ApprovalStep => (n === 2 && policy.step2 ? policy.step2 : policy.step1);
const ctxOf = (a: Actor, m: Meta) => ({ tenantId: a.tenantId, actorId: a.userId, ipAddress: m.ipAddress, userAgent: m.userAgent });

// ---------------------------------------------------------------------------
// Requesting
// ---------------------------------------------------------------------------

/**
 * Stores an action for approval. Domain errors (the invoice has payments, the
 * discount is already given…) surface now, exactly as if done directly.
 */
export async function requestApproval(actor: Actor, process: ApprovalProcess, rawPayload: unknown, note: string, meta: Meta, now: Date = new Date()): Promise<{ id: string; approverIds: string[] }> {
  const policy = (await approvalSettings(actor.tenantId))[process];
  const def = PROCESSES[process];
  const payload = def.schema.parse(rawPayload);
  try {
    return await withRls(actor.tenantId, async (tx) => {
      const { summary, amountMinor } = await def.prepare(tx, actor.tenantId, payload);
      const steps = stepsFor(policy, amountMinor);
      const people = await approverPool(tx, actor.tenantId);
      if (!hasEnoughApprovers(policy, steps, people, actor.userId)) throw new ApprovalError("noApprover");
      const row = await tx.approvalRequest.create({
        data: {
          tenantId: actor.tenantId,
          process,
          targetKey: def.targetKey(payload),
          payload: payload as Prisma.InputJsonValue,
          summary: summary as Prisma.InputJsonValue,
          amountMinor: amountMinor === null ? null : BigInt(amountMinor),
          stepsRequired: steps,
          note: note.trim().slice(0, 500),
          requestedById: actor.userId,
          expiresAt: expiryFrom(now, policy),
        },
      });
      await recordAudit(ctxOf(actor, meta), { action: "CREATE", entityType: "ApprovalRequest", entityId: row.id, after: { process, targetKey: row.targetKey, amountMinor, steps } }, tx);
      return { id: row.id, approverIds: eligibleApprovers(policy.step1, people, { requesterId: actor.userId }).map((p) => p.id) };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ApprovalError("alreadyPending");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

class ApplyFailed extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type DecideOutcome = { outcome: "approved" } | { outcome: "nextStep"; approverIds: string[] } | { outcome: "rejected" } | { outcome: "expired" } | { outcome: "failed"; code: string };

/**
 * One approver's decision. `expectedStep` is the step the approver saw: if
 * someone else decided it meanwhile, the call is refused (`changed`) rather
 * than silently deciding the next step.
 */
export async function decide(actor: Actor, requestId: string, input: { decision: "APPROVE" | "REJECT"; comment: string; expectedStep: number }, meta: Meta, now: Date = new Date()): Promise<DecideOutcome> {
  if (actor.impersonating) throw new ApprovalError("supportCannotDecide");
  const comment = input.comment.trim().slice(0, 500);
  if (input.decision === "REJECT" && !comment) throw new ApprovalError("commentRequired");
  const settings = await approvalSettings(actor.tenantId);

  const guard = async (tx: Tx) => {
    await tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${requestId} FOR UPDATE`;
    const req = await tx.approvalRequest.findFirst({ where: { id: requestId, tenantId: actor.tenantId }, include: { decisions: { select: { approverId: true, step: true } } } });
    if (!req) throw new ApprovalError("notFound");
    if (req.status !== "PENDING") throw new ApprovalError("notPending");
    if (req.currentStep !== input.expectedStep) throw new ApprovalError("changed");
    const policy = settings[req.process as ApprovalProcess];
    const me = await tx.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId }, select: { id: true, role: true, isActive: true } });
    if (!me) throw new ApprovalError("notAllowed");
    if (me.id === req.requestedById) throw new ApprovalError("ownRequest");
    const earlier = req.decisions.map((d) => d.approverId).filter((x): x is string => Boolean(x));
    if (!canDecideStep(stepOf(policy, req.currentStep), me, { requesterId: req.requestedById, earlierApproverIds: earlier })) throw new ApprovalError("notAllowed");
    return { req, policy };
  };

  try {
    return await withRls(actor.tenantId, async (tx) => {
      const { req, policy } = await guard(tx);
      if (req.expiresAt.getTime() <= now.getTime()) {
        await tx.approvalRequest.update({ where: { id: req.id }, data: { status: "EXPIRED", decidedAt: now } });
        await recordAudit({ tenantId: actor.tenantId, actorId: null }, { action: "UPDATE", entityType: "ApprovalRequest", entityId: req.id, before: { status: "PENDING" }, after: { status: "EXPIRED" } }, tx);
        return { outcome: "expired" } as DecideOutcome; // committed: the request is now EXPIRED
      }
      await tx.approvalDecision.create({ data: { tenantId: actor.tenantId, requestId: req.id, step: req.currentStep, approverId: actor.userId, decision: input.decision, comment } });
      const audit = ctxOf(actor, meta);
      if (input.decision === "REJECT") {
        await tx.approvalRequest.update({ where: { id: req.id }, data: { status: "REJECTED", decidedAt: now } });
        await recordAudit(audit, { action: "UPDATE", entityType: "ApprovalRequest", entityId: req.id, before: { status: "PENDING" }, after: { status: "REJECTED", step: req.currentStep } }, tx);
        return { outcome: "rejected" };
      }
      if (req.currentStep < req.stepsRequired) {
        await tx.approvalRequest.update({ where: { id: req.id }, data: { currentStep: req.currentStep + 1 } });
        await recordAudit(audit, { action: "UPDATE", entityType: "ApprovalRequest", entityId: req.id, before: { step: req.currentStep }, after: { step: req.currentStep + 1, approvedStep: req.currentStep } }, tx);
        const people = await approverPool(tx, actor.tenantId);
        const next = eligibleApprovers(stepOf(policy, req.currentStep + 1), people, { requesterId: req.requestedById, earlierApproverIds: [actor.userId] });
        return { outcome: "nextStep", approverIds: next.map((p) => p.id) };
      }
      // Final approval: apply the change now, as the person who asked for it.
      const def = PROCESSES[req.process as ApprovalProcess];
      try {
        await def.apply(tx, { tenantId: actor.tenantId, actorId: req.requestedById ?? actor.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, def.schema.parse(req.payload));
      } catch (err) {
        const code = errorCode(err);
        if (code) throw new ApplyFailed(code);
        throw err;
      }
      await tx.approvalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedAt: now, appliedAt: now } });
      await recordAudit(audit, { action: "UPDATE", entityType: "ApprovalRequest", entityId: req.id, before: { status: "PENDING" }, after: { status: "APPROVED", approvedBy: actor.userId, requestedBy: req.requestedById, process: req.process } }, tx);
      return { outcome: "approved" };
    });
  } catch (err) {
    if (!(err instanceof ApplyFailed)) throw err;
    // Nothing was applied (the transaction rolled back). Record the approval and why it couldn't happen.
    await withRls(actor.tenantId, async (tx) => {
      const { req } = await guard(tx);
      await tx.approvalDecision.create({ data: { tenantId: actor.tenantId, requestId: req.id, step: req.currentStep, approverId: actor.userId, decision: "APPROVE", comment } });
      await tx.approvalRequest.update({ where: { id: req.id }, data: { status: "FAILED", decidedAt: now, failureCode: err.code } });
      await recordAudit(ctxOf(actor, meta), { action: "UPDATE", entityType: "ApprovalRequest", entityId: req.id, before: { status: "PENDING" }, after: { status: "FAILED", failureCode: err.code } }, tx);
    });
    return { outcome: "failed", code: err.code };
  }
}

/** The requester takes a pending request back. */
export async function withdraw(actor: Actor, requestId: string, meta: Meta, now: Date = new Date()) {
  await withRls(actor.tenantId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${requestId} FOR UPDATE`;
    const req = await tx.approvalRequest.findFirst({ where: { id: requestId, tenantId: actor.tenantId } });
    if (!req || req.requestedById !== actor.userId) throw new ApprovalError("notFound");
    if (req.status !== "PENDING") throw new ApprovalError("notPending");
    await tx.approvalRequest.update({ where: { id: req.id }, data: { status: "WITHDRAWN", decidedAt: now } });
    await recordAudit(ctxOf(actor, meta), { action: "UPDATE", entityType: "ApprovalRequest", entityId: req.id, before: { status: "PENDING" }, after: { status: "WITHDRAWN" } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface RequestRow {
  id: string;
  process: ApprovalProcess;
  status: string;
  summary: Summary;
  amountMinor: number | null;
  note: string;
  stepsRequired: number;
  currentStep: number;
  requestedBy: string;
  requestedById: string | null;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  failureCode: string | null;
}

type RawRequest = Prisma.ApprovalRequestGetPayload<{ include: { requestedBy: { select: { name: true; email: true } } } }>;
function toRow(r: RawRequest): RequestRow {
  return {
    id: r.id,
    process: r.process as ApprovalProcess,
    status: r.status,
    summary: r.summary as Summary,
    amountMinor: r.amountMinor === null ? null : Number(r.amountMinor),
    note: r.note,
    stepsRequired: r.stepsRequired,
    currentStep: r.currentStep,
    requestedBy: r.requestedBy?.name ?? r.requestedBy?.email ?? "—",
    requestedById: r.requestedById,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
    failureCode: r.failureCode,
  };
}

async function canSee(settings: ApprovalsSettings, actor: Actor, me: Person, r: { process: string; requestedById: string | null }): Promise<boolean> {
  if (r.requestedById === actor.userId) return true;
  if (actor.role === "SCHOOL_ADMIN") return true;
  const policy = settings[r.process as ApprovalProcess];
  return canDecideStep(policy.step1, me, { requesterId: r.requestedById, earlierApproverIds: [] }) || Boolean(policy.step2 && canDecideStep(policy.step2, me, { requesterId: r.requestedById, earlierApproverIds: [] }));
}

export type InboxTab = "waiting" | "mine" | "all";

/** The Approvals inbox. "waiting" = pending requests this person can decide now. */
export async function listRequests(actor: Actor, opts: { tab: InboxTab; status?: string; skip?: number; take?: number }): Promise<{ rows: RequestRow[]; total: number }> {
  const settings = await approvalSettings(actor.tenantId);
  return withRls(actor.tenantId, async (tx) => {
    const include = { requestedBy: { select: { name: true, email: true } } } as const;
    if (opts.tab === "waiting") {
      if (actor.impersonating) return { rows: [], total: 0 };
      const me = await tx.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId }, select: { id: true, role: true, isActive: true } });
      if (!me) return { rows: [], total: 0 };
      const pending = await tx.approvalRequest.findMany({ where: { tenantId: actor.tenantId, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 500, include: { ...include, decisions: { select: { approverId: true } } } });
      const mine = pending.filter((r) =>
        canDecideStep(stepOf(settings[r.process as ApprovalProcess], r.currentStep), me, { requesterId: r.requestedById, earlierApproverIds: r.decisions.map((d) => d.approverId).filter((x): x is string => Boolean(x)) }),
      );
      const page = mine.slice(opts.skip ?? 0, (opts.skip ?? 0) + (opts.take ?? 25));
      return { rows: page.map(toRow), total: mine.length };
    }
    if (opts.tab === "all" && actor.role !== "SCHOOL_ADMIN") throw new ApprovalError("notAllowed");
    const where: Prisma.ApprovalRequestWhereInput = { tenantId: actor.tenantId, ...(opts.tab === "mine" ? { requestedById: actor.userId } : {}), ...(opts.status ? { status: opts.status } : {}) };
    const [rows, total] = await Promise.all([tx.approvalRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: opts.skip ?? 0, take: opts.take ?? 25, include }), tx.approvalRequest.count({ where })]);
    return { rows: rows.map(toRow), total };
  });
}

/** How many requests are waiting for this person (menu badge, dashboard). */
export async function waitingCount(actor: Actor): Promise<number> {
  return (await listRequests(actor, { tab: "waiting", take: 1 })).total;
}

/** One request, if this person may see it, with its decisions and what they can do. */
export async function getRequest(actor: Actor, id: string) {
  const settings = await approvalSettings(actor.tenantId);
  return withRls(actor.tenantId, async (tx) => {
    const r = await tx.approvalRequest.findFirst({
      where: { id, tenantId: actor.tenantId },
      include: { requestedBy: { select: { name: true, email: true } }, decisions: { orderBy: { step: "asc" }, include: { approver: { select: { name: true, email: true } } } } },
    });
    if (!r) return null;
    const me = await tx.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId }, select: { id: true, role: true, isActive: true } });
    if (!me || !(await canSee(settings, actor, me, r))) return null;
    const policy = settings[r.process as ApprovalProcess];
    const earlier = r.decisions.map((d) => d.approverId).filter((x): x is string => Boolean(x));
    const canDecide = !actor.impersonating && r.status === "PENDING" && canDecideStep(stepOf(policy, r.currentStep), me, { requesterId: r.requestedById, earlierApproverIds: earlier });
    return {
      ...toRow(r),
      decisions: r.decisions.map((d) => ({ step: d.step, decision: d.decision as "APPROVE" | "REJECT", comment: d.comment, by: d.approver?.name ?? d.approver?.email ?? "—", at: d.createdAt })),
      canDecide,
      canWithdraw: r.status === "PENDING" && r.requestedById === actor.userId,
    };
  });
}

/** Pending requests on these targets (banners on invoices, payments, pupils' fees). */
export async function pendingFor(tenantId: string, process: ApprovalProcess, targetKeys: readonly string[]) {
  if (targetKeys.length === 0) return new Map<string, string>();
  const rows = await withRls(tenantId, (tx) => tx.approvalRequest.findMany({ where: { tenantId, process, status: "PENDING", targetKey: { in: [...targetKeys] } }, select: { id: true, targetKey: true } }));
  return new Map(rows.map((r) => [r.targetKey, r.id]));
}

/** Pending discount assignments for a pupil (any discount/term). */
export async function pendingDiscountsFor(tenantId: string, studentId: string) {
  return withRls(tenantId, (tx) =>
    tx.approvalRequest.findMany({ where: { tenantId, process: "DISCOUNT_ASSIGN", status: "PENDING", targetKey: { startsWith: `${studentId}:` } }, select: { id: true, summary: true } }),
  );
}

// ---------------------------------------------------------------------------
// Notifications, reminders and expiry (background jobs)
// ---------------------------------------------------------------------------

/** People to email: the current step's approvers, or the requester. */
export async function recipients(tenantId: string, requestId: string, who: "approvers" | "requester") {
  const settings = await approvalSettings(tenantId);
  return withRls(tenantId, async (tx) => {
    const r = await tx.approvalRequest.findFirst({ where: { id: requestId, tenantId }, include: { requestedBy: { select: { id: true, name: true, email: true, isActive: true } }, decisions: { select: { approverId: true } }, tenant: { select: { name: true } } } });
    if (!r) return null;
    const base = { school: r.tenant.name, process: r.process as ApprovalProcess, status: r.status, requester: r.requestedBy?.name ?? r.requestedBy?.email ?? "" };
    if (who === "requester") return { ...base, to: r.requestedBy?.isActive ? [{ id: r.requestedBy.id, email: r.requestedBy.email, name: r.requestedBy.name ?? "" }] : [] };
    if (r.status !== "PENDING") return { ...base, to: [] };
    const people = await approverPool(tx, tenantId);
    const earlier = r.decisions.map((d) => d.approverId).filter((x): x is string => Boolean(x));
    return { ...base, to: eligibleApprovers(stepOf(settings[r.process as ApprovalProcess], r.currentStep), people, { requesterId: r.requestedById, earlierApproverIds: earlier }).map((p) => ({ id: p.id, email: p.email, name: p.name })) };
  });
}

/** Nightly: expire overdue requests; pick the ones due a reminder. Platform-wide (no school context). */
export async function sweep(now: Date = new Date()) {
  const db = platformPrisma();
  const overdue = await db.approvalRequest.findMany({ where: { status: "PENDING", expiresAt: { lte: now } }, select: { id: true, tenantId: true } });
  for (const r of overdue) {
    await db.$transaction(async (tx) => {
      const n = await tx.approvalRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: now } });
      if (n.count) await recordAudit({ tenantId: r.tenantId, actorId: null }, { action: "UPDATE", entityType: "ApprovalRequest", entityId: r.id, before: { status: "PENDING" }, after: { status: "EXPIRED" } }, tx);
    });
  }
  const pending = await db.approvalRequest.findMany({ where: { status: "PENDING", expiresAt: { gt: now } }, select: { id: true, tenantId: true, createdAt: true, remindedAt: true } });
  const remind = pending.filter((r) => reminderDue(r.createdAt, r.remindedAt, now));
  if (remind.length) await db.approvalRequest.updateMany({ where: { id: { in: remind.map((r) => r.id) } }, data: { remindedAt: now } });
  return { expired: overdue, remind: remind.map((r) => ({ id: r.id, tenantId: r.tenantId })) };
}

/** Settings → Approvals: the people a policy can name (active admins and bursars). */
export async function approverChoices(tenantId: string) {
  return withRls(tenantId, (tx) => approverPool(tx, tenantId));
}

/** Pending requests of these kinds (e.g. the discounts page lists what's waiting). */
export async function pendingOfKinds(tenantId: string, processes: readonly ApprovalProcess[]) {
  const rows = await withRls(tenantId, (tx) =>
    tx.approvalRequest.findMany({ where: { tenantId, status: "PENDING", process: { in: [...processes] } }, orderBy: { createdAt: "desc" }, take: 50, include: { requestedBy: { select: { name: true, email: true } } } }),
  );
  return rows.map(toRow);
}
