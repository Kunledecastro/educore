"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { hashPassword } from "@educore/auth";
import { prisma, recordAudit, withRls } from "@educore/db";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { findPendingInvite } from "@/lib/invites";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/request-meta";
import { newPasswordSchema } from "@/lib/validation/people";

/**
 * Sets the invitee's password. Public (the person isn't signed in), so:
 * rate-limited per IP, the token is claimed with an atomic single-use delete,
 * and the password write happens inside the invitee's own school's RLS
 * transaction with an audit entry (actor = the invitee).
 */
export async function acceptInvite(token: string, input: unknown): Promise<ActionResult<void>> {
  const t = await getTranslations("invitePage");
  const tv = await getTranslations();
  const h = headers();
  const ip = clientIpFromHeaders(h);

  const limit = await getRateLimiter()
    .hit(`invite:${ip ?? "unknown-ip"}`, 10, 15 * 60_000)
    .catch(() => ({ allowed: true }));
  if (!limit.allowed) return fail(t("tooManyAttempts"));

  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      Object.entries(zodFieldErrors(parsed.error)).map(([k, v]) => [k, v.startsWith("validation.") ? tv(v as never) : v]),
    );
    return fail(t("fixErrors"), fieldErrors);
  }

  const invite = await findPendingInvite(token);
  if (!invite) return fail(t("invalidLink"));

  // Claim the token: exactly one request can succeed.
  const claimed = await prisma.verificationToken.deleteMany({
    where: { token: invite.tokenHash, expires: { gt: new Date() } },
  });
  if (claimed.count !== 1) return fail(t("invalidLink"));

  const passwordHash = await hashPassword(parsed.data.password);
  const tenantId = invite.user.tenantId!;
  await withRls(tenantId, async (tx) => {
    await tx.user.update({ where: { id: invite.user.id }, data: { passwordHash, emailVerified: new Date() } });
    await recordAudit(
      { tenantId, actorId: invite.user.id, ipAddress: ip, userAgent: userAgentFromHeaders(h) },
      { action: "UPDATE", entityType: "User", entityId: invite.user.id, after: { invite: "accepted", password: "set" } },
      tx,
    );
  });
  return ok();
}
