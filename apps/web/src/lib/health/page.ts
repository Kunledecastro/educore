import "server-only";
import { auditContextFor, requirePermission } from "@/lib/guard";
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
