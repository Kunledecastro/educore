import "server-only";
import { cache } from "react";
import { loadEntitlements } from "./entitlements-data";

/** A school's entitlements, loaded once per request. */
export const getEntitlements = cache((tenantId: string) => loadEntitlements(tenantId));
