import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@educore/db";
import { saveSchoolSecurity, schoolAccounts, setTwoFactorExempt } from "./school-security";
import { serverKey, decryptSecret } from "./secrets";
import { base32Decode, hotp, stepAt } from "./totp";
import { adminResetTwoFactor, confirmSetup, disableOwn, regenerateBackupCodes, securityState, startSetup, TwoFactorError, verifySecondFactor } from "./two-factor";

/**
 * Two-factor sign-in against a real Postgres (migrations through 0028): who
 * must set it up, set-up and codes (no replay, backup codes once), turning
 * it off, admin resets across schools, sessions ended by changes, the
 * teachers setting, and that the app's database role can't read secrets.
 */

process.env.NEXTAUTH_SECRET ??= "test-secret-for-2fa";

const stamp = Date.now();
const meta = { ipAddress: "127.0.0.1", userAgent: "test" };
let A: string;
let B: string;
const ids: Record<string, string> = {};
const T0 = 1_800_000_000_000; // a fixed clock for codes
const codeAt = (secret: string, ms: number, offsetSteps = 0) => hotp(base32Decode(secret), stepAt(ms) + offsetSteps);

async function user(tenantId: string | null, key: string, role: "PLATFORM_ADMIN" | "SCHOOL_ADMIN" | "ACCOUNTANT" | "TEACHER" | "PARENT" | "STUDENT") {
  ids[key] = (await prisma.user.create({ data: { tenantId, email: `${key}-${stamp}@2fa.test`, name: key, role } })).id;
}

async function enable(key: string, at = T0) {
  const { secret } = await startSetup(ids[key]!, new Date(at));
  const r = await confirmSetup(ids[key]!, codeAt(secret, at), meta, new Date(at));
  return { secret, codes: r.backupCodes };
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: "2FA A", slug: `tfa-a-${stamp}`, subdomain: `tfa-a-${stamp}` } }),
    prisma.tenant.create({ data: { name: "2FA B", slug: `tfa-b-${stamp}`, subdomain: `tfa-b-${stamp}` } }),
  ]);
  A = a.id;
  B = b.id;
  await Promise.all([
    user(null, "platform", "PLATFORM_ADMIN"),
    user(A, "admin", "SCHOOL_ADMIN"),
    user(A, "admin2", "SCHOOL_ADMIN"),
    user(A, "bursar", "ACCOUNTANT"),
    user(A, "teacher", "TEACHER"),
    user(A, "parent", "PARENT"),
    user(A, "pupil", "STUDENT"),
    user(B, "bAdmin", "SCHOOL_ADMIN"),
    user(B, "bTeacher", "TEACHER"),
  ]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: ids.platform } }).catch(() => undefined);
  await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("who has to set it up", () => {
  it("admins, bursars and the platform admin must; teachers when the school says; families may; pupils aren't offered it", async () => {
    const stage = async (k: string) => (await securityState(ids[k]!))!.stage(false);
    expect(await stage("platform")).toBe("setup");
    expect(await stage("admin")).toBe("setup");
    expect(await stage("bursar")).toBe("setup");
    expect(await stage("teacher")).toBe("ok");
    expect(await stage("parent")).toBe("ok");
    await saveSchoolSecurity({ id: ids.admin!, tenantId: A, ipAddress: null, userAgent: null }, true);
    expect(await stage("teacher")).toBe("setup");
    expect(await stage("bTeacher")).toBe("ok"); // another school's setting
    await expect(startSetup(ids.pupil!)).rejects.toEqual(new TwoFactorError("notOffered"));
  });
});

describe("set-up and codes", () => {
  let secret: string;
  let codes: string[];

  it("set-up needs a correct code; the secret is stored encrypted; other sessions end", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: ids.admin! } })).sessionVersion;
    const s = await startSetup(ids.admin!, new Date(T0));
    secret = s.secret;
    expect(s.uri).toContain("otpauth://totp/EduCore");
    await expect(confirmSetup(ids.admin!, "000000", meta, new Date(T0))).rejects.toEqual(new TwoFactorError("badCode"));
    const r = await confirmSetup(ids.admin!, codeAt(secret, T0), meta, new Date(T0));
    codes = r.backupCodes;
    expect(codes).toHaveLength(10);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin! }, include: { security: true } });
    expect(u.twoFactorEnabled).toBe(true);
    expect(u.sessionVersion).toBe(before + 1);
    expect(r.sessionVersion).toBe(before + 1);
    expect(u.security!.totpSecretEnc).not.toContain(secret);
    expect(decryptSecret(u.security!.totpSecretEnc!, serverKey("totp-secret"))).toBe(secret);
    expect(u.security!.backupCodeHashes.join()).not.toContain(codes[0]!.replace(/-/g, ""));
    expect((await securityState(ids.admin!))!.stage(false)).toBe("verify");
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityType: "User", entityId: ids.admin! } })).toBe(1);
  });

  it("a set-up left more than 30 minutes is refused", async () => {
    const s = await startSetup(ids.bursar!, new Date(T0));
    await expect(confirmSetup(ids.bursar!, codeAt(s.secret, T0 + 31 * 60_000), meta, new Date(T0 + 31 * 60_000))).rejects.toEqual(new TwoFactorError("noSetup"));
  });

  it("app codes work once, within one step either side", async () => {
    const t = T0 + 5 * 60_000;
    await expect(verifySecondFactor(ids.admin!, "123456", new Date(t))).rejects.toEqual(new TwoFactorError("badCode"));
    expect(await verifySecondFactor(ids.admin!, codeAt(secret, t), new Date(t))).toEqual({ method: "app", backupLeft: 10 });
    await expect(verifySecondFactor(ids.admin!, codeAt(secret, t), new Date(t))).rejects.toEqual(new TwoFactorError("badCode")); // replay
    await expect(verifySecondFactor(ids.admin!, codeAt(secret, t, -1), new Date(t))).rejects.toEqual(new TwoFactorError("badCode")); // older than the last used
    expect((await verifySecondFactor(ids.admin!, codeAt(secret, t, 1), new Date(t))).method).toBe("app"); // drift
    await expect(verifySecondFactor(ids.admin!, codeAt(secret, t, 3), new Date(t))).rejects.toEqual(new TwoFactorError("badCode"));
  });

  it("backup codes work once each", async () => {
    expect(await verifySecondFactor(ids.admin!, codes[0]!.toUpperCase(), new Date(T0))).toEqual({ method: "backup", backupLeft: 9 });
    await expect(verifySecondFactor(ids.admin!, codes[0]!, new Date(T0))).rejects.toEqual(new TwoFactorError("badCode"));
    expect((await verifySecondFactor(ids.admin!, codes[1]!.replace(/-/g, " "), new Date(T0))).backupLeft).toBe(8);
  });

  it("new backup codes need a current code, and the old ones stop working", async () => {
    const t = T0 + 20 * 60_000;
    await expect(regenerateBackupCodes(ids.admin!, "000000", meta, new Date(t))).rejects.toEqual(new TwoFactorError("badCode"));
    const fresh = await regenerateBackupCodes(ids.admin!, codeAt(secret, t), meta, new Date(t));
    expect(fresh).toHaveLength(10);
    await expect(verifySecondFactor(ids.admin!, codes[5]!, new Date(t))).rejects.toEqual(new TwoFactorError("badCode"));
    expect((await verifySecondFactor(ids.admin!, fresh[0]!, new Date(t))).method).toBe("backup");
  });
});

describe("turning it off and resets", () => {
  it("a required role can't turn it off; a parent can (with a code), which ends their other sessions", async () => {
    await expect(disableOwn(ids.admin!, "000000", meta)).rejects.toEqual(new TwoFactorError("required"));
    const { secret } = await enable("parent");
    const v = (await prisma.user.findUniqueOrThrow({ where: { id: ids.parent! } })).sessionVersion;
    const t = T0 + 60 * 60_000;
    await expect(disableOwn(ids.parent!, "000000", meta, new Date(t))).rejects.toEqual(new TwoFactorError("badCode"));
    await disableOwn(ids.parent!, codeAt(secret, t), meta, new Date(t));
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ids.parent! }, include: { security: true } });
    expect(u).toMatchObject({ twoFactorEnabled: false, sessionVersion: v + 1 });
    expect(u.security).toMatchObject({ totpSecretEnc: null, backupCodeHashes: [] });
  });

  it("school admins reset others in their own school only; never themselves; teachers can't", async () => {
    await enable("teacher");
    await enable("bTeacher");
    await enable("admin2");
    const actor = (k: string, role: string, tenantId: string | null) => ({ id: ids[k]!, role, tenantId });
    await expect(adminResetTwoFactor(actor("admin", "SCHOOL_ADMIN", A), ids.bTeacher!, meta)).rejects.toEqual(new TwoFactorError("notFound"));
    await expect(adminResetTwoFactor(actor("admin", "SCHOOL_ADMIN", A), ids.platform!, meta)).rejects.toEqual(new TwoFactorError("notFound"));
    await expect(adminResetTwoFactor(actor("admin", "SCHOOL_ADMIN", A), ids.admin!, meta)).rejects.toEqual(new TwoFactorError("self"));
    await expect(adminResetTwoFactor(actor("teacher", "TEACHER", A), ids.admin2!, meta)).rejects.toEqual(new TwoFactorError("notAllowed"));
    const v = (await prisma.user.findUniqueOrThrow({ where: { id: ids.teacher! } })).sessionVersion;
    const twoFv = (await securityState(ids.teacher!))!.twoFactorVersion;
    await adminResetTwoFactor(actor("admin", "SCHOOL_ADMIN", A), ids.teacher!, meta);
    const after = await securityState(ids.teacher!);
    expect(after).toMatchObject({ twoFactorEnabled: false, sessionVersion: v + 1, twoFactorVersion: twoFv + 1 }); // signed out; remembered devices forgotten
    expect(after!.stage(false)).toBe("setup"); // the school requires it for teachers
  });

  it("the platform admin can reset any school's admin; it's in both audit logs", async () => {
    await adminResetTwoFactor({ id: ids.platform!, role: "PLATFORM_ADMIN", tenantId: null }, ids.admin2!, meta);
    expect((await securityState(ids.admin2!))!.twoFactorEnabled).toBe(false);
    expect(await prisma.platformAuditLog.count({ where: { action: "TWO_FACTOR_RESET", entityId: ids.admin2! } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId: A, entityId: ids.admin2!, actorId: ids.platform! } })).toBe(1);
  });
});

describe("school view and storage", () => {
  it("lists staff and parents with status (no pupils), counting who still needs it", async () => {
    const r = await schoolAccounts(A);
    expect(r.rows.map((x) => x.role)).not.toContain("STUDENT");
    expect(r.rows.find((x) => x.id === ids.admin)).toMatchObject({ twoFactorEnabled: true, required: true });
    expect(r.missing).toBe(3); // bursar, teacher (after reset), admin2 (after reset)
    expect((await schoolAccounts(A, { filter: "missing" })).rows.map((x) => x.id).sort()).toEqual([ids.admin2, ids.bursar, ids.teacher].sort());
    expect((await schoolAccounts(B)).rows.map((x) => x.id)).not.toContain(ids.admin);
  });

  it("a platform-marked demo school requires nobody to set it up; a school can't undo the flag through its own settings", async () => {
    expect((await securityState(ids.bAdmin!))!.stage(false)).toBe("setup");
    await setTwoFactorExempt({ id: ids.platform!, ipAddress: null, userAgent: null }, B, true);
    expect((await securityState(ids.bAdmin!))!.stage(false)).toBe("ok");
    await saveSchoolSecurity({ id: ids.bAdmin!, tenantId: B, ipAddress: null, userAgent: null }, true); // school changes its own rule
    expect((await securityState(ids.bAdmin!))!.stage(false)).toBe("ok"); // flag kept
    expect((await securityState(ids.bTeacher!))!.twoFactorEnabled).toBe(true); // already on: still used
    expect((await securityState(ids.bTeacher!))!.stage(false)).toBe("verify");
    expect(await prisma.platformAuditLog.count({ where: { action: "TENANT_2FA_EXEMPT", tenantId: B } })).toBe(1);
    await setTwoFactorExempt({ id: ids.platform!, ipAddress: null, userAgent: null }, B, false);
    expect((await securityState(ids.bAdmin!))!.stage(false)).toBe("setup");
  });

  it("the app's database role can't read 2FA secrets or reset tokens at all", async () => {
    await expect(withRls(A, (tx) => tx.userSecurity.findMany())).rejects.toThrow();
    await expect(withRls(A, (tx) => tx.passwordResetToken.findMany())).rejects.toThrow();
  });
});
