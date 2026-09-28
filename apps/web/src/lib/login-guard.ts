/**
 * Cross-tenant login guard (architecture rule #1).
 *
 * Which school a sign-in is for is derived ONLY from the request's host,
 * via the headers middleware.ts sets — never from anything the browser
 * posts. (It previously came from a client-sent `subdomain` field, which
 * (a) a caller could simply omit to bypass the guard, and (b) broke every
 * login on the root domain, because next-auth serialised the unset field
 * as the literal string "undefined".)
 */

export type LoginHost =
  | { kind: "root" }
  | { kind: "subdomain"; subdomain: string }
  | { kind: "customDomain"; customDomain: string };

export function loginHostFromHeaders(headers: Headers): LoginHost {
  const subdomain = headers.get("x-tenant-subdomain");
  if (subdomain) return { kind: "subdomain", subdomain };
  const customDomain = headers.get("x-tenant-custom-domain");
  if (customDomain) return { kind: "customDomain", customDomain };
  return { kind: "root" };
}

export type GuardUser = {
  isPlatformAdmin: boolean;
  tenant: { subdomain: string; customDomain: string | null; status: string } | null;
};

export function isLoginAllowed(user: GuardUser, host: LoginHost): boolean {
  // Platform admins operate above tenant isolation.
  if (user.isPlatformAdmin) return true;

  if (!user.tenant || user.tenant.status !== "ACTIVE") return false;

  switch (host.kind) {
    case "subdomain":
      return user.tenant.subdomain === host.subdomain;
    case "customDomain":
      return user.tenant.customDomain !== null && user.tenant.customDomain === host.customDomain;
    case "root":
      // ASSUMPTION: until the wildcard custom domain is live, school users
      // sign in on the root domain and are placed in their own tenant from
      // their account. Tenant data access is still scoped by the session's
      // tenantId (forTenant()), so this never grants cross-tenant reads.
      return true;
  }
}
