import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { sanitizeForAudit } from "../src/audit";

describe("sanitizeForAudit", () => {
  it("never copies password hashes or tokens into the audit trail, at any depth", () => {
    const out = sanitizeForAudit({
      email: "a@b.c",
      passwordHash: "$argon2id$...",
      accounts: [{ provider: "google", access_token: "secret", refresh_token: "secret2" }],
    }) as Record<string, any>;
    expect(out.passwordHash).toBe("[REDACTED]");
    expect(out.accounts[0].access_token).toBe("[REDACTED]");
    expect(out.accounts[0].refresh_token).toBe("[REDACTED]");
    expect(out.email).toBe("a@b.c");
    expect(JSON.stringify(out)).not.toContain("argon2");
  });

  it("serialises Dates, Decimals and BigInts to strings", () => {
    const out = sanitizeForAudit({
      at: new Date("2026-09-28T10:00:00Z"),
      amount: new Prisma.Decimal("150000.50"),
      big: BigInt(42),
    }) as Record<string, unknown>;
    expect(out).toEqual({ at: "2026-09-28T10:00:00.000Z", amount: "150000.5", big: "42" });
  });

  it("maps null/undefined to null and keeps primitives", () => {
    expect(sanitizeForAudit(undefined)).toBeNull();
    expect(sanitizeForAudit({ a: undefined, b: 1, c: "x", d: false })).toEqual({ a: null, b: 1, c: "x", d: false });
  });

  it("stops at a sane depth instead of recursing forever", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i++) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }
    expect(JSON.stringify(sanitizeForAudit(root))).toContain("[TRUNCATED]");
  });
});
