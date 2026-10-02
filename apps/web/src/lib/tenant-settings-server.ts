import "server-only";
import { withRls } from "@educore/db";
import { parseTenantSettings, type TenantSettings } from "./tenant-settings";

/**
 * A school's settings by id, for code that runs outside a request
 * (background jobs, webhooks). Reads the tenant row under that school's RLS.
 */
export async function getTenantSettingsById(tenantId: string): Promise<TenantSettings> {
  const tenant = await withRls(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }));
  return parseTenantSettings(tenant?.settings);
}
