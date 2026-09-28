import "server-only";
import { prisma } from "@educore/db";
import { inviteIdentifier, inviteStatus, type InviteStatus } from "./invite-token";

/**
 * Sign-in status for a page of people, in one query. Reads invite tokens
 * with the base client (platform table); the user ids passed in already come
 * from a tenant-scoped query, so this never reveals another school's data.
 */
export async function inviteStatusesFor(
  users: { id: string; isActive: boolean; passwordHash: string | null }[],
): Promise<Map<string, InviteStatus>> {
  const tokens = users.length
    ? await prisma.verificationToken.findMany({
        where: { identifier: { in: users.map((u) => inviteIdentifier(u.id)) } },
        select: { identifier: true, expires: true },
      })
    : [];
  const latest = new Map<string, Date>();
  for (const t of tokens) {
    const prev = latest.get(t.identifier);
    if (!prev || t.expires > prev) latest.set(t.identifier, t.expires);
  }
  return new Map(
    users.map((u) => [
      u.id,
      inviteStatus({ isActive: u.isActive, hasPassword: Boolean(u.passwordHash) }, latest.get(inviteIdentifier(u.id)) ?? null),
    ]),
  );
}
