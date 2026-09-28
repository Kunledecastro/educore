import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  inviteIdentifier,
  inviteStatus,
  looksLikeInviteToken,
  sameHash,
  userIdFromIdentifier,
} from "./invite-token";

describe("invite tokens", () => {
  it("are 256-bit, URL-safe, unique, and stored only as a hash", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(looksLikeInviteToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashInviteToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expire after 7 days", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(generateInviteToken(now).expires.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const bad of ["", "short", "x".repeat(44), "has space".padEnd(43, "a"), "../../etc/passwd".padEnd(43, "a")]) {
      expect(looksLikeInviteToken(bad), bad).toBe(false);
    }
  });

  it("compares hashes safely", () => {
    const h = hashInviteToken("abc");
    expect(sameHash(h, hashInviteToken("abc"))).toBe(true);
    expect(sameHash(h, hashInviteToken("abd"))).toBe(false);
    expect(sameHash(h, "00")).toBe(false);
  });

  it("round-trips the identifier", () => {
    expect(userIdFromIdentifier(inviteIdentifier("u1"))).toBe("u1");
    expect(userIdFromIdentifier("email-verify:u1")).toBeNull();
    expect(userIdFromIdentifier("invite:")).toBeNull();
  });
});

describe("inviteStatus", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("reports each state", () => {
    expect(inviteStatus({ isActive: false, hasPassword: true }, null, now)).toBe("deactivated");
    expect(inviteStatus({ isActive: true, hasPassword: true }, null, now)).toBe("active");
    expect(inviteStatus({ isActive: true, hasPassword: false }, null, now)).toBe("notInvited");
    expect(inviteStatus({ isActive: true, hasPassword: false }, new Date("2026-10-01"), now)).toBe("invited");
    expect(inviteStatus({ isActive: true, hasPassword: false }, new Date("2026-09-01"), now)).toBe("expired");
  });
});
