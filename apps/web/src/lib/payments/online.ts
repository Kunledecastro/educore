import "server-only";
import { randomBytes } from "node:crypto";
import { platformPrisma, recordAudit, withRls, type PrismaClient } from "@educore/db";
import { fromMinor, toMinor } from "../fees";
import { todayInTimeZone } from "../format";
import { FeeRuleError, recordPayment } from "../invoice-writer";
import { getTenantSettingsById } from "../tenant-settings-server";
import { paystack, type PaymentProvider } from "./paystack";
import { decideSettlement, type AttemptStatus } from "./settle-rules";

/**
 * Online payments (milestone 3.3): start a checkout for a parent, and settle
 * it once the provider confirms. Settlement is idempotent and safe to call
 * from the return page, the webhook and a manual "check again" — whichever
 * comes first records the payment; the others find it already done.
 */

/** A provider reference nobody can guess: EDU-<20 hex>. */
export function newReference(): string {
  return `EDU-${randomBytes(10).toString("hex")}`;
}

export interface StartInput {
  tenantId: string;
  payer: { id: string; email: string };
  invoice: { id: string; studentId: string; invoiceNo: string; currency: string };
  amountMinor: number;
  callbackUrl: (reference: string) => string;
}

/** Records the attempt FIRST (so the webhook can find it), then asks the provider for a checkout URL. */
export async function startOnlineCheckout(input: StartInput, provider: PaymentProvider = paystack) {
  const reference = newReference();
  const attempt = await withRls(input.tenantId, (tx) =>
    tx.onlinePayment.create({
      data: {
        tenantId: input.tenantId,
        invoiceId: input.invoice.id,
        studentId: input.invoice.studentId,
        payerId: input.payer.id,
        provider: provider.name,
        reference,
        amount: fromMinor(input.amountMinor),
        currency: input.invoice.currency,
      },
    }),
  );
  try {
    const { authorizationUrl } = await provider.initialize({
      email: input.payer.email,
      amountMinor: input.amountMinor,
      currency: input.invoice.currency,
      reference,
      callbackUrl: input.callbackUrl(reference),
      metadata: { invoice: input.invoice.invoiceNo, school: input.tenantId },
    });
    return { reference, authorizationUrl, attemptId: attempt.id };
  } catch (err) {
    await withRls(input.tenantId, (tx) =>
      tx.onlinePayment.update({ where: { id: attempt.id }, data: { status: "FAILED", message: "Could not start checkout" } }),
    );
    throw err;
  }
}

export type SettleOutcome =
  | { result: "unknown" }
  | { result: "pending" | "failed" | "abandoned" | "review"; invoiceId: string }
  | { result: "paid"; invoiceId: string; receiptNo: string | null };

const OUTCOME: Record<AttemptStatus, "pending" | "failed" | "abandoned" | "review"> = {
  PENDING: "pending",
  FAILED: "failed",
  ABANDONED: "abandoned",
  NEEDS_REVIEW: "review",
  SUCCEEDED: "pending", // not used: SUCCEEDED returns "paid"
};

/**
 * Checks a reference with the provider and applies the result.
 * The attempt row is locked for the whole decision, so two callers
 * (webhook + return page) can't both record the money.
 */
export async function settleOnlinePayment(reference: string, provider: PaymentProvider = paystack): Promise<SettleOutcome> {
  if (!/^EDU-[0-9a-f]{20}$/.test(reference)) return { result: "unknown" };
  // The webhook arrives with no session: the reference (unique across schools) says which school it is.
  const found = await platformPrisma().onlinePayment.findUnique({ where: { reference }, select: { tenantId: true } });
  if (!found) return { result: "unknown" };
  const { tenantId } = found;

  const verification = await provider.verify(reference);
  const settings = await getTenantSettingsById(tenantId);

  return withRls(tenantId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM online_payments WHERE reference = ${reference} FOR UPDATE`;
    const attempt = await tx.onlinePayment.findFirstOrThrow({ where: { reference, tenantId }, include: { payment: { select: { receiptNo: true } } } });
    const decision = decideSettlement(
      { status: attempt.status, amountMinor: toMinor(attempt.amount) ?? 0, currency: attempt.currency, reference: attempt.reference },
      verification,
    );
    const audit = { tenantId, actorId: attempt.payerId, ipAddress: null, userAgent: `EduCore ${provider.name}` };

    if (decision.action === "none") {
      if (attempt.status === "SUCCEEDED") return { result: "paid", invoiceId: attempt.invoiceId, receiptNo: attempt.payment?.receiptNo ?? null };
      return { result: OUTCOME[attempt.status], invoiceId: attempt.invoiceId };
    }
    if (decision.action === "mark") {
      await tx.onlinePayment.update({ where: { id: attempt.id }, data: { status: decision.status, message: verification.message, verifiedAt: new Date() } });
      return { result: decision.status === "FAILED" ? "failed" : "abandoned", invoiceId: attempt.invoiceId };
    }
    if (decision.action === "review") return review(tx, attempt.id, decision.reason, audit, attempt.invoiceId);

    // record: the money is in. Apply it to the invoice (same rules as the bursary).
    await tx.$executeRawUnsafe("SAVEPOINT online_payment");
    try {
      const { payment } = await recordPayment(tx, audit, {
        invoiceId: attempt.invoiceId,
        amountMinor: toMinor(attempt.amount)!,
        method: "PAYSTACK",
        reference,
        note: verification.channel ? `Paid online (${verification.channel})` : "Paid online",
        paidAt: todayInTimeZone(settings.timezone, verification.paidAt ?? new Date()),
        today: todayInTimeZone(settings.timezone),
        receiptPrefix: settings.receiptPrefix,
      });
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT online_payment");
      const after = await tx.onlinePayment.update({
        where: { id: attempt.id },
        data: { status: "SUCCEEDED", paymentId: payment.id, channel: verification.channel, message: verification.message, verifiedAt: new Date() },
      });
      await recordAudit(audit, { action: "UPDATE", entityType: "OnlinePayment", entityId: attempt.id, before: attempt, after }, tx);
      return { result: "paid", invoiceId: attempt.invoiceId, receiptNo: payment.receiptNo };
    } catch (err) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT online_payment");
      // Paid, but the invoice can't take it any more (settled at the bursary meanwhile, cancelled…): a person decides.
      if (err instanceof FeeRuleError) return review(tx, attempt.id, err.code, audit, attempt.invoiceId);
      throw err;
    }
  });
}

async function review(tx: PrismaClient, attemptId: string, reason: string, audit: { tenantId: string; actorId: string | null; ipAddress: null; userAgent: string }, invoiceId: string): Promise<SettleOutcome> {
  const after = await tx.onlinePayment.update({ where: { id: attemptId }, data: { status: "NEEDS_REVIEW", message: reason, verifiedAt: new Date() } });
  await recordAudit(audit, { action: "UPDATE", entityType: "OnlinePayment", entityId: attemptId, after }, tx);
  return { result: "review", invoiceId };
}
