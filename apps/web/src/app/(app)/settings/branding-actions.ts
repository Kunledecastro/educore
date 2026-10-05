"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { BrandingError, removeLogo, saveBranding, saveLogo, type BrandingActor } from "@/lib/branding-data";
import { LOGO_MAX_BYTES } from "@/lib/branding";
import { auditContextFor, type RequestContext } from "@/lib/guard";
import { runAction, UserFacingError } from "@/lib/run-action";
import { brandingSchema } from "@/lib/validation/branding";

/** School branding: logo, brand colour, contact line. School admins of their own school only; audited. */

function actorFor(ctx: RequestContext): { tenantId: string; actor: BrandingActor } {
  const a = auditContextFor(ctx);
  return { tenantId: a.tenantId, actor: { userId: ctx.user.id, ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null, impersonatorId: a.impersonatorId ?? null } };
}

async function friendly(err: unknown): Promise<never> {
  if (err instanceof BrandingError) {
    const t = await getTranslations("settings.branding.errors");
    throw new UserFacingError(t(err.code, { max: Math.round(LOGO_MAX_BYTES / 1024) }), { logo: t(err.code, { max: Math.round(LOGO_MAX_BYTES / 1024) }) });
  }
  throw err;
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function saveBrandingAction(input: unknown) {
  return runAction(["branding", "update"], async (ctx) => {
    const data = brandingSchema.parse(input);
    const { tenantId, actor } = actorFor(ctx);
    try {
      await saveBranding(tenantId, actor, { primaryColor: data.primaryColor || null, contactLine: data.contactLine || null });
    } catch (err) {
      return friendly(err);
    }
    refresh();
  });
}

export async function uploadLogoAction(formData: FormData) {
  return runAction(["branding", "update"], async (ctx) => {
    const file = formData.get("logo");
    const t = await getTranslations("settings.branding.errors");
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError(t("empty"), { logo: t("empty") });
    // Reject by size before reading the whole file into memory.
    if (file.size > LOGO_MAX_BYTES) return friendly(new BrandingError("tooLarge"));
    const { tenantId, actor } = actorFor(ctx);
    try {
      const r = await saveLogo(tenantId, actor, new Uint8Array(await file.arrayBuffer()));
      refresh();
      return r;
    } catch (err) {
      return friendly(err);
    }
  });
}

export async function removeLogoAction() {
  return runAction(["branding", "update"], async (ctx) => {
    const { tenantId, actor } = actorFor(ctx);
    await removeLogo(tenantId, actor);
    refresh();
  });
}
