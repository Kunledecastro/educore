import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkResetToken } from "@/lib/security/password-reset";
import { ResetForm } from "./form";

/** Choose a new password from an emailed link (Phase 6.1). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: { token?: string | string[] } }) {
  const t = await getTranslations("passwordReset");
  const token = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
  const state = token ? await checkResetToken(token) : "invalid";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-xl font-semibold">{t("resetTitle")}</h1>
        {state === "ok" && token ? (
          <ResetForm token={token} />
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-sm">{state === "expired" ? t("expired") : t("invalid")}</p>
            <Link href="/forgot-password" className="text-sm underline underline-offset-2">
              {t("askAgain")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
