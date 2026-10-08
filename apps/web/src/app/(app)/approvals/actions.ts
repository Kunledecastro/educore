"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { decide, withdraw, type Actor } from "@/lib/approvals/engine";
import { approvalUserError } from "@/lib/approvals/gate";
import { APPROVAL_PROCESSES } from "@/lib/approvals/policy";
import { saveProcessPolicy } from "@/lib/approvals/settings";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { inngest } from "@/lib/inngest/client";
import { runAction, UserFacingError } from "@/lib/run-action";
import { idSchema } from "@/lib/validation/common";

/** Approvals (Phase 8.0): decide, withdraw, and the school's settings. */

function actorOf(ctx: RequestContext): { actor: Actor; meta: { ipAddress: string | null; userAgent: string | null } } {
  const a = auditContextFor(ctx);
  return { actor: { tenantId: a.tenantId, userId: ctx.user.id, role: ctx.user.role, impersonating: Boolean(ctx.impersonation) }, meta: { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null } };
}

const decideSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().max(500).default(""), expectedStep: z.number().int().min(1).max(2) });

export async function decideAction(requestId: unknown, input: unknown) {
  return runAction(["approval", "update"], async (ctx) => {
    const id = idSchema.parse(requestId);
    const data = decideSchema.parse(input);
    const { actor, meta } = actorOf(ctx);
    const r = await decide(actor, id, data, meta).catch(async (err) => {
      throw await approvalUserError(err);
    });
    if (r.outcome === "expired") throw new UserFacingError((await getTranslations("approvals.errors"))("expired"));
    await inngest
      .send({ name: "educore/approval.changed", data: { tenantId: actor.tenantId, requestId: id, event: r.outcome === "nextStep" ? "nextStep" : "decided" } })
      .catch((err) => console.error("[approvals] could not queue the notification", err));
    revalidatePath("/approvals", "layout");
    revalidatePath("/fees", "layout");
    revalidatePath("/payments");
    return r.outcome === "failed" ? { outcome: r.outcome, code: r.code } : { outcome: r.outcome };
  });
}

export async function withdrawAction(requestId: unknown) {
  return runAction(["approval", "read"], async (ctx) => {
    const { actor, meta } = actorOf(ctx);
    await withdraw(actor, idSchema.parse(requestId), meta).catch(async (err) => {
      throw await approvalUserError(err);
    });
    revalidatePath("/approvals", "layout");
    revalidatePath("/fees", "layout");
  });
}

const settingsInput = z.object({
  process: z.enum(APPROVAL_PROCESSES),
  policy: z.object({
    enabled: z.boolean(),
    expiryDays: z.number().int().min(1).max(30),
    step1: z.object({ roles: z.array(z.string()).max(4), userIds: z.array(z.string()).max(20) }),
    step2: z.object({ roles: z.array(z.string()).max(4), userIds: z.array(z.string()).max(20) }).nullable(),
    /** Major units as typed (e.g. "50000"); "" = always two steps when step2 is set. */
    secondStepFrom: z.string().trim().regex(/^(\d{1,12})(\.\d{1,2})?$|^$/),
  }),
});

export async function saveApprovalPolicyAction(input: unknown) {
  return runAction(["approvalSettings", "update"], async (ctx) => {
    const { process, policy } = settingsInput.parse(input);
    const { actor, meta } = actorOf(ctx);
    const minor = policy.secondStepFrom === "" ? null : Math.round(Number(policy.secondStepFrom) * 100);
    const t = await getTranslations("approvals.settings");
    if (policy.enabled && policy.step1.roles.length === 0 && policy.step1.userIds.length === 0) throw new UserFacingError(t("needApprover"));
    if (policy.step2 && policy.step2.roles.length === 0 && policy.step2.userIds.length === 0) throw new UserFacingError(t("needApprover2"));
    await saveProcessPolicy(actor, process, { enabled: policy.enabled, expiryDays: policy.expiryDays, step1: policy.step1, step2: policy.step2, secondStepFromMinor: policy.step2 ? minor : null }, meta).catch(async (err) => {
      throw await approvalUserError(err);
    });
    revalidatePath("/settings/approvals");
    revalidatePath("/approvals", "layout");
  });
}
