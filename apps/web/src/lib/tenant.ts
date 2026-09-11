import { cache } from "react";
import { headers } from "next/headers";
import { platformPrisma, type Tenant } from "@educore/db";

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
