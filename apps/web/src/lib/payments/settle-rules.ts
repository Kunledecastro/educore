/**
 * What to do with a verified online payment (milestone 3.3). Pure, tested.
 * Amounts in minor units.
 */
import type { Verification } from "./paystack";

export type AttemptStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "ABANDONED" | "NEEDS_REVIEW";

export type Decision =
  | { action: "none" } // already settled, or Paystack is still waiting
  | { action: "mark"; status: "FAILED" | "ABANDONED" }
  | { action: "review"; reason: "amountMismatch" | "currencyMismatch" | "referenceMismatch" }
  | { action: "record" };

export function decideSettlement(attempt: { status: AttemptStatus; amountMinor: number; currency: string; reference: string }, v: Verification): Decision {
  // Settled once, settled for good: a late webhook or a refresh of the return page changes nothing.
  if (attempt.status === "SUCCEEDED" || attempt.status === "NEEDS_REVIEW") return { action: "none" };
  if (v.reference !== attempt.reference) return { action: "review", reason: "referenceMismatch" };
  if (v.status === "pending") return { action: "none" };
  if (v.status === "failed") return attempt.status === "FAILED" ? { action: "none" } : { action: "mark", status: "FAILED" };
  if (v.status === "abandoned") return attempt.status === "ABANDONED" ? { action: "none" } : { action: "mark", status: "ABANDONED" };
  // success — but only for exactly what we asked for. (A FAILED/ABANDONED attempt can still succeed later: the payer retried on Paystack's page.)
  if (v.currency !== attempt.currency.toUpperCase()) return { action: "review", reason: "currencyMismatch" };
  if (v.amountMinor !== attempt.amountMinor) return { action: "review", reason: "amountMismatch" };
  return { action: "record" };
}

/** Smallest online payment we start (Paystack's floor is lower; this avoids pointless fees). */
export const MIN_ONLINE_MINOR = 10_000; // ₦100

export function checkOnlineAmount(amountMinor: number | null, balanceMinor: number): "invalid" | "tooSmall" | "moreThanBalance" | null {
  if (amountMinor === null || !Number.isInteger(amountMinor) || amountMinor <= 0) return "invalid";
  if (amountMinor > balanceMinor) return "moreThanBalance";
  if (amountMinor < Math.min(MIN_ONLINE_MINOR, balanceMinor)) return "tooSmall";
  return null;
}
