"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { toMinor } from "@/lib/fees";
import { getEntitlements } from "@/lib/entitlements-server";
import { trustedHost } from "@/lib/request-meta";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { startOnlineCheckout, settleOnlinePayment } from "@/lib/payments/online";
import { PAYSTACK_CURRENCIES, paystack } from "@/lib/payments/paystack";
import { checkOnlineAmount } from "@/lib/payments/settle-rules";
import { studentScopeFor } from "@/lib/student-scope";
import { idSchema } from "@/lib/validation/common";
import { onlinePaymentSchema } from "@/lib/validation/fees";

/**
 * Online payment (milestone 3.3). Parents only, for their own children's
 * invoices (student row scope). We record the attempt, ask Paystack for a
 * checkout page and send the parent there; the money is applied only after
 * Paystack confirms it server to server (return page or webhook).
 */
export async function startOnlinePaymentAction(input: unknown) {
  return runAction(["payment", "create"], async (ctx) => {
    const t = await getTranslations("fees.online.errors");
    if (ctx.user.role !== Role.PARENT) throw new UserFacingError(t("parentsOnly"));
    // Online payment is its own module (Premium); fees alone covers the bursary.
    if (!(await getEntitlements(ctx.user.tenantId!)).modules.has("onlinePayments")) throw new UserFacingError(t("notInPlan"));
    if (!paystack.configured()) throw new UserFacingError(t("notConfigured"));
    const data = onlinePaymentSchema.parse(input);
    const scope = await studentScopeFor(ctx);
    const invoice = await ctx.db.invoice.findFirst({
      where: { id: data.invoiceId, student: scope },
      select: { id: true, studentId: true, invoiceNo: true, currency: true, status: true, totalDue: true, amountPaid: true },
    });
    if (!invoice) throw new NotFoundError();
    if (invoice.status === "CANCELLED") throw new UserFacingError(t("cancelled"));
    if (!PAYSTACK_CURRENCIES.has(invoice.currency)) throw new UserFacingError(t("currency", { currency: invoice.currency }));
    const balance = (toMinor(invoice.totalDue) ?? 0) - (toMinor(invoice.amountPaid) ?? 0);
    const issue = checkOnlineAmount(toMinor(data.amount), balance);
    if (issue) throw new UserFacingError(t(issue), { amount: t(issue) });

    // Paystack sends the parent back here: only ever to one of our own hosts (never a spoofed Host header).
    const h = headers();
    const host = trustedHost(h.get("x-forwarded-host") ?? h.get("host"));
    const proto = host.startsWith("localhost") ? "http" : "https";
    try {
      const { authorizationUrl } = await startOnlineCheckout({
        tenantId: ctx.user.tenantId!,
        payer: { id: ctx.user.id, email: ctx.user.email },
        invoice,
        amountMinor: toMinor(data.amount)!,
        callbackUrl: (reference) => `${proto}://${host}/api/payments/paystack/callback?reference=${reference}`,
      });
      return { url: authorizationUrl };
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      console.error("[paystack] could not start checkout", err);
      throw new UserFacingError(t("startFailed"));
    }
  });
}

/** Finance staff: ask Paystack again about an online payment that's pending or needs review. */
export async function recheckOnlinePaymentAction(id: unknown) {
  return runAction(["payment", "update"], async (ctx) => {
    const t = await getTranslations("fees.online.errors");
    const attemptId = idSchema.parse(id);
    const attempt = await ctx.db.onlinePayment.findFirst({ where: { id: attemptId }, select: { reference: true } });
    if (!attempt) throw new NotFoundError();
    try {
      const outcome = await settleOnlinePayment(attempt.reference);
      revalidatePath("/payments");
      revalidatePath("/fees", "layout");
      return { result: outcome.result };
    } catch (err) {
      console.error("[paystack] recheck failed", err);
      throw new UserFacingError(t("checkFailed"));
    }
  });
}
