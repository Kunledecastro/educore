import { describe, expect, it } from "vitest";
import { DEFAULT_PLANS } from "../entitlements";
import { addMonths, checkoutPeriodStart, isRenewalDue, monthlyQuote, nextRetryAt, planAction, planChange } from "./rules";

const d = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
const { STARTER, STANDARD, PREMIUM, FREE_TRIAL } = DEFAULT_PLANS;

describe("billing periods", () => {
  it("adds calendar months, clamping to the month's end", () => {
    expect(addMonths(d("2026-10-05T09:30:00.000Z"), 1)).toEqual(d("2026-11-05T09:30:00.000Z"));
    expect(addMonths(d("2027-01-31"), 1)).toEqual(d("2027-02-28"));
    expect(addMonths(d("2028-01-31"), 1)).toEqual(d("2028-02-29"));
    expect(addMonths(d("2026-12-15"), 1)).toEqual(d("2027-01-15"));
  });

  it("subscribing during the trial keeps the trial days", () => {
    expect(checkoutPeriodStart({ state: "trial", until: d("2026-10-20") }, null, d("2026-10-05"))).toEqual(d("2026-10-20"));
  });
  it("paying while overdue pays the month that was due; after read-only it starts today", () => {
    expect(checkoutPeriodStart({ state: "grace", until: d("2026-10-08") }, d("2026-10-01"), d("2026-10-05"))).toEqual(d("2026-10-01"));
    expect(checkoutPeriodStart({ state: "readOnly", until: d("2026-09-08") }, d("2026-09-01"), d("2026-10-05"))).toEqual(d("2026-10-05"));
  });
});

describe("charges", () => {
  it("bills active students × price, at least one student", () => {
    expect(monthlyQuote(STANDARD, 120)).toEqual({ students: 120, unitPriceMinor: 50_000, amountMinor: 6_000_000 });
    expect(monthlyQuote(STARTER, 0)).toEqual({ students: 1, unitPriceMinor: 30_000, amountMinor: 30_000 });
  });
});

describe("changing plan", () => {
  it("knows upgrades from downgrades", () => {
    expect(planChange(STARTER, STANDARD)).toBe("upgrade");
    expect(planChange(PREMIUM, STANDARD)).toBe("downgrade");
    expect(planChange(STANDARD, STANDARD)).toBe("same");
    expect(planChange({ ...STARTER, code: "STANDARD" }, STARTER)).toBe("upgrade"); // same price: more modules wins
  });

  it("a trial, an unpaid school or one without a card goes to checkout", () => {
    expect(planAction({ state: "trial", hasCard: false, current: FREE_TRIAL, target: STANDARD, pendingPlan: null })).toBe("checkout");
    expect(planAction({ state: "grace", hasCard: true, current: STANDARD, target: STANDARD, pendingPlan: null })).toBe("checkout");
    expect(planAction({ state: "readOnly", hasCard: true, current: STANDARD, target: STARTER, pendingPlan: null })).toBe("checkout");
    expect(planAction({ state: "active", hasCard: false, current: STANDARD, target: PREMIUM, pendingPlan: null })).toBe("checkout");
  });

  it("a paying school upgrades now and downgrades at renewal", () => {
    expect(planAction({ state: "active", hasCard: true, current: STANDARD, target: PREMIUM, pendingPlan: null })).toBe("switchNow");
    expect(planAction({ state: "active", hasCard: true, current: STANDARD, target: STARTER, pendingPlan: null })).toBe("scheduleDowngrade");
    expect(planAction({ state: "active", hasCard: true, current: STANDARD, target: STANDARD, pendingPlan: "STARTER" })).toBe("cancelScheduled");
    expect(planAction({ state: "active", hasCard: true, current: STANDARD, target: STANDARD, pendingPlan: null })).toBe("none");
  });
});

describe("renewals and retries", () => {
  const sub = { status: "ACTIVE", currentPeriodEnd: d("2026-11-01"), cancelAtPeriodEnd: false, hasCard: true, failedAttempts: 0, nextChargeAt: null };

  it("is due once the paid month ends", () => {
    expect(isRenewalDue(sub, d("2026-10-31"))).toBe(false);
    expect(isRenewalDue(sub, d("2026-11-01"))).toBe(true);
  });

  it("never renews without a card, after cancelling, or for a cancelled subscription", () => {
    const now = d("2026-11-02");
    expect(isRenewalDue({ ...sub, hasCard: false }, now)).toBe(false);
    expect(isRenewalDue({ ...sub, cancelAtPeriodEnd: true }, now)).toBe(false);
    expect(isRenewalDue({ ...sub, status: "CANCELLED" }, now)).toBe(false);
  });

  it("retries 1, 3 and 6 days after the due date, then stops", () => {
    const due = d("2026-11-01");
    expect(nextRetryAt(due, 1)).toEqual(d("2026-11-02"));
    expect(nextRetryAt(due, 2)).toEqual(d("2026-11-04"));
    expect(nextRetryAt(due, 3)).toEqual(d("2026-11-07"));
    expect(nextRetryAt(due, 4)).toBeNull();
    const failed = { ...sub, status: "PAST_DUE", failedAttempts: 1, nextChargeAt: d("2026-11-02") };
    expect(isRenewalDue(failed, d("2026-11-01T12:00:00.000Z"))).toBe(false);
    expect(isRenewalDue(failed, d("2026-11-02"))).toBe(true);
    expect(isRenewalDue({ ...failed, failedAttempts: 4, nextChargeAt: null }, d("2026-11-20"))).toBe(false);
  });

  it("every retry falls inside the 7-day grace window", () => {
    for (let n = 1; n <= 3; n++) expect(nextRetryAt(d("2026-11-01"), n)!.getTime()).toBeLessThan(d("2026-11-08").getTime());
  });
});
