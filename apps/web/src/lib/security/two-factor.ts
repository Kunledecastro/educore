import { platformPrisma, recordAudit, recordPlatformAudit } from "@educore/db";
import { parseTenantSettings } from "../tenant-settings";
import { authStage, twoFactorOffered, twoFactorRequired, type AuthStage } from "./rules";
import { breakGlass } from "./session-state";
import { decryptSecret, encryptSecret, hashBackupCode, matchBackupCode, newBackupCodes, serverKey } from "./secrets";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp";

/**
 * Two-factor sign-in, server side (Phase 6.0). Secrets live in
 * `user_security`, which only the platform client can read; the TOTP secret
 * is encrypted at rest and backup codes are stored as keyed hashes. Every
 * change bumps `sessionVersion` (signs the account out elsewhere) and
 * `twoFactorVersion` (forgets remembered devices), and is audited.
 */

export class TwoFactorError extends Error {
  constructor(public readonly code: "notOffered" | "alreadyOn" | "notOn" | "noSetup" | "badCode" | "required" | "notFound" | "notAllowed" | "self") {
    super(code);
    this.name = "TwoFactorError";
  }
}

export interface Meta {
  ipAddress: string | null;
  userAgent: string | null;
}

const secretKey = () => serverKey("totp-secret");
const codeKey = () => serverKey("backup-codes");
const ISSUER = "EduCore";

async function audit(userId: string, tenantId: string | null, actorId: string, meta: Meta, action: string, after: Record<string, unknown>) {
  if (tenantId) {
    await recordAudit({ tenantId, actorId, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: "UPDATE", entityType: "User", entityId: userId, after: { twoFactor: action, ...after } });
  } else {
    await recordPlatformAudit({ actorId, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: `TWO_FACTOR_${action.toUpperCase()}`, entityType: "User", entityId: userId, after });
  }
}

/** Everything sign-in and every request need: is 2FA on, is it required, the session version. */
export async function securityState(userId: string) {
  const user = await platformPrisma().user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, tenantId: true, isActive: true, email: true, twoFactorEnabled: true, sessionVersion: true, tenant: { select: { settings: true } }, security: { select: { twoFactorVersion: true } } },
  });
  if (!user) return null;
  const parsed = user.tenant ? parseTenantSettings(user.tenant.settings) : null;
  const school = parsed ? { ...parsed.security, exempt: parsed.platformFlags.twoFactorExempt } : null;
  return {
    ...user,
    twoFactorVersion: user.security?.twoFactorVersion ?? 0,
    required: twoFactorRequired(user.role, school),
    offered: twoFactorOffered(user.role),
    stage: (passed: boolean): AuthStage => (breakGlass() ? "ok" : authStage({ role: user.role, twoFactorEnabled: user.twoFactorEnabled, sessionPassed2fa: passed, school })),
  };
}

/** Step 1 of set-up: a new secret (kept pending until confirmed), its QR link and manual key. */
export async function startSetup(userId: string, now: Date = new Date()) {
  const s = await securityState(userId);
  if (!s) throw new TwoFactorError("notFound");
  if (!s.offered) throw new TwoFactorError("notOffered");
  if (s.twoFactorEnabled) throw new TwoFactorError("alreadyOn");
  const secret = newTotpSecret();
  await platformPrisma().userSecurity.upsert({
    where: { userId },
    create: { userId, pendingSecretEnc: encryptSecret(secret, secretKey()), pendingCreatedAt: now },
    update: { pendingSecretEnc: encryptSecret(secret, secretKey()), pendingCreatedAt: now },
  });
  return { secret, uri: otpauthUri(secret, s.email, ISSUER) };
}

/**
 * Step 2: the first code from the app proves it's set up. Turns 2FA on,
 * returns 10 backup codes (shown once) and the new session version (the
 * caller's session is upgraded; every other session ends).
 */
export async function confirmSetup(userId: string, code: string, meta: Meta, now: Date = new Date()): Promise<{ backupCodes: string[]; sessionVersion: number }> {
  const s = await securityState(userId);
  if (!s) throw new TwoFactorError("notFound");
  if (s.twoFactorEnabled) throw new TwoFactorError("alreadyOn");
  const db = platformPrisma();
  const sec = await db.userSecurity.findUnique({ where: { userId } });
  if (!sec?.pendingSecretEnc || !sec.pendingCreatedAt || now.getTime() - sec.pendingCreatedAt.getTime() > 30 * 60_000) throw new TwoFactorError("noSetup");
  const secret = decryptSecret(sec.pendingSecretEnc, secretKey());
  const step = verifyTotp(secret, code, now.getTime());
  if (step === null) throw new TwoFactorError("badCode");
  const codes = newBackupCodes();
  const key = codeKey();
  const updated = await db.$transaction(async (tx) => {
    await tx.userSecurity.update({
      where: { userId },
      data: { totpSecretEnc: sec.pendingSecretEnc, pendingSecretEnc: null, pendingCreatedAt: null, lastUsedStep: BigInt(step), enabledAt: now, backupCodeHashes: codes.map((c) => hashBackupCode(c, key)), twoFactorVersion: { increment: 1 } },
    });
    return tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: true, sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  });
  await audit(userId, s.tenantId, userId, meta, "enabled", {});
  return { backupCodes: codes, sessionVersion: updated.sessionVersion };
}

/**
 * Checks a sign-in code: a 6-digit app code (each one usable once) or a
 * backup code (crossed off when used). Returns how it was verified and how
 * many backup codes remain.
 */
export async function verifySecondFactor(userId: string, input: string, now: Date = new Date()): Promise<{ method: "app" | "backup"; backupLeft: number }> {
  const db = platformPrisma();
  const sec = await db.userSecurity.findUnique({ where: { userId } });
  if (!sec?.totpSecretEnc) throw new TwoFactorError("notOn");
  const trimmed = input.trim();
  if (/^[\d\s]{6,8}$/.test(trimmed)) {
    const step = verifyTotp(decryptSecret(sec.totpSecretEnc, secretKey()), trimmed, now.getTime());
    if (step === null) throw new TwoFactorError("badCode");
    // Atomic: only succeeds if this step is newer than the last one used.
    const r = await db.userSecurity.updateMany({ where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] }, data: { lastUsedStep: BigInt(step) } });
    if (r.count !== 1) throw new TwoFactorError("badCode");
    return { method: "app", backupLeft: sec.backupCodeHashes.length };
  }
  const i = matchBackupCode(trimmed, sec.backupCodeHashes, codeKey());
  if (i < 0) throw new TwoFactorError("badCode");
  const remaining = sec.backupCodeHashes.filter((_, j) => j !== i);
  // Atomic: the stored list must still be the one we checked (no double use).
  const r = await db.userSecurity.updateMany({ where: { userId, backupCodeHashes: { equals: sec.backupCodeHashes } }, data: { backupCodeHashes: remaining } });
  if (r.count !== 1) throw new TwoFactorError("badCode");
  return { method: "backup", backupLeft: remaining.length };
}

/** New backup codes (the old ones stop working). Needs a current code. */
export async function regenerateBackupCodes(userId: string, code: string, meta: Meta, now: Date = new Date()): Promise<string[]> {
  const s = await securityState(userId);
  if (!s?.twoFactorEnabled) throw new TwoFactorError("notOn");
  await verifySecondFactor(userId, code, now);
  const codes = newBackupCodes();
  await platformPrisma().userSecurity.update({ where: { userId }, data: { backupCodeHashes: codes.map((c) => hashBackupCode(c, codeKey())) } });
  await audit(userId, s.tenantId, userId, meta, "backupCodesRenewed", {});
  return codes;
}

async function clear(userId: string) {
  const db = platformPrisma();
  return db.$transaction(async (tx) => {
    await tx.userSecurity.upsert({
      where: { userId },
      create: { userId, twoFactorVersion: 1 },
      update: { totpSecretEnc: null, pendingSecretEnc: null, pendingCreatedAt: null, backupCodeHashes: [], lastUsedStep: null, enabledAt: null, twoFactorVersion: { increment: 1 } },
    });
    return tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  });
}

/** Turn it off yourself — only where your role doesn't require it, and with a current code. */
export async function disableOwn(userId: string, code: string, meta: Meta, now: Date = new Date()) {
  const s = await securityState(userId);
  if (!s?.twoFactorEnabled) throw new TwoFactorError("notOn");
  if (s.required) throw new TwoFactorError("required");
  await verifySecondFactor(userId, code, now);
  const r = await clear(userId);
  await audit(userId, s.tenantId, userId, meta, "disabled", {});
  return r;
}

/**
 * Lost phone: an admin clears someone's 2FA so they set it up again at their
 * next sign-in. School admins: anyone in their own school but themselves.
 * Platform admin: anyone. The person is signed out everywhere.
 */
export async function adminResetTwoFactor(actor: { id: string; role: string; tenantId: string | null }, targetUserId: string, meta: Meta) {
  if (actor.id === targetUserId) throw new TwoFactorError("self");
  const target = await platformPrisma().user.findUnique({ where: { id: targetUserId }, select: { id: true, tenantId: true, role: true, twoFactorEnabled: true } });
  if (!target) throw new TwoFactorError("notFound");
  if (actor.role === "SCHOOL_ADMIN") {
    if (!actor.tenantId || target.tenantId !== actor.tenantId || target.role === "PLATFORM_ADMIN") throw new TwoFactorError("notFound");
  } else if (actor.role !== "PLATFORM_ADMIN") {
    throw new TwoFactorError("notAllowed");
  }
  await clear(target.id);
  if (target.tenantId) {
    await recordAudit({ tenantId: target.tenantId, actorId: actor.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: "UPDATE", entityType: "User", entityId: target.id, before: { twoFactorEnabled: target.twoFactorEnabled }, after: { twoFactor: "reset by admin" } });
  }
  if (actor.role === "PLATFORM_ADMIN") {
    await recordPlatformAudit({ actorId: actor.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: "TWO_FACTOR_RESET", tenantId: target.tenantId, entityType: "User", entityId: target.id });
  }
}

/** Sign someone out everywhere (also used by password resets in 6.1). */
export async function bumpSessionVersion(userId: string) {
  return platformPrisma().user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
}

/** For Account → Security: status only (never the secret or codes). */
export async function securityOverview(userId: string) {
  const s = await securityState(userId);
  if (!s) return null;
  const sec = await platformPrisma().userSecurity.findUnique({ where: { userId }, select: { enabledAt: true, backupCodeHashes: true } });
  return { enabled: s.twoFactorEnabled, required: s.required, offered: s.offered, role: s.role, enabledAt: sec?.enabledAt ?? null, backupLeft: sec?.backupCodeHashes.length ?? 0 };
}
