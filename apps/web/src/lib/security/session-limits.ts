import type { Role } from "@educore/db";

/**
 * Session limits (tester review, Oct 2026): sign people out after a period
 * of inactivity, and cap how long a privileged session can last at all —
 * so a laptop left open in the staff room doesn't stay signed in.
 *
 * Plain functions, used by the Auth.js JWT callback (server enforcement)
 * and by the idle timer in the browser (warning + sign-out). Tested.
 */

/** What a school can choose for staff inactivity (minutes). */
export const STAFF_IDLE_CHOICES = [15, 30, 60, 120] as const;
export type StaffIdleMinutes = (typeof STAFF_IDLE_CHOICES)[number];
export const DEFAULT_STAFF_IDLE: StaffIdleMinutes = 30;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Money, records and the whole platform: a working day at most, then sign in again. */
const PRIVILEGED: readonly Role[] = ["PLATFORM_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT"];

export interface SessionLimits {
  /** Minutes without activity before sign-out. */
  idleMinutes: number;
  /** Longest a session can last from sign-in, active or not (ms). */
  maxAgeMs: number;
}

export function sessionLimits(role: Role, staffIdle: number = DEFAULT_STAFF_IDLE): SessionLimits {
  const staff = (STAFF_IDLE_CHOICES as readonly number[]).includes(staffIdle) ? staffIdle : DEFAULT_STAFF_IDLE;
  switch (role) {
    case "PLATFORM_ADMIN":
      return { idleMinutes: 15, maxAgeMs: 12 * HOUR };
    case "PARENT":
      return { idleMinutes: 60, maxAgeMs: 30 * DAY };
    case "STUDENT":
      // Pupils often use shared school computers.
      return { idleMinutes: 30, maxAgeMs: 7 * DAY };
    default:
      return { idleMinutes: staff, maxAgeMs: PRIVILEGED.includes(role) ? 12 * HOUR : 30 * DAY };
  }
}

/** Allowance for the browser's activity ping arriving a little late. */
export const IDLE_GRACE_MS = 2 * 60_000;
/** The browser tells the server about activity at most this often. */
export const ACTIVITY_PING_MS = 60_000;
/** Warning shown this long before sign-out. */
export const IDLE_WARNING_MS = 60_000;

export interface LimitClaims {
  /** Last activity the server heard about (epoch ms). */
  act?: number;
  /** When this session signed in (epoch ms). */
  aat?: number;
  /** Idle limit, minutes. */
  idl?: number;
  /** Absolute limit from sign-in, ms. */
  mxa?: number;
}

/** Why a session has run out, or null if it is still good. */
export function sessionExpired(c: LimitClaims, now: number = Date.now()): "idle" | "maxAge" | null {
  if (c.aat !== undefined && c.mxa !== undefined && now - c.aat > c.mxa) return "maxAge";
  if (c.act !== undefined && c.idl !== undefined && now - c.act > c.idl * 60_000 + IDLE_GRACE_MS) return "idle";
  return null;
}

/** Fresh claims at sign-in (or for a session from before this change). */
export function claimsAtSignIn(limits: SessionLimits, now: number = Date.now()): Required<LimitClaims> {
  return { act: now, aat: now, idl: limits.idleMinutes, mxa: limits.maxAgeMs };
}

/** The browser reported activity: move the idle clock, never past "now" and never for an expired session. */
export function touched<T extends LimitClaims>(c: T, now: number = Date.now()): T {
  if (sessionExpired(c, now)) return c;
  return { ...c, act: now };
}

/** Browser side: what to show, given the last activity (any tab) and the limit. */
export function idlePhase(lastActivity: number, idleMinutes: number, now: number = Date.now()): { phase: "active" | "warning" | "expired"; msLeft: number } {
  const msLeft = lastActivity + idleMinutes * 60_000 - now;
  if (msLeft <= 0) return { phase: "expired", msLeft: 0 };
  if (msLeft <= IDLE_WARNING_MS) return { phase: "warning", msLeft };
  return { phase: "active", msLeft };
}

/** The browser's activity ping is a session update carrying exactly { touch: true }. */
export function isActivityPing(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && (payload as { touch?: unknown }).touch === true);
}
