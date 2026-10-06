import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { Role } from "@educore/db";
import { auth } from "./auth";
import { resolveImpersonation, type Impersonation } from "./impersonation";
import { IMPERSONATION_COOKIE } from "./impersonation-token";
import { studentMayUseLogin } from "./student-logins-data";
import type { AuthStage } from "./security/rules";
import { securityState } from "./security/two-factor";

/**
 * Where the signed-in person stands (Phase 6): "ok", or still owing the 2FA
 * code ("verify") or 2FA set-up ("setup"). Null = not signed in, or the
 * session was ended (password reset, 2FA change, account switched off).
 * Only the 2FA pages use the non-"ok" stages; everything else goes through
 * getEffectiveSession(), which treats them as signed out.
 */
export const getSignInStage = cache(async (): Promise<{ stage: AuthStage; userId: string; role: Role; email: string; name: string; sid: string } | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const state = await securityState(session.user.id);
  if (!state || !state.isActive || state.sessionVersion !== session.sv) return null;
  return { stage: state.stage(session.mfa === "ok"), userId: state.id, role: state.role, email: state.email, name: session.user.name ?? "", sid: session.sid };
});

export interface EffectiveUser {
  id: string;
  role: Role;
  tenantId: string | null;
  name: string;
  email: string;
  /** Students on a one-time password must choose their own before anything else (Phase 5.0). */
  mustChangePassword?: boolean;
}

/**
 * Who this request acts as. Normally the signed-in user. For a platform
 * admin with a live support impersonation, the school admin they're working
 * as — plus `impersonation` describing the real person behind it. Cached
 * per request; the layout and requireUser() both use it, so they never
 * disagree.
 */
export const getEffectiveSession = cache(async (): Promise<{ user: EffectiveUser; impersonation: Impersonation | null } | null> => {
  const session = await auth();
  if (!session?.user) return null;
  // Signed out everywhere, or still owing the 2FA step: not signed in for anything else.
  const stage = await getSignInStage();
  if (!stage || stage.stage !== "ok") return null;
  const real: EffectiveUser = {
    id: session.user.id,
    role: session.user.role,
    tenantId: session.user.tenantId ?? null,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
  };
  if (real.role === Role.STUDENT) {
    // A student's login can be switched off at any time (them, their class, or the school): checked on every request.
    const access = await studentMayUseLogin(real.id);
    if (!access.ok) return null;
    return { user: { ...real, mustChangePassword: access.mustChangePassword }, impersonation: null };
  }
  if (real.role !== Role.PLATFORM_ADMIN) return { user: real, impersonation: null };
  const cookie = cookies().get(IMPERSONATION_COOKIE)?.value;
  if (!cookie) return { user: real, impersonation: null };
  const imp = await resolveImpersonation(real.id, cookie);
  if (!imp) return { user: real, impersonation: null };
  return { user: { ...imp.target }, impersonation: imp };
});
