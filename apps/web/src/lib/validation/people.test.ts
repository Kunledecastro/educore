import { describe, expect, it } from "vitest";
import {
  existingGuardianLinkSchema,
  guardianSchema,
  newGuardianLinkSchema,
  newPasswordSchema,
  staffSchema,
  studentSchema,
  teacherSchema,
} from "./people";

function errorsOf(r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) {
  return Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("studentSchema", () => {
  const base = { admissionNo: "ga-2027-0001", firstName: " Amaka ", lastName: "Okonkwo", classId: "c1" };

  it("normalises admission numbers and trims names; blanks become undefined", () => {
    const s = studentSchema.parse({ ...base, sectionId: "", dateOfBirth: "", gender: "" });
    expect(s).toMatchObject({ admissionNo: "GA-2027-0001", firstName: "Amaka", sectionId: undefined, dateOfBirth: undefined, gender: undefined });
  });

  it("accepts common admission number styles and rejects junk", () => {
    expect(studentSchema.safeParse({ ...base, admissionNo: "24/0153" }).success).toBe(true);
    expect(errorsOf(studentSchema.safeParse({ ...base, admissionNo: "GA 2027" }))).toEqual({ admissionNo: "validation.admissionNo" });
  });

  it("rejects a birth date in the future", () => {
    expect(errorsOf(studentSchema.safeParse({ ...base, dateOfBirth: "2999-01-01" }))).toEqual({ dateOfBirth: "validation.dobFuture" });
  });

  it("requires a class", () => {
    expect(errorsOf(studentSchema.safeParse({ ...base, classId: "" }))).toEqual({ classId: "validation.required" });
  });
});

describe("teacherSchema / staffSchema", () => {
  it("lowercases emails and validates them", () => {
    expect(teacherSchema.parse({ name: "C. Eze", email: " C.Eze@Greenfield.EDU ", employeeId: "ga-t-004" })).toMatchObject({
      email: "c.eze@greenfield.edu",
      employeeId: "GA-T-004",
    });
    expect(errorsOf(teacherSchema.safeParse({ name: "X", email: "not-an-email", employeeId: "T1" }))).toEqual({ email: "validation.email" });
  });

  it("only allows admin or accountant as a staff login role (never platform admin)", () => {
    expect(staffSchema.safeParse({ name: "X", email: "x@y.co", employeeId: "S1", role: "ACCOUNTANT" }).success).toBe(true);
    for (const role of ["PLATFORM_ADMIN", "PARENT", "TEACHER", ""]) {
      expect(errorsOf(staffSchema.safeParse({ name: "X", email: "x@y.co", employeeId: "S1", role }))).toEqual({ role: "validation.invalidChoice" });
    }
  });
});

describe("guardian schemas", () => {
  it("accepts Nigerian and international phone formats, rejects junk", () => {
    for (const phone of ["+2348012345678", "0801 234 5678", "(020) 7946-0958", ""]) {
      expect(guardianSchema.safeParse({ name: "N", email: "n@x.co", phone }).success, phone).toBe(true);
    }
    for (const phone of ["123", "call me", "+234 801 234 5678 999 999"]) {
      expect(errorsOf(guardianSchema.safeParse({ name: "N", email: "n@x.co", phone })), phone).toHaveProperty("phone");
    }
  });

  it("parses the primary-contact checkbox from form values", () => {
    const base = { studentId: "s1", name: "N", email: "n@x.co", relationship: "MOTHER" };
    expect(newGuardianLinkSchema.parse({ ...base, isPrimary: "on" }).isPrimary).toBe(true);
    expect(newGuardianLinkSchema.parse({ ...base, isPrimary: false }).isPrimary).toBe(false);
    expect(existingGuardianLinkSchema.parse({ studentId: "s1", email: "N@X.co", relationship: "FATHER", isPrimary: undefined })).toMatchObject({
      email: "n@x.co",
      isPrimary: false,
    });
  });
});

describe("newPasswordSchema", () => {
  it("accepts a long password with a letter and a digit", () => {
    expect(newPasswordSchema.safeParse({ password: "greenfield2026", confirm: "greenfield2026" }).success).toBe(true);
  });
  it("rejects short, letter-only or digit-only passwords, and mismatches", () => {
    expect(errorsOf(newPasswordSchema.safeParse({ password: "abc123", confirm: "abc123" }))).toEqual({ password: "validation.passwordWeak" });
    expect(errorsOf(newPasswordSchema.safeParse({ password: "onlyletters!", confirm: "onlyletters!" }))).toEqual({ password: "validation.passwordWeak" });
    expect(errorsOf(newPasswordSchema.safeParse({ password: "12345678901", confirm: "12345678901" }))).toEqual({ password: "validation.passwordWeak" });
    expect(errorsOf(newPasswordSchema.safeParse({ password: "greenfield2026", confirm: "greenfield2027" }))).toEqual({ confirm: "validation.passwordMismatch" });
  });
});
