import "server-only";
import { recordAudit, type AuditContext, type PaymentMethod, type PrismaClient } from "@educore/db";
import { fromMinor, toMinor, type Bill } from "./fees";
import {
  checkAdjustment,
  checkPayment,
  checkReversal,
  documentNumber,
  invoiceFromBill,
  invoiceStatusFor,
  type AdjustmentIssue,
  type PaymentIssue,
  type StoredInvoiceStatus,
} from "./invoicing";

/**
 * Every write to invoices and payments goes through here (Phase 3.1/3.2),
 * always inside the school's RLS transaction (withRls / auditedMutation),
 * always with its audit entry in the same transaction. Rules live in
 * lib/invoicing.ts; this file does the locking, numbering and bookkeeping.
 *
 * Concurrency: every change to an invoice's money first locks the invoice
 * row (SELECT … FOR UPDATE), so two bursars recording payments at once
 * can't both pay the same balance. Numbers come from number_sequences,
 * incremented in the same transaction, so a rolled-back write never burns
 * a number (gap-free).
 */

/** An expected refusal with a code the action turns into a message. */
export class FeeRuleError extends Error {
  constructor(public readonly code: PaymentIssue | AdjustmentIssue | "hasPayments" | "alreadyCancelled" | "notAPayment" | "alreadyReversed") {
    super(code);
    this.name = "FeeRuleError";
  }
}

type Tx = PrismaClient;

/** Reserves `count` consecutive numbers for a key ("invoice:2026"); returns the first. */
export async function nextNumbers(tx: Tx, tenantId: string, key: string, count = 1): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO number_sequences ("tenantId", "key", "value") VALUES (${tenantId}, ${key}, ${count})
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "value" = number_sequences."value" + ${count}
    RETURNING "value"`;
  return Number(rows[0]!.value) - count + 1;
}

async function lockInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { academicYear: { select: { startDate: true } } },
  });
  if (!invoice) throw new FeeRuleError("invoiceCancelled"); // callers check existence first; this is a race guard
  return invoice;
}

const minor = (v: { toString(): string }) => toMinor(v) ?? 0;

/** Recomputes amountPaid and status from the invoice's payments (net of reversals). */
export async function settleInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  const [inv, sum] = await Promise.all([
    tx.invoice.findFirstOrThrow({ where: { id: invoiceId, tenantId }, select: { status: true, totalDue: true } }),
    tx.payment.aggregate({ where: { tenantId, invoiceId }, _sum: { amount: true } }),
  ]);
  const paid = minor(sum._sum.amount ?? 0);
  const status = inv.status === "CANCELLED" ? "CANCELLED" : invoiceStatusFor(minor(inv.totalDue), paid);
  return tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: fromMinor(paid), status } });
}

export interface NewInvoice {
  studentId: string;
  term: { id: string; academicYearId: string; yearStart: Date };
  bill: Bill;
  dueDate: Date;
  currency: string;
  prefix: string;
  billingRunId?: string | null;
}

/** Creates one issued invoice from a bill. The caller makes sure the student has no live invoice for the term. */
export async function createInvoice(tx: Tx, audit: AuditContext, input: NewInvoice) {
  const { lines, subtotalMinor, discountMinor, totalMinor } = invoiceFromBill(input.bill);
  const year = input.term.yearStart.getUTCFullYear();
  const n = await nextNumbers(tx, audit.tenantId, `invoice:${year}`);
  const invoice = await tx.invoice.create({
    data: {
      tenantId: audit.tenantId,
      studentId: input.studentId,
      academicYearId: input.term.academicYearId,
      termId: input.term.id,
      invoiceNo: documentNumber(input.prefix, year, n),
      dueDate: input.dueDate,
      status: invoiceStatusFor(totalMinor, 0),
      subtotal: fromMinor(subtotalMinor),
      discountTotal: fromMinor(discountMinor),
      totalDue: fromMinor(totalMinor),
      amountPaid: "0",
      currency: input.currency,
      billingRunId: input.billingRunId ?? null,
      createdById: audit.actorId,
      lines: {
        create: lines.map((l) => ({
          tenantId: audit.tenantId,
          kind: l.kind,
          feeTypeId: l.feeTypeId,
          discountId: l.discountId,
          description: l.description,
          amount: fromMinor(l.amountMinor),
          position: l.position,
        })),
      },
    },
    include: { lines: true },
  });
  await recordAudit(audit, { action: "CREATE", entityType: "Invoice", entityId: invoice.id, after: invoice }, tx);
  return invoice;
}

export async function cancelInvoice(tx: Tx, audit: AuditContext, input: { invoiceId: string; reason: string }) {
  const before = await lockInvoice(tx, audit.tenantId, input.invoiceId);
  if (before.status === "CANCELLED") throw new FeeRuleError("alreadyCancelled");
  // Net of reversals: an invoice whose payments were all reversed can be cancelled.
  if (minor(before.amountPaid) !== 0) throw new FeeRuleError("hasPayments");
  const after = await tx.invoice.update({
    where: { id: before.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason },
  });
  await recordAudit(audit, { action: "UPDATE", entityType: "Invoice", entityId: before.id, before, after }, tx);
  return after;
}

/** Adds an extra charge (positive) or a credit (negative) to an invoice. */
export async function addAdjustment(tx: Tx, audit: AuditContext, input: { invoiceId: string; description: string; amountMinor: number }) {
  const before = await lockInvoice(tx, audit.tenantId, input.invoiceId);
  const issue = checkAdjustment({
    amountMinor: input.amountMinor,
    status: before.status as StoredInvoiceStatus,
    totalMinor: minor(before.totalDue),
    paidMinor: minor(before.amountPaid),
  });
  if (issue) throw new FeeRuleError(issue);
  const last = await tx.invoiceLine.aggregate({ where: { tenantId: audit.tenantId, invoiceId: before.id }, _max: { position: true } });
  const line = await tx.invoiceLine.create({
    data: {
      tenantId: audit.tenantId,
      invoiceId: before.id,
      kind: "ADJUSTMENT",
      description: input.description,
      amount: fromMinor(input.amountMinor),
      position: (last._max.position ?? 0) + 1,
    },
  });
  const total = minor(before.totalDue) + input.amountMinor;
  await tx.invoice.update({ where: { id: before.id }, data: { totalDue: fromMinor(total) } });
  const after = await settleInvoice(tx, audit.tenantId, before.id);
  await recordAudit(audit, { action: "UPDATE", entityType: "Invoice", entityId: before.id, before, after: { ...after, addedLine: line } }, tx);
  return after;
}

export interface NewPayment {
  invoiceId: string;
  amountMinor: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  paidAt: Date;
  today: Date;
  receiptPrefix: string;
}

/** Records money received against an invoice and issues its receipt number. */
export async function recordPayment(tx: Tx, audit: AuditContext, input: NewPayment) {
  const invoice = await lockInvoice(tx, audit.tenantId, input.invoiceId);
  const issue = checkPayment({
    amountMinor: input.amountMinor,
    invoice: { status: invoice.status as StoredInvoiceStatus, totalMinor: minor(invoice.totalDue), paidMinor: minor(invoice.amountPaid) },
    paidOn: input.paidAt,
    today: input.today,
  });
  if (issue) throw new FeeRuleError(issue);
  const year = invoice.academicYear.startDate.getUTCFullYear();
  const n = await nextNumbers(tx, audit.tenantId, `receipt:${year}`);
  const payment = await tx.payment.create({
    data: {
      tenantId: audit.tenantId,
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      kind: "PAYMENT",
      amount: fromMinor(input.amountMinor),
      method: input.method,
      reference: input.reference,
      note: input.note,
      receiptNo: documentNumber(input.receiptPrefix, year, n),
      paidAt: input.paidAt,
      recordedById: audit.actorId,
    },
  });
  const after = await settleInvoice(tx, audit.tenantId, invoice.id);
  await recordAudit(
    audit,
    { action: "CREATE", entityType: "Payment", entityId: payment.id, after: { ...payment, invoice: { invoiceNo: after.invoiceNo, status: after.status, amountPaid: after.amountPaid } } },
    tx,
  );
  return { payment, invoice: after };
}

/** Undoes a payment with a REVERSAL row (the original is never changed or deleted). */
export async function reversePayment(tx: Tx, audit: AuditContext, input: { paymentId: string; reason: string }) {
  const original = await tx.payment.findFirst({
    where: { id: input.paymentId, tenantId: audit.tenantId },
    include: { reversedBy: { select: { id: true } } },
  });
  if (!original) throw new FeeRuleError("notAPayment");
  await lockInvoice(tx, audit.tenantId, original.invoiceId);
  const issue = checkReversal({ kind: original.kind, reversed: original.reversedBy !== null });
  if (issue) throw new FeeRuleError(issue);
  const reversal = await tx.payment.create({
    data: {
      tenantId: audit.tenantId,
      invoiceId: original.invoiceId,
      studentId: original.studentId,
      kind: "REVERSAL",
      amount: fromMinor(-minor(original.amount)),
      method: original.method,
      reference: original.receiptNo,
      note: input.reason,
      reversesId: original.id,
      paidAt: new Date(),
      recordedById: audit.actorId,
    },
  });
  const after = await settleInvoice(tx, audit.tenantId, original.invoiceId);
  await recordAudit(
    audit,
    { action: "CREATE", entityType: "Payment", entityId: reversal.id, before: original, after: { ...reversal, invoice: { invoiceNo: after.invoiceNo, status: after.status, amountPaid: after.amountPaid } } },
    tx,
  );
  return { reversal, invoice: after };
}

/** The other payment (not reversed) already recorded with this reference, if any — a double-entry guard. */
export async function findDuplicateReference(tx: Tx, tenantId: string, method: PaymentMethod, reference: string | null) {
  if (!reference || method === "CASH") return null;
  return tx.payment.findFirst({
    where: { tenantId, kind: "PAYMENT", method, reference: { equals: reference, mode: "insensitive" }, reversedBy: null },
    select: { receiptNo: true },
  });
}
