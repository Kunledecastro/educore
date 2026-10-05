import { z } from "zod";
import { slugProblem } from "@/lib/slugs";
import { textSchema, V } from "./common";
import { emailSchema, PEOPLE_V } from "./people";

/** Self-serve school sign-up (Phase 4.3). Messages are i18n keys. */
export const signupSchema = z
  .object({
    schoolName: textSchema(100),
    slug: z
      .string({ required_error: V.required })
      .trim()
      .toLowerCase()
      .min(1, V.required)
      .superRefine((s, ctx) => {
        const problem = slugProblem(s);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem === "reserved" ? "validation.slugReserved" : "validation.slugFormat" });
      }),
    adminName: textSchema(80),
    email: emailSchema,
    password: z
      .string({ required_error: V.required })
      .min(10, PEOPLE_V.passwordWeak)
      .max(128, V.tooLong)
      .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), PEOPLE_V.passwordWeak),
    confirm: z.string({ required_error: V.required }).min(1, V.required),
    /** Must be ticked: agreement to EduCore's terms and privacy notice. */
    accept: z.literal(true, { errorMap: () => ({ message: "validation.acceptTerms" }) }),
    /** Honeypot: hidden from people, filled in by bots. */
    website: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirm"], message: PEOPLE_V.passwordMismatch });
  });
export type SignupInput = z.input<typeof signupSchema>;
