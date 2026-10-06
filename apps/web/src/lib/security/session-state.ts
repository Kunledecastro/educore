import { randomBytes } from "node:crypto";
import { readToken, rememberValid, serverKey, signToken, type RememberDevice } from "./secrets";

/**
 * Pieces of the session that 2FA adds (Phase 6), kept free of Next.js
 * imports so they're testable:
 * - `sid`  a random id per sign-in, so an "upgrade" proof can't be reused
 *          on another session;
 * - `sv`   the user's session version at sign-in (bumped = signed out);
 * - `mfa`  "ok" once this session passed the code step (or 2FA was off).
 */

export const REMEMBER_COOKIE = "ec_2fa_rd";
const proofKey = () => serverKey("session-upgrade");
const rememberKey = () => serverKey("remember-device");

export function newSessionId(): string {
  return randomBytes(16).toString("base64url");
}

/** Issued by the server after a correct code; the JWT callback accepts it only for the same user and session, within 2 minutes. */
export function upgradeProof(userId: string, sid: string, now: number = Date.now()): string {
  return signToken({ k: "mfa-ok", u: userId, s: sid, e: now + 120_000 }, proofKey());
}

export function proofValid(proof: unknown, userId: string | undefined, sid: string | undefined, now: number = Date.now()): boolean {
  if (typeof proof !== "string" || !userId || !sid) return false;
  const p = readToken<{ k: string; u: string; s: string; e: number }>(proof, proofKey());
  return Boolean(p && p.k === "mfa-ok" && p.u === userId && p.s === sid && p.e > now);
}

export function rememberCookieValue(userId: string, twoFactorVersion: number, days: number, now: number = Date.now()): string {
  return signToken({ u: userId, v: twoFactorVersion, e: now + days * 86400_000 }, rememberKey());
}

export function isRemembered(cookie: string | undefined, userId: string, twoFactorVersion: number, now: number = Date.now()): boolean {
  return rememberValid(readToken<RememberDevice>(cookie, rememberKey()), userId, twoFactorVersion, now);
}

// ---------------------------------------------------------------------------
// The decisions the Auth.js JWT callback makes, as plain functions (tested).
// ---------------------------------------------------------------------------

export interface SignInFacts {
  userId: string;
  twoFactorEnabled: boolean;
  twoFactorVersion: number;
  sessionVersion: number;
}

/** At sign-in: a new session id and version, and whether the code step is still owed. */
export function tokenAtSignIn(facts: SignInFacts | null, rememberCookie: string | undefined, now: number = Date.now()): { sid: string; sv: number; mfa: "ok" | "pending" } {
  const remembered = facts ? isRemembered(rememberCookie, facts.userId, facts.twoFactorVersion, now) : false;
  return { sid: newSessionId(), sv: facts?.sessionVersion ?? 0, mfa: facts?.twoFactorEnabled && !remembered ? "pending" : "ok" };
}

/**
 * On a session update: only a valid server-minted proof for this user and
 * session changes anything (code step passed; pick up the new version).
 * Whatever else a browser sends is ignored.
 */
export function tokenAfterUpdate<T extends { sub?: string; sid?: string; mfa?: "ok" | "pending"; sv?: number }>(token: T, payload: unknown, currentSessionVersion: (() => Promise<number | null>) | number | null, now: number = Date.now()): T | Promise<T> {
  const proof = payload && typeof payload === "object" ? (payload as { mfaProof?: unknown }).mfaProof : undefined;
  if (!proofValid(proof, token.sub, token.sid, now)) return token;
  const apply = (sv: number | null) => (sv === null ? token : { ...token, mfa: "ok" as const, sv });
  return typeof currentSessionVersion === "function" ? currentSessionVersion().then(apply) : apply(currentSessionVersion);
}

/**
 * Break-glass (operations only): with TWO_FACTOR_BREAK_GLASS=1 in the
 * environment, the 2FA step and set-up are skipped for everyone, so a fault
 * in 2FA can never lock a school out. Logged loudly; remove it straight after.
 */
export function breakGlass(env: Record<string, string | undefined> = process.env): boolean {
  const on = env.TWO_FACTOR_BREAK_GLASS === "1";
  if (on) console.warn("[security] TWO_FACTOR_BREAK_GLASS is on — two-factor sign-in is NOT being enforced");
  return on;
}
