import type { TenantSettings } from "./tenant-settings";

/**
 * All user-facing money, number and date formatting goes through here
 * (architecture rule #5), driven by the school's settings — never by
 * hand-built strings like `₦${n}`.
 */

type FormatSettings = Pick<TenantSettings, "locale" | "currency" | "timezone" | "dateStyle">;

/** Accepts numbers, numeric strings and Prisma `Decimal` (anything with a numeric toString). */
export type Numeric = number | string | { toString(): string } | null | undefined;

function toNumber(value: Numeric): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(value: Numeric, settings: FormatSettings): string {
  return new Intl.NumberFormat(settings.locale, {
    style: "currency",
    currency: settings.currency,
    // School fees are whole amounts in most currencies; show kobo/cents only when present.
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

export function formatNumber(value: Numeric, settings: Pick<TenantSettings, "locale">): string {
  return new Intl.NumberFormat(settings.locale).format(toNumber(value));
}

export function formatDate(
  value: Date | string | number | null | undefined,
  settings: Pick<TenantSettings, "locale" | "timezone" | "dateStyle">,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(settings.locale, {
    dateStyle: settings.dateStyle,
    timeZone: settings.timezone,
  }).format(date);
}

/**
 * Today's calendar date in the school's time zone, as a UTC-midnight Date —
 * the representation used for date-only columns (e.g. Attendance.date).
 * A school in Lagos at 00:30 local time is already on the next day even
 * though UTC is still on the previous one.
 */
export function todayInTimeZone(timezone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA gives YYYY-MM-DD
  return new Date(`${parts}T00:00:00.000Z`);
}

export type { FormatSettings };

export function formatDateTime(
  value: Date | string | number | null | undefined,
  settings: Pick<TenantSettings, "locale" | "timezone" | "dateStyle">,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(settings.locale, {
    dateStyle: settings.dateStyle,
    timeStyle: "short",
    timeZone: settings.timezone,
  }).format(date);
}

/**
 * For date-only values (birthdays, term dates, academic years) stored at UTC
 * midnight: formatted in UTC so the calendar day never shifts, whatever the
 * school's time zone.
 */
export function formatDateOnly(
  value: Date | string | null | undefined,
  settings: Pick<TenantSettings, "locale" | "dateStyle">,
): string {
  return formatDate(value, { ...settings, timezone: "UTC" });
}
