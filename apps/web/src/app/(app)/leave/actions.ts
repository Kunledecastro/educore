"use server";

import { revalidatePath } from "next/cache";
import { ApprovalError, requestApproval, withdraw } from "@/lib/approvals/engine";
import { approvalUserError } from "@/lib/approvals/gate";
import { auditContextFor, ForbiddenError, type RequestContext } from "@/lib/guard";
import { inngest } from "@/lib/inngest/client";
import { cancelLeave, saveLeaveType } from "@/lib/leave/data";
import { leaveRequestSchema, STAFF_ROLES } from "@/lib/leave/rules";
import { runAction } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

/** Staff leave (Phase 8.2). Requests always go through the approval engine; a school admin decides. */

function refresh() {
  revalidatePath("/leave", "layout");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
}

function actorOf(ctx: RequestContext) {
  if (!ctx.user.tenantId || !(STAFF_ROLES as readonly string[]).includes(ctx.user.role)) throw new ForbiddenError();
  return { tenantId: ctx.user.tenantId, userId: ctx.user.id, role: ctx.user.role, impersonating: Boolean(ctx.impersonation) };
}

export async function requestLeaveAction(input: unknown) {
  return runAction(["leave", "create"], async (ctx) => {
    const actor = actorOf(ctx);
    // EduCore support working inside a school never asks for leave on someone's behalf.
    if (actor.impersonating) throw await approvalUserError(new ApprovalError("supportCannotDecide"));
    const data = leaveRequestSchema.parse(input);
    const a = auditContextFor(ctx);
    try {
      const r = await requestApproval(actor, "LEAVE", data, data.note, { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null });
      await inngest.send({ name: "educore/approval.changed", data: { tenantId: actor.tenantId, requestId: r.id, event: "requested" } }).catch((err) => console.error("[leave] could not queue the notification", err));
      refresh();
      return { pendingApproval: r.id };
    } catch (err) {
      throw await approvalUserError(err);
    }
  });
}

/** Take back a request that hasn't been decided yet. */
export async function withdrawLeaveAction(requestId: unknown) {
  return runAction(["leave", "create"], async (ctx) => {
    const actor = actorOf(ctx);
    const a = auditContextFor(ctx);
    await withdraw(actor, idSchema.parse(requestId), { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null }).catch(async (err) => {
      throw await approvalUserError(err);
    });
    refresh();
  });
}

/** Admins: cancel approved leave; the days go back to the person's balance. */
export async function cancelLeaveAction(leaveId: unknown) {
  return runAction(["leave", "update"], async (ctx) => {
    await cancelLeave(auditContextFor(ctx), idSchema.parse(leaveId)).catch(async (err) => {
      throw await approvalUserError(err);
    });
    refresh();
  });
}

/** Admins: add or change a leave type. */
export async function saveLeaveTypeAction(input: unknown) {
  return runAction(["leaveSettings", "update"], async (ctx) => {
    await saveLeaveType(auditContextFor(ctx), input).catch(async (err) => {
      throw await approvalUserError(err);
    });
    revalidatePath("/settings/leave");
    refresh();
  });
}
