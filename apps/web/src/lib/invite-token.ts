import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invite links let a new teacher, staff member or parent set their own
 * password. EduCore has no public sign-up (users are created by the school),
 * so an invite link is effectively a one-time password — it's treated that way:
 *
 * - 32 random bytes (256 bits), URL-safe.
 * - Only the SHA-256 HASH is stored (in `verification_tokens`), so a
 *   database leak doesn't leak working links.
 * - Single use: claimed with an atomic delete when the password is set.
 * - Expires after 7 days; re-inviting replaces any earlier link.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function inviteIdentifier(userId: string): string {
  return `invite:${userId}`;
}

export function userIdFromIdentifier(identifier: string): string | null {
  return identifier.startsWith("invite:") ? identifier.slice("invite:".length) || null : null;
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateInviteToken(now: Date = new Date()): { token: string; tokenHash: string; expires: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token), expires: new Date(now.getTime() + INVITE_TTL_MS) };
}

/** Cheap shape check before touching the database (base64url of 32 bytes = 43 chars). */
export function looksLikeInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type InviteStatus = "active" | "invited" | "expired" | "notInvited" | "deactivated";

/** What the admin sees next to a person: can they sign in yet? */
export function inviteStatus(
  user: { isActive: boolean; hasPassword: boolean },
  latestInviteExpires: Date | null,
  now: Date = new Date(),
): InviteStatus {
  if (!user.isActive) return "deactivated";
  if (user.hasPassword) return "active";
  if (!latestInviteExpires) return "notInvited";
  return latestInviteExpires > now ? "invited" : "expired";
}
