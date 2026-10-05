import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Role } from "@educore/db";
import { getEffectiveSession } from "@/lib/session";
import { ChangePasswordForm } from "./form";

/** Students choose their own password (forced after signing in with a printed one-time password). */
export default async function ChangePasswordPage() {
  const session = await getEffectiveSession();
  if (!session) redirect("/login");
  if (session.user.role !== Role.STUDENT) redirect("/dashboard");
  const t = await getTranslations("changePassword");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">{session.user.mustChangePassword ? t("titleFirst") : t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{session.user.mustChangePassword ? t("introFirst", { name: session.user.name }) : t("intro")}</p>
        </div>
        <ChangePasswordForm username={session.user.name} />
      </div>
    </main>
  );
}
