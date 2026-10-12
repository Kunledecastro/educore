import { describe, expect, it } from "vitest";
import { claimsAtSignIn, idlePhase, IDLE_GRACE_MS, sessionExpired, sessionLimits, touched } from "./session-limits";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("session limits", () => {
  it("staff use the school's idle setting; money and admin roles are capped at a working day", () => {
    expect(sessionLimits("TEACHER", 60)).toEqual({ idleMinutes: 60, maxAgeMs: 30 * 24 * HOUR });
    expect(sessionLimits("SCHOOL_ADMIN", 15).idleMinutes).toBe(15);
    expect(sessionLimits("SCHOOL_ADMIN").maxAgeMs).toBe(12 * HOUR);
    expect(sessionLimits("ACCOUNTANT").maxAgeMs).toBe(12 * HOUR);
    expect(sessionLimits("SCHOOL_NURSE", 120).idleMinutes).toBe(120);
  });

  it("an unexpected setting falls back to 30 minutes", () => {
    expect(sessionLimits("TEACHER", 7).idleMinutes).toBe(30);
    expect(sessionLimits("TEACHER", Number.NaN).idleMinutes).toBe(30);
  });

  it("platform team, parents and pupils have fixed limits the school can't loosen", () => {
    expect(sessionLimits("PLATFORM_ADMIN", 120)).toEqual({ idleMinutes: 15, maxAgeMs: 12 * HOUR });
    expect(sessionLimits("PARENT", 15).idleMinutes).toBe(60);
    expect(sessionLimits("STUDENT", 120).idleMinutes).toBe(30);
  });

  it("expires after the idle limit (with a small grace) or the absolute limit, whichever comes first", () => {
    const t0 = Date.UTC(2026, 9, 12, 8);
    const c = claimsAtSignIn({ idleMinutes: 30, maxAgeMs: 12 * HOUR }, t0);
    expect(sessionExpired(c, t0 + 30 * MIN)).toBeNull();
    expect(sessionExpired(c, t0 + 30 * MIN + IDLE_GRACE_MS)).toBeNull();
    expect(sessionExpired(c, t0 + 30 * MIN + IDLE_GRACE_MS + 1)).toBe("idle");
    // Active all day: still out after 12 hours.
    let s = c;
    for (let t = t0; t <= t0 + 12 * HOUR; t += 10 * MIN) s = touched(s, t);
    expect(sessionExpired(s, t0 + 12 * HOUR + 1)).toBe("maxAge");
  });

  it("activity can't revive a session that has already run out", () => {
    const t0 = 1_000_000;
    const c = claimsAtSignIn({ idleMinutes: 15, maxAgeMs: 12 * HOUR }, t0);
    const late = t0 + 20 * MIN;
    expect(touched(c, late)).toBe(c);
    expect(sessionExpired(touched(c, late), late)).toBe("idle");
  });

  it("sessions from before this change have no claims and are left alone", () => {
    expect(sessionExpired({}, Date.now())).toBeNull();
  });

  it("the browser warns in the last minute, then signs out", () => {
    const last = 0;
    expect(idlePhase(last, 30, 28 * MIN).phase).toBe("active");
    expect(idlePhase(last, 30, 29 * MIN + 1).phase).toBe("warning");
    expect(idlePhase(last, 30, 30 * MIN)).toEqual({ phase: "expired", msLeft: 0 });
  });
});
