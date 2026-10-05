"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { BillingError, changePlan, setAutoRenew, startSubscriptionCheckout, type BillingActor } from "@/lib/billing/subscription-billing";
import { forbidWhileImpersonating, ForbiddenError, type RequestContext } from "@/lib/guard";
import { clientIpFromHeaders, trustedHost, userAgentFromHeaders } from "@/lib/request-meta";
import { runAction, UserFacingError } from "@/lib/run-action";
import { choosePlanSchema } from "@/lib/validation/platform";
import { z } from "zod";

/**
 * Plan & billing (Phase 4.2). School admins only — and never while EduCore
 * support is signed in as them (support can't spend a school's money).
 */

function billingActor(ctx: RequestContext): BillingActor {
  if (ctx.user.role !== Role.SCHOOL_ADMIN || !ctx.user.tenantId) throw new ForbiddenError();
  forbidWhileImpersonating(ctx);
  const h = headers();
  return { id: ctx.user.id, email: ctx.user.email, ipAddress: clientIpFromHeaders(h), userAgent: userAgentFromHeaders(h) };
}

async function asUserError(err: unknown): Promise<never> {
  if (err instanceof BillingError) {
    const t = await getTranslations("plan.errors");
    throw new UserFacingError(t(err.code));
  }
  throw err;
}

/**
 * Choose a plan. A paying school switches (upgrade now / downgrade at
 * renewal); otherwise it pays on Paystack, which saves the card for the
 * monthly charge. Returns where to send the browser, if anywhere.
 */
export async function choosePlanAction(input: unknown) {
  return runAction(["subscription", "update"], async (ctx) => {
    const actor = billingActor(ctx);
    const { plan } = choosePlanSchema.parse(input);
    const tenantId = ctx.user.tenantId!;
    try {
      const action = await changePlan(tenantId, plan, actor);
      if (action !== "checkout") {
        revalidatePath("/", "layout");
        return { action, url: null as string | null };
      }
      const h = headers();
      const host = trustedHost(h.get("x-forwarded-host") ?? h.get("host"));
      const proto = host.startsWith("localhost") ? "http" : "https";
      const { authorizationUrl } = await startSubscriptionCheckout({
        tenantId,
        actor,
        plan,
        callbackUrl: (reference) => `${proto}://${host}/api/billing/paystack/callback?reference=${reference}`,
      });
      return { action, url: authorizationUrl };
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      if (err instanceof BillingError) return asUserError(err);
      console.error("[billing] could not start checkout", err);
      const t = await getTranslations("plan.errors");
      throw new UserFacingError(t("startFailed"));
    }
  });
}

/** Turn the monthly automatic payment off (plan ends with the paid month) or back on. */
export async function setAutoRenewAction(on: unknown) {
  return runAction(["subscription", "update"], async (ctx) => {
    const actor = billingActor(ctx);
    try {
      await setAutoRenew(ctx.user.tenantId!, z.boolean().parse(on), actor);
    } catch (err) {
      return asUserError(err);
    }
    revalidatePath("/plan");
  });
}
