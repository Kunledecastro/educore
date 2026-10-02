import { z } from "zod";
import { toMinor } from "@/lib/fees";
import { dateOnlySchema, idSchema, textSchema, V } from "./common";

/** Fee setup (milestone 3.0). Messages are i18n keys, as everywhere else. */

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v ?? undefined), z.string().max(max, V.tooLong).optional());

const optionalId = z.preprocess((v) => (v === "" || v === null ? undefined : v), idSchema.optional());

export const feeItemSchema = z.object({
  name: textSchema(80),
  description: optionalText(200),
  isOptional: z.boolean().default(false),
  isOneOff: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type FeeItemFormInput = z.input<typeof feeItemSchema>;

export const discountSchema = z
  .object({
    name: textSchema(80),
    kind: z.enum(["PERCENT", "FIXED"], { errorMap: () => ({ message: V.invalidChoice }) }),
    value: z.string({ required_error: V.required }).trim().min(1, V.required),
    feeTypeId: optionalId,
    isActive: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    const minor = toMinor(d.value);
    if (minor === null || minor === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "validation.amount" });
    else if (d.kind === "PERCENT" && minor > 10000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "validation.percent" });
  });
export type DiscountFormInput = z.input<typeof discountSchema>;

export const studentDiscountSchema = z.object({
  studentId: idSchema,
  discountId: idSchema,
  academicYearId: idSchema,
  /** "" = the whole year. */
  termId: optionalId,
  note: optionalText(200),
});
export type StudentDiscountFormInput = z.input<typeof studentDiscountSchema>;

export const scheduleSchema = z.object({
  termId: idSchema,
  rows: z
    .array(z.object({ feeTypeId: idSchema, classId: idSchema, amount: z.string().max(20, V.tooLong) }))
    .max(5000),
});
export type ScheduleInput = z.input<typeof scheduleSchema>;

export const copyScheduleSchema = z.object({
  fromTermId: idSchema,
  toTermId: idSchema,
});

export const signupsSchema = z.object({
  termId: idSchema,
  feeTypeId: idSchema,
  sectionId: idSchema,
  /** The students of that section who are signed up; everyone else in the section is not. */
  studentIds: z.array(idSchema).max(500),
});
export type SignupsInput = z.input<typeof signupsSchema>;

// ---------------------------------------------------------------------------
// Invoicing and payments (3.1 / 3.2)
// ---------------------------------------------------------------------------

export const billingRunSchema = z.object({
  termId: idSchema,
  classIds: z.array(idSchema).min(1, "validation.chooseClasses").max(200),
  dueDate: dateOnlySchema,
});
export type BillingRunInput = z.input<typeof billingRunSchema>;

export const cancelInvoiceSchema = z.object({
  invoiceId: idSchema,
  reason: textSchema(200),
});
export type CancelInvoiceInput = z.input<typeof cancelInvoiceSchema>;

export const adjustmentSchema = z.object({
  invoiceId: idSchema,
  description: textSchema(120),
  /** Signed: "5000" adds a charge, "-5000" gives a credit. */
  amount: z.string({ required_error: V.required }).trim().min(1, V.required).max(20, V.tooLong),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "POS", "CHEQUE"] as const;

export const paymentSchema = z
  .object({
    invoiceId: idSchema,
    amount: z.string({ required_error: V.required }).trim().min(1, V.required).max(20, V.tooLong),
    method: z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: V.invalidChoice }) }),
    paidAt: dateOnlySchema,
    reference: optionalText(80),
    note: optionalText(300),
  })
  .superRefine((p, ctx) => {
    const minor = toMinor(p.amount);
    if (minor === null || minor === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "validation.amount" });
    // A transfer, POS or cheque payment without its reference can't be traced or matched to the bank statement.
    if (p.method !== "CASH" && !p.reference) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reference"], message: "validation.referenceRequired" });
  });
export type PaymentFormInput = z.input<typeof paymentSchema>;

export const reversalSchema = z.object({
  paymentId: idSchema,
  reason: textSchema(200),
});
export type ReversalInput = z.input<typeof reversalSchema>;
