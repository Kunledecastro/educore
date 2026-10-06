import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@educore/auth";
import { prisma } from "@educore/db";
import { checkResetToken, createResetToken, ResetError, resetPassword } from "./password-reset";
import { sha256 } from "./secrets";

/**
 * Forgot password against a real Postgres (migration 0028): no answer for
 * unknown or pupil accounts, only a hash stored, single use, 30-minute
 * expiry, only the newest link works, sessions ended, audited.
 */

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
const ids: Record<string, string> = {};
const email = (k: string) => `${k}-${stamp}@reset.test`;

beforeAll(async () => {
  A = (await prisma.tenant.create({ data: { name: "Reset A", slug: `rst-a-${stamp}`, subdomain: `rst-a-${stamp}` } })).id;
  for (const [k, role, active] of [["admin", "SCHOOL_ADMIN", true], ["parent", "PARENT", true], ["gone", "TEACHER", false]] as const) {
    ids[k] = (await prisma.user.create({ data: { tenantId: A, email: email(k), name: k, role, isActive: active } })).id;
  }
  ids.pupil = (await prisma.user.create({ data: { tenantId: A, email: `x${stamp}@students.educore.invalid`, name: "pupil", role: "STUDENT" } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: A } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("asking for a link", () => {
  it("nothing to send for unknown, inactive or pupil accounts (the page answers the same either way)", async () => {
    expect(await createResetToken(`nobody-${stamp}@reset.test`, null)).toEqual({ token: null, to: null });
    expect(await createResetToken(email("gone"), null)).toEqual({ token: null, to: null });
    expect(await createResetToken(`x${stamp}@students.educore.invalid`, null)).toEqual({ token: null, to: null });
  });

  it("stores only a hash of the token; email matching ignores case", async () => {
    const r = await createResetToken(email("parent").toUpperCase(), "1.2.3.4");
    expect(r.to).toEqual({ email: email("parent"), name: "parent" });
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: ids.parent } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(sha256(r.token!));
    expect(rows[0]!.tokenHash).not.toBe(r.token);
    expect(rows[0]!.requestIp).toBe("1.2.3.4");
  });
});

describe("using the link", () => {
  it("single use; signs out everywhere; audited; the password works", async () => {
    const { token } = await createResetToken(email("admin"), null);
    const v = (await prisma.user.findUniqueOrThrow({ where: { id: ids.admin! } })).sessionVersion;
    expect(await checkResetToken(token!)).toBe("ok");
    await resetPassword(token!, "newpassword2026", meta);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin! } });
    expect(await verifyPassword(u.passwordHash!, "newpassword2026")).toBe(true);
    expect(u.sessionVersion).toBe(v + 1);
    await expect(resetPassword(token!, "another2026pw", meta)).rejects.toEqual(new ResetError("invalid"));
    expect(await checkResetToken(token!)).toBe("invalid");
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityId: ids.admin!, entityType: "User" } })).toBe(1);
  });

  it("only the newest link works", async () => {
    const first = await createResetToken(email("parent"), null);
    const second = await createResetToken(email("parent"), null);
    await expect(resetPassword(first.token!, "newpassword2026", meta)).rejects.toEqual(new ResetError("invalid"));
    await resetPassword(second.token!, "newpassword2026", meta);
  });

  it("expires after 30 minutes; nonsense tokens are refused", async () => {
    const t0 = new Date();
    const { token } = await createResetToken(email("admin"), null, t0);
    const later = new Date(t0.getTime() + 31 * 60_000);
    expect(await checkResetToken(token!, later)).toBe("expired");
    await expect(resetPassword(token!, "newpassword2026", meta, later)).rejects.toEqual(new ResetError("expired"));
    await expect(resetPassword("short", "newpassword2026", meta)).rejects.toEqual(new ResetError("invalid"));
    expect(await checkResetToken("x".repeat(43))).toBe("invalid");
  });

  it("two requests racing with the same link: exactly one succeeds", async () => {
    const { token } = await createResetToken(email("parent"), null);
    const results = await Promise.allSettled([resetPassword(token!, "racepassword1", meta), resetPassword(token!, "racepassword2", meta)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
