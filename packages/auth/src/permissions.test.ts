import { describe, expect, it } from "vitest";
import { Role } from "./roles";
import { can, assertPermission, ForbiddenError, PERMISSION_MATRIX, RESOURCES } from "./permissions";

describe("RBAC permission matrix", () => {
  it("grants PLATFORM_ADMIN every action on every resource except deleting the audit log", () => {
    for (const resource of RESOURCES) {
      expect(can(Role.PLATFORM_ADMIN, resource, "read")).toBe(true);
      if (resource === "auditLog") continue;
      expect(can(Role.PLATFORM_ADMIN, resource, "delete")).toBe(true);
    }
  });

  it("lets SCHOOL_ADMIN manage students but never write the audit log", () => {
    expect(can(Role.SCHOOL_ADMIN, "student", "create")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "student", "delete")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "auditLog", "read")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "auditLog", "update")).toBe(false);
    expect(can(Role.SCHOOL_ADMIN, "auditLog", "delete")).toBe(false);
  });

  it("never lets ANY role delete the audit log", () => {
    for (const role of Object.values(Role)) {
      expect(can(role, "auditLog", "delete")).toBe(false);
    }
  });

  it("lets TEACHER write attendance and marks, but not fees or payments", () => {
    expect(can(Role.TEACHER, "attendance", "create")).toBe(true);
    expect(can(Role.TEACHER, "mark", "update")).toBe(true);
    expect(can(Role.TEACHER, "invoice", "read")).toBe(false);
    expect(can(Role.TEACHER, "payment", "create")).toBe(false);
    expect(can(Role.TEACHER, "user", "delete")).toBe(false);
  });

  it("lets PARENT only read student records and submit payments, never delete anything", () => {
    expect(can(Role.PARENT, "student", "read")).toBe(true);
    expect(can(Role.PARENT, "student", "update")).toBe(false);
    expect(can(Role.PARENT, "payment", "create")).toBe(true);
    expect(can(Role.PARENT, "payment", "delete")).toBe(false);
    expect(can(Role.PARENT, "invoice", "update")).toBe(false);
  });

  it("lets STUDENT only read their own academic data", () => {
    expect(can(Role.STUDENT, "mark", "read")).toBe(true);
    expect(can(Role.STUDENT, "mark", "update")).toBe(false);
    expect(can(Role.STUDENT, "attendance", "update")).toBe(false);
    expect(can(Role.STUDENT, "invoice", "create")).toBe(false);
  });

  it("restricts ACCOUNTANT to the fee/payment domain", () => {
    expect(can(Role.ACCOUNTANT, "invoice", "create")).toBe(true);
    expect(can(Role.ACCOUNTANT, "payment", "update")).toBe(true);
    expect(can(Role.ACCOUNTANT, "mark", "read")).toBe(false);
    expect(can(Role.ACCOUNTANT, "attendance", "update")).toBe(false);
  });

  it("assertPermission throws ForbiddenError when the matrix denies", () => {
    expect(() => assertPermission(Role.STUDENT, "user", "delete")).toThrow(ForbiddenError);
    expect(() => assertPermission(Role.SCHOOL_ADMIN, "student", "read")).not.toThrow();
  });

  it("every role in the matrix is a valid Role enum member", () => {
    for (const role of Object.keys(PERMISSION_MATRIX)) {
      expect(Object.values(Role)).toContain(role);
    }
  });

  it("academic setup (years, classes, sections, subjects, teacher assignments) is managed only by school admins", () => {
    const resources = ["academicYear", "classGrade", "section", "subject", "teacherAssignment"] as const;
    const writes = ["create", "update", "delete"] as const;
    for (const resource of resources) {
      for (const action of writes) {
        expect(can(Role.SCHOOL_ADMIN, resource, action)).toBe(true);
        for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) {
          expect(can(role, resource, action), `${role} must not ${action} ${resource}`).toBe(false);
        }
      }
      // Teachers can look at the structure they teach in; families and finance staff can't browse it.
      expect(can(Role.TEACHER, resource, "read")).toBe(true);
      expect(can(Role.PARENT, resource, "read")).toBe(false);
      expect(can(Role.STUDENT, resource, "read")).toBe(false);
      expect(can(Role.ACCOUNTANT, resource, "read")).toBe(false);
    }
  });
});

