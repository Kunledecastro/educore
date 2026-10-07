import type { TenantSettings } from "../tenant-settings";
import { formatDateTime } from "../format";
import { utcToZonedLocal } from "../zoned-time";

/** Time and date-time formatters for clinic visits, in the school's time zone. */
export function visitFmt(settings: Pick<TenantSettings, "locale" | "timezone" | "dateStyle">) {
  const time = new Intl.DateTimeFormat(settings.locale, { timeStyle: "short", timeZone: settings.timezone });
  return { time: (d: Date) => time.format(d), dateTime: (d: Date) => formatDateTime(d, settings) };
}

/** "Now" as a datetime-local value in the school's time zone (minutes). */
export function nowLocal(timezone: string, now: Date = new Date()): string {
  return utcToZonedLocal(now, timezone).slice(0, 16);
}
