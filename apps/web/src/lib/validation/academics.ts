import { z } from "zod";
import { dateOnlySchema, idSchema, optionalIntSchema, textSchema } from "./common";

export const ACADEMICS_V = {
  endBeforeStart: "validation.endBeforeStart",
  yearTooLong: "validation.yearTooLong",
  codeFormat: "validation.codeFormat",
} as const;

/** ASSUMPTION: an academic year lasts at most 24 months (catches typos like 2062). */
const MAX_YEAR_DAYS = 731;

export const academicYearSchema = z
  .object({
    name: textSchema(40),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  })
  .superRefine((v, ctx) => {
    // A field that already failed its own validation arrives as a non-Date.
    if (!(v.startDate instanceof Date) || !(v.endDate instanceof Date)) return;
    if (v.endDate <= v.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: ACADEMICS_V.endBeforeStart });
    } else if ((v.endDate.getTime() - v.startDate.getTime()) / 86_400_000 > MAX_YEAR_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: ACADEMICS_V.yearTooLong });
    }
  });
export type AcademicYearInput = z.input<typeof academicYearSchema>;

export const classSchema = z.object({
  academicYearId: idSchema,
  name: textSchema(60),
  order: optionalIntSchema(0, 99).transform((v) => v ?? 0),
});
export type ClassInput = z.input<typeof classSchema>;

export const sectionSchema = z.object({
  classId: idSchema,
  name: textSchema(20),
  capacity: optionalIntSchema(1, 500),
});
export type SectionInput = z.input<typeof sectionSchema>;

export const subjectSchema = z.object({
  name: textSchema(80),
  code: textSchema(12)
    .transform((c) => c.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]*$/, ACADEMICS_V.codeFormat)),
});
export type SubjectInput = z.input<typeof subjectSchema>;

export const assignmentSchema = z.object({
  sectionId: idSchema,
  subjectId: idSchema,
  teacherId: idSchema,
});
export type AssignmentInput = z.input<typeof assignmentSchema>;

/**
 * Why a record can't be deleted yet. Deleting in this schema cascades (a
 * year would take its attendance, marks and invoices with it), so anything
 * that holds real school records must be emptied or moved first. Returns
 * i18n keys under `academics.blockers.*`; empty array = safe to delete.
 */
export function deleteBlockers(counts: Partial<Record<DependencyKind, number>> & { isActiveYear?: boolean }): DependencyKind[] | ["activeYear"] {
  if (counts.isActiveYear) return ["activeYear"];
  return BLOCKING_DEPENDENCIES.filter((k) => (counts[k] ?? 0) > 0);
}

export const BLOCKING_DEPENDENCIES = [
  "classes",
  "students",
  "attendance",
  "assessments",
  "reportCards",
  "timetable",
  "feeStructures",
  "invoices",
] as const;
export type DependencyKind = (typeof BLOCKING_DEPENDENCIES)[number];
