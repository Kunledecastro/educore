import "server-only";
import { prisma } from "@educore/db";
import { hashInviteToken, looksLikeInviteToken, userIdFromIdentifier } from "./invite-token";

/**
 * Looks up a pending invite by its raw token. Uses the base client: the
 * invitee isn't signed in yet, and verification_tokens is a platform table.
 * Returns null for anything invalid, expired, used, or for an account that
 * already has a password or was deactivated — the caller shows one generic
 * "this link doesn't work" message for all of them.
 */
export async function findPendingInvite(token: string) {
  if (!looksLikeInviteToken(token)) return null;
  const tokenHash = hashInviteToken(token);
  const row = await prisma.verificationToken.findUnique({ where: { token: tokenHash } });
  if (!row || row.expires <= new Date()) return null;
  const userId = userIdFromIdentifier(row.identifier);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, tenantId: true, isActive: true, passwordHash: true, tenant: { select: { name: true, status: true } } },
  });
  if (!user || !user.isActive || user.passwordHash || !user.tenantId || user.tenant?.status !== "ACTIVE") return null;
  return { tokenHash, user };
}
