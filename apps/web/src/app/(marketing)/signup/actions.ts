"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/action-result";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders, userAgentFromHeaders } from "@/lib/request-meta";
import { createSchool, SIGNUP_LIMITS, SignupError, slugAvailable } from "@/lib/signup";
import { slugProblem } from "@/lib/slugs";
import { signupSchema } from "@/lib/validation/signup";

/**
 * Public sign-up (Phase 4.3). Nobody is signed in, so every call is rate
 * limited by IP (and sign-ups platform-wide), a hidden honeypot field catches
 * simple bots, and the school + admin are created in one transaction. The
 * browser then signs in with the password it just chose.
 */


async function allowed(keys: [string, { limit: number; windowMs: number }][]): Promise<boolean> {
  try {
    const rl = getRateLimiter();
    const results = await Promise.all(keys.map(([k, l]) => rl.hit(k, l.limit, l.windowMs)));
    return results.every((r) => r.allowed);
  } catch (err) {
    console.error("[signup] rate limiter unavailable, allowing", err);
    return true;
  }
}

export async function signupAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  const t = await getTranslations("signup.errors");
  const tv = await getTranslations();
  const h = headers();
  const ip = clientIpFromHeaders(h) ?? "unknown-ip";

  const okToTry = await allowed([
    [`signup:ip:h:${ip}`, SIGNUP_LIMITS.perIpHour],
    [`signup:ip:d:${ip}`, SIGNUP_LIMITS.perIpDay],
    ["signup:all", SIGNUP_LIMITS.globalHour],
  ]);
  if (!okToTry) return fail(t("tooMany"));

  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      Object.entries(zodFieldErrors(parsed.error)).map(([k, v]) => [k, v.startsWith("validation.") ? tv(v as never) : v]),
    );
    return fail(t("fixErrors"), fieldErrors);
  }
  // A bot filled the field people can't see: look successful, create nothing.
  if (parsed.data.website) return fail(t("tryAgain"));

  try {
    await createSchool(parsed.data, { ipAddress: clientIpFromHeaders(h), userAgent: userAgentFromHeaders(h) });
    return ok({ email: parsed.data.email });
  } catch (err) {
    if (err instanceof SignupError) {
      return err.code === "slugTaken" ? fail(t("slugTaken"), { slug: t("slugTaken") }) : fail(t("emailTaken"), { email: t("emailTaken") });
    }
    console.error("[signup] could not create school", err);
    return fail(t("tryAgain"));
  }
}

export type SlugStatus = "available" | "taken" | "reserved" | "format" | "slow";

/** Live "is this short name free?" check for the form. */
export async function checkSlugAction(raw: unknown): Promise<SlugStatus> {
  const slug = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 64) : "";
  const problem = slugProblem(slug);
  if (problem) return problem;
  const ip = clientIpFromHeaders(headers()) ?? "unknown-ip";
  if (!(await allowed([[`signup:slug:${ip}`, SIGNUP_LIMITS.slugChecksPerIp]]))) return "slow";
  return (await slugAvailable(slug)) ? "available" : "taken";
}
