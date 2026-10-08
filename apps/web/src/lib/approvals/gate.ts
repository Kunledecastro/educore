import "server-only";
import { getTranslations } from "next-intl/server";
import { auditContextFor, type RequestContext } from "../guard";
import { inngest } from "../inngest/client";
import { NotFoundError, UserFacingError } from "../run-action";
import { DiscountError } from "../discount-writer";
import { ApplyError } from "./processes";
import { ApprovalError, approvalRequired, requestApproval } from "./engine";
import type { ApprovalProcess } from "./policy";

/**
 * Called at the top of each action that can need approval (Phase 8). When
 * the school's policy for the process is off it returns null and the action
 * carries on exactly as before. When it's on, the action becomes a request:
 * nothing changes yet, the approvers are told, and the caller returns
 * `{ pendingApproval: id }` (the form shows "Sent for approval").
 */
export async function approvalGate(ctx: RequestContext, process: ApprovalProcess, payload: unknown, note: string): Promise<{ pendingApproval: string } | null> {
  const tenantId = ctx.user.tenantId;
  if (!tenantId || !(await approvalRequired(tenantId, process))) return null;
  const a = auditContextFor(ctx);
  try {
    const r = await requestApproval({ tenantId, userId: ctx.user.id, role: ctx.user.role, impersonating: Boolean(ctx.impersonation) }, process, payload, note, { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null });
    await inngest.send({ name: "educore/approval.changed", data: { tenantId, requestId: r.id, event: "requested" } }).catch((err) => console.error("[approvals] could not queue the notification", err));
    return { pendingApproval: r.id };
  } catch (err) {
    throw await approvalUserError(err);
  }
}

/** Approval and discount errors as messages people can act on; anything else unchanged. */
export async function approvalUserError(err: unknown): Promise<unknown> {
  if (err instanceof ApprovalError) return new UserFacingError((await getTranslations("approvals.errors"))(err.code));
  if (err instanceof ApplyError && err.code === "notFound") return new NotFoundError();
  if (err instanceof DiscountError) {
    if (err.code === "notFound") return new NotFoundError();
    if (err.code === "alreadyAssigned") {
      const m = (await getTranslations("fees.errors"))("alreadyAssigned");
      return new UserFacingError(m, { studentId: m });
    }
    return new UserFacingError((await getTranslations("approvals.errors"))("discountInactive"));
  }
  return err;
}
