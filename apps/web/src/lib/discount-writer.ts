import "server-only";
import { recordAudit, type AuditContext, type PrismaClient } from "@educore/db";
import { fromMinor, percentOf, toMinor } from "./fees";
import type { discountSchema, studentDiscountSchema } from "./validation/fees";
import type { z } from "zod";

/**
 * Discounts, written inside a caller's transaction (Phase 8 refactor): the
 * fee screens call these directly when no approval is needed, and the
 * approval engine calls the same functions when a request is approved — so
 * both paths run exactly the same checks.
 */

type Tx = PrismaClient;
export type StudentDiscountData = z.infer<typeof studentDiscountSchema>;
export type DiscountRuleData = z.infer<typeof discountSchema>;

export class DiscountError extends Error {
  constructor(public readonly code: "notFound" | "alreadyAssigned" | "inactive") {
    super(code);
    this.name = "DiscountError";
  }
}

async function must<T>(row: Promise<T | null>): Promise<T> {
  const found = await row;
  if (!found) throw new DiscountError("notFound");
  return found;
}

/** Everything that must hold for a discount to be given to a pupil; returns what's needed to describe it. */
export async function checkStudentDiscount(tx: Tx, tenantId: string, data: StudentDiscountData) {
  const student = await must(tx.student.findFirst({ where: { id: data.studentId, tenantId }, select: { id: true, firstName: true, lastName: true, admissionNo: true, classId: true, status: true } }));
  const discount = await must(tx.discount.findFirst({ where: { id: data.discountId, tenantId }, select: { id: true, name: true, kind: true, value: true, feeTypeId: true, isActive: true } }));
  const year = await must(tx.academicYear.findFirst({ where: { id: data.academicYearId, tenantId }, select: { id: true, name: true } }));
  const term = data.termId ? await must(tx.term.findFirst({ where: { id: data.termId, tenantId, academicYearId: data.academicYearId }, select: { id: true, name: true } })) : null;
  const clash = await tx.studentDiscount.findFirst({
    where: { tenantId, studentId: data.studentId, discountId: data.discountId, academicYearId: data.academicYearId, termId: data.termId ?? null },
    select: { id: true },
  });
  if (clash) throw new DiscountError("alreadyAssigned");
  return { student, discount, year, term };
}

export async function assignStudentDiscount(tx: Tx, audit: AuditContext, data: StudentDiscountData) {
  await checkStudentDiscount(tx, audit.tenantId, data);
  const after = await tx.studentDiscount.create({
    data: { tenantId: audit.tenantId, studentId: data.studentId, discountId: data.discountId, academicYearId: data.academicYearId, termId: data.termId ?? null, note: data.note ?? null },
  });
  await recordAudit(audit, { action: "CREATE", entityType: "StudentDiscount", entityId: after.id, after }, tx);
  return after;
}

/**
 * Roughly what the discount is worth, for approval thresholds: the pupil's
 * scheduled fees in scope (that term, or every term of the year), only the
 * discount's fee item if it has one. Fixed discounts count once per term.
 */
export async function estimateDiscountMinor(tx: Tx, tenantId: string, data: StudentDiscountData): Promise<number> {
  const { student, discount } = await checkStudentDiscount(tx, tenantId, data).catch(async (err) => {
    if (err instanceof DiscountError && err.code === "alreadyAssigned") {
      // Still estimate (the caller reports the clash separately).
      const s = await tx.student.findFirst({ where: { id: data.studentId, tenantId }, select: { classId: true } });
      const d = await tx.discount.findFirst({ where: { id: data.discountId, tenantId }, select: { kind: true, value: true, feeTypeId: true } });
      return { student: s!, discount: d! };
    }
    throw err;
  });
  const rows = await tx.feeStructure.findMany({
    where: {
      tenantId,
      academicYearId: data.academicYearId,
      termId: data.termId ? data.termId : { not: null },
      OR: [{ classId: student.classId ?? "__none__" }, { classId: null }],
      ...(discount.feeTypeId ? { feeTypeId: discount.feeTypeId } : {}),
    },
    select: { amount: true, termId: true },
  });
  const value = toMinor(discount.value) ?? 0;
  if (discount.kind === "FIXED") {
    const terms = data.termId ? 1 : Math.max(1, new Set(rows.map((r) => r.termId)).size);
    return value * terms;
  }
  const total = rows.reduce((n, r) => n + (toMinor(r.amount) ?? 0), 0);
  return percentOf(total, value / 100);
}

function ruleRow(data: DiscountRuleData) {
  const minor = toMinor(data.value)!;
  // PERCENT stores the percentage itself (12.5); FIXED stores the amount.
  return { name: data.name, kind: data.kind, value: fromMinor(minor), feeTypeId: data.feeTypeId ?? null, isActive: data.isActive };
}

/** Creates (no id) or changes a discount rule. Issued invoices keep the amount they were given. */
export async function saveDiscountRule(tx: Tx, audit: AuditContext, input: { id: string | null; data: DiscountRuleData }) {
  if (input.data.feeTypeId) await must(tx.feeType.findFirst({ where: { id: input.data.feeTypeId, tenantId: audit.tenantId }, select: { id: true } }));
  if (input.id) {
    const before = await must(tx.discount.findFirst({ where: { id: input.id, tenantId: audit.tenantId } }));
    const after = await tx.discount.update({ where: { id: before.id }, data: ruleRow(input.data) });
    await recordAudit(audit, { action: "UPDATE", entityType: "Discount", entityId: after.id, before, after }, tx);
    return after;
  }
  const after = await tx.discount.create({ data: { tenantId: audit.tenantId, ...ruleRow(input.data) } });
  await recordAudit(audit, { action: "CREATE", entityType: "Discount", entityId: after.id, after }, tx);
  return after;
}
