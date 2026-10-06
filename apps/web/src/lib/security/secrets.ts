import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-side secrets for account security (Phase 6). Pure functions with an
 * explicit key, so they're unit-testable; `serverKey()` derives keys from
 * env. Nothing here is ever sent to the browser except signed cookies.
 */

/** Derives a purpose-specific 32-byte key from TWO_FACTOR_KEY (or NEXTAUTH_SECRET). */
export function serverKey(purpose: string, env: Record<string, string | undefined> = process.env): Buffer {
  const root = env.TWO_FACTOR_KEY || env.NEXTAUTH_SECRET;
  if (!root) throw new Error("TWO_FACTOR_KEY / NEXTAUTH_SECRET is not set");
  return createHash("sha256").update(`educore:${purpose}:${root}`).digest();
}

/** AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(box: string, key: Buffer): string {
  const [v, iv, tag, ct] = box.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Bad secret box");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Backup codes: 10 one-time codes like "k7m2-9qxp-4tdz" (~60 bits each).
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o, 1/l/i

export const BACKUP_CODE_COUNT = 10;

export function newBackupCodes(rand: (n: number) => Buffer = randomBytes, count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = rand(12);
    const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export function normalizeBackupCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function looksLikeBackupCode(input: string): boolean {
  return normalizeBackupCode(input).length === 12;
}

/** Keyed hash, so a database leak alone doesn't let anyone test codes offline. */
export function hashBackupCode(code: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalizeBackupCode(code)).digest("base64url");
}

/** The index of the matching unused code, or -1. */
export function matchBackupCode(input: string, hashes: readonly string[], key: Buffer): number {
  const h = Buffer.from(hashBackupCode(input, key));
  return hashes.findIndex((x) => {
    const b = Buffer.from(x);
    return b.length === h.length && timingSafeEqual(b, h);
  });
}

// ---------------------------------------------------------------------------
// Signed tokens: "remember this device" cookies and session upgrade proofs.
// ---------------------------------------------------------------------------

export function signToken(payload: Record<string, unknown>, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function readToken<T extends Record<string, unknown>>(token: string | undefined | null, key: Buffer): T | null {
  if (!token || token.length > 2000) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export interface RememberDevice {
  u: string; // user id
  v: number; // 2FA version at the time
  e: number; // expiry (ms)
  [k: string]: unknown;
}

export const REMEMBER_DAYS = 30;

export function rememberValid(t: RememberDevice | null, userId: string, twoFactorVersion: number, now: number): boolean {
  return Boolean(t && t.u === userId && t.v === twoFactorVersion && typeof t.e === "number" && t.e > now);
}

/** SHA-256 of a reset token (only the hash is stored). */
export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}
