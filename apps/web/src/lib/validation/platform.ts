import { z } from "zod";
import { idSchema, textSchema } from "./common";

/** Platform console (Phase 4.0). */
export const suspendSchema = z.object({ tenantId: idSchema, reason: textSchema(300) });
export type SuspendInput = z.input<typeof suspendSchema>;

export const impersonateSchema = z.object({
  userId: idSchema,
  /** Why support needs to act as this person — goes in both audit logs. */
  reason: z.string({ required_error: "validation.required" }).trim().min(3, "validation.required").max(300, "validation.tooLong"),
});
export type ImpersonateInput = z.input<typeof impersonateSchema>;
