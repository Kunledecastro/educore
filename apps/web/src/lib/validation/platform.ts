import { z } from "zod";
import { MODULES } from "@/lib/entitlements";
import { toMinor } from "@/lib/fees";
import { dateOnlySchema, idSchema, textSchema } from "./common";

/** Platform console (Phase 4.0). */
export const suspendSchema = z.object({ tenantId: idSchema, reason: textSchema(300) });
export type SuspendInput = z.input<typeof suspendSchema>;

export const impersonateSchema = z.object({
  userId: idSchema,
  /** Why support needs to act as this person — goes in both audit logs. */
  reason: z.string({ required_error: "validation.required" }).trim().min(3, "validation.required").max(300, "validation.tooLong"),
});
export type ImpersonateInput = z.input<typeof impersonateSchema>;

// ---------------------------------------------------------------------------
// Plans (4.1)
// ---------------------------------------------------------------------------

export const PLAN_CODES = ["FREE_TRIAL", "STARTER", "STANDARD", "PREMIUM"] as const;

/** Platform team sets a school's plan by hand (complimentary, invoiced offline, trial extension). */
export const tenantPlanSchema = z.object({
  tenantId: idSchema,
  plan: z.enum(PLAN_CODES, { errorMap: () => ({ message: "validation.invalidChoice" }) }),
  /** Trial end, or paid-until. "" = no end date (or, for a trial, the usual 30 days from sign-up). */
  until: z.preprocess((v) => (v === "" || v === null ? undefined : v), dateOnlySchema.optional()),
  note: textSchema(300),
});
export type TenantPlanInput = z.input<typeof tenantPlanSchema>;

const wholeNumber = (v: string) => /^\d{1,9}$/.test(v.trim());

export const planEditSchema = z
  .object({
    code: z.enum(PLAN_CODES, { errorMap: () => ({ message: "validation.invalidChoice" }) }),
    name: textSchema(40),
    /** Naira per student per month, e.g. "500" or "450.50". */
    price: z.string({ required_error: "validation.required" }).trim().min(1, "validation.required").max(12, "validation.tooLong"),
    /** "" = unlimited. */
    maxStudents: z.string().trim().max(9, "validation.tooLong").default(""),
    modules: z.array(z.enum(MODULES)).max(MODULES.length),
    isPublic: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    const minor = toMinor(p.price);
    if (minor === null || minor < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: "validation.amount" });
    if (p.maxStudents !== "" && (!wholeNumber(p.maxStudents) || Number(p.maxStudents) < 1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxStudents"], message: "validation.integer" });
    }
  });
export type PlanEditInput = z.input<typeof planEditSchema>;
