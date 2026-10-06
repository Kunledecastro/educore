import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashBackupCode, matchBackupCode, newBackupCodes, readToken, rememberValid, serverKey, signToken } from "./secrets";
import { base32Decode, base32Encode, hotp, otpauthUri, stepAt, verifyTotp } from "./totp";

describe("TOTP (RFC 6238 test vectors, SHA-1)", () => {
  const secret = Buffer.from("12345678901234567890");
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("at %i s → %s", (t, code) => {
    expect(hotp(secret, Math.floor(t / 30), 8)).toBe(code);
  });

  it("RFC 4226 HOTP vectors", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(secret, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it("base32 round-trips", () => {
    const b = base32Encode(secret);
    expect(b).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(b).equals(secret)).toBe(true);
    expect(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq").equals(secret)).toBe(true);
  });

  it("accepts the current step and one either side, returning the step; refuses others", () => {
    const b32 = base32Encode(secret);
    const t = 1_700_000_000_000;
    const now = stepAt(t);
    const code = (step: number) => hotp(secret, step);
    expect(verifyTotp(b32, code(now), t)).toBe(now);
    expect(verifyTotp(b32, code(now - 1), t)).toBe(now - 1);
    expect(verifyTotp(b32, code(now + 1), t)).toBe(now + 1);
    expect(verifyTotp(b32, code(now - 2), t)).toBeNull();
    expect(verifyTotp(b32, "12345", t)).toBeNull();
    expect(verifyTotp(b32, "abcdef", t)).toBeNull();
    expect(verifyTotp(b32, ` ${code(now).slice(0, 3)} ${code(now).slice(3)} `, t)).toBe(now);
  });

  it("builds the otpauth link apps scan", () => {
    expect(otpauthUri("ABC", "ada@school.ng", "EduCore")).toBe("otpauth://totp/EduCore%3Aada%40school.ng?secret=ABC&issuer=EduCore&algorithm=SHA1&digits=6&period=30");
  });
});

describe("secrets", () => {
  const key = serverKey("test", { NEXTAUTH_SECRET: "x" });
  it("derives different keys per purpose, preferring TWO_FACTOR_KEY", () => {
    expect(serverKey("a", { NEXTAUTH_SECRET: "x" }).equals(serverKey("b", { NEXTAUTH_SECRET: "x" }))).toBe(false);
    expect(serverKey("a", { NEXTAUTH_SECRET: "x", TWO_FACTOR_KEY: "y" }).equals(serverKey("a", { NEXTAUTH_SECRET: "x" }))).toBe(false);
    expect(() => serverKey("a", {})).toThrow();
  });

  it("encrypts secrets (AES-GCM) and detects tampering", () => {
    const box = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(box).not.toContain("JBSWY3DP");
    expect(decryptSecret(box, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
    const parts = box.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(box, serverKey("other", { NEXTAUTH_SECRET: "x" }))).toThrow();
  });

  it("backup codes: 10 distinct, readable, matched by keyed hash regardless of spacing/case", () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/);
    const hashes = codes.map((c) => hashBackupCode(c, key));
    expect(matchBackupCode(codes[3]!.toUpperCase().replace(/-/g, " "), hashes, key)).toBe(3);
    expect(matchBackupCode("aaaa-bbbb-cccc", hashes, key)).toBe(-1);
  });

  it("signed tokens and 'remember this device'", () => {
    const t = signToken({ u: "user1", v: 2, e: 1000 }, key);
    expect(readToken(t, key)).toEqual({ u: "user1", v: 2, e: 1000 });
    expect(readToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), key)).toBeNull();
    expect(readToken(t, serverKey("other", { NEXTAUTH_SECRET: "x" }))).toBeNull();
    const r = { u: "user1", v: 2, e: 1000 };
    expect(rememberValid(r, "user1", 2, 999)).toBe(true);
    expect(rememberValid(r, "user1", 3, 999)).toBe(false); // 2FA reset since
    expect(rememberValid(r, "user2", 2, 999)).toBe(false);
    expect(rememberValid(r, "user1", 2, 1001)).toBe(false); // expired
  });
});

describe("session upgrade proofs and remembered devices", () => {
  it("a proof works only for the same user, the same session, briefly", async () => {
    process.env.NEXTAUTH_SECRET ??= "test";
    const { upgradeProof, proofValid, rememberCookieValue, isRemembered } = await import("./session-state");
    const p = upgradeProof("u1", "sid1", 1000);
    expect(proofValid(p, "u1", "sid1", 1000)).toBe(true);
    expect(proofValid(p, "u2", "sid1", 1000)).toBe(false);
    expect(proofValid(p, "u1", "sid2", 1000)).toBe(false);
    expect(proofValid(p, "u1", "sid1", 1000 + 121_000)).toBe(false);
    expect(proofValid("forged.proof", "u1", "sid1", 1000)).toBe(false);
    expect(proofValid({ u: "u1" }, "u1", "sid1", 1000)).toBe(false);
    const c = rememberCookieValue("u1", 3, 30, 0);
    expect(isRemembered(c, "u1", 3, 29 * 86400_000)).toBe(true);
    expect(isRemembered(c, "u1", 4, 1)).toBe(false);
    expect(isRemembered(c, "u1", 3, 31 * 86400_000)).toBe(false);
    expect(isRemembered(undefined, "u1", 3, 1)).toBe(false);
  });
});

describe("JWT callback decisions", () => {
  it("at sign-in: code owed only when 2FA is on and the device isn't remembered", async () => {
    process.env.NEXTAUTH_SECRET ??= "test";
    const { tokenAtSignIn, rememberCookieValue } = await import("./session-state");
    const facts = { userId: "u1", twoFactorEnabled: true, twoFactorVersion: 2, sessionVersion: 7 };
    const t = tokenAtSignIn(facts, undefined, 1000);
    expect(t).toMatchObject({ sv: 7, mfa: "pending" });
    expect(t.sid.length).toBeGreaterThan(10);
    expect(tokenAtSignIn(facts, undefined, 1000).sid).not.toBe(t.sid);
    expect(tokenAtSignIn(facts, rememberCookieValue("u1", 2, 30, 0), 1000).mfa).toBe("ok");
    expect(tokenAtSignIn(facts, rememberCookieValue("u1", 1, 30, 0), 1000).mfa).toBe("pending"); // reset since
    expect(tokenAtSignIn({ ...facts, twoFactorEnabled: false }, undefined, 1000).mfa).toBe("ok");
    expect(tokenAtSignIn(null, undefined, 1000)).toMatchObject({ sv: 0, mfa: "ok" });
  });

  it("on update: only a valid proof upgrades the session; browser-sent values are ignored", async () => {
    const { tokenAfterUpdate, upgradeProof } = await import("./session-state");
    const token = { sub: "u1", sid: "s1", mfa: "pending" as const, sv: 3 };
    expect(await tokenAfterUpdate(token, { mfa: "ok", sv: 99 }, 4)).toEqual(token);
    expect(await tokenAfterUpdate(token, { mfaProof: upgradeProof("u1", "other-session") }, 4)).toEqual(token);
    expect(await tokenAfterUpdate(token, { mfaProof: upgradeProof("u1", "s1") }, 4)).toEqual({ ...token, mfa: "ok", sv: 4 });
    expect(await tokenAfterUpdate(token, { mfaProof: upgradeProof("u1", "s1") }, async () => 5)).toEqual({ ...token, mfa: "ok", sv: 5 });
    expect(await tokenAfterUpdate(token, { mfaProof: upgradeProof("u1", "s1") }, null)).toEqual(token); // account gone
  });

  it("break-glass is off unless explicitly set to 1", async () => {
    const { breakGlass } = await import("./session-state");
    expect(breakGlass({})).toBe(false);
    expect(breakGlass({ TWO_FACTOR_BREAK_GLASS: "true" })).toBe(false);
    expect(breakGlass({ TWO_FACTOR_BREAK_GLASS: "1" })).toBe(true);
  });
});
