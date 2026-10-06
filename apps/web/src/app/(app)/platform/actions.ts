"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { platformPrisma, recordAudit, recordPlatformAudit } from "@educore/db";
import { ForbiddenError, type RequestContext } from "@/lib/guard";
import { ImpersonationError, startImpersonation, stopImpersonation } from "@/lib/impersonation";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation-token";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/request-meta";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { getEffectiveSession } from "@/lib/session";
import { idSchema } from "@/lib/validation/common";
import { MODULES } from "@/lib/entitlements";
import { toMinor } from "@/lib/fees";
import { impersonateSchema, planEditSchema, suspendSchema, tenantPlanSchema } from "@/lib/validation/platform";

/**
 * Platform console actions (Phase 4.0). Platform admins only — and never
 * while impersonating (then the request acts as a school admin, so
 * isPlatformAdmin is false and these refuse). Everything is written to the
 * platform audit log; changes to a school also go in that school's log.
 */

function platformOnly(ctx: RequestContext) {
  if (!ctx.isPlatformAdmin) throw new ForbiddenError();
}

function actorFor(ctx: RequestContext) {
  const h = headers();
  return { id: ctx.user.id, actorId: ctx.user.id, ipAddress: clientIpFromHeaders(h), userAgent: userAgentFromHeaders(h) };
}

export async function suspendTenant(input: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const { tenantId, reason } = suspendSchema.parse(input);
    const actor = actorFor(ctx);
    await platformPrisma().$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!before) throw new NotFoundError();
      if (before.status === "SUSPENDED") return;
      const after = await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason } });
      // Anyone impersonating in this school is cut off too.
      await tx.impersonationSession.updateMany({ where: { tenantId, endedAt: null }, data: { endedAt: new Date() } });
      const snap = (x: typeof before) => ({ status: x.status, suspendedAt: x.suspendedAt, suspendedReason: x.suspendedReason });
      await recordPlatformAudit(actor, { action: "TENANT_SUSPEND", tenantId, entityType: "Tenant", entityId: tenantId, before: snap(before), after: snap(after) }, tx);
      await recordAudit({ tenantId, actorId: null, impersonatorId: ctx.user.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "UPDATE", entityType: "Tenant", entityId: tenantId, before: snap(before), after: snap(after) }, tx);
    });
    revalidatePath("/platform", "layout");
  });
}

export async function reactivateTenant(id: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const tenantId = idSchema.parse(id);
    const actor = actorFor(ctx);
    await platformPrisma().$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!before) throw new NotFoundError();
      if (before.status === "ACTIVE") return;
      const after = await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", suspendedAt: null, suspendedReason: null } });
      const snap = (x: typeof before) => ({ status: x.status, suspendedAt: x.suspendedAt, suspendedReason: x.suspendedReason });
      await recordPlatformAudit(actor, { action: "TENANT_REACTIVATE", tenantId, entityType: "Tenant", entityId: tenantId, before: snap(before), after: snap(after) }, tx);
      await recordAudit({ tenantId, actorId: null, impersonatorId: ctx.user.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "UPDATE", entityType: "Tenant", entityId: tenantId, before: snap(before), after: snap(after) }, tx);
    });
    revalidatePath("/platform", "layout");
  });
}

/** Sign in as a school admin for support: sets the signed cookie; the next page load acts as them. */
export async function startImpersonationAction(input: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const t = await getTranslations("platform.errors");
    const { userId, reason } = impersonateSchema.parse(input);
    try {
      const { cookie, expiresAt } = await startImpersonation(actorFor(ctx), userId, reason);
      cookies().set(IMPERSONATION_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
    } catch (err) {
      if (err instanceof ImpersonationError) throw new UserFacingError(t(err.code));
      throw err;
    }
    return { ok: true };
  });
}

/** Stop working as a school admin; back to the console. Works from inside the impersonated session. */
export async function stopImpersonationAction() {
  const session = await getEffectiveSession();
  const platformAdminId = session?.impersonation?.platformAdminId ?? (session?.user.role === "PLATFORM_ADMIN" ? session.user.id : null);
  const tenantId = session?.impersonation?.target.tenantId;
  if (platformAdminId) {
    const h = headers();
    await stopImpersonation({ id: platformAdminId, ipAddress: clientIpFromHeaders(h), userAgent: userAgentFromHeaders(h) });
  }
  cookies().delete(IMPERSONATION_COOKIE);
  redirect(tenantId ? `/platform/tenants/${tenantId}` : "/platform/tenants");
}

// ---------------------------------------------------------------------------
// Plans (4.1)
// ---------------------------------------------------------------------------

/** Set a school's plan by hand: complimentary, invoiced offline, or a trial extension. Audited in both logs. */
export async function changeTenantPlan(input: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const { tenantId, plan, until, note } = tenantPlanSchema.parse(input);
    const actor = actorFor(ctx);
    await platformPrisma().$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId }, include: { subscription: true } });
      if (!before) throw new NotFoundError();
      await tx.tenant.update({ where: { id: tenantId }, data: { plan } });
      const sub = { plan, status: plan === "FREE_TRIAL" ? ("TRIALING" as const) : ("ACTIVE" as const), currentPeriodEnd: until ?? null, cancelAtPeriodEnd: false };
      await tx.subscription.upsert({ where: { tenantId }, create: { tenantId, ...sub }, update: sub });
      const snapBefore = { plan: before.plan, status: before.subscription?.status ?? null, until: before.subscription?.currentPeriodEnd ?? null };
      const snapAfter = { plan, status: sub.status, until: sub.currentPeriodEnd, note };
      await recordPlatformAudit(actor, { action: "TENANT_PLAN_CHANGE", tenantId, entityType: "Tenant", entityId: tenantId, before: snapBefore, after: snapAfter }, tx);
      await recordAudit({ tenantId, actorId: null, impersonatorId: ctx.user.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "UPDATE", entityType: "Subscription", entityId: tenantId, before: snapBefore, after: snapAfter }, tx);
    });
    revalidatePath("/platform", "layout");
  });
}

/** Edit a plan in the catalogue. Takes effect for every school on it from their next page load. */
export async function updatePlan(input: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const data = planEditSchema.parse(input);
    const actor = actorFor(ctx);
    const next = {
      name: data.name,
      priceMinor: toMinor(data.price)!,
      maxStudents: data.maxStudents === "" ? null : Number(data.maxStudents),
      modules: MODULES.filter((m) => data.modules.includes(m)),
      isPublic: data.isPublic,
      updatedById: ctx.user.id,
    };
    await platformPrisma().$transaction(async (tx) => {
      const before = await tx.planDefinition.findUnique({ where: { code: data.code } });
      const after = await tx.planDefinition.upsert({ where: { code: data.code }, create: { code: data.code, ...next }, update: next });
      await recordPlatformAudit(actor, { action: "PLAN_UPDATE", entityType: "Plan", entityId: data.code, before, after }, tx);
    });
    revalidatePath("/platform", "layout");
  });
}

/** Lost phone (Phase 6.0): clear a school admin's 2FA so they set it up again; they're signed out everywhere. */
export async function platformResetTwoFactorAction(userId: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const actor = actorFor(ctx);
    const { adminResetTwoFactor, TwoFactorError } = await import("@/lib/security/two-factor");
    try {
      await adminResetTwoFactor({ id: ctx.user.id, role: "PLATFORM_ADMIN", tenantId: null }, idSchema.parse(userId), { ipAddress: actor.ipAddress, userAgent: actor.userAgent });
    } catch (err) {
      if (err instanceof TwoFactorError) throw new UserFacingError((await getTranslations("twoFactor.errors"))(err.code));
      throw err;
    }
    revalidatePath("/platform", "layout");
  });
}

/** Shared demo schools (Phase 6.0): don't require 2FA there, so testers sharing a login aren't locked out. */
export async function setTwoFactorExemptAction(tenantId: unknown, exempt: unknown) {
  return runAction(["tenant", "update"], async (ctx) => {
    platformOnly(ctx);
    const actor = actorFor(ctx);
    const { setTwoFactorExempt } = await import("@/lib/security/school-security");
    await setTwoFactorExempt({ id: ctx.user.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, idSchema.parse(tenantId), exempt === true);
    revalidatePath("/platform", "layout");
  });
}
