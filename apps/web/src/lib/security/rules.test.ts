import { describe, expect, it } from "vitest";
import { authStage, twoFactorOffered, twoFactorRequired } from "./rules";

describe("who uses 2FA", () => {
  it("required for platform, admins and bursars; teachers if the school says; never forced on families", () => {
    for (const r of ["PLATFORM_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT", "SCHOOL_NURSE"]) expect(twoFactorRequired(r, { requireTeacher2fa: false })).toBe(true);
    expect(twoFactorRequired("TEACHER", { requireTeacher2fa: false })).toBe(false);
    expect(twoFactorRequired("TEACHER", { requireTeacher2fa: true })).toBe(true);
    for (const r of ["PARENT", "STUDENT"]) expect(twoFactorRequired(r, { requireTeacher2fa: true })).toBe(false);
    expect(twoFactorRequired("SCHOOL_ADMIN", { requireTeacher2fa: true, exempt: true })).toBe(false); // demo school
    expect(twoFactorRequired("TEACHER", { requireTeacher2fa: true, exempt: true })).toBe(false);
    expect(twoFactorRequired("PLATFORM_ADMIN", { requireTeacher2fa: false, exempt: true })).toBe(true);
    expect(twoFactorOffered("PARENT")).toBe(true);
    expect(twoFactorOffered("STUDENT")).toBe(false);
  });

  it("session stages", () => {
    const school = { requireTeacher2fa: false };
    expect(authStage({ role: "SCHOOL_ADMIN", twoFactorEnabled: false, sessionPassed2fa: false, school })).toBe("setup");
    expect(authStage({ role: "SCHOOL_ADMIN", twoFactorEnabled: true, sessionPassed2fa: false, school })).toBe("verify");
    expect(authStage({ role: "SCHOOL_ADMIN", twoFactorEnabled: true, sessionPassed2fa: true, school })).toBe("ok");
    expect(authStage({ role: "PARENT", twoFactorEnabled: false, sessionPassed2fa: false, school })).toBe("ok");
    expect(authStage({ role: "PARENT", twoFactorEnabled: true, sessionPassed2fa: false, school })).toBe("verify");
    expect(authStage({ role: "TEACHER", twoFactorEnabled: false, sessionPassed2fa: false, school: { requireTeacher2fa: true } })).toBe("setup");
  });
});
