import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSignInStage } from "@/lib/session";
import { VerifyForm } from "./verify-form";

/** The code step after the password (Phase 6.0). */
export default async function TwoFactorPage() {
  const s = await getSignInStage();
  if (!s) redirect("/login");
  if (s.stage === "setup") redirect("/two-factor/setup");
  if (s.stage === "ok") redirect("/dashboard");
  const t = await getTranslations("twoFactor.verify");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("intro")}</p>
        </div>
        <VerifyForm />
      </div>
    </main>
  );
}
