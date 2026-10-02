/**
 * Invoice and payment rules (Phase 3.1 / 3.2). Pure and tested; amounts in
 * integer minor units (see lib/fees.ts).
 */
import type { Bill } from "./fees";

export type StoredInvoiceStatus = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
export type InvoiceDisplayStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";

/** The stored status follows from the money, never typed in. */
export function invoiceStatusFor(totalMinor: number, paidMinor: number): "ISSUED" | "PARTIALLY_PAID" | "PAID" {
  if (paidMinor >= totalMinor) return "PAID";
  return paidMinor > 0 ? "PARTIALLY_PAID" : "ISSUED";
}

/**
 * What to show: an unpaid or part-paid invoice past its due date is
 * OVERDUE. `today` and `dueDate` are date-only values (UTC midnight).
 */
export function displayStatus(inv: { status: StoredInvoiceStatus; dueDate: Date }, today: Date): InvoiceDisplayStatus {
  if (inv.status === "CANCELLED" || inv.status === "PAID") return inv.status;
  if (inv.dueDate.getTime() < today.getTime()) return "OVERDUE";
  return inv.status === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "ISSUED";
}

/** Prefix-YEAR-00042 (at least 5 digits). */
export function documentNumber(prefix: string, year: number | string, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}

export interface InvoiceLineDraft {
  kind: "FEE" | "DISCOUNT" | "ADJUSTMENT";
  feeTypeId: string | null;
  discountId: string | null;
  description: string;
  amountMinor: number;
  position: number;
}

/** A bill (lib/fees computeBill) as invoice lines, plus the invoice's totals. */
export function invoiceFromBill(bill: Bill): { lines: InvoiceLineDraft[]; subtotalMinor: number; discountMinor: number; totalMinor: number } {
  const lines = bill.lines.map<InvoiceLineDraft>((l, position) =>
    l.kind === "FEE"
      ? { kind: "FEE", feeTypeId: l.feeTypeId, discountId: null, description: l.description, amountMinor: l.amountMinor, position }
      : { kind: "DISCOUNT", feeTypeId: null, discountId: l.discountId, description: l.description, amountMinor: l.amountMinor, position },
  );
  return { lines, subtotalMinor: bill.subtotalMinor, discountMinor: bill.discountMinor, totalMinor: bill.totalMinor };
}

export type PaymentIssue = "notPositive" | "moreThanBalance" | "invoiceCancelled" | "invoicePaid" | "futureDate";

/**
 * Can this amount be paid against this invoice? Payments never exceed the
 * balance (no overpayment on an invoice); the date can't be in the future.
 */
export function checkPayment(input: {
  amountMinor: number;
  invoice: { status: StoredInvoiceStatus; totalMinor: number; paidMinor: number };
  paidOn: Date;
  today: Date;
}): PaymentIssue | null {
  if (input.invoice.status === "CANCELLED") return "invoiceCancelled";
  const balance = input.invoice.totalMinor - input.invoice.paidMinor;
  if (balance <= 0) return "invoicePaid";
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) return "notPositive";
  if (input.amountMinor > balance) return "moreThanBalance";
  if (input.paidOn.getTime() > input.today.getTime()) return "futureDate";
  return null;
}

export type AdjustmentIssue = "zero" | "belowPaid" | "belowZero" | "invoiceCancelled";

/**
 * An adjustment line (extra charge, or a credit with a negative amount) on an
 * issued invoice. The total can't go below zero, nor below what's already
 * been paid (reverse a payment first).
 */
export function checkAdjustment(input: { amountMinor: number; status: StoredInvoiceStatus; totalMinor: number; paidMinor: number }): AdjustmentIssue | null {
  if (input.status === "CANCELLED") return "invoiceCancelled";
  if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) return "zero";
  const next = input.totalMinor + input.amountMinor;
  if (next < 0) return "belowZero";
  if (next < input.paidMinor) return "belowPaid";
  return null;
}

/** A reversal is allowed once, only for a real payment, and only on a non-cancelled invoice. */
export function checkReversal(payment: { kind: "PAYMENT" | "REVERSAL"; reversed: boolean }): "notAPayment" | "alreadyReversed" | null {
  if (payment.kind !== "PAYMENT") return "notAPayment";
  if (payment.reversed) return "alreadyReversed";
  return null;
}

/** Signed money parser for adjustments: "-5,000" → -500000. */
export function toSignedMinor(raw: string, toMinor: (s: string) => number | null): number | null {
  const s = raw.trim();
  const negative = s.startsWith("-");
  const minor = toMinor(negative ? s.slice(1) : s.replace(/^\+/, ""));
  if (minor === null) return null;
  return negative ? -minor : minor;
}

/** Totals for a list of invoices (dashboards, class summaries). */
export function summarizeInvoices(invoices: { status: StoredInvoiceStatus; totalMinor: number; paidMinor: number; dueDate: Date }[], today: Date) {
  let billed = 0;
  let paid = 0;
  let overdue = 0;
  let count = 0;
  for (const inv of invoices) {
    if (inv.status === "CANCELLED") continue;
    count++;
    billed += inv.totalMinor;
    paid += inv.paidMinor;
    if (displayStatus(inv, today) === "OVERDUE") overdue += inv.totalMinor - inv.paidMinor;
  }
  return { count, billed, paid, outstanding: billed - paid, overdue, rate: billed === 0 ? null : paid / billed };
}
