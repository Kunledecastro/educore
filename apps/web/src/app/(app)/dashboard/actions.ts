"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditedMutation } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { getTranslations } from "next-intl/server";
import { loadSampleData, removeSampleData, SampleDataError } from "@/lib/sample-data";

/**
 * Hide or bring back the setup checklist on the dashboard (milestone 1.4).
 *
 * The tenant id comes from the session, never from the browser. The write
 * runs as `educore_app`, which (migration 0008) may update only this one
 * column, and only on its own school's row — so even a bug here couldn't
 * change the plan, status or another school.
 */
export async function setOnboardingHidden(hidden: unknown) {
  return runAction(["onboarding", "update"] as const, async (ctx) => {
    const value = z.boolean().parse(hidden);
    const audit = auditContextFor(ctx);
    await auditedMutation(audit, {
      action: "UPDATE",
      entityType: "Tenant",
      run: async (tx) => {
        const before = await tx.tenant.findUnique({
          where: { id: audit.tenantId },
          select: { id: true, onboardingDismissedAt: true },
        });
        if (!before) throw new NotFoundError();
        const after = await tx.tenant.update({
          where: { id: audit.tenantId },
          data: { onboardingDismissedAt: value ? new Date() : null },
          select: { id: true, onboardingDismissedAt: true },
        });
        return { before, after };
      },
    });
    revalidatePath("/dashboard");
    return { hidden: value };
  });
}

async function sampleError(err: unknown): Promise<never> {
  if (err instanceof SampleDataError) throw new UserFacingError((await getTranslations("sampleData.errors"))(err.code));
  throw err;
}

/** Try EduCore with sample classes, pupils, attendance and marks (fresh schools only). Not while impersonating. */
export async function loadSampleDataAction() {
  return runAction(["onboarding", "update"] as const, async (ctx) => {
    if (ctx.impersonation) throw new UserFacingError((await getTranslations("sampleData.errors"))("support"));
    const result = await loadSampleData(auditContextFor(ctx)).catch(sampleError);
    revalidatePath("/", "layout");
    return result;
  });
}

/** Remove exactly what "Load sample data" added. */
export async function removeSampleDataAction() {
  return runAction(["onboarding", "update"] as const, async (ctx) => {
    if (ctx.impersonation) throw new UserFacingError((await getTranslations("sampleData.errors"))("support"));
    const result = await removeSampleData(auditContextFor(ctx)).catch(sampleError);
    revalidatePath("/", "layout");
    return result;
  });
}
