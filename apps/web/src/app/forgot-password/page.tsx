import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { anyChannelEnabled } from "@/lib/notify/channels";
import { ForgotForm } from "./form";

/** Forgot password (Phase 6.1): we email a one-time link. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations("passwordReset");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{t("forgotTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("forgotIntro")}</p>
        </div>
        {anyChannelEnabled() ? <ForgotForm /> : <p className="rounded-md border p-4 text-sm">{t("emailOff")}</p>}
        <p className="text-sm text-muted-foreground">{t("pupils")}</p>
        <p className="text-center text-sm">
          <Link href="/login" className="underline underline-offset-2">
            {t("backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
