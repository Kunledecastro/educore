import { hashPassword } from "@educore/auth";
import { platformPrisma, Prisma, recordAudit, recordPlatformAudit } from "@educore/db";
import { DEFAULT_TENANT_SETTINGS } from "./tenant-settings";

/**
 * Self-serve school sign-up (Phase 4.3): one transaction creates the school
 * (on the 30-day free trial) and its first school admin, and records both in
 * the school's audit log and the platform log. No request APIs here — the
 * server action does rate limiting and reads the request.
 */

/** Rate limits for the public sign-up form (per IP, and platform-wide). */
export const SIGNUP_LIMITS = {
  perIpHour: { limit: 5, windowMs: 60 * 60_000 },
  perIpDay: { limit: 10, windowMs: 24 * 60 * 60_000 },
  /** Platform-wide brake on a scripted flood. */
  globalHour: { limit: 200, windowMs: 60 * 60_000 },
  slugChecksPerIp: { limit: 60, windowMs: 10 * 60_000 },
} as const;

export type SignupErrorCode = "slugTaken" | "emailTaken";

export class SignupError extends Error {
  constructor(public readonly code: SignupErrorCode) {
    super(code);
    this.name = "SignupError";
  }
}

export interface NewSchool {
  schoolName: string;
  slug: string;
  adminName: string;
  email: string;
  password: string;
}

export async function createSchool(input: NewSchool, meta: { ipAddress: string | null; userAgent: string | null }) {
  const db = platformPrisma();
  const email = input.email.trim().toLowerCase();
  const slug = input.slug.trim().toLowerCase();
  // Fast, friendly checks first; the unique indexes are what really decide.
  const [slugUsed, emailUsed] = await Promise.all([
    db.tenant.findFirst({ where: { OR: [{ slug }, { subdomain: slug }] }, select: { id: true } }),
    db.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (slugUsed) throw new SignupError("slugTaken");
  if (emailUsed) throw new SignupError("emailTaken");

  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.schoolName.trim(),
          slug,
          subdomain: slug,
          plan: "FREE_TRIAL",
          status: "ACTIVE",
          settings: { ...DEFAULT_TENANT_SETTINGS },
          branding: {},
        },
      });
      const admin = await tx.user.create({
        data: { tenantId: tenant.id, email, name: input.adminName.trim(), role: "SCHOOL_ADMIN", passwordHash, isActive: true },
        select: { id: true, email: true, name: true, role: true },
      });
      const ctx = { tenantId: tenant.id, actorId: admin.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent };
      await recordAudit(ctx, { action: "CREATE", entityType: "Tenant", entityId: tenant.id, after: { name: tenant.name, slug, plan: tenant.plan, via: "signup" } }, tx);
      await recordAudit(ctx, { action: "CREATE", entityType: "User", entityId: admin.id, after: admin }, tx);
      await recordPlatformAudit(
        { actorId: admin.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
        { action: "TENANT_SIGNUP", tenantId: tenant.id, entityType: "Tenant", entityId: tenant.id, after: { name: tenant.name, slug, adminEmail: email } },
        tx,
      );
      return { tenantId: tenant.id, userId: admin.id };
    });
  } catch (err) {
    // Two sign-ups racing for the same short name or email: the database decides.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = String(err.meta?.target ?? "");
      throw new SignupError(target.includes("email") ? "emailTaken" : "slugTaken");
    }
    throw err;
  }
}

/** Is this short name free? (Format and reserved names are checked by the caller.) */
export async function slugAvailable(slug: string): Promise<boolean> {
  return !(await platformPrisma().tenant.findFirst({ where: { OR: [{ slug }, { subdomain: slug }] }, select: { id: true } }));
}
