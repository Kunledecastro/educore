import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatNumber, todayInTimeZone } from "./format";
import { DEFAULT_TENANT_SETTINGS, parseTenantSettings } from "./tenant-settings";

const ng = parseTenantSettings({ locale: "en-NG", currency: "NGN", timezone: "Africa/Lagos" });

describe("parseTenantSettings", () => {
  it("fills every default for empty or non-object input", () => {
    for (const raw of [undefined, null, {}, [], "junk", 42]) {
      const s = parseTenantSettings(raw);
      expect(s.locale).toBe(DEFAULT_TENANT_SETTINGS.locale);
      expect(s.timezone).toBe(DEFAULT_TENANT_SETTINGS.timezone);
      expect(s.currency).toBe(DEFAULT_TENANT_SETTINGS.currency);
      expect(s.dateStyle).toBe("medium");
      expect(s.features).toEqual({});
    }
  });

  it("keeps valid values", () => {
    const s = parseTenantSettings({ locale: "fr-SN", timezone: "Africa/Dakar", currency: "xof", dateStyle: "long" });
    expect(s).toMatchObject({ locale: "fr-SN", timezone: "Africa/Dakar", currency: "XOF", dateStyle: "long" });
  });

  it("falls back per field on invalid values instead of throwing", () => {
    const s = parseTenantSettings({ timezone: "Mars/Olympus", currency: "NOPE", dateStyle: "huge", locale: "en-NG" });
    expect(s.timezone).toBe(DEFAULT_TENANT_SETTINGS.timezone);
    expect(s.currency).toBe(DEFAULT_TENANT_SETTINGS.currency);
    expect(s.dateStyle).toBe("medium");
    expect(s.locale).toBe("en-NG");
  });

  it("reads the seeded Greenfield settings (legacy shape) correctly", () => {
    const s = parseTenantSettings({ gradingScale: "letter", locale: "en-NG", timezone: "Africa/Lagos" });
    expect(s).toMatchObject({ locale: "en-NG", timezone: "Africa/Lagos", currency: "NGN", gradingScale: "letter" });
  });
});

describe("formatMoney", () => {
  it("adds thousands separators and the school's currency", () => {
    expect(formatMoney(150000, ng)).toBe("₦150,000");
  });
  it("accepts Decimal-like values and numeric strings", () => {
    expect(formatMoney({ toString: () => "150000.50" }, ng)).toBe("₦150,000.5");
    expect(formatMoney("2500", ng)).toBe("₦2,500");
  });
  it("treats null/undefined/garbage as zero", () => {
    expect(formatMoney(null, ng)).toBe("₦0");
    expect(formatMoney("abc", ng)).toBe("₦0");
  });
  it("follows the school's currency and locale", () => {
    const ke = parseTenantSettings({ locale: "en-KE", currency: "KES" });
    expect(formatMoney(1200, ke)).toMatch(/1,200/);
    expect(formatMoney(1200, ke)).toMatch(/Ksh|KES/);
  });
});

describe("formatNumber / formatDate", () => {
  it("formats numbers by locale", () => {
    expect(formatNumber(1234567, ng)).toBe("1,234,567");
  });
  it("formats dates in the school's time zone", () => {
    // 23:30 UTC on 1 Sep is already 2 Sep in Lagos (UTC+1).
    expect(formatDate(new Date("2026-09-01T23:30:00Z"), ng)).toMatch(/2 Sept?/);
  });
  it("returns empty string for missing or invalid dates", () => {
    expect(formatDate(null, ng)).toBe("");
    expect(formatDate("not a date", ng)).toBe("");
  });
});

describe("todayInTimeZone", () => {
  it("uses the school's calendar day, not UTC's", () => {
    const now = new Date("2026-09-01T23:30:00Z");
    expect(todayInTimeZone("Africa/Lagos", now).toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(todayInTimeZone("UTC", now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
