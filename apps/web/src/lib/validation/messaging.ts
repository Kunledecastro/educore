import { z } from "zod";
import { idSchema, textSchema, V } from "./common";

/** Announcements and messages (Phase 4.4). Messages are i18n keys. */

const longText = (max: number) => z.string({ required_error: V.required }).trim().min(1, V.required).max(max, V.tooLong);

export const ANNOUNCEMENT_ROLES = ["TEACHER", "PARENT", "STUDENT", "ACCOUNTANT", "SCHOOL_ADMIN"] as const;

export const announcementSchema = z
  .object({
    title: textSchema(150),
    body: longText(5000),
    audienceScope: z.enum(["SCHOOL", "CLASS", "ROLE"], { errorMap: () => ({ message: V.invalidChoice }) }),
    audienceClassId: z.preprocess((v) => (v === "" ? null : v), idSchema.nullable().default(null)),
    audienceRole: z.preprocess((v) => (v === "" ? null : v), z.enum(ANNOUNCEMENT_ROLES).nullable().default(null)),
    isPinned: z.boolean().default(false),
  })
  .superRefine((a, ctx) => {
    if (a.audienceScope === "CLASS" && !a.audienceClassId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["audienceClassId"], message: V.required });
    if (a.audienceScope === "ROLE" && !a.audienceRole) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["audienceRole"], message: V.required });
  });
export type AnnouncementFormInput = z.input<typeof announcementSchema>;

export const newThreadSchema = z.object({
  studentId: idSchema,
  recipientIds: z.array(idSchema).min(1, "validation.chooseRecipients").max(20),
  subject: textSchema(150),
  body: longText(5000),
});
export type NewThreadInput = z.input<typeof newThreadSchema>;

export const replySchema = z.object({ threadId: idSchema, body: longText(5000) });
export type ReplyInput = z.input<typeof replySchema>;
