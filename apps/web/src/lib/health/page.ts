import "server-only";
import { can } from "@educore/auth";
import { auditContextFor, requirePermission, type RequestContext } from "@/lib/guard";
import { getEntitlements } from "@/lib/entitlements-server";
import type { BadgeAlert } from "@/components/health/alert-badge";
import { alertsFor } from "./alerts";
import { healthConfigured, healthViewer } from "./data";

/**
 * Shared start for every health page: the permission check (the matrix),
 * the health viewer (pupil relationships, the school's setting, support
 * sign-ins) and the request details used for the access log.
 */
export async function healthPage(action: "read" | "update" = "read") {
  const ctx = await requirePermission("healthRecord", action, { page: true });
  const a = auditContextFor(ctx);
  const viewer = await healthViewer(a.tenantId, { id: ctx.user.id, role: ctx.user.role }, { impersonating: Boolean(ctx.impersonation) });
  return { ctx, viewer, meta: { ipAddress: a.ipAddress ?? null, userAgent: a.userAgent ?? null }, configured: healthConfigured() };
}

/**
 * Health-alert badges for pupils shown on another page (registers,
 * gradebooks, class lists). Empty — never an error — when the role can't
 * see alerts, the plan lacks the health module, or health isn't set up.
 */
export async function alertBadges(ctx: RequestContext, studentIds: readonly string[]): Promise<Record<string, BadgeAlert[]>> {
  const tenantId = ctx.user.tenantId;
  if (!tenantId || ctx.isPlatformAdmin || ctx.impersonation || studentIds.length === 0) return {};
  if (!can(ctx.user.role, "healthAlert", "read") || !healthConfigured()) return {};
  if (!(await getEntitlements(tenantId)).modules.has("health")) return {};
  try {
    const viewer = await healthViewer(tenantId, { id: ctx.user.id, role: ctx.user.role });
    const map = await alertsFor(viewer, studentIds);
    return Object.fromEntries(Object.entries(map).map(([id, list]) => [id, list.map((a) => ({ category: a.category, severity: a.severity, text: a.text }))]));
  } catch (err) {
    console.error("[health] alert badges unavailable", err);
    return {};
  }
}
