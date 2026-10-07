import { z } from "zod";
import { dateOnlySchema, idSchema, textSchema, V } from "./common";

export const PEOPLE_V = {
  email: "validation.email",
  admissionNo: "validation.admissionNo",
  employeeId: "validation.employeeId",
  phone: "validation.phone",
  dobFuture: "validation.dobFuture",
  passwordWeak: "validation.passwordWeak",
  passwordMismatch: "validation.passwordMismatch",
} as const;

export const STUDENT_STATUSES = ["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"] as const;
export const GENDERS = ["FEMALE", "MALE", "OTHER"] as const;
export const RELATIONSHIPS = ["MOTHER", "FATHER", "GUARDIAN", "OTHER"] as const;
/** Staff who log in to the school portal but don't teach. */
export const STAFF_ROLES = ["SCHOOL_ADMIN", "ACCOUNTANT", "SCHOOL_NURSE"] as const;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const emailSchema = z
  .string({ required_error: V.required })
  .trim()
  .min(1, V.required)
  .max(254, V.tooLong)
  .email(PEOPLE_V.email)
  .transform((e) => e.toLowerCase());

function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max, V.tooLong).optional());
}

/** Loose international phone check: optional +, 7–15 digits, common separators. */
const phoneSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(20, V.tooLong)
    .regex(/^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/, PEOPLE_V.phone)
    .refine((p) => {
      const digits = p.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15;
    }, PEOPLE_V.phone)
    .optional(),
);

const optionalDateOnly = z.preprocess(emptyToUndefined, dateOnlySchema.optional());

/** School reference numbers: letters, digits, / - _ . (e.g. GA-2026-0001, 24/0153). */
const refNumber = (message: string) =>
  textSchema(30).pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, message));

// ------------------------------------------------------------------ students

export const studentSchema = z
  .object({
    admissionNo: refNumber(PEOPLE_V.admissionNo).transform((s) => s.toUpperCase()),
    firstName: textSchema(60),
    lastName: textSchema(60),
    dateOfBirth: optionalDateOnly,
    gender: z.preprocess(emptyToUndefined, z.enum(GENDERS, { errorMap: () => ({ message: V.invalidChoice }) }).optional()),
    classId: idSchema,
    sectionId: z.preprocess(emptyToUndefined, idSchema.optional()),
    admissionDate: optionalDateOnly,
  })
  .superRefine((v, ctx) => {
    if (v.dateOfBirth instanceof Date && v.dateOfBirth > new Date()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOfBirth"], message: PEOPLE_V.dobFuture });
    }
  });
export type StudentInput = z.input<typeof studentSchema>;

export const studentStatusSchema = z.enum(STUDENT_STATUSES, { errorMap: () => ({ message: V.invalidChoice }) });

// ------------------------------------------------------- teachers and staff

const personBase = {
  name: textSchema(100),
  email: emailSchema,
  employeeId: refNumber(PEOPLE_V.employeeId).transform((s) => s.toUpperCase()),
  department: optionalText(80),
};

export const teacherSchema = z.object({
  ...personBase,
  qualification: optionalText(120),
  joiningDate: optionalDateOnly,
});
export type TeacherInput = z.input<typeof teacherSchema>;

export const staffSchema = z.object({
  ...personBase,
  role: z.enum(STAFF_ROLES, { errorMap: () => ({ message: V.invalidChoice }) }),
  designation: optionalText(80),
  joiningDate: optionalDateOnly,
});
export type StaffInput = z.input<typeof staffSchema>;

// ------------------------------------------------------------------ guardians

export const guardianSchema = z.object({
  name: textSchema(100),
  email: emailSchema,
  phone: phoneSchema,
  occupation: optionalText(80),
});
export type GuardianInput = z.input<typeof guardianSchema>;

const linkFields = {
  relationship: z.enum(RELATIONSHIPS, { errorMap: () => ({ message: V.invalidChoice }) }),
  isPrimary: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
};

/** Add a brand-new parent/guardian and link them to a student in one step. */
export const newGuardianLinkSchema = guardianSchema.extend({ studentId: idSchema, ...linkFields });
export type NewGuardianLinkInput = z.input<typeof newGuardianLinkSchema>;

/** Link a parent who already has an account (e.g. a sibling's parent) to another student. */
export const existingGuardianLinkSchema = z.object({ studentId: idSchema, email: emailSchema, ...linkFields });
export type ExistingGuardianLinkInput = z.input<typeof existingGuardianLinkSchema>;

// ---------------------------------------------------------------- passwords

/**
 * Password policy (NIST 800-63B style): length over complexity rules, with
 * a floor of one letter and one digit so "aaaaaaaaaa" isn't accepted.
 */
export const newPasswordSchema = z
  .object({
    password: z
      .string({ required_error: V.required })
      .min(10, PEOPLE_V.passwordWeak)
      .max(128, V.tooLong)
      .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), PEOPLE_V.passwordWeak),
    confirm: z.string({ required_error: V.required }).min(1, V.required),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirm"], message: PEOPLE_V.passwordMismatch });
    }
  });
export type NewPasswordInput = z.input<typeof newPasswordSchema>;
