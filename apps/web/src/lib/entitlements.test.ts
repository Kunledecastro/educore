import { describe, expect, it } from "vitest";
import { RESOURCES } from "@educore/auth";
import { checkEntitlement, computeEntitlements, DEFAULT_PLANS, monthlyChargeMinor, RESOURCE_MODULE, studentCapacity, type EntitlementInput } from "./entitlements";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const base: EntitlementInput = { tenantStatus: "ACTIVE", tenantCreatedAt: d("2026-09-01"), plan: DEFAULT_PLANS.FREE_TRIAL, subscription: null };

describe("subscription state", () => {
  it("a new school is on a 30-day trial with everything, then read-only", () => {
    const during = computeEntitlements(base, d("2026-09-30"));
    expect(during).toMatchObject({ state: "trial", canWrite: true, until: d("2026-10-01") });
    expect(during.modules.has("onlinePayments")).toBe(true);
    expect(computeEntitlements(base, d("2026-10-01"))).toMatchObject({ state: "readOnly", canWrite: false });
  });

  it("the platform can extend a trial", () => {
    const extended = { ...base, subscription: { status: "TRIALING" as const, currentPeriodEnd: d("2026-11-15") } };
    expect(computeEntitlements(extended, d("2026-11-01")).state).toBe("trial");
  });

  it("paid and current → active; period over → 7 days' grace → read-only", () => {
    const paid = { ...base, plan: DEFAULT_PLANS.STANDARD, subscription: { status: "ACTIVE" as const, currentPeriodEnd: d("2026-11-01") } };
    expect(computeEntitlements(paid, d("2026-10-20")).state).toBe("active");
    expect(computeEntitlements(paid, d("2026-11-03"))).toMatchObject({ state: "grace", canWrite: true, until: d("2026-11-08") });
    expect(computeEntitlements(paid, d("2026-11-08"))).toMatchObject({ state: "readOnly", canWrite: false });
  });

  it("a failed payment before the period ends gives grace from the failure", () => {
    const pastDue = { ...base, plan: DEFAULT_PLANS.STARTER, subscription: { status: "PAST_DUE" as const, currentPeriodEnd: d("2026-11-01") } };
    expect(computeEntitlements(pastDue, d("2026-10-20"))).toMatchObject({ state: "grace", until: d("2026-11-08") });
  });

  it("cancelled → read-only; suspended → nothing", () => {
    const cancelled = { ...base, plan: DEFAULT_PLANS.STARTER, subscription: { status: "CANCELLED" as const, currentPeriodEnd: d("2026-11-01") } };
    expect(computeEntitlements(cancelled, d("2026-10-20")).state).toBe("readOnly");
    expect(computeEntitlements({ ...base, tenantStatus: "SUSPENDED" }, d("2026-09-05"))).toMatchObject({ state: "suspended", canWrite: false });
  });

  it("a paid plan set by the platform with no subscription is active (complimentary)", () => {
    expect(computeEntitlements({ ...base, plan: DEFAULT_PLANS.PREMIUM }, d("2030-01-01")).state).toBe("active");
  });
});

describe("checkEntitlement", () => {
  const starter = computeEntitlements({ ...base, plan: DEFAULT_PLANS.STARTER, subscription: null }, d("2026-10-01"));
  const readOnly = computeEntitlements(base, d("2027-01-01"));

  it("refuses modules the plan doesn't include — reads too", () => {
    expect(checkEntitlement(starter, "invoice", "read")).toEqual({ reason: "module", module: "fees" });
    expect(checkEntitlement(starter, "reportCard", "update")).toEqual({ reason: "module", module: "reportCards" });
    expect(checkEntitlement(starter, "attendance", "create")).toBeNull();
  });

  it("core features are always available", () => {
    for (const r of ["student", "user", "classGrade", "academicYear", "guardian", "auditLog", "onboarding"] as const) {
      expect(RESOURCE_MODULE[r]).toBeUndefined();
      expect(checkEntitlement(starter, r, "update")).toBeNull();
    }
  });

  it("read-only schools can read and export, but not change anything", () => {
    expect(checkEntitlement(readOnly, "student", "read")).toBeNull();
    expect(checkEntitlement(readOnly, "invoice", "export")).toBeNull();
    for (const action of ["create", "update", "delete", "import"] as const) {
      expect(checkEntitlement(readOnly, "student", action)).toEqual({ reason: "readOnly" });
    }
  });

  it("every module named in RESOURCE_MODULE is a real resource", () => {
    for (const r of Object.keys(RESOURCE_MODULE)) expect(RESOURCES).toContain(r);
  });

  it("higher plans include everything lower plans do", () => {
    const has = (p: keyof typeof DEFAULT_PLANS) => new Set(DEFAULT_PLANS[p].modules);
    for (const m of has("STARTER")) expect(has("STANDARD").has(m)).toBe(true);
    for (const m of has("STANDARD")) expect(has("PREMIUM").has(m)).toBe(true);
  });
});

describe("limits and charges", () => {
  const starter = computeEntitlements({ ...base, plan: DEFAULT_PLANS.STARTER }, d("2026-10-01"));
  it("caps enrolment at the plan's maximum", () => {
    expect(studentCapacity(starter, 299)).toEqual({ ok: true, remaining: 1 });
    expect(studentCapacity(starter, 300)).toEqual({ ok: false, remaining: 0 });
    expect(studentCapacity(starter, 290, 20)).toEqual({ ok: false, remaining: 10 });
    expect(studentCapacity(computeEntitlements({ ...base, plan: DEFAULT_PLANS.PREMIUM }, d("2026-10-01")), 100_000).ok).toBe(true);
  });
  it("charges students × price per month", () => {
    expect(monthlyChargeMinor(DEFAULT_PLANS.STANDARD, 120)).toBe(6_000_000); // ₦60,000
    expect(monthlyChargeMinor(DEFAULT_PLANS.FREE_TRIAL, 120)).toBe(0);
  });
});
