"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auditContextFor } from "@/lib/guard";
import { runAction, UserFacingError } from "@/lib/run-action";
import { saveSchoolSecurity } from "@/lib/security/school-security";
import { adminResetTwoFactor, TwoFactorError } from "@/lib/security/two-factor";
import { idSchema } from "@/lib/validation/common";

/** School admins: require 2FA for teachers (Phase 6.0). Admins and bursars always need it. */
export async function saveSchoolSecurityAction(input: unknown) {
  return runAction(["user", "update"], async (ctx) => {
    const { requireTeacher2fa } = z.object({ requireTeacher2fa: z.boolean() }).parse(input);
    const a = auditContextFor(ctx);
    await saveSchoolSecurity({ id: ctx.user.id, tenantId: a.tenantId, ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null }, requireTeacher2fa);
    revalidatePath("/settings/security");
  });
}

/** Lost phone: clear someone's 2FA so they set it up again at their next sign-in (and sign them out everywhere). */
export async function resetUserTwoFactorAction(userId: unknown) {
  return runAction(["user", "update"], async (ctx) => {
    const a = auditContextFor(ctx);
    try {
      await adminResetTwoFactor({ id: ctx.impersonation?.platformAdminId ?? ctx.user.id, role: ctx.impersonation ? "PLATFORM_ADMIN" : ctx.user.role, tenantId: a.tenantId }, idSchema.parse(userId), { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null });
    } catch (err) {
      if (err instanceof TwoFactorError) throw new UserFacingError((await getTranslations("twoFactor.errors"))(err.code));
      throw err;
    }
    revalidatePath("/settings/security");
  });
}
