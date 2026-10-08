import "server-only";
import { z } from "zod";
import type { AuditContext, PrismaClient } from "@educore/db";
import { assignStudentDiscount, checkStudentDiscount, DiscountError, estimateDiscountMinor, saveDiscountRule } from "../discount-writer";
import { toMinor } from "../fees";
import { cancelInvoice, FeeRuleError, reversePayment } from "../invoice-writer";
import { cancelInvoiceSchema, discountSchema, reversalSchema, studentDiscountSchema } from "../validation/fees";
import type { ApprovalProcess } from "./policy";

/**
 * What each approval process does (Phase 8.0). `prepare` runs when the
 * request is made: it checks the change could happen now, and returns a
 * display snapshot and the amount. `apply` runs on final approval, inside
 * the approval's transaction, through the same writer the fee screens use —
 * so the checks are made again at that moment and a stale request fails
 * safely instead of half-applying.
 */

type Tx = PrismaClient;

/** Shown in the inbox and on the request page; taken when requested. */
export interface Summary {
  pupil?: string;
  admissionNo?: string;
  invoiceNo?: string;
  receiptNo?: string;
  discount?: string;
  discountValue?: string;
  scope?: string;
  reason?: string;
  ruleChange?: "create" | "update";
}

export class ApplyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ApplyError";
  }
}

/** Domain errors from the writers become stable codes (for failureCode and translations). */
export function errorCode(err: unknown): string | null {
  if (err instanceof FeeRuleError) return `fee.${err.code}`;
  if (err instanceof DiscountError) return `discount.${err.code}`;
  if (err instanceof ApplyError) return err.code;
  return null;
}

interface ProcessDef<S extends z.ZodTypeAny> {
  schema: S;
  targetKey(p: z.infer<S>): string;
  prepare(tx: Tx, tenantId: string, p: z.infer<S>): Promise<{ summary: Summary; amountMinor: number | null }>;
  apply(tx: Tx, audit: AuditContext, p: z.infer<S>): Promise<void>;
}

const name = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`;

const discountAssign: ProcessDef<typeof studentDiscountSchema> = {
  schema: studentDiscountSchema,
  targetKey: (p) => `${p.studentId}:${p.discountId}:${p.academicYearId}:${p.termId ?? "year"}`,
  async prepare(tx, tenantId, p) {
    const { student, discount, year, term } = await checkStudentDiscount(tx, tenantId, p);
    if (!discount.isActive) throw new DiscountError("inactive");
    const amountMinor = await estimateDiscountMinor(tx, tenantId, p);
    return {
      amountMinor,
      summary: { pupil: name(student), admissionNo: student.admissionNo, discount: discount.name, discountValue: `${discount.kind}:${discount.value.toString()}`, scope: term ? `${year.name} · ${term.name}` : year.name, reason: p.note ?? undefined },
    };
  },
  async apply(tx, audit, p) {
    const d = await tx.discount.findFirst({ where: { id: p.discountId, tenantId: audit.tenantId }, select: { isActive: true } });
    if (d && !d.isActive) throw new DiscountError("inactive");
    await assignStudentDiscount(tx, audit, p);
  },
};

const invoiceCancel: ProcessDef<typeof cancelInvoiceSchema> = {
  schema: cancelInvoiceSchema,
  targetKey: (p) => p.invoiceId,
  async prepare(tx, tenantId, p) {
    const inv = await tx.invoice.findFirst({ where: { id: p.invoiceId, tenantId }, select: { invoiceNo: true, status: true, totalDue: true, amountPaid: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } } });
    if (!inv) throw new ApplyError("notFound");
    if (inv.status === "CANCELLED") throw new FeeRuleError("alreadyCancelled");
    if ((toMinor(inv.amountPaid) ?? 0) !== 0) throw new FeeRuleError("hasPayments");
    return { amountMinor: toMinor(inv.totalDue) ?? 0, summary: { pupil: name(inv.student), admissionNo: inv.student.admissionNo, invoiceNo: inv.invoiceNo, reason: p.reason } };
  },
  async apply(tx, audit, p) {
    await cancelInvoice(tx, audit, { invoiceId: p.invoiceId, reason: p.reason });
  },
};

const paymentReversal: ProcessDef<typeof reversalSchema> = {
  schema: reversalSchema,
  targetKey: (p) => p.paymentId,
  async prepare(tx, tenantId, p) {
    const pay = await tx.payment.findFirst({
      where: { id: p.paymentId, tenantId },
      select: { kind: true, amount: true, receiptNo: true, reversedBy: { select: { id: true } }, invoice: { select: { invoiceNo: true } }, student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    });
    if (!pay || pay.kind !== "PAYMENT") throw new FeeRuleError("notAPayment");
    if (pay.reversedBy) throw new FeeRuleError("alreadyReversed");
    return { amountMinor: toMinor(pay.amount) ?? 0, summary: { pupil: name(pay.student), admissionNo: pay.student.admissionNo, receiptNo: pay.receiptNo ?? undefined, invoiceNo: pay.invoice.invoiceNo, reason: p.reason } };
  },
  async apply(tx, audit, p) {
    await reversePayment(tx, audit, { paymentId: p.paymentId, reason: p.reason });
  },
};

const discountRuleSchema = z.object({ id: z.string().min(1).max(40).nullable(), data: discountSchema });
const discountRule: ProcessDef<typeof discountRuleSchema> = {
  schema: discountRuleSchema,
  targetKey: (p) => (p.id ? `rule:${p.id}` : `new:${p.data.name.trim().toLowerCase()}`),
  async prepare(tx, tenantId, p) {
    if (p.id && !(await tx.discount.findFirst({ where: { id: p.id, tenantId }, select: { id: true } }))) throw new DiscountError("notFound");
    return { amountMinor: null, summary: { discount: p.data.name, discountValue: `${p.data.kind}:${p.data.value}`, ruleChange: p.id ? "update" : "create" } };
  },
  async apply(tx, audit, p) {
    await saveDiscountRule(tx, audit, { id: p.id, data: p.data });
  },
};

export const PROCESSES: Record<ApprovalProcess, ProcessDef<z.ZodTypeAny>> = {
  DISCOUNT_ASSIGN: discountAssign,
  INVOICE_CANCEL: invoiceCancel,
  PAYMENT_REVERSAL: paymentReversal,
  DISCOUNT_RULE: discountRule,
};
