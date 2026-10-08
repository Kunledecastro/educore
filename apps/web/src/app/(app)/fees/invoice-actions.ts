"use server";

import { revalidatePath } from "next/cache";
import { approvalGate } from "@/lib/approvals/gate";
import { getTranslations } from "next-intl/server";
import { can } from "@educore/auth";
import { auditedMutation, withRls } from "@educore/db";
import { toMinor } from "@/lib/fees";
import { todayInTimeZone } from "@/lib/format";
import { auditContextFor, ForbiddenError } from "@/lib/guard";
import { inngest } from "@/lib/inngest/client";
import { addAdjustment, cancelInvoice, FeeRuleError, findDuplicateReference, recordPayment, reversePayment } from "@/lib/invoice-writer";
import { toSignedMinor } from "@/lib/invoicing";
import { NotFoundError, runAction, UserFacingError } from "@/lib/run-action";
import { getSettingsForUser } from "@/lib/tenant";
import { adjustmentSchema, billingRunSchema, cancelInvoiceSchema, paymentSchema, reversalSchema } from "@/lib/validation/fees";

/**
 * Invoicing (3.1) and payments (3.2). Permission first (runAction), Zod
 * input, then the rules and bookkeeping in lib/invoice-writer.ts inside one
 * RLS transaction with the audit entry. Rule refusals become friendly
 * messages; ids from the browser are re-checked against the school.
 */

async function feeError(err: unknown): Promise<never> {
  if (err instanceof FeeRuleError) {
    const t = await getTranslations("fees.rules");
    const fieldFor: Partial<Record<string, string>> = { notPositive: "amount", moreThanBalance: "amount", futureDate: "paidAt", zero: "amount", belowPaid: "amount", belowZero: "amount" };
    const field = fieldFor[err.code];
    throw new UserFacingError(t(err.code), field ? { [field]: t(err.code) } : undefined);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Bill the term
// ---------------------------------------------------------------------------

export async function startBillingRun(input: unknown) {
  return runAction(["invoice", "create"], async (ctx) => {
    const data = billingRunSchema.parse(input);
    const t = await getTranslations("fees.billing.errors");
    const audit = auditContextFor(ctx);
    const run = await auditedMutation(audit, {
      action: "CREATE",
      entityType: "BillingRun",
      run: async (tx) => {
        const term = await tx.term.findFirst({ where: { id: data.termId, tenantId: audit.tenantId }, select: { id: true, academicYearId: true } });
        if (!term) throw new NotFoundError();
        const classes = await tx.classGrade.findMany({ where: { tenantId: audit.tenantId, academicYearId: term.academicYearId, id: { in: data.classIds } }, select: { id: true } });
        if (classes.length !== new Set(data.classIds).size) throw new NotFoundError();
        const busy = await tx.billingRun.findFirst({ where: { tenantId: audit.tenantId, status: { in: ["QUEUED", "RUNNING"] } } });
        if (busy) throw new UserFacingError(t("busy"));
        const after = await tx.billingRun.create({
          data: { tenantId: audit.tenantId, termId: term.id, classIds: classes.map((c) => c.id), dueDate: data.dueDate, createdById: audit.actorId },
        });
        return { after };
      },
    });
    try {
      await inngest.send({ name: "educore/billing.requested", data: { runId: run.id, tenantId: run.tenantId } });
    } catch (err) {
      console.error("[billing] could not queue run", err);
      await withRls(run.tenantId, (tx) => tx.billingRun.update({ where: { id: run.id }, data: { status: "FAILED", error: "queueUnavailable", finishedAt: new Date() } }));
      throw new UserFacingError(t("queueUnavailable"));
    }
    revalidatePath("/fees", "layout");
    return { id: run.id };
  });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export async function cancelInvoiceAction(input: unknown) {
  return runAction(["invoice", "update"], async (ctx) => {
    const data = cancelInvoiceSchema.parse(input);
    const gate = await approvalGate(ctx, "INVOICE_CANCEL", data, data.reason).catch(feeError);
    if (gate) {
      revalidatePath("/fees", "layout");
      revalidatePath("/approvals");
      return gate;
    }
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, async (tx) => {
      if (!(await tx.invoice.findFirst({ where: { id: data.invoiceId, tenantId: audit.tenantId }, select: { id: true } }))) throw new NotFoundError();
      await cancelInvoice(tx, audit, { invoiceId: data.invoiceId, reason: data.reason }).catch(feeError);
    });
    revalidatePath("/fees", "layout");
  });
}

export async function addAdjustmentAction(input: unknown) {
  return runAction(["invoice", "update"], async (ctx) => {
    const data = adjustmentSchema.parse(input);
    const tv = await getTranslations("validation");
    const amountMinor = toSignedMinor(data.amount, toMinor);
    if (amountMinor === null) throw new UserFacingError(tv("signedAmount"), { amount: tv("signedAmount") });
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, async (tx) => {
      if (!(await tx.invoice.findFirst({ where: { id: data.invoiceId, tenantId: audit.tenantId }, select: { id: true } }))) throw new NotFoundError();
      await addAdjustment(tx, audit, { invoiceId: data.invoiceId, description: data.description, amountMinor }).catch(feeError);
    });
    revalidatePath("/fees", "layout");
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPaymentAction(input: unknown) {
  return runAction(["payment", "create"], async (ctx) => {
    // Parents also hold payment:create — for ONLINE checkout only (3.3). Recording money
    // received at the bursary is finance staff's job: never let a family mark itself paid.
    if (!can(ctx.user.role, "feeStructure", "update")) throw new ForbiddenError();
    const data = paymentSchema.parse(input);
    const t = await getTranslations("fees.rules");
    const settings = await getSettingsForUser(ctx.user.tenantId ?? null);
    const audit = auditContextFor(ctx);
    const result = await withRls(audit.tenantId, async (tx) => {
      if (!(await tx.invoice.findFirst({ where: { id: data.invoiceId, tenantId: audit.tenantId }, select: { id: true } }))) throw new NotFoundError();
      const duplicate = await findDuplicateReference(tx, audit.tenantId, data.method, data.reference ?? null);
      if (duplicate) throw new UserFacingError(t("duplicateReference", { receipt: duplicate.receiptNo ?? "" }), { reference: t("duplicateReference", { receipt: duplicate.receiptNo ?? "" }) });
      return recordPayment(tx, audit, {
        invoiceId: data.invoiceId,
        amountMinor: toMinor(data.amount)!,
        method: data.method,
        reference: data.reference ?? null,
        note: data.note ?? null,
        paidAt: data.paidAt,
        today: todayInTimeZone(settings.timezone),
        receiptPrefix: settings.receiptPrefix,
      }).catch(feeError);
    });
    revalidatePath("/fees", "layout");
    revalidatePath("/payments");
    return { paymentId: result.payment.id, receiptNo: result.payment.receiptNo };
  });
}

export async function reversePaymentAction(input: unknown) {
  return runAction(["payment", "update"], async (ctx) => {
    const data = reversalSchema.parse(input);
    const gate = await approvalGate(ctx, "PAYMENT_REVERSAL", data, data.reason).catch(feeError);
    if (gate) {
      revalidatePath("/fees", "layout");
      revalidatePath("/approvals");
      return gate;
    }
    const audit = auditContextFor(ctx);
    await withRls(audit.tenantId, async (tx) => {
      if (!(await tx.payment.findFirst({ where: { id: data.paymentId, tenantId: audit.tenantId }, select: { id: true } }))) throw new NotFoundError();
      await reversePayment(tx, audit, { paymentId: data.paymentId, reason: data.reason }).catch(feeError);
    });
    revalidatePath("/fees", "layout");
    revalidatePath("/payments");
  });
}
