import { DEFAULT_TENANT_SETTINGS } from "@/lib/tenant-settings";

/** Platform console display helpers (Phase 4.0). */
export const STATUS_VARIANT = { ACTIVE: "success", SUSPENDED: "destructive", CANCELLED: "outline" } as const;

/** The console isn't any one school's: format with the platform defaults (en-NG, Lagos time). */
export const PLATFORM_FORMAT = {
  locale: DEFAULT_TENANT_SETTINGS.locale,
  timezone: DEFAULT_TENANT_SETTINGS.timezone,
  dateStyle: DEFAULT_TENANT_SETTINGS.dateStyle,
  currency: DEFAULT_TENANT_SETTINGS.currency,
} as const;
