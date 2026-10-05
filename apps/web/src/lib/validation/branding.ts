import { z } from "zod";
import { normaliseHex } from "@/lib/branding";

/** School branding form (logo is uploaded separately). Messages are i18n keys. */
export const brandingSchema = z.object({
  /** "" = EduCore's default colour. */
  primaryColor: z
    .string()
    .trim()
    .max(7, "validation.color")
    .refine((v) => v === "" || normaliseHex(v) !== null, "validation.color"),
  contactLine: z.string().trim().max(200, "validation.tooLong").default(""),
});
export type BrandingInput = z.input<typeof brandingSchema>;
