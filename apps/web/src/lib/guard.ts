import { headers } from "next/headers";
import { forTenant, platformPrisma, Role, type AuditContext, type TenantScopedClient } from "@educore/db";
import { clientIpFromHeaders, userAgentFromHeaders } from "./request-meta";
import { can, type Action, type Resource, type AuthUser } from "@educore/auth";
import type { Impersonation } from "./impersonation";
import { getEffectiveSession } from "./session";
import { getTenantForUser } from "./tenant";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface RequestContext {
  user: AuthUser & { name: string; email: string };
  /**
   * A single client type for both paths. A union of the base PrismaClient and
   * the extended client isn't callable in TypeScript (their generic method
   * signatures don't unify), so every `db.model.findUnique(...)` would fail
   * to type-check. The tenant-scope extension only adds a query hook — it
   * doesn't change any method's shape — so the platform client is safely
   * viewed through the same type.
   */
  db: TenantScopedClient;
  isPlatformAdmin: boolean;
  /** Set while a platform admin is working as this school admin for support (Phase 4.0). */
  impersonation: Impersonation | null;
}

/**
 * Every Route Handler / Server Action that touches tenant data should start
 * with this. It resolves the authenticated session, and hands back a Prisma
 * client that is ALREADY tenant-scoped (`forTenant`) unless the caller is a
 * PLATFORM_ADMIN, in which case it deliberately returns the unscoped client
 * (architecture rule #1's "operates above tenant isolation").
 */
export async function requireUser(): Promise<RequestContext> {
  const session = await getEffectiveSession();
  if (!session) throw new UnauthenticatedError();

  // While impersonating, everything below sees the school admin (tenant-scoped client, their role).
  const { id, role, tenantId, name, email } = session.user;
  const isPlatformAdmin = role === Role.PLATFORM_ADMIN;

  if (!isPlatformAdmin && !tenantId) {
    // Should be unreachable given the schema's nullability rule, but fail
    // closed rather than silently returning an unscoped client.
    throw new ForbiddenError("User has no tenant assigned");
  }

  const db: TenantScopedClient = isPlatformAdmin
    ? (platformPrisma() as unknown as TenantScopedClient)
    : forTenant(tenantId!);

  return {
    user: { id, role, tenantId, name: name ?? "", email: email ?? "" },
    db,
    isPlatformAdmin,
    impersonation: session.impersonation,
  };
}

/** Throws unless the current user's role is allowed `action` on `resource`. */
export async function requirePermission(resource: Resource, action: Action): Promise<RequestContext> {
  const ctx = await requireUser();
  if (!can(ctx.user.role, resource, action)) {
    throw new ForbiddenError(`Role ${ctx.user.role} may not ${action} ${resource}`);
  }
  return ctx;
}

/** Throws unless the current user's role is one of `roles`. */
export async function requireRole(...roles: Role[]): Promise<RequestContext> {
  const ctx = await requireUser();
  if (!roles.includes(ctx.user.role)) {
    throw new ForbiddenError(`Requires one of: ${roles.join(", ")}`);
  }
  return ctx;
}

/**
 * Confirms the signed-in user belongs to the tenant the request arrived on
 * (by subdomain/custom domain). PLATFORM_ADMIN is exempt — they operate
 * across tenants by design. Call this from pages/layouts that render
 * tenant-branded UI, to stop a valid session from one school rendering
 * another school's subdomain.
 */
export async function requireMatchingTenant(): Promise<RequestContext> {
  const ctx = await requireUser();
  if (ctx.isPlatformAdmin) return ctx;

  const { mismatch } = await getTenantForUser(ctx.user.tenantId ?? null);
  if (mismatch) {
    throw new ForbiddenError("Session does not belong to this school's portal");
  }
  return ctx;
}

/**
 * Who/where for audit entries on this request (architecture rule #3):
 * actor, tenant, IP and user agent. `tenantId` defaults to the user's own
 * school; platform admins acting on a school must pass that school's id.
 */
export function auditContextFor(ctx: RequestContext, tenantId: string | null = ctx.user.tenantId ?? null): AuditContext {
  if (!tenantId) throw new ForbiddenError("An audited change needs a school (tenant) context");
  const h = headers();
  return {
    tenantId,
    actorId: ctx.user.id,
    ipAddress: clientIpFromHeaders(h),
    userAgent: userAgentFromHeaders(h),
    impersonatorId: ctx.impersonation?.platformAdminId ?? null,
  };
}

/** Some things support must never do while working as a school admin (credentials, billing). */
export function forbidWhileImpersonating(ctx: RequestContext) {
  if (ctx.impersonation) throw new ForbiddenError("Not allowed while signed in as a school admin for support");
}
