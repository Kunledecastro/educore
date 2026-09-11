import { forTenant, platformPrisma, Role, type TenantScopedClient, type PrismaClient } from "@educore/db";
import { can, type Action, type Resource, type AuthUser } from "@educore/auth";
import { auth } from "./auth";
import { getCurrentTenant } from "./tenant";

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
  db: TenantScopedClient | PrismaClient;
  isPlatformAdmin: boolean;
}

/**
 * Every Route Handler / Server Action that touches tenant data should start
 * with this. It resolves the authenticated session, and hands back a Prisma
 * client that is ALREADY tenant-scoped (`forTenant`) unless the caller is a
 * PLATFORM_ADMIN, in which case it deliberately returns the unscoped client
 * (architecture rule #1's "operates above tenant isolation").
 */
export async function requireUser(): Promise<RequestContext> {
  const session = await auth();
  if (!session?.user) throw new UnauthenticatedError();

  const { id, role, tenantId, name, email } = session.user;
  const isPlatformAdmin = role === Role.PLATFORM_ADMIN;

  if (!isPlatformAdmin && !tenantId) {
    // Should be unreachable given the schema's nullability rule, but fail
    // closed rather than silently returning an unscoped client.
    throw new ForbiddenError("User has no tenant assigned");
  }

  const db = isPlatformAdmin ? platformPrisma() : forTenant(tenantId!);

  return {
    user: { id, role, tenantId, name: name ?? "", email: email ?? "" },
    db,
    isPlatformAdmin,
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

  const tenant = await getCurrentTenant();
  if (!tenant || tenant.id !== ctx.user.tenantId) {
    throw new ForbiddenError("Session does not belong to this school's portal");
  }
  return ctx;
}
