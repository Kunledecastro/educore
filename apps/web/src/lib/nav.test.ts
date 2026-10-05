import { describe, expect, it } from "vitest";
import { Role } from "@educore/db";
import { DEFAULT_PLANS } from "./entitlements";
import { getNavItemsForRole } from "./nav";

const hrefs = (role: Role, plan?: keyof typeof DEFAULT_PLANS) =>
  getNavItemsForRole(role, plan ? new Set(DEFAULT_PLANS[plan].modules) : null).map((i) => i.href);

describe("navigation follows the plan (4.1)", () => {
  it("hides modules the school's plan doesn't include", () => {
    const starter = hrefs(Role.SCHOOL_ADMIN, "STARTER");
    expect(starter).not.toContain("/fees");
    expect(starter).not.toContain("/payments");
    expect(starter).not.toContain("/report-cards");
    expect(starter).toContain("/attendance");
    expect(starter).toContain("/students");
    expect(starter).toContain("/plan");
  });

  it("shows everything on Premium, and to platform admins nothing school-level", () => {
    expect(hrefs(Role.SCHOOL_ADMIN, "PREMIUM")).toEqual(hrefs(Role.SCHOOL_ADMIN));
    expect(hrefs(Role.PLATFORM_ADMIN)).toEqual(["/dashboard", "/platform/tenants", "/platform/plans", "/platform/audit"]);
  });

  it("only school admins get the plan page in their menu", () => {
    for (const r of [Role.TEACHER, Role.PARENT, Role.STUDENT, Role.ACCOUNTANT]) expect(hrefs(r)).not.toContain("/plan");
  });
});
