import { z } from "zod";

/**
 * Validation messages are i18n KEYS under `validation.*` in messages/*.json,
 * not English text, so the same schema validates on the server and shows a
 * translated message in the browser (`t(error.message)` in the form).
 */
export const V = {
  required: "validation.required",
  tooLong: "validation.tooLong",
  invalidDate: "validation.invalidDate",
  invalidChoice: "validation.invalidChoice",
  integer: "validation.integer",
  outOfRange: "validation.outOfRange",
} as const;

/** Database id coming from a form or URL. */
export const idSchema = z.string({ required_error: V.required }).trim().min(1, V.required).max(64, V.invalidChoice);

export function textSchema(max: number) {
  return z
    .string({ required_error: V.required })
    .trim()
    .min(1, V.required)
    .max(max, V.tooLong);
}

/** `YYYY-MM-DD` from an <input type="date"> → Date at UTC midnight (date-only semantics). */
export const dateOnlySchema = z
  .string({ required_error: V.required })
  .trim()
  .min(1, V.required)
  .regex(/^\d{4}-\d{2}-\d{2}$/, V.invalidDate)
  .transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    // Reject impossible dates like 2026-02-31 (JS would roll them over).
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: V.invalidDate });
      return z.NEVER;
    }
    return d;
  });

/** Optional integer from a form field ("" → undefined). */
export function optionalIntSchema(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
    z.number({ invalid_type_error: V.integer }).int(V.integer).min(min, V.outOfRange).max(max, V.outOfRange).optional(),
  );
}

/** Date → `YYYY-MM-DD` for pre-filling <input type="date">. */
export function toDateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
