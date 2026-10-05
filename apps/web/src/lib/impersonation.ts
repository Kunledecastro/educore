import "server-only";
import { platformPrisma, recordAudit, recordPlatformAudit, Role } from "@educore/db";
import { IMPERSONATION_MINUTES, signImpersonationToken, verifyImpersonationToken } from "./impersonation-token";

/**
 * Support impersonation (Phase 4.0): a platform admin works as one of a
 * school's admins for a limited time.
 *
 * - Only a platform admin can start it, only as an ACTIVE SCHOOL_ADMIN of an
 *   ACTIVE school, with a written reason; 30 minutes, then it simply stops.
 * - The signed cookie points at an impersonation_sessions row; the row must
 *   be open, unexpired and belong to the same platform admin on every request.
 * - Logged twice: in the platform audit log, and in the SCHOOL's own audit log
 *   ("EduCore support signed in"), so the school can see it happened. Every
 *   change made meanwhile carries impersonatorId in the school's audit log.
 */

export interface Impersonation {
  sessionId: string;
  platformAdminId: string;
  platformAdminName: string;
  expiresAt: Date;
  target: { id: string; role: Role; tenantId: string; name: string; email: string; tenantName: string };
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

/** The live impersonation for this platform admin, if the cookie and the row agree. */
export async function resolveImpersonation(platformAdminId: string, cookie: string | undefined, now: Date = new Date()): Promise<Impersonation | null> {
  const sessionId = verifyImpersonationToken(cookie, secret(), now);
  if (!sessionId) return null;
  const row = await platformPrisma().impersonationSession.findFirst({
    where: { id: sessionId, platformAdminId, endedAt: null, expiresAt: { gt: now } },
    include: {
      platformAdmin: { select: { name: true, role: true } },
      targetUser: { select: { id: true, role: true, tenantId: true, name: true, email: true, isActive: true, tenant: { select: { name: true, status: true } } } },
    },
  });
  const t = row?.targetUser;
  if (!row || row.platformAdmin.role !== Role.PLATFORM_ADMIN || !t || !t.isActive || t.role !== Role.SCHOOL_ADMIN || t.tenantId !== row.tenantId || t.tenant?.status !== "ACTIVE") return null;
  return {
    sessionId: row.id,
    platformAdminId,
    platformAdminName: row.platformAdmin.name,
    expiresAt: row.expiresAt,
    target: { id: t.id, role: t.role, tenantId: t.tenantId!, name: t.name, email: t.email, tenantName: t.tenant!.name },
  };
}

export class ImpersonationError extends Error {
  constructor(public readonly code: "notSchoolAdmin" | "schoolNotActive" | "notFound") {
    super(code);
    this.name = "ImpersonationError";
  }
}

/** Opens a session and returns the cookie value. Caller has checked the actor is a platform admin. */
export async function startImpersonation(
  actor: { id: string; ipAddress: string | null; userAgent: string | null },
  targetUserId: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ cookie: string; expiresAt: Date; tenantId: string }> {
  const db = platformPrisma();
  const target = await db.user.findUnique({ where: { id: targetUserId }, include: { tenant: { select: { id: true, status: true } } } });
  if (!target || !target.tenant) throw new ImpersonationError("notFound");
  if (target.role !== Role.SCHOOL_ADMIN || !target.isActive) throw new ImpersonationError("notSchoolAdmin");
  if (target.tenant.status !== "ACTIVE") throw new ImpersonationError("schoolNotActive");
  const expiresAt = new Date(now.getTime() + IMPERSONATION_MINUTES * 60_000);
  const session = await db.$transaction(async (tx) => {
    // One live impersonation per platform admin.
    await tx.impersonationSession.updateMany({ where: { platformAdminId: actor.id, endedAt: null }, data: { endedAt: now } });
    const s = await tx.impersonationSession.create({
      data: { platformAdminId: actor.id, targetUserId: target.id, tenantId: target.tenant!.id, reason, startedAt: now, expiresAt, ipAddress: actor.ipAddress },
    });
    const summary = { sessionId: s.id, targetUserId: target.id, targetEmail: target.email, reason, expiresAt };
    await recordPlatformAudit({ actorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "IMPERSONATION_START", tenantId: target.tenant!.id, entityType: "ImpersonationSession", entityId: s.id, after: summary }, tx);
    await recordAudit(
      { tenantId: target.tenant!.id, actorId: target.id, impersonatorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent },
      { action: "CREATE", entityType: "SupportSession", entityId: s.id, after: { reason, expiresAt } },
      tx,
    );
    return s;
  });
  return { cookie: signImpersonationToken(session.id, expiresAt, secret()), expiresAt, tenantId: target.tenant.id };
}

/** Ends this platform admin's open impersonation (if any). */
export async function stopImpersonation(actor: { id: string; ipAddress: string | null; userAgent: string | null }, now: Date = new Date()) {
  const db = platformPrisma();
  const open = await db.impersonationSession.findMany({ where: { platformAdminId: actor.id, endedAt: null } });
  for (const s of open) {
    await db.$transaction(async (tx) => {
      const ended = await tx.impersonationSession.update({ where: { id: s.id }, data: { endedAt: now < s.expiresAt ? now : s.expiresAt } });
      await recordPlatformAudit({ actorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent }, { action: "IMPERSONATION_END", tenantId: s.tenantId, entityType: "ImpersonationSession", entityId: s.id, before: s, after: ended }, tx);
      await recordAudit(
        { tenantId: s.tenantId, actorId: s.targetUserId, impersonatorId: actor.id, ipAddress: actor.ipAddress, userAgent: actor.userAgent },
        { action: "UPDATE", entityType: "SupportSession", entityId: s.id, after: { endedAt: ended.endedAt } },
        tx,
      );
    });
  }
  return open.length;
}
