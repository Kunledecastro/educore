import { describe, expect, it } from "vitest";
import { parseTenantSettings } from "../tenant-settings";
import { canDecideStep, DEFAULT_POLICY, eligibleApprovers, expiryFrom, hasEnoughApprovers, policyWarnings, reminderDue, stepsFor, type Person, type ProcessPolicy } from "./policy";

const people: Person[] = [
  { id: "prop", role: "SCHOOL_ADMIN", isActive: true },
  { id: "adm2", role: "SCHOOL_ADMIN", isActive: true },
  { id: "burs", role: "ACCOUNTANT", isActive: true },
  { id: "gone", role: "SCHOOL_ADMIN", isActive: false },
  { id: "teach", role: "TEACHER", isActive: true },
];
const policy = (p: Partial<ProcessPolicy>): ProcessPolicy => ({ ...DEFAULT_POLICY, enabled: true, ...p });

describe("approval policies (Phase 8)", () => {
  it("every process is off by default, and bad settings fall back to off", () => {
    const s = parseTenantSettings({}).approvals;
    expect(Object.values(s).every((p) => !p.enabled)).toBe(true);
    expect(parseTenantSettings({ approvals: { INVOICE_CANCEL: { enabled: "yes" } } }).approvals.INVOICE_CANCEL.enabled).toBe(false);
    expect(parseTenantSettings({ approvals: "nonsense" }).approvals.PAYMENT_REVERSAL).toEqual(DEFAULT_POLICY);
  });

  it("a second step only from the school's amount (or always, with no amount set)", () => {
    const two = policy({ step2: { roles: [], userIds: ["prop"] }, secondStepFromMinor: 10_000_000 });
    expect(stepsFor(two, 9_999_999)).toBe(1);
    expect(stepsFor(two, 10_000_000)).toBe(2);
    expect(stepsFor({ ...two, secondStepFromMinor: null }, 1)).toBe(2);
    expect(stepsFor(policy({}), 99_999_999)).toBe(1);
  });

  it("approvers match by role or by name; never the requester, an earlier step's approver, a disabled account or a teacher", () => {
    const step = { roles: ["ACCOUNTANT" as const], userIds: ["prop", "teach"] };
    const ctx = { requesterId: "adm2", earlierApproverIds: [] };
    expect(canDecideStep(step, people[0]!, ctx)).toBe(true); // named
    expect(canDecideStep(step, people[2]!, ctx)).toBe(true); // by role
    expect(canDecideStep(step, people[1]!, ctx)).toBe(false); // neither
    expect(canDecideStep(step, people[4]!, ctx)).toBe(false); // teachers never approve, even if named
    expect(canDecideStep({ roles: ["SCHOOL_ADMIN"], userIds: [] }, people[3]!, ctx)).toBe(false); // disabled
    expect(canDecideStep(step, people[0]!, { requesterId: "prop", earlierApproverIds: [] })).toBe(false); // own request
    expect(canDecideStep(step, people[0]!, { requesterId: "adm2", earlierApproverIds: ["prop"] })).toBe(false); // took step 1
  });

  it("a request needs someone else to approve it — and two different people for two steps", () => {
    const one = policy({ step1: { roles: [], userIds: ["burs"] } });
    expect(hasEnoughApprovers(one, 1, people, "burs")).toBe(false);
    expect(hasEnoughApprovers(one, 1, people, "adm2")).toBe(true);
    const two = policy({ step1: { roles: ["SCHOOL_ADMIN"], userIds: [] }, step2: { roles: [], userIds: ["prop"] } });
    expect(hasEnoughApprovers(two, 2, people, "burs")).toBe(true); // adm2 then prop
    expect(hasEnoughApprovers(two, 2, people, "adm2")).toBe(false); // only prop is left for both steps
    expect(eligibleApprovers(two.step1, people, { requesterId: "burs" }).map((p) => p.id)).toEqual(["prop", "adm2"]);
  });

  it("warns the admin when a step can be decided by nobody, by one person only, or not by two different people", () => {
    expect(policyWarnings(policy({ step1: { roles: [], userIds: [] } }), people)).toEqual(["step1None"]);
    expect(policyWarnings(policy({ step1: { roles: [], userIds: ["prop"] } }), people)).toEqual(["step1One"]);
    expect(policyWarnings(policy({ step1: { roles: [], userIds: ["prop"] }, step2: { roles: [], userIds: ["prop"] } }), people)).toEqual(["step1One", "step2SamePeople"]);
    expect(policyWarnings(policy({ step1: { roles: ["SCHOOL_ADMIN"], userIds: [] } }), people)).toEqual([]);
  });

  it("expiry after the school's days; reminders after two days, then daily", () => {
    const now = new Date("2026-10-08T09:00:00Z");
    expect(expiryFrom(now, policy({ expiryDays: 7 })).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    const made = new Date("2026-10-08T09:00:00Z");
    expect(reminderDue(made, null, new Date("2026-10-10T08:59:00Z"))).toBe(false);
    expect(reminderDue(made, null, new Date("2026-10-10T09:00:00Z"))).toBe(true);
    expect(reminderDue(made, new Date("2026-10-10T09:00:00Z"), new Date("2026-10-11T08:00:00Z"))).toBe(false);
    expect(reminderDue(made, new Date("2026-10-10T09:00:00Z"), new Date("2026-10-11T09:00:00Z"))).toBe(true);
  });
});
