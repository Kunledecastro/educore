import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, emergencyContactsSchema, healthProfileSchema, isEmptyProfile } from "./profile";
import { canEditRecord, canOpenRecord, canSeeList, canVerify, statusAfterSave, type HealthActor } from "./rules";

const actor = (role: string, over: Partial<HealthActor> = {}): HealthActor => ({ role, childIds: [], adminFullAccess: false, impersonating: false, ...over });

describe("who may open and change health records", () => {
  it("the nurse: everyone; parents: only their own children", () => {
    expect(canOpenRecord(actor("SCHOOL_NURSE"), "any")).toBe(true);
    expect(canEditRecord(actor("SCHOOL_NURSE"), "any")).toBe(true);
    const parent = actor("PARENT", { childIds: ["ada"] });
    expect(canOpenRecord(parent, "ada")).toBe(true);
    expect(canOpenRecord(parent, "chi")).toBe(false);
    expect(canEditRecord(parent, "chi")).toBe(false);
  });

  it("admins: the list always; full records only with the school's setting; never edit or verify", () => {
    expect(canSeeList(actor("SCHOOL_ADMIN"))).toBe(true);
    expect(canOpenRecord(actor("SCHOOL_ADMIN"), "ada")).toBe(false);
    expect(canOpenRecord(actor("SCHOOL_ADMIN", { adminFullAccess: true }), "ada")).toBe(true);
    expect(canEditRecord(actor("SCHOOL_ADMIN", { adminFullAccess: true }), "ada")).toBe(false);
    expect(canVerify(actor("SCHOOL_ADMIN", { adminFullAccess: true }))).toBe(false);
  });

  it("support working as an admin never opens records; teachers, bursars, pupils and the platform team can't either", () => {
    expect(canOpenRecord(actor("SCHOOL_ADMIN", { adminFullAccess: true, impersonating: true }), "ada")).toBe(false);
    for (const r of ["TEACHER", "ACCOUNTANT", "STUDENT", "PLATFORM_ADMIN"]) {
      expect(canOpenRecord(actor(r, { childIds: ["ada"] }), "ada")).toBe(false);
      expect(canEditRecord(actor(r), "ada")).toBe(false);
      expect(canSeeList(actor(r))).toBe(false);
    }
  });

  it("status: a parent's change after a check needs re-checking; the nurse can verify", () => {
    expect(statusAfterSave("PARENT", null, false)).toBe("SUBMITTED");
    expect(statusAfterSave("PARENT", "SUBMITTED", false)).toBe("SUBMITTED");
    expect(statusAfterSave("PARENT", "VERIFIED", false)).toBe("CHANGED");
    expect(statusAfterSave("PARENT", "VERIFIED", true)).toBe("CHANGED"); // parents can't verify
    expect(statusAfterSave("SCHOOL_NURSE", "CHANGED", true)).toBe("VERIFIED");
    expect(statusAfterSave("SCHOOL_NURSE", "CHANGED", false)).toBe("CHANGED");
    expect(statusAfterSave("SCHOOL_NURSE", null, false)).toBe("SUBMITTED");
  });
});

describe("profile format", () => {
  it("fills defaults, and knows an empty form when it sees one", () => {
    expect(isEmptyProfile(EMPTY_PROFILE)).toBe(true);
    const p = healthProfileSchema.parse({ genotype: "AS", allergies: [{ name: "Peanuts", severity: "severe" }] });
    expect(p.allergies[0]).toEqual({ name: "Peanuts", reaction: "", severity: "severe" });
    expect(isEmptyProfile(p)).toBe(false);
  });

  it("rejects unknown values and oversize lists", () => {
    expect(healthProfileSchema.safeParse({ genotype: "ZZ" }).success).toBe(false);
    expect(healthProfileSchema.safeParse({ allergies: [{ name: "", severity: "mild" }] }).success).toBe(false);
    expect(healthProfileSchema.safeParse({ allergies: Array.from({ length: 21 }, () => ({ name: "x", severity: "mild" })) }).success).toBe(false);
    expect(healthProfileSchema.safeParse({ permittedMedicines: ["morphine"] }).success).toBe(false);
  });

  it("emergency contacts: a phone number each, at most 5", () => {
    expect(emergencyContactsSchema.safeParse([{ name: "Mrs Okafor", phone: "+234 803 000 0000" }]).success).toBe(true);
    expect(emergencyContactsSchema.safeParse([{ name: "Mrs Okafor", phone: "call me" }]).success).toBe(false);
    expect(emergencyContactsSchema.safeParse(Array.from({ length: 6 }, () => ({ name: "x", phone: "08030000000" }))).success).toBe(false);
  });
});
