import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238 / RFC 4226), as used by Google
 * Authenticator, Microsoft Authenticator, Authy, 1Password… SHA-1, 6 digits,
 * 30-second steps — the settings every authenticator app supports.
 * Pure and unit-tested against the RFC test vectors.
 */

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what the QR code / manual key carries). */
export function newTotpSecret(rand: (n: number) => Buffer = randomBytes): string {
  return base32Encode(rand(20));
}

export function hotp(secret: Buffer, counter: bigint | number, digits = DIGITS, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function stepAt(unixMs: number): number {
  return Math.floor(unixMs / 1000 / STEP_SECONDS);
}

/**
 * Checks a 6-digit code against the current step and one either side (clock
 * drift). Returns the step that matched — the caller must refuse any step at
 * or before the last one used, so a code can't be replayed — or null.
 */
export function verifyTotp(secretB32: string, code: string, unixMs: number = Date.now(), window = 1): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(unixMs);
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(hotp(secret, now + d));
    if (timingSafeEqual(expected, Buffer.from(digits))) return now + d;
  }
  return null;
}

/** The otpauth:// link authenticator apps read from the QR code. */
export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
