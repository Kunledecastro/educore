"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/request-meta";
import { getEffectiveSession } from "@/lib/session";
import { setOwnPassword } from "@/lib/student-logins-data";
import { newPasswordSchema } from "@/lib/validation/people";

/** A student chooses their own password (required after a printed one-time password). */
export async function changeOwnPasswordAction(input: unknown): Promise<ActionResult<void>> {
  const t = await getTranslations("changePassword");
  const tv = await getTranslations();
  const session = await getEffectiveSession();
  if (!session || session.impersonation || session.user.role !== Role.STUDENT) return fail(t("notAllowed"));
  const h = headers();
  const ip = clientIpFromHeaders(h);
  const limit = await getRateLimiter()
    .hit(`pwchange:${session.user.id}`, 10, 15 * 60_000)
    .catch(() => ({ allowed: true }));
  if (!limit.allowed) return fail(t("tooMany"));
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(Object.entries(zodFieldErrors(parsed.error)).map(([k, v]) => [k, v.startsWith("validation.") ? tv(v as never) : v]));
    return fail(t("fixErrors"), fieldErrors);
  }
  await setOwnPassword(session.user.id, parsed.data.password, { ipAddress: ip, userAgent: userAgentFromHeaders(h) });
  return ok();
}
