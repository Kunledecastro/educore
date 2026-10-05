"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { runAction, UserFacingError } from "@/lib/run-action";
import { issueLogins, MAX_SLIPS_PER_CALL, recordConsent, saveStudentLoginSettings, setLoginActive, StudentLoginError, type LoginActor } from "@/lib/student-logins-data";
import { idSchema } from "@/lib/validation/common";

/** Student logins (Phase 5.0): settings (admins), issue/reset with printable slips, switch off/on, consent. Audited. */

async function actor(ctx: RequestContext): Promise<{ tenantId: string; actor: LoginActor }> {
  const a = auditContextFor(ctx);
  return { tenantId: a.tenantId, actor: { userId: ctx.user.id, role: ctx.user.role, ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null, impersonatorId: a.impersonatorId ?? null } };
}

async function friendly(err: unknown): Promise<never> {
  if (err instanceof StudentLoginError) {
    const t = await getTranslations("studentLogins.errors");
    throw new UserFacingError(t(err.code, { max: MAX_SLIPS_PER_CALL }));
  }
  throw err;
}

const settingsSchema = z.object({ enabled: z.boolean(), classIds: z.array(idSchema).max(500) });

export async function saveLoginSettingsAction(input: unknown) {
  return runAction(["studentLogin", "create"], async (ctx) => {
    const data = settingsSchema.parse(input);
    const { tenantId, actor: a } = await actor(ctx);
    try {
      await saveStudentLoginSettings(tenantId, a, data);
    } catch (err) {
      return friendly(err);
    }
    revalidatePath("/students/logins");
  });
}

/** Returns the slips (with one-time passwords) to print — shown once, never stored. */
export async function issueLoginsAction(studentIds: unknown) {
  return runAction(["studentLogin", "update"], async (ctx) => {
    const ids = z.array(idSchema).min(1).max(MAX_SLIPS_PER_CALL).parse(studentIds);
    const { tenantId, actor: a } = await actor(ctx);
    const tenant = await ctx.db.tenant.findFirst({ where: { id: tenantId }, select: { slug: true } });
    if (!tenant) throw new UserFacingError("—");
    try {
      const slips = await issueLogins(tenantId, a, ids, tenant.slug);
      revalidatePath("/students/logins");
      return { slips, school: tenant.slug };
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function setLoginActiveAction(studentId: unknown, active: unknown) {
  return runAction(["studentLogin", "update"], async (ctx) => {
    const { tenantId, actor: a } = await actor(ctx);
    try {
      await setLoginActive(tenantId, a, idSchema.parse(studentId), z.boolean().parse(active));
    } catch (err) {
      return friendly(err);
    }
    revalidatePath("/students/logins");
  });
}

export async function consentAction(studentId: unknown, given: unknown) {
  return runAction(["studentLogin", "update"], async (ctx) => {
    const { tenantId, actor: a } = await actor(ctx);
    try {
      await recordConsent(tenantId, a, idSchema.parse(studentId), z.boolean().parse(given));
    } catch (err) {
      return friendly(err);
    }
    revalidatePath("/students/logins");
  });
}
