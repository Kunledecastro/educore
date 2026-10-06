"use server";

import { cookies, headers } from "next/headers";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { unstable_update } from "@/lib/auth";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/request-meta";
import { REMEMBER_DAYS } from "@/lib/security/secrets";
import { REMEMBER_COOKIE, rememberCookieValue, upgradeProof } from "@/lib/security/session-state";
import { confirmSetup, disableOwn, regenerateBackupCodes, securityState, startSetup, TwoFactorError, verifySecondFactor } from "@/lib/security/two-factor";
import { getSignInStage } from "@/lib/session";

/**
 * Two-factor sign-in (Phase 6.0): the code step after the password, set-up,
 * and managing it from Account → Security. These run for a person who may
 * not be fully signed in yet, so each checks the sign-in stage itself.
 */

function meta() {
  const h = headers();
  return { ipAddress: clientIpFromHeaders(h), userAgent: userAgentFromHeaders(h) };
}

async function message(err: unknown): Promise<ActionResult<never>> {
  const t = await getTranslations("twoFactor.errors");
  if (err instanceof TwoFactorError) return fail(t(err.code));
  console.error("[two-factor] failed", err);
  return fail(t("generic"));
}

/** At most 8 code attempts per account per 15 minutes. */
async function allowAttempt(userId: string): Promise<boolean> {
  try {
    return (await getRateLimiter().hit(`2fa:${userId}`, 8, 15 * 60_000)).allowed;
  } catch {
    return true;
  }
}

/** Upgrades this browser's session after a correct code (and picks up a new session version). */
async function upgrade(userId: string, sid: string) {
  await unstable_update({ mfaProof: upgradeProof(userId, sid) } as never);
}

export async function verifyCodeAction(input: { code: string; remember: boolean }): Promise<ActionResult<{ backupLeft: number; method: "app" | "backup" }>> {
  const s = await getSignInStage();
  if (!s || s.stage !== "verify") return fail((await getTranslations("twoFactor.errors"))("expired"));
  if (!(await allowAttempt(s.userId))) return fail((await getTranslations("twoFactor.errors"))("tooMany"));
  try {
    const r = await verifySecondFactor(s.userId, String(input.code ?? "").slice(0, 40));
    if (input.remember) {
      const state = await securityState(s.userId);
      cookies().set(REMEMBER_COOKIE, rememberCookieValue(s.userId, state!.twoFactorVersion, REMEMBER_DAYS), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: REMEMBER_DAYS * 86400,
      });
    }
    await upgrade(s.userId, s.sid);
    return ok(r);
  } catch (err) {
    return message(err);
  }
}

/** Set-up step 1: a new key, as a QR code (drawn here — the key never goes to another service) and as text. */
export async function startSetupAction(): Promise<ActionResult<{ secret: string; qrSvg: string }>> {
  const s = await getSignInStage();
  if (!s || s.stage === "verify") return fail((await getTranslations("twoFactor.errors"))("expired"));
  try {
    const { secret, uri } = await startSetup(s.userId);
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return ok({ secret, qrSvg });
  } catch (err) {
    return message(err);
  }
}

/** Set-up step 2: the first code turns it on; backup codes are shown once. */
export async function confirmSetupAction(input: { code: string }): Promise<ActionResult<{ backupCodes: string[] }>> {
  const s = await getSignInStage();
  if (!s || s.stage === "verify") return fail((await getTranslations("twoFactor.errors"))("expired"));
  if (!(await allowAttempt(s.userId))) return fail((await getTranslations("twoFactor.errors"))("tooMany"));
  try {
    const r = await confirmSetup(s.userId, String(input.code ?? "").slice(0, 12), meta());
    await upgrade(s.userId, s.sid); // other sessions end; this one carries on
    return ok({ backupCodes: r.backupCodes });
  } catch (err) {
    return message(err);
  }
}

export async function regenerateCodesAction(input: { code: string }): Promise<ActionResult<{ backupCodes: string[] }>> {
  const s = await getSignInStage();
  if (!s || s.stage !== "ok") return fail((await getTranslations("twoFactor.errors"))("expired"));
  if (!(await allowAttempt(s.userId))) return fail((await getTranslations("twoFactor.errors"))("tooMany"));
  try {
    return ok({ backupCodes: await regenerateBackupCodes(s.userId, String(input.code ?? "").slice(0, 40), meta()) });
  } catch (err) {
    return message(err);
  }
}

export async function disableAction(input: { code: string }): Promise<ActionResult<void>> {
  const s = await getSignInStage();
  if (!s || s.stage !== "ok") return fail((await getTranslations("twoFactor.errors"))("expired"));
  if (!(await allowAttempt(s.userId))) return fail((await getTranslations("twoFactor.errors"))("tooMany"));
  try {
    await disableOwn(s.userId, String(input.code ?? "").slice(0, 40), meta());
    cookies().delete(REMEMBER_COOKIE);
    await upgrade(s.userId, s.sid);
    return ok();
  } catch (err) {
    return message(err);
  }
}
