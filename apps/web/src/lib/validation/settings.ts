import { z } from "zod";
import { dateOnlySchema, idSchema, textSchema, V } from "./common";

/** Number from a form field ("" → required error; "12.5" → 12.5). */
function numberSchema(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v.replace(",", ".")) : v),
    z.number({ required_error: V.required, invalid_type_error: V.outOfRange }).finite(V.outOfRange).min(min, V.outOfRange).max(max, V.outOfRange),
  );
}

export const termSchema = z
  .object({
    academicYearId: idSchema,
    name: textSchema(40),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  })
  .superRefine((v, ctx) => {
    if (!(v.startDate instanceof Date) || !(v.endDate instanceof Date)) return;
    if (v.endDate <= v.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "validation.endBeforeStart" });
    }
  });
export type TermFormInput = z.input<typeof termSchema>;

export const MAX_GRADE_BANDS = 20;
export const gradeBandsSchema = z
  .array(
    z.object({
      minScore: numberSchema(0, 100),
      grade: textSchema(8),
      remark: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), textSchema(60).optional()),
    }),
  )
  .max(MAX_GRADE_BANDS, V.tooLong);
/** Form shape: `{ rows }`, so field errors come back as "rows.2.grade". */
export const gradeBandsFormSchema = z.object({ rows: gradeBandsSchema });
export type GradeBandsInput = z.input<typeof gradeBandsFormSchema>;

export const MAX_SCORE_COMPONENTS = 10;
export const scoreComponentsSchema = z
  .array(
    z.object({
      id: z.preprocess((v) => (v === "" || v === null ? undefined : v), idSchema.optional()),
      name: textSchema(30),
      weight: numberSchema(0.1, 100),
    }),
  )
  .max(MAX_SCORE_COMPONENTS, V.tooLong);
export const scoreComponentsFormSchema = z.object({ rows: scoreComponentsSchema });
export type ScoreComponentsInput = z.input<typeof scoreComponentsFormSchema>;

export const academicOptionsSchema = z.object({
  showPosition: z.boolean(),
  attendanceEditDays: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ required_error: V.required, invalid_type_error: V.integer }).int(V.integer).min(0, V.outOfRange).max(60, V.outOfRange),
  ),
});
export type AcademicOptionsInput = z.input<typeof academicOptionsSchema>;
