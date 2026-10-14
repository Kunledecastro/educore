import { z } from "zod";
import { idSchema, textSchema, V } from "./common";

/** A class's results for one term (publish / unpublish). */
export const resultsTargetSchema = z.object({ classId: idSchema, termId: idSchema });

/** Publishing, when the school wants it approved (Phase 8.1): an optional note for the approver. */
export const publishRequestSchema = resultsTargetSchema.extend({
  note: z.string().trim().max(300, V.tooLong).optional(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

/** Unpublishing to change locked marks, when it needs approval (8.1): why, and which subjects will change. */
export const unpublishRequestSchema = resultsTargetSchema.extend({
  reason: textSchema(300),
  subjectIds: z.array(idSchema).min(1, V.required).max(30),
});
export type UnpublishRequest = z.infer<typeof unpublishRequestSchema>;

/** What the results page sends; reason and subjects are only required when approval is on. */
export const unpublishInputSchema = resultsTargetSchema.extend({
  reason: z.string().trim().max(300, V.tooLong).optional(),
  subjectIds: z.array(idSchema).max(30).optional(),
});
