import { describe, expect, it } from "vitest";
import { Role } from "./roles";
import { can, assertPermission, ForbiddenError, PERMISSION_MATRIX, RESOURCES, studentScopeWhere } from "./permissions";

describe("RBAC permission matrix", () => {
  it("grants PLATFORM_ADMIN every action on every resource except deleting the audit log, and nothing on pupils' health data", () => {
    const HEALTH = new Set(["healthRecord", "healthAlert", "clinicVisit", "healthAccessLog", "healthSettings"]);
    for (const resource of RESOURCES) {
      if (HEALTH.has(resource)) {
        expect(can(Role.PLATFORM_ADMIN, resource, "read")).toBe(false);
        continue;
      }
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

  it("only school admins can pay for and change their school's EduCore plan (4.2)", () => {
    expect(can(Role.SCHOOL_ADMIN, "subscription", "update")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "subscription", "delete")).toBe(false);
    expect(can(Role.SCHOOL_ADMIN, "tenant", "update")).toBe(false); // can't set its own plan by hand
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) {
      expect(can(role, "subscription", "update")).toBe(false);
    }
  });

  it("messages are teacher ↔ parent (and admins); announcements are posted by admins and teachers (4.4)", () => {
    for (const role of [Role.SCHOOL_ADMIN, Role.TEACHER, Role.PARENT]) expect(can(role, "message", "create")).toBe(true);
    for (const role of [Role.STUDENT, Role.ACCOUNTANT]) expect(can(role, "message", "read")).toBe(false);
    expect(can(Role.TEACHER, "announcement", "create")).toBe(true);
    expect(can(Role.TEACHER, "announcement", "delete")).toBe(false);
    for (const role of [Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) expect(can(role, "announcement", "create")).toBe(false);
    expect(can(Role.SCHOOL_ADMIN, "announcement", "delete")).toBe(true);
  });

  it("only school admins change their school's branding", () => {
    expect(can(Role.SCHOOL_ADMIN, "branding", "update")).toBe(true);
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) expect(can(role, "branding", "update")).toBe(false);
  });

  it("student logins: admins manage, teachers reset (own form sections, checked in code), nobody else (5.0)", () => {
    expect(can(Role.SCHOOL_ADMIN, "studentLogin", "create")).toBe(true);
    expect(can(Role.TEACHER, "studentLogin", "update")).toBe(true);
    expect(can(Role.TEACHER, "studentLogin", "create")).toBe(false);
    for (const role of [Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) expect(can(role, "studentLogin", "read")).toBe(false);
  });

  it("assignments: teachers set and mark; students and parents read and hand in; bursars nothing (5.1)", () => {
    expect(can(Role.TEACHER, "assignment", "create")).toBe(true);
    expect(can(Role.TEACHER, "submission", "update")).toBe(true);
    for (const role of [Role.STUDENT, Role.PARENT]) {
      expect(can(role, "assignment", "read")).toBe(true);
      expect(can(role, "assignment", "create")).toBe(false);
      expect(can(role, "submission", "create")).toBe(true);
      expect(can(role, "submission", "delete")).toBe(false);
    }
    expect(can(Role.ACCOUNTANT, "assignment", "read")).toBe(false);
    for (const role of Object.values(Role)) expect(can(role, "submission", "delete")).toBe(role === Role.PLATFORM_ADMIN);
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

  it("only school admins see and hide the onboarding checklist", () => {
    expect(can(Role.SCHOOL_ADMIN, "onboarding", "read")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "onboarding", "update")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "onboarding", "delete")).toBe(false);
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) {
      expect(can(role, "onboarding", "read"), `${role} must not read onboarding`).toBe(false);
      expect(can(role, "onboarding", "update"), `${role} must not update onboarding`).toBe(false);
    }
    // Hiding the checklist must not open up the rest of the school record.
    expect(can(Role.SCHOOL_ADMIN, "tenant", "update")).toBe(false);
  });
});

describe("studentScopeWhere (row-level: which students a user may see)", () => {
  const user = (role: Role) => ({ id: "u1", tenantId: "t1", role });

  it("school admins and accountants see the whole school (tenant scoping does the rest)", () => {
    expect(studentScopeWhere(user(Role.SCHOOL_ADMIN), {})).toEqual({});
    expect(studentScopeWhere(user(Role.ACCOUNTANT), {})).toEqual({});
  });

  it("parents see only their linked children", () => {
    expect(studentScopeWhere(user(Role.PARENT), { guardianStudentIds: ["s1", "s2"] })).toEqual({ id: { in: ["s1", "s2"] } });
  });

  it("a parent with no linked children sees nothing — never everything", () => {
    expect(studentScopeWhere(user(Role.PARENT), {})).toEqual({ id: { in: [] } });
    expect(studentScopeWhere(user(Role.PARENT), { guardianStudentIds: [] })).toEqual({ id: { in: [] } });
  });

  it("teachers see only students in sections they teach", () => {
    expect(studentScopeWhere(user(Role.TEACHER), { teacherSectionIds: ["sec1"] })).toEqual({ sectionId: { in: ["sec1"] } });
    expect(studentScopeWhere(user(Role.TEACHER), {})).toEqual({ sectionId: { in: [] } });
  });

  it("students see only themselves; an unlinked student account sees nothing", () => {
    expect(studentScopeWhere(user(Role.STUDENT), { ownStudentId: "s9" })).toEqual({ id: "s9" });
    expect(studentScopeWhere(user(Role.STUDENT), {})).toEqual({ id: "__none__" });
  });

  it("academic settings (terms, grading scale, score components) are changed only by school admins", () => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(can(Role.SCHOOL_ADMIN, "academicSettings", action)).toBe(true);
      for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) {
        expect(can(role, "academicSettings", action), `${role} must not ${action} academicSettings`).toBe(false);
      }
    }
    // Teachers need to read them to enter scores; families get results through their own screens.
    expect(can(Role.TEACHER, "academicSettings", "read")).toBe(true);
    expect(can(Role.PARENT, "academicSettings", "read")).toBe(false);
  });

  it("attendance: admins and teachers take/correct registers, nobody deletes them, families only read", () => {
    for (const role of [Role.SCHOOL_ADMIN, Role.TEACHER]) {
      for (const action of ["create", "read", "update", "export"] as const) expect(can(role, "attendance", action)).toBe(true);
    }
    for (const role of Object.values(Role)) {
      if (role === Role.PLATFORM_ADMIN) continue;
      expect(can(role, "attendance", "delete"), `${role} must not delete attendance`).toBe(false);
    }
    for (const role of [Role.PARENT, Role.STUDENT]) {
      expect(can(role, "attendance", "read")).toBe(true);
      expect(can(role, "attendance", "create")).toBe(false);
      expect(can(role, "attendance", "update")).toBe(false);
    }
    expect(can(Role.ACCOUNTANT, "attendance", "read")).toBe(false);
  });

  it("results: only school admins publish; teachers enter scores; families only read", () => {
    expect(can(Role.SCHOOL_ADMIN, "results", "update")).toBe(true);
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) {
      expect(can(role, "results", "update"), `${role} must not publish results`).toBe(false);
    }
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT]) expect(can(role, "results", "read")).toBe(true);
    expect(can(Role.ACCOUNTANT, "results", "read")).toBe(false);
    for (const role of [Role.SCHOOL_ADMIN, Role.TEACHER]) expect(can(role, "mark", "update")).toBe(true);
    for (const role of [Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) expect(can(role, "mark", "update")).toBe(false);
    for (const role of Object.values(Role)) {
      if (role !== Role.PLATFORM_ADMIN) expect(can(role, "mark", "delete"), `${role} must not delete marks wholesale`).toBe(false);
    }
  });

  it("report cards: admins generate; teachers comment; families only read; nobody deletes", () => {
    expect(can(Role.SCHOOL_ADMIN, "reportCard", "create")).toBe(true);
    expect(can(Role.TEACHER, "reportCard", "create")).toBe(false);
    expect(can(Role.TEACHER, "reportCard", "update")).toBe(true);
    for (const role of [Role.PARENT, Role.STUDENT]) {
      expect(can(role, "reportCard", "read")).toBe(true);
      expect(can(role, "reportCard", "update")).toBe(false);
      expect(can(role, "reportCard", "export")).toBe(false);
    }
    expect(can(Role.ACCOUNTANT, "reportCard", "read")).toBe(false);
    for (const role of Object.values(Role)) {
      if (role !== Role.PLATFORM_ADMIN) expect(can(role, "reportCard", "delete"), `${role} must not delete report cards`).toBe(false);
    }
  });

  it("timetable: only school admins build it; teachers, parents and students read it", () => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(can(Role.SCHOOL_ADMIN, "timetable", action)).toBe(true);
      for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) {
        expect(can(role, "timetable", action), `${role} must not ${action} timetable`).toBe(false);
      }
    }
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT]) expect(can(role, "timetable", "read")).toBe(true);
  });

  it("fee setup (items, schedule, discounts, sign-ups): school admins and accountants only", () => {
    for (const role of [Role.SCHOOL_ADMIN, Role.ACCOUNTANT]) {
      for (const action of ["create", "read", "update", "delete"] as const) expect(can(role, "feeStructure", action)).toBe(true);
    }
    for (const role of [Role.TEACHER, Role.PARENT, Role.STUDENT]) {
      for (const action of ["create", "read", "update", "delete"] as const) {
        expect(can(role, "feeStructure", action), `${role} must not ${action} fee setup`).toBe(false);
      }
    }
    // Finance staff manage fees but still can't touch academics.
    expect(can(Role.ACCOUNTANT, "academicSettings", "read")).toBe(false);
    expect(can(Role.ACCOUNTANT, "classGrade", "update")).toBe(false);
  });

  it("invoices and payments: admins bill and adjust; only the bursar handles money; families only read; nobody deletes a payment", () => {
    for (const role of [Role.SCHOOL_ADMIN, Role.ACCOUNTANT]) {
      for (const action of ["create", "read", "update", "export"] as const) expect(can(role, "invoice", action)).toBe(true);
    }
    // Segregation of duties: the admin sees payments but doesn't record or reverse them.
    expect(can(Role.SCHOOL_ADMIN, "payment", "read")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "payment", "create")).toBe(false);
    expect(can(Role.SCHOOL_ADMIN, "payment", "update")).toBe(false);
    for (const action of ["create", "read", "update", "export", "import"] as const) expect(can(Role.ACCOUNTANT, "payment", action)).toBe(true);
    for (const role of Object.values(Role)) {
      if (role !== Role.PLATFORM_ADMIN) expect(can(role, "payment", "delete"), `${role} must not delete payments`).toBe(false);
    }
    for (const role of [Role.PARENT, Role.STUDENT]) {
      expect(can(role, "invoice", "read")).toBe(true);
      expect(can(role, "invoice", "update")).toBe(false);
      expect(can(role, "payment", "update")).toBe(false);
      expect(can(role, "payment", "import")).toBe(false);
    }
    expect(can(Role.TEACHER, "invoice", "read")).toBe(false);
    expect(can(Role.TEACHER, "payment", "read")).toBe(false);
  });

  it("online payment: parents may start one; students, teachers can't", () => {
    expect(can(Role.PARENT, "payment", "create")).toBe(true);
    expect(can(Role.STUDENT, "payment", "create")).toBe(false);
    expect(can(Role.TEACHER, "payment", "create")).toBe(false);
    // Starting a checkout never lets a parent touch the money afterwards.
    expect(can(Role.PARENT, "payment", "update")).toBe(false);
  });
});


describe("health (Phase 7): minimum necessary access", () => {
  it("the nurse works with every health record; nothing academic or financial", () => {
    for (const a of ["create", "read", "update", "delete"] as const) expect(can(Role.SCHOOL_NURSE, "healthRecord", a)).toBe(true);
    expect(can(Role.SCHOOL_NURSE, "clinicVisit", "create")).toBe(true);
    expect(can(Role.SCHOOL_NURSE, "healthAlert", "create")).toBe(true);
    for (const r of ["mark", "invoice", "payment", "attendance", "message", "user", "auditLog", "healthAccessLog", "healthSettings"] as const) {
      expect(can(Role.SCHOOL_NURSE, r, "read")).toBe(false);
    }
  });

  it("admins: read (full records only with the school's setting, checked in code), the access log and the settings; never edit records", () => {
    expect(can(Role.SCHOOL_ADMIN, "healthRecord", "read")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "healthRecord", "update")).toBe(false);
    expect(can(Role.SCHOOL_ADMIN, "clinicVisit", "create")).toBe(false);
    expect(can(Role.SCHOOL_ADMIN, "healthAccessLog", "read")).toBe(true);
    expect(can(Role.SCHOOL_ADMIN, "healthSettings", "update")).toBe(true);
  });

  it("teachers see alerts only; pupils and bursars see nothing; parents their own child's", () => {
    expect(can(Role.TEACHER, "healthAlert", "read")).toBe(true);
    for (const r of ["healthRecord", "clinicVisit", "healthAccessLog"] as const) expect(can(Role.TEACHER, r, "read")).toBe(false);
    for (const role of [Role.STUDENT, Role.ACCOUNTANT]) {
      for (const r of ["healthRecord", "healthAlert", "clinicVisit", "healthAccessLog", "healthSettings"] as const) expect(can(role, r, "read")).toBe(false);
    }
    expect(can(Role.PARENT, "healthRecord", "update")).toBe(true);
    expect(can(Role.PARENT, "healthAlert", "create")).toBe(false);
    expect(can(Role.PARENT, "clinicVisit", "create")).toBe(false);
  });

  it("nobody may change or delete the access log; the platform team can't open pupils' health data", () => {
    for (const role of Object.values(Role)) for (const a of ["update", "delete"] as const) expect(can(role, "healthAccessLog", a)).toBe(false);
    for (const r of ["healthRecord", "healthAlert", "clinicVisit", "healthAccessLog"] as const) expect(can(Role.PLATFORM_ADMIN, r, "read")).toBe(false);
  });
});
