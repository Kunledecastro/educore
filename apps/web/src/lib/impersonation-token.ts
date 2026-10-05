import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The impersonation cookie (Phase 4.0): `<sessionId>.<expiresEpochSeconds>.<hmac>`.
 * HMAC-SHA256 with a key derived from NEXTAUTH_SECRET, so it can't be forged
 * or extended. The cookie only POINTS at an impersonation_sessions row; the
 * row (not ended, not expired, same platform admin) is what grants access.
 * Pure — unit-tested.
 */

export const IMPERSONATION_COOKIE = "educore_impersonation";
export const IMPERSONATION_MINUTES = 30;

function mac(secret: string, payload: string): Buffer {
  return createHmac("sha256", `${secret}:impersonation:v1`).update(payload).digest();
}

export function signImpersonationToken(sessionId: string, expiresAt: Date, secret: string): string {
  if (!/^[a-z0-9]{10,40}$/i.test(sessionId)) throw new Error("bad session id");
  const payload = `${sessionId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

/** The session id if the token is genuine and not expired at `now`; otherwise null. */
export function verifyImpersonationToken(token: string | undefined | null, secret: string, now: Date = new Date()): string | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, exp, sig] = parts as [string, string, string];
  if (!/^[a-z0-9]{10,40}$/i.test(sessionId) || !/^\d{9,11}$/.test(exp)) return null;
  const expected = mac(secret, `${sessionId}.${exp}`);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(exp) * 1000 <= now.getTime()) return null;
  return sessionId;
}
