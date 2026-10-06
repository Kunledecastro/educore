import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSignInStage } from "@/lib/session";
import { securityState } from "@/lib/security/two-factor";
import { SetupWizard } from "./wizard";

/**
 * Set up two-factor sign-in (Phase 6.0). Required roles land here straight
 * after the password and can't use anything else until it's done; anyone
 * else who's offered it comes here from Account → Security.
 */
export default async function TwoFactorSetupPage() {
  const s = await getSignInStage();
  if (!s) redirect("/login");
  if (s.stage === "verify") redirect("/two-factor");
  const state = await securityState(s.userId);
  if (!state?.offered) redirect("/dashboard");
  if (state.twoFactorEnabled) redirect("/account/security");
  const t = await getTranslations("twoFactor.setup");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{s.stage === "setup" ? t("introRequired") : t("introOptional")}</p>
        </div>
        <SetupWizard required={s.stage === "setup"} email={s.email} />
      </div>
    </main>
  );
}
