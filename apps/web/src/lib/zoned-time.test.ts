import { describe, expect, it } from "vitest";
import { utcToZonedLocal, zonedLocalToUtc } from "./zoned-time";

describe("school-time due dates", () => {
  it("4pm in Lagos is 3pm UTC", () => {
    expect(zonedLocalToUtc("2026-10-10T16:00", "Africa/Lagos")?.toISOString()).toBe("2026-10-10T15:00:00.000Z");
    expect(utcToZonedLocal(new Date("2026-10-10T15:00:00Z"), "Africa/Lagos")).toBe("2026-10-10T16:00");
  });
  it("handles zones with daylight saving", () => {
    expect(zonedLocalToUtc("2026-07-01T09:30", "Europe/London")?.toISOString()).toBe("2026-07-01T08:30:00.000Z");
    expect(zonedLocalToUtc("2026-12-01T09:30", "Europe/London")?.toISOString()).toBe("2026-12-01T09:30:00.000Z");
    expect(zonedLocalToUtc("2026-07-01T09:30", "UTC")?.toISOString()).toBe("2026-07-01T09:30:00.000Z");
  });
  it("rejects malformed and impossible times", () => {
    for (const bad of ["", "2026-10-10", "2026-02-31T10:00", "2026-10-10T25:00", "10/10/2026 16:00"]) expect(zonedLocalToUtc(bad, "Africa/Lagos")).toBeNull();
  });
});
