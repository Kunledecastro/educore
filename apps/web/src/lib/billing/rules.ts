/**
 * EduCore subscription billing rules (Phase 4.2). Pure and unit-tested;
 * the database code in subscription-billing.ts only applies them.
 *
 * - Billed monthly in advance, per ACTIVE student (at least one), in naira.
 * - Subscribing during the trial keeps the trial: the first paid month starts
 *   when the trial ends. Paying while overdue (grace) pays the month that was
 *   due; after read-only, a new month starts on the day of payment.
 * - Upgrades apply at once (new price from the next charge, no proration);
 *   downgrades wait for the next renewal.
 * - A failed renewal is retried 1, 3 and 6 days after the due date (inside the
 *   7-day grace window); after that the school pays from "Plan & billing".
 */
import type { Entitlements, PlanSpec } from "../entitlements";

const DAY = 86_400_000;

/** Same day next month(s), clamped to the month's end (31 Jan + 1 → 28/29 Feb), keeping the time of day. */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

export function monthlyQuote(plan: Pick<PlanSpec, "priceMinor">, activeStudents: number) {
  const students = Math.max(1, Math.floor(activeStudents));
  return { students, unitPriceMinor: plan.priceMinor, amountMinor: students * plan.priceMinor };
}

/** When the month bought at checkout starts. */
export function checkoutPeriodStart(e: Pick<Entitlements, "state" | "until">, subscriptionPeriodEnd: Date | null, now: Date): Date {
  if (e.state === "trial" && e.until && e.until > now) return e.until;
  if (e.state === "grace" && subscriptionPeriodEnd && subscriptionPeriodEnd <= now) return subscriptionPeriodEnd;
  return now;
}

export type PlanChange = "upgrade" | "downgrade" | "same";

/** By price, then by modules: a cheaper plan with fewer modules is a downgrade. */
export function planChange(from: Pick<PlanSpec, "code" | "priceMinor" | "modules">, to: Pick<PlanSpec, "code" | "priceMinor" | "modules">): PlanChange {
  if (from.code === to.code) return "same";
  if (to.priceMinor !== from.priceMinor) return to.priceMinor > from.priceMinor ? "upgrade" : "downgrade";
  return to.modules.length >= from.modules.length ? "upgrade" : "downgrade";
}

/** How a school admin's "choose this plan" is carried out. */
export type PlanAction = "checkout" | "switchNow" | "scheduleDowngrade" | "cancelScheduled" | "none";

export function planAction(input: {
  state: Entitlements["state"];
  hasCard: boolean;
  current: Pick<PlanSpec, "code" | "priceMinor" | "modules">;
  target: Pick<PlanSpec, "code" | "priceMinor" | "modules">;
  pendingPlan: string | null;
}): PlanAction {
  // Not paying yet, overdue, or lapsed: the school pays now (and saves a card).
  if (input.state !== "active" || !input.hasCard || input.current.code === "FREE_TRIAL") return "checkout";
  const change = planChange(input.current, input.target);
  if (change === "same") return input.pendingPlan ? "cancelScheduled" : "none";
  return change === "upgrade" ? "switchNow" : "scheduleDowngrade";
}

export const RETRY_DAYS = [1, 3, 6] as const;

/** When to try a failed renewal again, or null when the retries are used up. `failedAttempts` counts failures so far. */
export function nextRetryAt(dueAt: Date, failedAttempts: number): Date | null {
  const days = RETRY_DAYS[failedAttempts - 1];
  return days === undefined ? null : new Date(dueAt.getTime() + days * DAY);
}

export function isRenewalDue(
  sub: { status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; hasCard: boolean; failedAttempts: number; nextChargeAt: Date | null },
  now: Date,
): boolean {
  if (!sub.hasCard || sub.cancelAtPeriodEnd || !sub.currentPeriodEnd) return false;
  if (sub.status !== "ACTIVE" && sub.status !== "PAST_DUE") return false;
  if (sub.currentPeriodEnd > now) return false;
  if (sub.failedAttempts > RETRY_DAYS.length) return false;
  if (sub.failedAttempts > 0 && (!sub.nextChargeAt || sub.nextChargeAt > now)) return false;
  return true;
}
