import { z } from "zod";
import { parseStudentLogins } from "./student-logins";

/**
 * Per-school configuration (architecture rule #8: config-first). Stored in
 * `Tenant.settings` (JSONB). Every field has a safe default and a `.catch()`
 * fallback, so a missing or malformed value in one school's JSON can never
 * crash a page — it just falls back to the default.
 */

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(locale: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

export const DEFAULT_TENANT_SETTINGS = {
  locale: "en-NG",
  timezone: "Africa/Lagos",
  currency: "NGN",
  dateStyle: "medium",
  gradingScale: "letter",
  features: {} as Record<string, boolean>,
  invoicePrefix: "INV",
  receiptPrefix: "RCT",
  paymentTermDays: 14,
} as const;

export const tenantSettingsSchema = z.object({
  /** BCP-47 locale used for number/date formatting, e.g. "en-NG", "fr-SN". */
  locale: z.string().refine(isValidLocale).catch(DEFAULT_TENANT_SETTINGS.locale).default(DEFAULT_TENANT_SETTINGS.locale),
  /** IANA time zone — decides what "today" means for attendance, due dates, etc. */
  timezone: z
    .string()
    .refine(isValidTimeZone)
    .catch(DEFAULT_TENANT_SETTINGS.timezone)
    .default(DEFAULT_TENANT_SETTINGS.timezone),
  /** ISO 4217 currency for fees. */
  currency: z
    .string()
    .transform((c) => c.toUpperCase())
    .refine(isValidCurrency)
    .catch(DEFAULT_TENANT_SETTINGS.currency)
    .default(DEFAULT_TENANT_SETTINGS.currency),
  /** How dates are shown across the app. */
  dateStyle: z
    .enum(["short", "medium", "long"])
    .catch(DEFAULT_TENANT_SETTINGS.dateStyle)
    .default(DEFAULT_TENANT_SETTINGS.dateStyle),
  /** Grading scale identifier; the full scale definition arrives with Phase 2 (marks). */
  gradingScale: z.string().catch(DEFAULT_TENANT_SETTINGS.gradingScale).default(DEFAULT_TENANT_SETTINGS.gradingScale),
  /** Per-school feature switches (plan limits land in Phase 4). */
  features: z.record(z.boolean()).catch({}).default({}),
  /** Invoice and receipt number prefixes: INV-2026-00001, RCT-2026-00001. */
  invoicePrefix: z.string().regex(/^[A-Z0-9]{1,8}$/).catch(DEFAULT_TENANT_SETTINGS.invoicePrefix).default(DEFAULT_TENANT_SETTINGS.invoicePrefix),
  receiptPrefix: z.string().regex(/^[A-Z0-9]{1,8}$/).catch(DEFAULT_TENANT_SETTINGS.receiptPrefix).default(DEFAULT_TENANT_SETTINGS.receiptPrefix),
  /** Default days from billing to the due date. */
  paymentTermDays: z.number().int().min(0).max(120).catch(DEFAULT_TENANT_SETTINGS.paymentTermDays).default(DEFAULT_TENANT_SETTINGS.paymentTermDays),
  /** Student logins (Phase 5.0): off unless the school turns them on for chosen classes. */
  studentLogins: z.unknown().transform(parseStudentLogins),
  /** Account security (Phase 6): whether teachers must use two-factor sign-in. Admins and bursars always must. */
  security: z
    .object({ requireTeacher2fa: z.boolean().catch(false).default(false) })
    .catch({ requireTeacher2fa: false })
    .default({ requireTeacher2fa: false }),
  /** Set by the EduCore platform team only (never by a school): e.g. a shared demo school where 2FA isn't required. */
  platformFlags: z
    .object({ twoFactorExempt: z.boolean().catch(false).default(false) })
    .catch({ twoFactorExempt: false })
    .default({ twoFactorExempt: false }),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** Parses a tenant's raw `settings` JSON into fully-defaulted, validated settings. Never throws. */
export function parseTenantSettings(raw: unknown): TenantSettings {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return tenantSettingsSchema.parse(input);
}
