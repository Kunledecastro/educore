import { cache } from "react";
import { headers } from "next/headers";
import { platformPrisma, type Tenant } from "@educore/db";
import { parseTenantSettings, type TenantSettings } from "./tenant-settings";

/**
 * Resolves the current request's Tenant row from the subdomain/custom-domain
 * headers set by middleware.ts. Wrapped in React's `cache()` so multiple
 * Server Components rendering the same request share one DB round trip.
 */
export const getCurrentTenant = cache(async (): Promise<Tenant | null> => {
  const h = headers();
  const subdomain = h.get("x-tenant-subdomain");
  const customDomain = h.get("x-tenant-custom-domain");

  const db = platformPrisma();

  if (subdomain) {
    return db.tenant.findUnique({ where: { subdomain } });
  }
  if (customDomain) {
    return db.tenant.findUnique({ where: { customDomain } });
  }
  return null;
});

/**
 * The tenant a signed-in user is working in for this request.
 *
 * - On a school's subdomain / custom domain: that school, and it must be the
 *   user's own (otherwise `mismatch` is true and the caller should reject).
 * - On the root domain (no wildcard domain yet): the user's own tenant, from
 *   their session. Same rule as the login guard in login-guard.ts.
 * - A suspended school counts as a mismatch, so existing sessions stop
 *   working as soon as a school is suspended.
 */
export const getTenantForUser = cache(
  async (userTenantId: string | null): Promise<{ tenant: Tenant | null; mismatch: boolean }> => {
    const h = headers();
    const onTenantHost = Boolean(h.get("x-tenant-subdomain") || h.get("x-tenant-custom-domain"));

    if (onTenantHost) {
      const tenant = await getCurrentTenant();
      return { tenant, mismatch: !tenant || tenant.id !== userTenantId || tenant.status !== "ACTIVE" };
    }

    if (!userTenantId) return { tenant: null, mismatch: true };
    const tenant = await platformPrisma().tenant.findUnique({ where: { id: userTenantId } });
    return { tenant, mismatch: !tenant || tenant.status !== "ACTIVE" };
  },
);

/**
 * Formatting/behaviour settings for the signed-in user's school, with safe
 * defaults (platform admins and unknown tenants get the defaults).
 */
export const getSettingsForUser = cache(async (userTenantId: string | null): Promise<TenantSettings> => {
  if (!userTenantId) return parseTenantSettings(null);
  const { tenant } = await getTenantForUser(userTenantId);
  return parseTenantSettings(tenant?.settings);
});
