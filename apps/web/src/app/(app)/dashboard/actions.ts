"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditedMutation } from "@educore/db";
import { auditContextFor } from "@/lib/guard";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { getTranslations } from "next-intl/server";
import { loadSampleData, removeSampleData, SampleDataError } from "@/lib/sample-data";
import { remindRegister, RemindError } from "@/lib/dashboard/remind";
import { CHANNELS, registerReminderEmail } from "@/lib/notify/channels";
import { appUrl } from "@/lib/inngest/notify-message";
import { getSettingsForUser, getTenantForUser } from "@/lib/tenant";
import { todayInTimeZone } from "@/lib/format";
import { idSchema } from "@/lib/validation/common";

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

/** Admins: remind a form teacher to take today's register (once per class per day, audited). */
export async function remindRegisterAction(sectionId: unknown) {
  return runAction(["attendance", "update"] as const, async (ctx) => {
    if (ctx.user.role !== "SCHOOL_ADMIN") throw new UserFacingError((await getTranslations("dashboard.remind"))("notAllowed"));
    const audit = auditContextFor(ctx);
    const settings = await getSettingsForUser(audit.tenantId);
    try {
      const r = await remindRegister(audit, idSchema.parse(sectionId), todayInTimeZone(settings.timezone));
      const channels = CHANNELS.filter((c) => c.enabled());
      if (channels.length) {
        const { tenant } = await getTenantForUser(audit.tenantId);
        const n = registerReminderEmail({ recipient: r.teacher, className: r.sectionName, schoolName: tenant?.name ?? "EduCore", link: `${appUrl()}/attendance` });
        for (const c of channels) await c.send(n).catch((err) => console.error("[remind] email failed", err));
      }
    } catch (err) {
      if (err instanceof RemindError) throw new UserFacingError((await getTranslations("dashboard.remind"))(err.code));
      throw err;
    }
    revalidatePath("/dashboard");
  });
}
