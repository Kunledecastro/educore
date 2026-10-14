import "server-only";
import { z } from "zod";
import { recordAudit, type AuditContext, type PrismaClient } from "@educore/db";
import { assignStudentDiscount, checkStudentDiscount, DiscountError, estimateDiscountMinor, saveDiscountRule } from "../discount-writer";
import { toMinor } from "../fees";
import { cancelInvoice, FeeRuleError, reversePayment } from "../invoice-writer";
import { cancelInvoiceSchema, discountSchema, reversalSchema, studentDiscountSchema } from "../validation/fees";
import { publishClassResults, ResultsError, resultsTarget, unpublishClassResults } from "../results-writer";
import { publishRequestSchema, unpublishRequestSchema } from "../validation/results";
import { randomUUID } from "node:crypto";
import { assessLeave, bookLeave, LeaveError, leaveTargetKey } from "../leave/data";
import { leaveRequestSchema } from "../leave/rules";
import { announcementSchema } from "../validation/messaging";
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
  /** 8.1: results. */
  className?: string;
  termName?: string;
  subjects?: string;
  /** 8.2: people and communication. */
  status?: string;
  title?: string;
  audience?: string;
  staff?: string;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
  /** The announcement text, so the approver reads exactly what will go out. */
  body?: string;
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
  if (err instanceof ResultsError) return `results.${err.code}`;
  if (err instanceof LeaveError) return `leave.${err.code}`;
  if (err instanceof ApplyError) return err.code;
  return null;
}

interface ProcessDef<S extends z.ZodTypeAny> {
  schema: S;
  /** One pending request per target. `requesterId`: whose request it is. */
  targetKey(p: z.infer<S>, requesterId: string): string;
  prepare(tx: Tx, tenantId: string, p: z.infer<S>, requesterId: string): Promise<{ summary: Summary; amountMinor: number | null }>;
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

const resultsPublish: ProcessDef<typeof publishRequestSchema> = {
  schema: publishRequestSchema,
  targetKey: (p) => `${p.classId}:${p.termId}`,
  async prepare(tx, tenantId, p) {
    const { cls, term, publication } = await resultsTarget(tx, tenantId, p);
    if (publication) throw new ResultsError("alreadyPublished");
    return { amountMinor: null, summary: { className: cls.name, termName: term.name, reason: p.note || undefined } };
  },
  async apply(tx, audit, p) {
    await publishClassResults(tx, audit, { classId: p.classId, termId: p.termId });
  },
};

const resultsUnpublish: ProcessDef<typeof unpublishRequestSchema> = {
  schema: unpublishRequestSchema,
  targetKey: (p) => `${p.classId}:${p.termId}`,
  async prepare(tx, tenantId, p) {
    const { cls, term, publication } = await resultsTarget(tx, tenantId, p);
    if (!publication) throw new ResultsError("notPublished");
    const ids = [...new Set(p.subjectIds)];
    const subjects = await tx.subject.findMany({ where: { tenantId, id: { in: ids } }, select: { name: true }, orderBy: { name: "asc" } });
    if (subjects.length !== ids.length) throw new ApplyError("notFound");
    return { amountMinor: null, summary: { className: cls.name, termName: term.name, subjects: subjects.map((s) => s.name).join(", "), reason: p.reason } };
  },
  async apply(tx, audit, p) {
    await unpublishClassResults(tx, audit, p);
  },
};

// ---------------------------------------------------------------------------
// 8.2 People and communication
// ---------------------------------------------------------------------------

export const studentStatusRequestSchema = z.object({
  studentId: z.string().min(1).max(64),
  status: z.enum(["INACTIVE", "GRADUATED", "WITHDRAWN"]),
  reason: z.string().trim().max(300).optional(),
});
const studentStatus: ProcessDef<typeof studentStatusRequestSchema> = {
  schema: studentStatusRequestSchema,
  targetKey: (p) => p.studentId,
  async prepare(tx, tenantId, p) {
    const st = await tx.student.findFirst({ where: { id: p.studentId, tenantId }, select: { firstName: true, lastName: true, admissionNo: true, status: true } });
    if (!st) throw new ApplyError("notFound");
    if (st.status === p.status) throw new ApplyError("student.unchanged");
    return { amountMinor: null, summary: { pupil: name(st), admissionNo: st.admissionNo, status: p.status, reason: p.reason || undefined } };
  },
  async apply(tx, audit, p) {
    const before = await tx.student.findFirst({ where: { id: p.studentId, tenantId: audit.tenantId } });
    if (!before) throw new ApplyError("notFound");
    if (before.status === p.status) throw new ApplyError("student.unchanged");
    const after = await tx.student.update({ where: { id: before.id }, data: { status: p.status } });
    await recordAudit(audit, { action: "UPDATE", entityType: "Student", entityId: before.id, before, after }, tx);
  },
};

/** A teacher's announcement to the whole school or a role (teachers can otherwise only post to their classes). */
export const schoolAnnouncementSchema = announcementSchema.refine((a) => a.audienceScope !== "CLASS" && !a.isPinned, { message: "validation.invalidChoice" });
const announcementSchool: ProcessDef<typeof schoolAnnouncementSchema> = {
  schema: schoolAnnouncementSchema,
  targetKey: () => `ann:${randomUUID()}`,
  async prepare(_tx, _tenantId, p) {
    return { amountMinor: null, summary: { title: p.title, body: p.body, audience: p.audienceScope === "ROLE" ? `ROLE:${p.audienceRole}` : "SCHOOL" } };
  },
  async apply(tx, audit, p) {
    const after = await tx.announcement.create({
      data: { tenantId: audit.tenantId, publishedById: audit.actorId!, title: p.title, body: p.body, audienceScope: p.audienceScope, audienceClassId: null, audienceRole: p.audienceScope === "ROLE" ? p.audienceRole : null, isPinned: false },
    });
    await recordAudit(audit, { action: "CREATE", entityType: "Announcement", entityId: after.id, before: null, after }, tx);
  },
};

const leave: ProcessDef<typeof leaveRequestSchema> = {
  schema: leaveRequestSchema,
  targetKey: (p, requesterId) => leaveTargetKey(requesterId, p),
  async prepare(tx, tenantId, p, requesterId) {
    const a = await assessLeave(tx, tenantId, requesterId, p);
    if (a.refusal) throw new LeaveError(a.refusal);
    const who = await tx.user.findFirst({ where: { id: requesterId, tenantId }, select: { name: true, email: true } });
    return { amountMinor: null, summary: { staff: who?.name ?? who?.email ?? "", leaveType: a.type.name, startDate: p.startDate, endDate: p.endDate, days: a.days, reason: p.note || undefined } };
  },
  async apply(tx, audit, p) {
    await bookLeave(tx, audit, p);
  },
};

export const PROCESSES: Record<ApprovalProcess, ProcessDef<z.ZodTypeAny>> = {
  DISCOUNT_ASSIGN: discountAssign,
  INVOICE_CANCEL: invoiceCancel,
  PAYMENT_REVERSAL: paymentReversal,
  DISCOUNT_RULE: discountRule,
  RESULTS_PUBLISH: resultsPublish,
  RESULTS_UNPUBLISH: resultsUnpublish,
  STUDENT_STATUS: studentStatus,
  ANNOUNCEMENT_SCHOOL: announcementSchool,
  LEAVE: leave,
};
