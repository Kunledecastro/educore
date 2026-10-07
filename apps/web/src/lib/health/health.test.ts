import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, emergencyContactsSchema, healthProfileSchema, isEmptyProfile } from "./profile";
import { canEditRecord, canManageAlerts, canRecordVisit, disallowedMedicines, isUrgent, retentionDue, visitView, canOpenRecord, canSeeAlerts, canSeeList, canVerify, cardLevel, sortAlerts, statusAfterSave, type AlertCategory, type AlertSeverity, type HealthActor } from "./rules";

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

describe("alerts and emergency cards (7.1)", () => {
  const ada = { id: "ada", sectionId: "jss1a" };
  const bo = { id: "bo", sectionId: "jss1b" };
  const nosection = { id: "cy", sectionId: null };

  it("teachers see alerts only for sections they teach; never the full record", () => {
    const teacher = actor("TEACHER", { sectionIds: ["jss1a"] });
    expect(canSeeAlerts(teacher, ada)).toBe(true);
    expect(canSeeAlerts(teacher, bo)).toBe(false);
    expect(canSeeAlerts(teacher, nosection)).toBe(false);
    expect(cardLevel(teacher, ada)).toBe("basic");
    expect(cardLevel(teacher, bo)).toBeNull();
  });

  it("the nurse and admins see every pupil's alerts; parents their own child; the card level follows record access", () => {
    expect(canSeeAlerts(actor("SCHOOL_NURSE"), bo)).toBe(true);
    expect(cardLevel(actor("SCHOOL_NURSE"), bo)).toBe("full");
    expect(cardLevel(actor("SCHOOL_ADMIN"), bo)).toBe("basic");
    expect(cardLevel(actor("SCHOOL_ADMIN", { adminFullAccess: true }), bo)).toBe("full");
    const parent = actor("PARENT", { childIds: ["ada"] });
    expect(cardLevel(parent, ada)).toBe("full");
    expect(cardLevel(parent, bo)).toBeNull();
  });

  it("bursars, pupils, the platform team and support sign-ins see no alerts; only the nurse writes them", () => {
    for (const r of ["ACCOUNTANT", "STUDENT", "PLATFORM_ADMIN"]) expect(canSeeAlerts(actor(r, { sectionIds: ["jss1a"], childIds: ["ada"] }), ada)).toBe(false);
    expect(canSeeAlerts(actor("SCHOOL_ADMIN", { impersonating: true }), ada)).toBe(false);
    expect(canManageAlerts(actor("SCHOOL_NURSE"))).toBe(true);
    for (const r of ["SCHOOL_ADMIN", "TEACHER", "PARENT"]) expect(canManageAlerts(actor(r))).toBe(false);
    expect(canManageAlerts(actor("SCHOOL_NURSE", { impersonating: true }))).toBe(false);
  });

  it("most serious alerts come first", () => {
    const input: { category: AlertCategory; severity: AlertSeverity }[] = [
      { category: "OTHER", severity: "MILD" },
      { category: "ASTHMA", severity: "SEVERE" },
      { category: "ALLERGY", severity: "SEVERE" },
      { category: "DIABETES", severity: "MODERATE" },
    ];
    const sorted = sortAlerts(input);
    expect(sorted.map((a) => `${a.severity}:${a.category}`)).toEqual(["SEVERE:ALLERGY", "SEVERE:ASTHMA", "MODERATE:DIABETES", "MILD:OTHER"]);
  });
});

describe("clinic visits (7.2)", () => {
  const ada = { id: "ada", sectionId: "jss1a" };
  it("only the nurse records; parents and the nurse see full visits; teachers and admins a summary", () => {
    expect(canRecordVisit(actor("SCHOOL_NURSE"))).toBe(true);
    for (const r of ["SCHOOL_ADMIN", "TEACHER", "PARENT", "ACCOUNTANT"]) expect(canRecordVisit(actor(r))).toBe(false);
    expect(visitView(actor("SCHOOL_NURSE"), ada)).toBe("full");
    expect(visitView(actor("PARENT", { childIds: ["ada"] }), ada)).toBe("full");
    expect(visitView(actor("PARENT", { childIds: ["bo"] }), ada)).toBeNull();
    expect(visitView(actor("TEACHER", { sectionIds: ["jss1a"] }), ada)).toBe("summary");
    expect(visitView(actor("TEACHER", { sectionIds: ["jss1b"] }), ada)).toBeNull();
    expect(visitView(actor("SCHOOL_ADMIN"), ada)).toBe("summary");
    expect(visitView(actor("SCHOOL_ADMIN", { adminFullAccess: true }), ada)).toBe("full");
    expect(visitView(actor("SCHOOL_ADMIN", { impersonating: true }), ada)).toBeNull();
    expect(visitView(actor("ACCOUNTANT"), ada)).toBeNull();
  });

  it("medicine must be permitted by the parent, or the pupil's own at-school medicine", () => {
    const allowed = { permitted: ["paracetamol"], ownAtSchool: ["Salbutamol inhaler"] };
    expect(disallowedMedicines([{ code: "paracetamol" }, { code: "own", name: " salbutamol INHALER " }], allowed)).toEqual([]);
    expect(disallowedMedicines([{ code: "ibuprofen" }, { code: "own", name: "Ventolin" }], allowed)).toEqual(["ibuprofen", "Ventolin"]);
    expect(disallowedMedicines([{ code: "paracetamol" }], { permitted: [], ownAtSchool: [] })).toEqual(["paracetamol"]);
  });

  it("sent home and referred are urgent", () => {
    expect(isUrgent("SENT_HOME")).toBe(true);
    expect(isUrgent("REFERRED")).toBe(true);
    expect(isUrgent("BACK_TO_CLASS")).toBe(false);
    expect(isUrgent(null)).toBe(false);
  });

  it("retention: the school's years after leaving, never sooner than 30 days", () => {
    const left = new Date("2026-01-10T00:00:00Z");
    expect(retentionDue(left, 1, new Date("2027-01-09T00:00:00Z"))).toBe(false);
    expect(retentionDue(left, 1, new Date("2027-01-10T00:00:00Z"))).toBe(true);
    expect(retentionDue(left, 0, new Date("2026-02-08T00:00:00Z"))).toBe(false);
    expect(retentionDue(left, 0, new Date("2026-02-09T00:00:00Z"))).toBe(true);
  });
});
