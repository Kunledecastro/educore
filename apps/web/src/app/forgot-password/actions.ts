"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { appUrl } from "@/lib/inngest/notify-message";
import { anyChannelEnabled, CHANNELS, passwordResetEmail } from "@/lib/notify/channels";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/request-meta";
import { createResetToken, ResetError, RESET_MINUTES, resetPassword } from "@/lib/security/password-reset";
import { newPasswordSchema } from "@/lib/validation/people";

async function allow(key: string, limit: number, windowMs: number) {
  try {
    return (await getRateLimiter().hit(key, limit, windowMs)).allowed;
  } catch {
    return true;
  }
}

/**
 * Step 1: email me a link. The answer is the same whether or not the
 * account exists, so this can't be used to find out who has an account.
 */
export async function requestResetAction(input: unknown): Promise<ActionResult<{ sent: true }>> {
  const t = await getTranslations("passwordReset");
  if (!anyChannelEnabled()) return fail(t("emailOff"));
  const parsed = z.object({ email: z.string().trim().email().max(200) }).safeParse(input);
  if (!parsed.success) return fail(t("badEmail"), { email: t("badEmail") });
  const ip = clientIpFromHeaders(headers());
  const email = parsed.data.email.toLowerCase();
  if (!(await allow(`pwreset:ip:${ip ?? "unknown"}`, 10, 15 * 60_000)) || !(await allow(`pwreset:email:${email}`, 3, 60 * 60_000))) {
    return fail(t("tooMany"));
  }
  try {
    const r = await createResetToken(email, ip);
    if (r.token && r.to) {
      const link = `${appUrl()}/reset-password?token=${encodeURIComponent(r.token)}`;
      for (const c of CHANNELS.filter((x) => x.enabled())) await c.send(passwordResetEmail({ recipient: r.to, link, minutes: RESET_MINUTES }));
    }
  } catch (err) {
    console.error("[password-reset] could not send", err); // never revealed to the person asking
  }
  return ok({ sent: true });
}

/** Step 2: choose a new password with the link. */
export async function resetPasswordAction(input: unknown): Promise<ActionResult<void>> {
  const t = await getTranslations("passwordReset");
  const tv = await getTranslations();
  const h = headers();
  const ip = clientIpFromHeaders(h);
  if (!(await allow(`pwreset:set:${ip ?? "unknown"}`, 20, 15 * 60_000))) return fail(t("tooMany"));
  const token = z.object({ token: z.string().min(10).max(100) }).safeParse(input);
  if (!token.success) return fail(t("invalid"));
  const parsed = newPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(Object.entries(zodFieldErrors(parsed.error)).map(([k, v]) => [k, v.startsWith("validation.") ? tv(v as never) : v]));
    return fail(t("fixErrors"), fieldErrors);
  }
  try {
    await resetPassword(token.data.token, parsed.data.password, { ipAddress: ip, userAgent: userAgentFromHeaders(h) });
    return ok();
  } catch (err) {
    if (err instanceof ResetError) return fail(t(err.code));
    throw err;
  }
}
