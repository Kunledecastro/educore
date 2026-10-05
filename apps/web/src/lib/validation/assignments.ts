import { z } from "zod";
import { ALLOWED_TYPES, MAX_FILE_BYTES } from "../storage/file-types";
import { idSchema, textSchema, V } from "./common";

/** Assignments (Phase 5.1). Messages are i18n keys. */

/** "YYYY-MM-DDTHH:mm" from <input type="datetime-local">, in the school's time zone (converted in the action). */
const localDateTime = z.string({ required_error: V.required }).trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, V.invalidDate);

const maxScore = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v),
  z.number({ invalid_type_error: V.integer }).positive(V.outOfRange).max(1000, V.outOfRange).multipleOf(0.5, V.outOfRange).nullable(),
);

const fields = {
  title: textSchema(150),
  instructions: z.string().trim().max(10000, V.tooLong).default(""),
  dueAt: localDateTime,
  maxScore,
  mode: z.enum(["ONLINE", "PAPER"], { errorMap: () => ({ message: V.invalidChoice }) }),
};

export const assignmentEditSchema = z.object(fields);
export type AssignmentEditInput = z.input<typeof assignmentEditSchema>;

export const assignmentCreateSchema = z.object({
  ...fields,
  subjectId: idSchema,
  sectionIds: z.array(idSchema).min(1, "validation.chooseSections").max(30),
  publish: z.boolean().default(false),
});
export type AssignmentCreateInput = z.input<typeof assignmentCreateSchema>;

export const uploadRequestSchema = z.object({
  assignmentId: idSchema,
  fileName: z.string().trim().min(1, V.required).max(200, V.tooLong),
  contentType: z.enum(Object.keys(ALLOWED_TYPES) as [keyof typeof ALLOWED_TYPES, ...(keyof typeof ALLOWED_TYPES)[]], { errorMap: () => ({ message: "validation.fileType" }) }),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES, "validation.fileTooLarge"),
});

export const grantSchema = z.string().min(10).max(2000);
