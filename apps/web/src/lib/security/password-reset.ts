import { randomBytes } from "node:crypto";
import { hashPassword } from "@educore/auth";
import { platformPrisma, recordAudit, recordPlatformAudit } from "@educore/db";
import { isInternalStudentEmail } from "../student-logins";
import { sha256 } from "./secrets";

/**
 * Forgot password (Phase 6.1). A single-use link, valid 30 minutes; only a
 * hash of its token is stored. Asking never reveals whether an account
 * exists. A reset signs the account out everywhere; 2FA (if on) still
 * applies at the next sign-in. Pupils have no email — their teacher resets
 * them (5.0).
 */

export const RESET_MINUTES = 30;

export interface ResetRequest {
  /** The raw token for the email link — null when there's nothing to send (unknown/inactive account, pupil). */
  token: string | null;
  to: { email: string; name: string } | null;
}

export async function createResetToken(email: string, requestIp: string | null, now: Date = new Date()): Promise<ResetRequest> {
  const db = platformPrisma();
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, name: true, isActive: true, role: true } });
  if (!user || !user.isActive || user.role === "STUDENT" || isInternalStudentEmail(user.email)) return { token: null, to: null };
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    // Only the newest link works.
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000), requestIp } });
  });
  return { token, to: { email: user.email, name: user.name ?? "" } };
}

export class ResetError extends Error {
  constructor(public readonly code: "invalid" | "expired") {
    super(code);
    this.name = "ResetError";
  }
}

/** Is this link still usable? (For showing the form; checked again on submit.) */
export async function checkResetToken(token: string, now: Date = new Date()): Promise<"ok" | "invalid" | "expired"> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return "invalid";
  const row = await platformPrisma().passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, select: { usedAt: true, expiresAt: true } });
  if (!row || row.usedAt) return "invalid";
  return row.expiresAt.getTime() < now.getTime() ? "expired" : "ok";
}

/** Sets the new password, uses up the link, and ends every session. */
export async function resetPassword(token: string, newPassword: string, meta: { ipAddress: string | null; userAgent: string | null }, now: Date = new Date()): Promise<{ email: string }> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw new ResetError("invalid");
  const passwordHash = await hashPassword(newPassword);
  const db = platformPrisma();
  const user = await db.$transaction(async (tx) => {
    // Claim the link atomically: only one request can use it.
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt) throw new ResetError("invalid");
    if (row.expiresAt.getTime() < now.getTime()) throw new ResetError("expired");
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new ResetError("invalid");
    const u = await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
      select: { id: true, email: true, tenantId: true, isActive: true },
    });
    if (!u.isActive) throw new ResetError("invalid");
    await tx.passwordResetToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: now } });
    if (u.tenantId) {
      await recordAudit({ tenantId: u.tenantId, actorId: u.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: "UPDATE", entityType: "User", entityId: u.id, after: { password: "reset by email link" } }, tx);
    } else {
      await recordPlatformAudit({ actorId: u.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { action: "PASSWORD_RESET", entityType: "User", entityId: u.id }, tx);
    }
    return u;
  });
  return { email: user.email };
}
