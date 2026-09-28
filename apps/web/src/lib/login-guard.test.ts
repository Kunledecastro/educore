import { describe, expect, it } from "vitest";
import { isLoginAllowed, loginHostFromHeaders, type GuardUser } from "./login-guard";

const greenfieldUser: GuardUser = {
  isPlatformAdmin: false,
  tenant: { subdomain: "greenfield", customDomain: "portal.greenfield.edu", status: "ACTIVE" },
};

describe("loginHostFromHeaders", () => {
  it("reads the subdomain set by middleware", () => {
    expect(loginHostFromHeaders(new Headers({ "x-tenant-subdomain": "greenfield" }))).toEqual({
      kind: "subdomain",
      subdomain: "greenfield",
    });
  });
  it("reads a custom domain", () => {
    expect(loginHostFromHeaders(new Headers({ "x-tenant-custom-domain": "portal.greenfield.edu" }))).toEqual({
      kind: "customDomain",
      customDomain: "portal.greenfield.edu",
    });
  });
  it("treats no tenant headers as the root domain", () => {
    expect(loginHostFromHeaders(new Headers())).toEqual({ kind: "root" });
  });
});

describe("isLoginAllowed (cross-tenant login guard)", () => {
  it("allows a school user on their own subdomain", () => {
    expect(isLoginAllowed(greenfieldUser, { kind: "subdomain", subdomain: "greenfield" })).toBe(true);
  });
  it("rejects a school user on ANOTHER school's subdomain", () => {
    expect(isLoginAllowed(greenfieldUser, { kind: "subdomain", subdomain: "riverside" })).toBe(false);
  });
  it("allows their own custom domain and rejects someone else's", () => {
    expect(isLoginAllowed(greenfieldUser, { kind: "customDomain", customDomain: "portal.greenfield.edu" })).toBe(true);
    expect(isLoginAllowed(greenfieldUser, { kind: "customDomain", customDomain: "portal.riverside.edu" })).toBe(false);
  });
  it("rejects a custom-domain login for a tenant with no custom domain", () => {
    const user: GuardUser = { ...greenfieldUser, tenant: { ...greenfieldUser.tenant!, customDomain: null } };
    expect(isLoginAllowed(user, { kind: "customDomain", customDomain: "portal.greenfield.edu" })).toBe(false);
  });
  it("allows school users on the root domain (no wildcard domain yet)", () => {
    expect(isLoginAllowed(greenfieldUser, { kind: "root" })).toBe(true);
  });
  it("rejects users of a suspended school everywhere", () => {
    const user: GuardUser = { ...greenfieldUser, tenant: { ...greenfieldUser.tenant!, status: "SUSPENDED" } };
    expect(isLoginAllowed(user, { kind: "root" })).toBe(false);
    expect(isLoginAllowed(user, { kind: "subdomain", subdomain: "greenfield" })).toBe(false);
  });
  it("rejects a non-platform user with no tenant", () => {
    expect(isLoginAllowed({ isPlatformAdmin: false, tenant: null }, { kind: "root" })).toBe(false);
  });
  it("allows platform admins on any host", () => {
    const admin: GuardUser = { isPlatformAdmin: true, tenant: null };
    expect(isLoginAllowed(admin, { kind: "root" })).toBe(true);
    expect(isLoginAllowed(admin, { kind: "subdomain", subdomain: "greenfield" })).toBe(true);
  });
});
