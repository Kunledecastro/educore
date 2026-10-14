"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { withRls } from "@educore/db";
import { approvalGate, approvalUserError } from "@/lib/approvals/gate";
import { approvalRequired } from "@/lib/approvals/engine";
import { auditContextFor } from "@/lib/guard";
import { publishClassResults, unpublishClassResults } from "@/lib/results-writer";
import { runAction, UserFacingError } from "@/lib/run-action";
import { publishRequestSchema, unpublishInputSchema, unpublishRequestSchema } from "@/lib/validation/results";

function refresh() {
  revalidatePath("/assessments", "layout");
  revalidatePath("/students", "layout");
  revalidatePath("/approvals");
}

/**
 * Publish a class's results for a term: parents and students can see them,
 * and scores are locked (the gradebook refuses changes). Admins only;
 * audited. Both ids are re-checked against this school. If the school wants
 * publishing approved (Phase 8.1), this becomes a request instead.
 */
export async function publishResults(input: unknown) {
  return runAction(["results", "update"], async (ctx) => {
    const data = publishRequestSchema.parse(input);
    const gate = await approvalGate(ctx, "RESULTS_PUBLISH", data, data.note ?? "");
    if (gate) {
      refresh();
      return gate;
    }
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, (tx) => publishClassResults(tx, audit, data, { idempotent: true })).catch(async (err) => {
      throw await approvalUserError(err);
    });
    refresh();
  });
}

/**
 * Take results back down (e.g. to correct a score). Families stop seeing
 * them, scores unlock, and the class's report cards for the term must be
 * regenerated. Audited. If the school requires approval (Phase 8.1), the
 * request must say why and which subjects will change, and nothing happens
 * until it's approved.
 */
export async function unpublishResults(input: unknown) {
  return runAction(["results", "update"], async (ctx) => {
    const data = unpublishInputSchema.parse(input);
    if (ctx.user.tenantId && (await approvalRequired(ctx.user.tenantId, "RESULTS_UNPUBLISH"))) {
      const parsed = unpublishRequestSchema.safeParse(data);
      if (!parsed.success) {
        const t = await getTranslations("gradebook.publish");
        const fields = parsed.error.flatten().fieldErrors;
        throw new UserFacingError(t("needReasonAndSubjects"), { ...(fields.reason ? { reason: t("needReason") } : {}), ...(fields.subjectIds ? { subjectIds: t("needSubjects") } : {}) });
      }
      const gate = await approvalGate(ctx, "RESULTS_UNPUBLISH", parsed.data, parsed.data.reason);
      if (gate) {
        refresh();
        return gate;
      }
    }
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, (tx) => unpublishClassResults(tx, audit, data)).catch(async (err) => {
      throw await approvalUserError(err);
    });
    refresh();
  });
}
